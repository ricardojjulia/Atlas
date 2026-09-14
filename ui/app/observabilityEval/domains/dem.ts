import { runDql, toNum } from "../queryRunner";
import { getSettingsObjectCounts } from "../../tenantReview/services/settingsService";
import { mkProbe, mkFinding, buildDomain } from "../domainUtils";
import type { ObsDomainResult } from "../types";

export async function runDemDomain(): Promise<ObsDomainResult> {
  const [appR, rumR, synthR, synthGrailR, settingsResult] = await Promise.all([
    runDql("fetch dt.entity.application | summarize count()"),
    runDql("fetch user.events, from:now()-30d | summarize total = count()"),
    runDql("fetch dt.entity.synthetic_test | fieldsAdd entity.name, type | summarize testCount = count(), by:{type}"),
    runDql("fetch dt.synthetic.events, from:now()-30d | summarize total = count()"),
    getSettingsObjectCounts(["builtin:sessionreplay.web.privacy-preferences"]),
  ]);

  const appCount = toNum(appR.records[0]?.["count()"]);
  const rumVolume = toNum(rumR.records[0]?.["total"]);
  const synthTotal = synthR.records.reduce((s, r) => s + toNum(r["testCount"]), 0);
  const synthGrailTotal = toNum(synthGrailR.records[0]?.["total"]);
  const sessionReplayCount = settingsResult.get("builtin:sessionreplay.web.privacy-preferences") ?? 0;

  // P1: Web applications monitored
  const p1Score = appCount >= 3 ? 100 : appCount >= 1 ? 70 : 0;
  const p1 = mkProbe(
    "dem.apps", "Web applications configured", 0.25, p1Score,
    `${appCount} web application${appCount !== 1 ? "s" : ""} configured for RUM monitoring`,
    "≥ 1 web application instrumented",
    appCount === 0 ? mkFinding(
      "dem.apps", "No Web Applications Configured",
      "No web applications are configured for Real User Monitoring.",
      "warning",
      "Configure RUM for customer-facing web applications by injecting the Dynatrace JavaScript tag or using OneAgent auto-injection.",
      "0 web applications"
    ) : undefined
  );

  // P2: RUM user event volume — scored per app to avoid rewarding near-dead single-app deployments
  const eventsPerApp = appCount > 0 ? Math.round(rumVolume / appCount) : 0;
  const p2Score = rumVolume === 0 && appCount > 0 ? 0
    : rumVolume === 0 ? 50
    : eventsPerApp >= 100000 ? 100   // 100k events/app/30d — active real users
    : eventsPerApp >= 10000 ? 80     // 10k events/app/30d — moderate traffic
    : eventsPerApp >= 1000 ? 60      // 1k events/app/30d — minimal
    : 40;                            // < 1k — very low (test/staging-like)
  const p2 = mkProbe(
    "dem.rumvolume", "RUM user event volume", 0.25, p2Score,
    appCount > 0
      ? `${rumVolume.toLocaleString()} user events in 30 days (~${eventsPerApp.toLocaleString()} per app)`
      : `${rumVolume.toLocaleString()} user events ingested in last 30 days`,
    "≥ 10,000 events per monitored app in 30 days",
    rumVolume === 0 && appCount > 0 ? mkFinding(
      "dem.rumvolume", "No RUM User Events Detected",
      "Web applications are configured but no user events are flowing into Grail.",
      "warning",
      "Verify the Dynatrace JavaScript tag is deployed and users are actively accessing the application.",
      `0 user events | ${appCount} app${appCount !== 1 ? "s" : ""} configured`
    ) : undefined
  );

  // P3: Session replay configured — proportional to app count (1 config for 20 apps is not good coverage)
  const srCovPct = appCount > 0 ? Math.round(((sessionReplayCount ?? 0) / appCount) * 100) : 0;
  const p3Score = appCount === 0 && (sessionReplayCount ?? 0) === 0 ? 50
    : (sessionReplayCount ?? 0) === 0 ? 40
    : (sessionReplayCount ?? 0) >= appCount ? 100   // all apps covered
    : srCovPct >= 50 ? 80                           // majority covered
    : 60;                                           // some coverage
  const p3 = mkProbe(
    "dem.sessionreplay", "Session replay configured", 0.15, p3Score,
    appCount > 0
      ? `${sessionReplayCount ?? 0} of ${appCount} app${appCount !== 1 ? "s" : ""} with session replay (${srCovPct}%)`
      : `${sessionReplayCount ?? 0} session replay privacy preference${sessionReplayCount !== 1 ? "s" : ""} configured`,
    "Session replay configured for all monitored apps",
    (sessionReplayCount ?? 0) === 0 && appCount > 0 ? mkFinding(
      "dem.sessionreplay", "Session Replay Not Configured",
      "Web applications exist but no session replay privacy preferences are configured.",
      "info",
      "Configure session replay to enable user session playback for UX troubleshooting and journey analysis."
    ) : undefined
  );

  // P4: Synthetic monitors
  const p4Score = synthTotal >= 5 ? 100 : synthTotal >= 2 ? 70 : synthTotal >= 1 ? 50 : 0;
  const p4 = mkProbe(
    "dem.synthetic", "Synthetic monitors configured", 0.20, p4Score,
    `${synthTotal} synthetic monitor${synthTotal !== 1 ? "s" : ""} configured`,
    "≥ 5 synthetic monitors",
    synthTotal === 0 ? mkFinding(
      "dem.synthetic", "No Synthetic Monitors Configured",
      "No synthetic monitors are configured. Synthetic monitoring provides availability and performance baselines for critical user journeys.",
      "warning",
      "Create synthetic browser monitors for critical user journeys and HTTP monitors for API endpoint health checks.",
      "0 synthetic monitors"
    ) : synthTotal < 3 ? mkFinding(
      "dem.synthetic", "Limited Synthetic Monitor Coverage",
      `Only ${synthTotal} synthetic monitor${synthTotal !== 1 ? "s are" : " is"} configured — insufficient for meaningful availability monitoring.`,
      "info",
      "Expand synthetic monitor coverage to key user journeys, API endpoints, and critical internal services.",
      `${synthTotal} monitor${synthTotal !== 1 ? "s" : ""} configured`
    ) : undefined
  );

  // P5: Synthetic execution data in Grail
  const p5Score = synthGrailTotal > 0 ? 100 : synthTotal > 0 ? 30 : 50;
  const p5 = mkProbe(
    "dem.synthgrail", "Synthetic execution data in Grail", 0.15, p5Score,
    `${synthGrailTotal.toLocaleString()} synthetic execution events in Grail (last 30 days)`,
    "> 0 synthetic events in Grail",
    synthGrailTotal === 0 && synthTotal > 0 ? mkFinding(
      "dem.synthgrail", "Synthetic Events Not Flowing to Grail",
      "Synthetic monitors exist but no execution events are found in Grail. DQL-based analysis of synthetic data is unavailable.",
      "info",
      "Verify synthetic monitor configuration and check that the tenant's Grail data pipeline is healthy.",
      `0 events | ${synthTotal} monitor${synthTotal !== 1 ? "s" : ""} configured`
    ) : undefined
  );

  return buildDomain("dem", "Digital Experience (DEM/RUM)", "◉", [p1, p2, p3, p4, p5]);
}
