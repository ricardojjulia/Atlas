import { runDql, toNum } from "../queryRunner";
import { getSettingsObjectCounts } from "../../tenantReview/services/settingsService";
import { mkProbe, mkFinding, buildDomain } from "../domainUtils";
import type { ObsDomainResult } from "../types";

export async function runDemDomain(): Promise<ObsDomainResult> {
  const [appR, rumR, synthR, synthGrailR, settingsResult] = await Promise.all([
    // Staleness filter — exclude decommissioned application entities
    runDql("fetch dt.entity.application | filter toTimestamp(lastSeenTms) > now() - 30d | summarize count()"),
    // user_actions is the correct Grail table for RUM user action data
    runDql("fetch user_actions, from:now()-30d | summarize total = count()"),
    // 30d staleness filter removes paused or deleted monitors from the coverage count
    runDql("fetch dt.entity.synthetic_test | filter toTimestamp(lastSeenTms) > now() - 30d | fieldsAdd entity.name, type | summarize testCount = count(), by:{type}"),
    // Synthetic events in Grail are stored as events with SYNTHETIC_EVENT kind
    runDql("fetch events, from:now()-30d | filter event.kind == \"SYNTHETIC_EVENT\" | summarize total = count()"),
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

  // P2: RUM user action volume — scored per app to avoid rewarding near-dead single-app deployments
  const eventsPerApp = appCount > 0 ? Math.round(rumVolume / appCount) : 0;
  const p2Score = rumVolume === 0 && appCount > 0 ? 0
    : rumVolume === 0 ? 50
    : eventsPerApp >= 100000 ? 100   // 100k actions/app/30d — active real users
    : eventsPerApp >= 10000 ? 80     // 10k actions/app/30d — moderate traffic
    : eventsPerApp >= 1000 ? 60      // 1k actions/app/30d — minimal
    : 40;                            // < 1k — very low (test/staging-like)
  const p2 = mkProbe(
    "dem.rumvolume", "RUM user action volume", 0.25, p2Score,
    appCount > 0
      ? `${rumVolume.toLocaleString()} user actions in 30 days (~${eventsPerApp.toLocaleString()} per app)`
      : `${rumVolume.toLocaleString()} user actions ingested in last 30 days`,
    "≥ 10,000 user actions per monitored app in 30 days",
    rumVolume === 0 && appCount > 0 ? mkFinding(
      "dem.rumvolume", "No RUM User Actions Detected",
      "Web applications are configured but no user action data is flowing into Grail.",
      "warning",
      "Verify the Dynatrace JavaScript tag is deployed and users are actively accessing the application.",
      `0 user actions | ${appCount} app${appCount !== 1 ? "s" : ""} configured`
    ) : undefined
  );

  // P3: Session replay configured — proportional to app count (1 config for 20 apps is not good coverage)
  const srCovPct = appCount > 0 ? Math.round(((sessionReplayCount ?? 0) / appCount) * 100) : 0;
  // Guard appCount=0 first — prevents N>=0 short-circuit giving score=100 when no apps exist
  const p3Score = appCount === 0 ? 50
    : (sessionReplayCount ?? 0) === 0 ? 40
    : (sessionReplayCount ?? 0) >= appCount ? 100   // all apps covered
    : srCovPct >= 50 ? 80                           // majority covered
    : 60;                                           // some coverage
  const p3 = mkProbe(
    "dem.sessionreplay", "Session replay configured", 0.15, p3Score,
    appCount > 0
      ? `${sessionReplayCount ?? 0} of ${appCount} app${appCount !== 1 ? "s" : ""} with session replay privacy config (${srCovPct}%)`
      : `${sessionReplayCount ?? 0} session replay privacy preference${sessionReplayCount !== 1 ? "s" : ""} configured`,
    "Session replay configured for all monitored apps",
    (sessionReplayCount ?? 0) === 0 && appCount > 0 ? mkFinding(
      "dem.sessionreplay", "Session Replay Not Configured",
      "Web applications exist but no session replay privacy preferences are configured.",
      "info",
      "Configure session replay to enable user session playback for UX troubleshooting and journey analysis."
    ) : undefined
  );

  // P4: Synthetic monitors — enterprise maturity expects broader coverage
  // Clamp 2–4 monitors to 55 to avoid sentinel=50 collision (real partial, not unknown)
  const p4Score = synthTotal >= 15 ? 100 : synthTotal >= 5 ? 75 : synthTotal >= 2 ? 55 : synthTotal >= 1 ? 40 : 0;
  const p4 = mkProbe(
    "dem.synthetic", "Synthetic monitors configured", 0.20, p4Score,
    `${synthTotal} synthetic monitor${synthTotal !== 1 ? "s" : ""} configured`,
    "≥ 15 synthetic monitors for enterprise coverage",
    synthTotal === 0 ? mkFinding(
      "dem.synthetic", "No Synthetic Monitors Configured",
      "No synthetic monitors are configured. Synthetic monitoring provides availability and performance baselines for critical user journeys.",
      "warning",
      "Create synthetic browser monitors for critical user journeys and HTTP monitors for API endpoint health checks.",
      "0 synthetic monitors"
    ) : synthTotal < 5 ? mkFinding(
      "dem.synthetic", "Limited Synthetic Monitor Coverage",
      `Only ${synthTotal} synthetic monitor${synthTotal !== 1 ? "s are" : " is"} configured — insufficient for enterprise availability monitoring.`,
      "info",
      "Expand synthetic monitor coverage to all customer-facing journeys, critical APIs, and key internal dependencies.",
      `${synthTotal} monitor${synthTotal !== 1 ? "s" : ""} configured (target ≥ 15)`
    ) : undefined
  );

  // P5: Synthetic execution events in Grail (stored as events with SYNTHETIC_EVENT kind)
  const p5Score = synthGrailTotal > 0 ? 100 : synthTotal > 0 ? 30 : 50;
  const p5 = mkProbe(
    "dem.synthgrail", "Synthetic execution data in Grail", 0.15, p5Score,
    `${synthGrailTotal.toLocaleString()} synthetic execution event${synthGrailTotal !== 1 ? "s" : ""} in Grail (last 30 days)`,
    "> 0 synthetic events in Grail",
    synthGrailTotal === 0 && synthTotal > 0 ? mkFinding(
      "dem.synthgrail", "Synthetic Events Not Flowing to Grail",
      "Synthetic monitors exist but no execution events are found in Grail. DQL-based analysis of synthetic availability data is unavailable.",
      "info",
      "Verify synthetic monitor configuration and check that the tenant's Grail data pipeline is healthy.",
      `0 events | ${synthTotal} monitor${synthTotal !== 1 ? "s" : ""} configured`
    ) : undefined
  );

  return buildDomain("dem", "Digital Experience (DEM/RUM)", "◉", [p1, p2, p3, p4, p5]);
}
