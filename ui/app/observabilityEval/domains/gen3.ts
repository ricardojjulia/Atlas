import { workflowsClient } from "@dynatrace-sdk/client-automation";
import { runDql, toNum } from "../queryRunner";
import { getSettingsObjectCounts } from "../../tenantReview/services/settingsService";
import { getDashboardSummary } from "../../tenantReview/services/dashboardService";
import { mkProbe, mkFinding, buildDomain } from "../domainUtils";
import type { ObsDomainResult } from "../types";

export async function runGen3Domain(): Promise<ObsDomainResult> {
  const [settingsResult, segmentsR, wfResult, dashSummary] = await Promise.all([
    getSettingsObjectCounts([
      "builtin:management-zones",
      "builtin:anomaly-detection.metric-events",
      "builtin:alerting.profile",
      "builtin:problem.notifications",
      "builtin:davis.anomaly-detectors",
      "builtin:monitoring.slos",
      "builtin:logmonitoring.log-dpp-processor-rule",
      "builtin:openpipeline.logs.pipelines",
      "builtin:alerting.maintenance-window",
      "builtin:maintenance-windows",
    ]),
    runDql("fetch dt.system.segments | summarize count()"),
    workflowsClient.getWorkflows({ limit: 200 }).catch(() => ({ count: 0, results: [] })),
    getDashboardSummary().catch(() => ({
      grailDashboardCount: 0, notebookCount: 0,
      classicDashboardCount: -1, sharedDocumentCount: 0,
    })),
  ]);

  const classicMz        = settingsResult.get("builtin:management-zones") ?? 0;
  const metricEvents     = settingsResult.get("builtin:anomaly-detection.metric-events") ?? 0;
  const alertingProfiles = settingsResult.get("builtin:alerting.profile") ?? 0;
  const problemNotifs    = settingsResult.get("builtin:problem.notifications") ?? 0;
  // null = schema not countable via Settings API on this tenant — fall back to classic-only scoring
  const gen3Detectors    = settingsResult.get("builtin:davis.anomaly-detectors") ?? null;
  const gen3SloCount     = settingsResult.get("builtin:monitoring.slos") ?? 0;
  const classicLogRules  = settingsResult.get("builtin:logmonitoring.log-dpp-processor-rule") ?? 0;
  const gen3Pipelines    = settingsResult.get("builtin:openpipeline.logs.pipelines") ?? 0;
  const classicMw        = settingsResult.get("builtin:alerting.maintenance-window") ?? 0;
  // null = gen3 maintenance windows schema not yet available on this tenant
  const gen3Mw           = settingsResult.get("builtin:maintenance-windows") ?? null;

  const segments         = toNum(segmentsR.records[0]?.["count()"]);
  const deployedWf       = (wfResult.results ?? []).filter(w => w.isDeployed === true).length;
  // classicDashboardCount < 0 means the classicDashboards app function failed or timed out
  const classicDash      = dashSummary.classicDashboardCount < 0 ? null : dashSummary.classicDashboardCount;
  const grailDash        = dashSummary.grailDashboardCount ?? 0;
  const classicAlertTotal = metricEvents + alertingProfiles + problemNotifs;

  // P1: Management Zone → Segment migration (weight 0.20)
  const p1Score = classicMz === 0 ? 100
    : segments >= classicMz ? 100
    : segments >= Math.ceil(classicMz * 0.5) ? 75
    : segments >= 1 ? 55
    : 20;
  const p1 = mkProbe(
    "gen3.mz2seg", "Management Zone → Segment migration", 0.20, p1Score,
    classicMz === 0
      ? "No classic Management Zones — nothing to migrate"
      : `${segments} Segment${segments !== 1 ? "s" : ""} vs ${classicMz} classic Management Zone${classicMz !== 1 ? "s" : ""}`,
    "≥ 1 Segment per Management Zone (or all MZs decommissioned)",
    segments === 0 && classicMz > 0 ? mkFinding(
      "gen3.mz2seg", "Management Zones Not Migrated to Segments",
      `${classicMz} classic Management Zone${classicMz !== 1 ? "s remain" : " remains"} with no Segments defined. Access-control and filter logic must be re-expressed as Segments backed by enriched entity tags.`,
      "warning",
      "Create a Segment for each Management Zone. Align boundaries with enriched tags (dt.owner, team, env). Complete MZ migration before migrating classic alerting.",
      `${classicMz} Management Zone${classicMz !== 1 ? "s" : ""}, 0 Segments`
    ) : segments < classicMz ? mkFinding(
      "gen3.mz2seg", "Segment Migration Incomplete",
      `${segments} of ${classicMz} Management Zones have Segment equivalents.`,
      "info",
      "Complete Segment definitions for remaining Management Zones. Validate data scoping before decommissioning MZ-based access policies."
    ) : undefined
  );

  // P2: Classic alerting migration (weight 0.18)
  // When builtin:davis.anomaly-detectors is countable: ratio probe (classic backlog vs gen3 detectors).
  // When not countable (gen3Detectors === null): score on classic backlog shrink alone.
  let p2Score: number;
  let p2Evidence: string;
  if (gen3Detectors !== null) {
    if      (classicAlertTotal === 0 && gen3Detectors >= 1)                            { p2Score = 100; }
    else if (classicAlertTotal === 0)                                                   { p2Score = 80; }
    else if (gen3Detectors >= classicAlertTotal)                                        { p2Score = 90; }
    else if (gen3Detectors >= Math.ceil(classicAlertTotal * 0.5))                      { p2Score = 70; }
    else if (classicAlertTotal <= 5)                                                    { p2Score = 65; }
    else if (classicAlertTotal <= 20)                                                   { p2Score = 45; }
    else if (classicAlertTotal <= 50)                                                   { p2Score = 30; }
    else                                                                                { p2Score = 15; }
    p2Evidence = `${classicAlertTotal} classic alerting config${classicAlertTotal !== 1 ? "s" : ""} → ${gen3Detectors} gen3 Anomaly Detector${gen3Detectors !== 1 ? "s" : ""}`;
  } else {
    if      (classicAlertTotal === 0)  { p2Score = 100; }
    else if (classicAlertTotal <= 5)   { p2Score = 80; }
    else if (classicAlertTotal <= 20)  { p2Score = 60; }
    else if (classicAlertTotal <= 50)  { p2Score = 40; }
    else                               { p2Score = 20; }
    p2Evidence = `${classicAlertTotal} classic alerting config${classicAlertTotal !== 1 ? "s" : ""} (metric events: ${metricEvents}, profiles: ${alertingProfiles}, notifications: ${problemNotifs})`;
  }
  const p2 = mkProbe(
    "gen3.alerting", "Classic alerting config migration", 0.18, p2Score,
    p2Evidence,
    "0 classic alerting configs (all migrated to gen3 Anomaly Detectors)",
    classicAlertTotal > 0 ? mkFinding(
      "gen3.alerting", "Classic Alerting Configs Not Yet Migrated",
      `${classicAlertTotal} classic alerting configuration${classicAlertTotal !== 1 ? "s" : ""} remain: ${metricEvents} metric event rule${metricEvents !== 1 ? "s" : ""}, ${alertingProfiles} alerting profile${alertingProfiles !== 1 ? "s" : ""}, ${problemNotifs} problem notification${problemNotifs !== 1 ? "s" : ""}.`,
      classicAlertTotal > 20 ? "warning" : "info",
      "Migrate metric event rules to gen3 Anomaly Detectors. Migrate problem notifications to AutomationEngine Workflows. Complete Management Zone → Segment migration first.",
      `${classicAlertTotal} classic configs pending`
    ) : undefined
  );

  // P3: Gen3 SLO adoption (weight 0.16)
  // Classic SLO count is not accessible via Settings 2.0 — score on gen3 adoption only.
  const p3Score = gen3SloCount >= 10 ? 100 : gen3SloCount >= 5 ? 85 : gen3SloCount >= 2 ? 70 : gen3SloCount === 1 ? 55 : 20;
  const p3 = mkProbe(
    "gen3.slo", "Gen3 SLO adoption", 0.16, p3Score,
    `${gen3SloCount} gen3 SLO${gen3SloCount !== 1 ? "s" : ""} configured`,
    "≥ 5 gen3 SLOs configured",
    gen3SloCount === 0 ? mkFinding(
      "gen3.slo", "No Gen3 SLOs Configured",
      "No gen3 Service Level Objectives are defined. Classic SLOs do not support Grail-backed burn rate or AutomationEngine integration.",
      "info",
      "Migrate classic SLOs to gen3 using Settings → Service-Level Objectives. Gen3 SLOs support error budget burn rate, multi-window alerting, and workflow-based notification."
    ) : undefined
  );

  // P4: OpenPipeline vs Classic log processing (weight 0.15)
  // score=50 (unknown/sentinel) when neither side has any config — no log processing is N/A, not a gap
  let p4Score: number;
  let p4Finding;
  if (gen3Pipelines >= 1 && classicLogRules === 0) {
    p4Score = 100;
  } else if (gen3Pipelines >= 1 && classicLogRules > 0) {
    p4Score = 75;
    p4Finding = mkFinding(
      "gen3.openpipeline", "Classic Log Rules Active Alongside OpenPipeline",
      `${classicLogRules} classic log processing rule${classicLogRules !== 1 ? "s" : ""} active alongside ${gen3Pipelines} OpenPipeline pipeline${gen3Pipelines !== 1 ? "s" : ""}. Classic LMA rules are deprecated and will be removed in Phase 3.`,
      "info",
      "Validate OpenPipeline pipeline equivalents, then decommission classic log processing rules."
    );
  } else if (gen3Pipelines === 0 && classicLogRules === 0) {
    p4Score = 50; // N/A — log processing not configured on this tenant
  } else {
    p4Score = 20;
    p4Finding = mkFinding(
      "gen3.openpipeline", "Classic Log Processing Not Migrated to OpenPipeline",
      `${classicLogRules} classic log processing rule${classicLogRules !== 1 ? "s" : ""} active with no OpenPipeline pipeline configured. Classic LMA rules are deprecated.`,
      "warning",
      "Create OpenPipeline log pipelines to replace classic LMA rules. Validate routing, parsing, and masking before removing classic rules."
    );
  }
  const p4 = mkProbe(
    "gen3.openpipeline", "OpenPipeline log migration", 0.15, p4Score,
    gen3Pipelines === 0 && classicLogRules === 0
      ? "No log processing configured (N/A)"
      : `${gen3Pipelines} OpenPipeline pipeline${gen3Pipelines !== 1 ? "s" : ""}, ${classicLogRules} classic log rule${classicLogRules !== 1 ? "s" : ""}`,
    "≥ 1 OpenPipeline pipeline, 0 classic log rules",
    p4Finding
  );

  // P5: Maintenance Window migration (weight 0.13)
  // Ratio probe when builtin:maintenance-windows schema is available; classic-only fallback otherwise.
  let p5Score: number;
  let p5Evidence: string;
  if (gen3Mw !== null) {
    if      (classicMw === 0 && gen3Mw >= 1) { p5Score = 100; }
    else if (classicMw === 0)                { p5Score = 85; }
    else if (gen3Mw >= classicMw)            { p5Score = 100; }
    else if (gen3Mw >= Math.ceil(classicMw * 0.5)) { p5Score = 70; }
    else if (gen3Mw >= 1)                    { p5Score = 55; }
    else                                     { p5Score = 20; }
    p5Evidence = `${gen3Mw} gen3 Maintenance Window${gen3Mw !== 1 ? "s" : ""} vs ${classicMw} classic`;
  } else {
    if      (classicMw === 0)  { p5Score = 100; }
    else if (classicMw <= 3)   { p5Score = 70; }
    else if (classicMw <= 10)  { p5Score = 51; } // non-sentinel: real partial, not unknown
    else                       { p5Score = 30; }
    p5Evidence = `${classicMw} classic Maintenance Window${classicMw !== 1 ? "s" : ""} (gen3 count unavailable)`;
  }
  const p5 = mkProbe(
    "gen3.maint", "Maintenance Window migration", 0.13, p5Score,
    p5Evidence,
    "0 classic maintenance windows (all recreated in gen3)",
    classicMw > 0 && (gen3Mw === null || gen3Mw < classicMw) ? mkFinding(
      "gen3.maint", "Classic Maintenance Windows Not Fully Migrated",
      gen3Mw !== null
        ? `${classicMw} classic maintenance windows with only ${gen3Mw} gen3 equivalents configured.`
        : `${classicMw} classic maintenance window${classicMw !== 1 ? "s" : ""} must be recreated using the gen3 Maintenance Windows feature.`,
      "info",
      "Recreate all classic maintenance windows using the gen3 Maintenance Windows feature before Phase 3 cutover."
    ) : undefined
  );

  // P6: AutomationEngine workflow adoption (weight 0.10)
  const p6Score = deployedWf >= 10 ? 100 : deployedWf >= 5 ? 80 : deployedWf >= 2 ? 65 : deployedWf === 1 ? 55 : 20;
  const p6 = mkProbe(
    "gen3.workflows", "AutomationEngine workflow adoption", 0.10, p6Score,
    `${deployedWf} deployed workflow${deployedWf !== 1 ? "s" : ""}`,
    "≥ 5 deployed workflows",
    deployedWf === 0 ? mkFinding(
      "gen3.workflows", "No Deployed Workflows",
      "AutomationEngine workflows are the gen3 replacement for classic problem notifications and scheduled tasks. No deployed workflows were found.",
      "warning",
      "Migrate classic notification integrations to AutomationEngine Workflows. At minimum, create workflows for critical alert routing and incident escalation."
    ) : undefined
  );

  // P7: Classic Dashboard migration (weight 0.08)
  // classicDash=null when the classicDashboards app function failed — sentinel score 50.
  let p7Score: number;
  let p7Evidence: string;
  if (classicDash === null) {
    p7Score = 50; // unknown — app function unavailable
    p7Evidence = "Classic dashboard count unavailable";
  } else if (classicDash === 0) {
    p7Score = 100;
    p7Evidence = `${grailDash} Grail dashboard${grailDash !== 1 ? "s" : ""}, 0 classic`;
  } else if (grailDash >= classicDash) {
    p7Score = 90;
    p7Evidence = `${grailDash} Grail vs ${classicDash} classic dashboards — migration coverage sufficient`;
  } else if (grailDash >= Math.ceil(classicDash * 0.5)) {
    p7Score = 65;
    p7Evidence = `${grailDash} Grail vs ${classicDash} classic dashboards`;
  } else if (grailDash >= 1) {
    p7Score = 55;
    p7Evidence = `${grailDash} Grail vs ${classicDash} classic dashboards`;
  } else {
    p7Score = 20;
    p7Evidence = `0 Grail dashboards, ${classicDash} classic dashboards remaining`;
  }
  const p7 = mkProbe(
    "gen3.dashboards", "Classic Dashboard migration", 0.08, p7Score,
    p7Evidence,
    "0 classic dashboards (all recreated as Grail Dashboards or Notebooks)",
    classicDash !== null && classicDash > 0 && grailDash < classicDash ? mkFinding(
      "gen3.dashboards", "Classic Dashboards Not Fully Migrated",
      `${classicDash} classic dashboard${classicDash !== 1 ? "s" : ""} remaining. Classic dashboards cannot query Grail data sources or use gen3 DQL tiles.`,
      "info",
      "Recreate classic dashboards as Grail-backed Dashboards or Notebooks. Use DQL equivalents of V1 tile queries."
    ) : undefined
  );

  return buildDomain("gen3", "Gen3 Migration Readiness", "◈", [p1, p2, p3, p4, p5, p6, p7]);
}
