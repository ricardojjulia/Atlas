import { runDql, toNum } from "../queryRunner";
import { mkProbe, mkFinding, buildDomain } from "../domainUtils";
import type { ObsDomainResult } from "../types";

export async function runInfraDomain(segFilter: string): Promise<ObsDomainResult> {
  const sf = segFilter ? `| filter filterSegments("${segFilter}")` : "";

  const [hostR, svcR, activeSpanSvcR, stalePgiR, k8sR] = await Promise.all([
    // 30d staleness filter removes decommissioned hosts from the monitored count
    runDql("fetch dt.entity.host | filter toTimestamp(lastSeenTms) > now() - 30d | summarize count()"),
    runDql("fetch dt.entity.service | filter toTimestamp(lastSeenTms) > now() - 30d | summarize count()"),
    // 7d window avoids false ghost readings from batch/weekly workloads with irregular traffic
    runDql(`fetch spans, from:now()-7d\n${sf}\n| filter isNotNull(dt.entity.service)\n| summarize active = countDistinct(dt.entity.service)`),
    // 30d window aligns with entity staleness convention used across the app
    runDql("fetch dt.entity.process_group_instance | filter isNotNull(lastSeenTms) and toTimestamp(lastSeenTms) < now() - 30d | summarize count()"),
    runDql("fetch dt.entity.kubernetes_cluster | filter toTimestamp(lastSeenTms) > now() - 30d | summarize count()"),
  ]);

  // P1: Host baseline
  const hostCount = toNum(hostR.records[0]?.["count()"]);
  const p1Score = hostCount >= 1 ? 100 : 0;
  const p1 = mkProbe(
    "infra.hosts", "Hosts monitored", 0.20, p1Score,
    `${hostCount} host${hostCount !== 1 ? "s" : ""} monitored by OneAgent`,
    "≥ 1 host monitored",
    hostCount === 0 ? mkFinding(
      "infra.hosts", "No Hosts Detected",
      "No hosts are being monitored. OneAgent may not be deployed.",
      "critical",
      "Deploy OneAgent on at least one host to begin infrastructure monitoring."
    ) : undefined
  );

  // P2: Service detection — totalSvcs reuses svcCount (eliminated duplicate query)
  const svcCount = toNum(svcR.records[0]?.["count()"]);
  const totalSvcs = svcCount;
  const p2Score = svcCount >= 5 ? 100 : svcCount >= 1 ? 70 : hostCount > 0 ? 0 : 50;
  const p2 = mkProbe(
    "infra.services", "Service detection", 0.20, p2Score,
    `${svcCount} service${svcCount !== 1 ? "s" : ""} detected in topology`,
    "≥ 5 services detected",
    svcCount === 0 && hostCount > 0 ? mkFinding(
      "infra.services", "No Services Detected",
      "Hosts are monitored but no services are detected in the topology.",
      "warning",
      "Verify that OneAgent service detection rules are configured and application traffic is flowing."
    ) : undefined
  );

  // P3: Active service rate (services with live spans in last 7d)
  const activeSvcs = toNum(activeSpanSvcR.records[0]?.["active"]);
  const activePct = totalSvcs > 0 ? Math.round((activeSvcs / totalSvcs) * 100) : 0;
  const ghostCount = Math.max(0, totalSvcs - activeSvcs);
  // Math.max(51,...) prevents exact-50% active rate colliding with the unknown sentinel
  const p3Score = totalSvcs === 0 ? 50 : activePct >= 75 ? 100 : activePct >= 50 ? Math.max(51, activePct) : Math.round(activePct * 0.6);
  const p3 = mkProbe(
    "infra.activesvcs", "Active service rate", 0.25, p3Score,
    `${activeSvcs} of ${totalSvcs} services with live traffic in last 7 days (${activePct}%)`,
    "≥ 75% of services actively receiving traffic",
    ghostCount > totalSvcs * 0.25 ? mkFinding(
      "infra.activesvcs", "High Ghost Service Ratio",
      `${ghostCount} service${ghostCount !== 1 ? "s" : ""} (${100 - activePct}%) exist in topology but sent no request data in the last 7 days.`,
      ghostCount > totalSvcs * 0.5 ? "warning" : "info",
      "Review ghost services — decommissioned services should be removed to keep topology clean.",
      `Ghost services: ${ghostCount} | Active: ${activeSvcs}`
    ) : undefined
  );

  // P4: Stale process group instances
  const stalePgis = toNum(stalePgiR.records[0]?.["count()"]);
  const p4Score = stalePgis === 0 ? 100 : stalePgis <= 10 ? 70 : stalePgis <= 50 ? 40 : 0;
  const p4 = mkProbe(
    "infra.stalepgi", "Stale process group instances", 0.15, p4Score,
    `${stalePgis} process group instance${stalePgis !== 1 ? "s" : ""} not seen in > 30 days`,
    "0 stale process group instances",
    stalePgis > 0 ? mkFinding(
      "infra.stalepgi", "Stale Process Group Instances",
      `${stalePgis} process group instance${stalePgis !== 1 ? "s" : ""} last seen more than 30 days ago.`,
      stalePgis > 50 ? "warning" : "info",
      "Review stale PGIs — decommissioned processes accumulate over time and inflate entity counts.",
      `${stalePgis} stale PGIs (last seen > 30 days)`
    ) : undefined
  );

  // P5: Kubernetes monitoring
  const k8sClusters = toNum(k8sR.records[0]?.["count()"]);
  const p5Score = k8sClusters >= 1 ? 100 : 50;
  const p5 = mkProbe(
    "infra.k8s", "Kubernetes cluster monitoring", 0.20, p5Score,
    k8sClusters === 0 ? "No Kubernetes clusters detected (may not apply)" : `${k8sClusters} Kubernetes cluster${k8sClusters !== 1 ? "s" : ""} monitored`,
    "≥ 1 Kubernetes cluster monitored (if applicable)"
  );

  return buildDomain("infra", "Infrastructure Coverage", "▦", [p1, p2, p3, p4, p5]);
}
