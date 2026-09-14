import { runDql, toNum, toStr } from "../queryRunner";
import { mkProbe, mkFinding, buildDomain } from "../domainUtils";
import type { ObsDomainResult } from "../types";

export async function runOneAgentDomain(): Promise<ObsDomainResult> {
  // Exclude hosts not seen in 30 days to avoid stale decommissioned entities inflating denominators
  const ACTIVE_HOST_FILTER = "filter toTimestamp(lastSeenTms) > now() - 30d";
  const [modeR, versionR, noGroupR, totalR, candidatesR, zonesR] = await Promise.all([
    runDql(`fetch dt.entity.host | ${ACTIVE_HOST_FILTER} | summarize hostCount = count(), by:{monitoringMode}`),
    // Filter null agentVersion rows — if installerVersion field is absent, all return null → shows 0 versions (unknown)
    runDql(`fetch dt.entity.host | ${ACTIVE_HOST_FILTER} | fieldsAdd agentVersion = installerVersion | filter isNotNull(agentVersion) | summarize hostCount = count(), by:{agentVersion} | sort hostCount desc`),
    runDql(`fetch dt.entity.host | ${ACTIVE_HOST_FILTER} | filter isNull(dt.host_group.id) OR dt.host_group.id == "" | summarize count()`),
    runDql(`fetch dt.entity.host | ${ACTIVE_HOST_FILTER} | summarize count()`),
    runDql("fetch dt.entity.host | filter isMonitoringCandidate == true | summarize count()"),
    runDql(`fetch dt.entity.host | ${ACTIVE_HOST_FILTER} | fieldsAdd networkZone | summarize hostCount = count(), by:{networkZone} | sort hostCount desc`),
  ]);

  const totalHosts = toNum(totalR.records[0]?.["count()"]);

  // P1: Full-stack coverage
  const fullStackCount = toNum(
    modeR.records.find(r => toStr(r["monitoringMode"]) === "FULL_STACK")?.["hostCount"]
  );
  const fsPct = totalHosts > 0 ? Math.round((fullStackCount / totalHosts) * 100) : 0;
  const p1Score = totalHosts === 0 ? 50 : fsPct >= 80 ? 100 : fsPct >= 50 ? fsPct : Math.round(fsPct * 0.5);
  const p1 = mkProbe(
    "oa.fullstack", "Full-stack mode coverage", 0.30, p1Score,
    `${fullStackCount} of ${totalHosts} hosts in FULL_STACK mode (${fsPct}%)`,
    "≥ 80% of hosts in FULL_STACK mode",
    p1Score < 100 && totalHosts > 0 ? mkFinding(
      "oa.fullstack", "OneAgent Full-Stack Coverage Gap",
      `${fsPct}% of hosts (${fullStackCount}/${totalHosts}) are in full-stack monitoring mode.`,
      fsPct >= 50 ? "warning" : "critical",
      "Enable full-stack monitoring on all hosts to gain deep-level code and infrastructure visibility.",
      `Full-stack: ${fullStackCount} | Other modes: ${totalHosts - fullStackCount}`
    ) : undefined
  );

  // P2: Agent version uniformity (null versions filtered in query — if 0 records, installerVersion field unavailable → unknown)
  const distinctVersions = versionR.records.length;
  const p2Score = distinctVersions === 0 ? 50 : distinctVersions <= 2 ? 100 : distinctVersions <= 5 ? 60 : 0;
  const p2 = mkProbe(
    "oa.versions", "Agent version uniformity", 0.20, p2Score,
    `${distinctVersions} distinct OneAgent version${distinctVersions !== 1 ? "s" : ""} detected`,
    "≤ 2 distinct agent versions in fleet",
    p2Score < 100 && distinctVersions > 0 ? mkFinding(
      "oa.versions", "OneAgent Version Fragmentation",
      `${distinctVersions} distinct OneAgent versions are running across the estate.`,
      distinctVersions > 5 ? "warning" : "info",
      "Enable auto-update policies or standardize OneAgent versions to reduce operational risk.",
      `${distinctVersions} distinct versions across fleet`
    ) : undefined
  );

  // P3: Host group assignment
  const hostsNoGroup = toNum(noGroupR.records[0]?.["count()"]);
  const assignedPct = totalHosts > 0 ? Math.round(((totalHosts - hostsNoGroup) / totalHosts) * 100) : 0;
  const p3Score = totalHosts === 0 ? 50 : assignedPct >= 80 ? 100 : assignedPct >= 50 ? assignedPct : Math.round(assignedPct * 0.5);
  const p3 = mkProbe(
    "oa.hostgroups", "Host group assignment", 0.20, p3Score,
    `${hostsNoGroup} of ${totalHosts} hosts without a host group`,
    "≥ 80% of hosts assigned to a host group",
    hostsNoGroup > 0 && totalHosts > 0 ? mkFinding(
      "oa.hostgroups", "Host Group Assignment Gap",
      `${hostsNoGroup} hosts (${100 - assignedPct}%) have no host group assignment.`,
      hostsNoGroup > totalHosts * 0.2 ? "warning" : "info",
      "Assign all hosts to host groups to enable topology-aware alerting and management zone scoping.",
      `${hostsNoGroup} hosts without host group`
    ) : undefined
  );

  // P4: Monitoring candidates
  const candidates = toNum(candidatesR.records[0]?.["count()"]);
  const p4Score = candidates === 0 ? 100 : candidates <= 5 ? 60 : 0;
  const p4 = mkProbe(
    "oa.candidates", "Monitoring candidates", 0.15, p4Score,
    `${candidates} unmonitored host candidate${candidates !== 1 ? "s" : ""} detected`,
    "0 unmonitored candidates",
    candidates > 0 ? mkFinding(
      "oa.candidates", "Unmonitored Host Candidates Detected",
      `${candidates} host${candidates !== 1 ? "s are" : " is"} visible to Dynatrace but not instrumented.`,
      candidates > 10 ? "warning" : "info",
      "Deploy OneAgent on monitoring candidate hosts to eliminate observability blind spots.",
      `${candidates} unmonitored candidate${candidates !== 1 ? "s" : ""}`
    ) : undefined
  );

  // P5: Network zones — 0 zones is common for direct SaaS-connected tenants (not a failure, treated as N/A)
  const zoneRows = zonesR.records.filter(r => {
    const z = toStr(r["networkZone"]);
    return z !== "null" && z !== "" && z !== "unknown";
  });
  const zoneCount = zoneRows.length;
  const p5Score = zoneCount >= 2 ? 100 : zoneCount === 1 ? 70 : 50;
  const p5 = mkProbe(
    "oa.networkzones", "Network zone utilization", 0.15, p5Score,
    `${zoneCount} network zone${zoneCount !== 1 ? "s" : ""} with host assignments`,
    "≥ 2 network zones active",
    zoneCount === 0 ? mkFinding(
      "oa.networkzones", "No Network Zones Configured",
      "No hosts are assigned to network zones, limiting ActiveGate routing flexibility.",
      "info",
      "Configure network zones and assign hosts to route telemetry through appropriate ActiveGates."
    ) : undefined
  );

  return buildDomain("oneagent", "OneAgent Deployment", "◈", [p1, p2, p3, p4, p5]);
}
