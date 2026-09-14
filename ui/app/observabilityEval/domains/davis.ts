import { runDql, toNum } from "../queryRunner";
import { getSettingsObjectCounts, getSettingsEnabledCounts } from "../../tenantReview/services/settingsService";
import { mkProbe, mkFinding, buildDomain } from "../domainUtils";
import type { ObsDomainResult } from "../types";

export async function runDavisDomain(): Promise<ObsDomainResult> {
  const [problemsR, davisEventsR, sloR, settingsCounts, settingsEnabled] = await Promise.all([
    runDql("fetch events, from:now()-30d | filter event.kind == \"DAVIS_PROBLEM\" | summarize count()"),
    runDql("fetch events, from:now()-30d | filter event.kind == \"DAVIS_EVENT\" | summarize total = count()"),
    runDql("fetch dt.entity.service_level_objective | summarize count()"),
    getSettingsObjectCounts([
      "builtin:davis.anomaly-detectors",
      "builtin:alerting.maintenance-window",
    ]),
    getSettingsEnabledCounts([
      "builtin:alerting.profile",
    ]),
  ]);

  const problemCount = toNum(problemsR.records[0]?.["count()"]);
  const davisEventTotal = toNum(davisEventsR.records[0]?.["total"]);
  const sloCount = toNum(sloR.records[0]?.["count()"]);
  const davisDetectors = settingsCounts.get("builtin:davis.anomaly-detectors") ?? 0;
  const maintenanceWindows = settingsCounts.get("builtin:alerting.maintenance-window") ?? 0;
  const alertingProfiles = settingsEnabled.get("builtin:alerting.profile");
  const enabledAlertingProfiles = alertingProfiles?.enabled ?? 0;

  // P1: Custom anomaly detector rules (supplements built-in Davis AI baselines — 0 custom rules is normal and valid)
  // Note: builtin:davis.anomaly-detectors counts user-defined custom threshold rules, NOT built-in Davis AI detection.
  // A tenant with 0 custom detectors may still have fully functional built-in Davis AI (evidenced by P2 events).
  const p1Score = (davisDetectors ?? 0) >= 5 ? 100 : (davisDetectors ?? 0) >= 2 ? 80 : (davisDetectors ?? 0) === 1 ? 70 : 50;
  const p1 = mkProbe(
    "davis.detectors", "Custom anomaly detector rules", 0.20, p1Score,
    `${davisDetectors ?? 0} custom anomaly detector rule${davisDetectors !== 1 ? "s" : ""} configured (built-in Davis AI baselines are always active)`,
    "≥ 2 custom anomaly detector rules for fine-tuned alerting",
    (davisDetectors ?? 0) === 0 ? mkFinding(
      "davis.detectors", "No Custom Anomaly Detector Rules",
      "No custom anomaly detector rules are defined. Built-in Davis AI baselines are active, but custom threshold rules for critical KPIs are missing.",
      "info",
      "Add custom anomaly detector rules for business-critical metrics where built-in AI baselines may be too broad or too sensitive.",
      "0 custom anomaly detector configurations"
    ) : undefined
  );

  // P2: Davis AI generating events (active problem detection)
  const p2Score = davisEventTotal > 100 ? 100 : davisEventTotal > 0 ? 80 : 0;
  const p2 = mkProbe(
    "davis.events", "Davis AI event activity", 0.15, p2Score,
    `${davisEventTotal.toLocaleString()} Davis events detected in last 30 days`,
    "> 0 Davis events (AI is actively evaluating)",
    davisEventTotal === 0 ? mkFinding(
      "davis.events", "Davis AI Not Generating Events",
      "No Davis events in the last 30 days — Davis AI may not be actively evaluating telemetry.",
      "warning",
      "Verify that Davis AI is enabled and that baseline data is sufficient for anomaly detection."
    ) : undefined
  );

  // P3: Problem count trend (open problems as health signal)
  // Guard: if Davis is not generating events at all (P2 = 0), zero problems means Davis is off, not that the env is healthy
  const p3Score = davisEventTotal === 0 ? 50 : problemCount === 0 ? 100 : problemCount < 10 ? 90 : problemCount < 50 ? 70 : problemCount < 200 ? 50 : 30;
  const p3 = mkProbe(
    "davis.problems", "Open problem count", 0.15, p3Score,
    `${problemCount.toLocaleString()} Davis problem${problemCount !== 1 ? "s" : ""} in last 30 days`,
    "Fewer active problems indicates healthy environment"
  );

  // P4: Alerting profiles (Gen3)
  const p4Score = enabledAlertingProfiles >= 3 ? 100 : enabledAlertingProfiles >= 1 ? 70 : 0;
  const p4 = mkProbe(
    "davis.alerting", "Alerting profiles configured", 0.20, p4Score,
    `${enabledAlertingProfiles} enabled alerting profile${enabledAlertingProfiles !== 1 ? "s" : ""}`,
    "≥ 3 alerting profiles configured",
    enabledAlertingProfiles === 0 ? mkFinding(
      "davis.alerting", "No Alerting Profiles Configured",
      "No alerting profiles are enabled. Davis problems will not trigger notifications.",
      "critical",
      "Configure alerting profiles to route Davis problems to the appropriate notification channels and teams.",
      "0 enabled alerting profiles"
    ) : enabledAlertingProfiles < 3 ? mkFinding(
      "davis.alerting", "Limited Alerting Profile Coverage",
      `Only ${enabledAlertingProfiles} alerting profile${enabledAlertingProfiles !== 1 ? "s are" : " is"} enabled.`,
      "info",
      "Create alerting profiles per team or environment to route notifications with appropriate severity filters."
    ) : undefined
  );

  // P5: SLOs defined
  const p5Score = sloCount >= 10 ? 100 : sloCount >= 5 ? 80 : sloCount >= 1 ? 60 : 0;
  const p5 = mkProbe(
    "davis.slos", "Service Level Objectives defined", 0.15, p5Score,
    `${sloCount} SLO${sloCount !== 1 ? "s" : ""} defined`,
    "≥ 10 SLOs defined for critical services",
    sloCount === 0 ? mkFinding(
      "davis.slos", "No Service Level Objectives Defined",
      "No SLOs are defined. Without SLOs, reliability targets are unmeasured and burn-rate alerts are unavailable.",
      "warning",
      "Define SLOs for critical services to establish reliability targets and enable Davis AI SLO-based alerting.",
      "0 SLO definitions"
    ) : sloCount < 5 ? mkFinding(
      "davis.slos", "Limited SLO Coverage",
      `Only ${sloCount} SLO${sloCount !== 1 ? "s are" : " is"} defined across all services.`,
      "info",
      "Expand SLO coverage to all customer-facing services and critical internal dependencies."
    ) : undefined
  );

  // P6: Maintenance windows
  const p6Score = (maintenanceWindows ?? 0) >= 1 ? 100 : 50;
  const p6 = mkProbe(
    "davis.maintenance", "Maintenance windows configured", 0.15, p6Score,
    `${maintenanceWindows ?? 0} maintenance window${maintenanceWindows !== 1 ? "s" : ""} configured`,
    "≥ 1 maintenance window defined",
    (maintenanceWindows ?? 0) === 0 ? mkFinding(
      "davis.maintenance", "No Maintenance Windows Configured",
      "No maintenance windows are defined. Planned maintenance activities will trigger false-positive Davis problems.",
      "info",
      "Create maintenance window schedules to suppress alerting during planned outages and deployments."
    ) : undefined
  );

  return buildDomain("davis", "Davis AI & Alerting", "△", [p1, p2, p3, p4, p5, p6]);
}
