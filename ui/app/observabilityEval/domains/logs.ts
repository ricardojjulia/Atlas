import { runDql, toNum, toStr } from "../queryRunner";
import { getSettingsObjectCounts } from "../../tenantReview/services/settingsService";
import { mkProbe, mkFinding, buildDomain } from "../domainUtils";
import type { ObsDomainResult } from "../types";

export async function runLogsDomain(segFilter: string): Promise<ObsDomainResult> {
  const sf = segFilter ? `| filter filterSegments("${segFilter}")` : "";

  const [logVolR, debugR, bucketR, settingsResult] = await Promise.all([
    runDql(`fetch logs, from:now()-24h\n${sf}\n| summarize total = count(), errors = countIf(loglevel == "ERROR" or loglevel == "SEVERE"), warnings = countIf(loglevel == "WARN" or loglevel == "WARNING"), debug = countIf(loglevel == "DEBUG" or loglevel == "TRACE")`),
    runDql(`fetch logs, from:now()-24h\n${sf}\n| summarize total = count(), debugCount = countIf(loglevel == "DEBUG" OR loglevel == "TRACE")`),
    runDql("fetch dt.system.buckets | fieldsKeep name, records, retention_days, estimated_uncompressed_bytes"),
    // Try both the new OpenPipeline schema and the legacy LMA processing rule schema
    getSettingsObjectCounts(["builtin:openpipeline.logs.pipelines", "builtin:logmonitoring.log-dpp-processor-rule"]),
  ]);

  const totalLogs = toNum(logVolR.records[0]?.["total"]);
  const errorLogs = toNum(logVolR.records[0]?.["errors"]);
  const debugLogs = toNum(debugR.records[0]?.["debugCount"]);
  const debugTotal = toNum(debugR.records[0]?.["total"]);
  // Combine both schemas: new OpenPipeline config OR legacy LMA processing rules both indicate log processing is active
  const openPipelineCount = (settingsResult.get("builtin:openpipeline.logs.pipelines") ?? 0)
    + (settingsResult.get("builtin:logmonitoring.log-dpp-processor-rule") ?? 0);

  // P1: Logs ingested into Grail
  const p1Score = totalLogs > 0 ? 100 : 0;
  const p1 = mkProbe(
    "logs.ingest", "Log ingestion into Grail", 0.20, p1Score,
    totalLogs > 0 ? `${totalLogs.toLocaleString()} log events ingested in last 24h` : "No log events found in last 24h",
    "> 0 log events ingested",
    totalLogs === 0 ? mkFinding(
      "logs.ingest", "No Logs Ingested into Grail",
      "No log events were found in Grail for the last 24 hours.",
      "critical",
      "Configure OneAgent log monitoring or an OpenTelemetry log exporter to ingest logs into Dynatrace Grail.",
      "0 log events in 24h window"
    ) : undefined
  );

  // P2: Log signal quality (error/warn ratio)
  const errorPct = totalLogs > 0 ? (errorLogs / totalLogs) * 100 : 0;
  const p2Score = totalLogs === 0 ? 50 : errorPct <= 5 ? 100 : errorPct <= 15 ? Math.round(100 - (errorPct - 5) * 5) : 30;
  const p2 = mkProbe(
    "logs.quality", "Log signal quality", 0.20, p2Score,
    totalLogs === 0 ? "No log data to evaluate" : `${errorPct.toFixed(1)}% error-level logs (${errorLogs.toLocaleString()} of ${totalLogs.toLocaleString()})`,
    "< 5% error-level log volume",
    errorPct > 15 && totalLogs > 0 ? mkFinding(
      "logs.quality", "High Error Log Rate",
      `${errorPct.toFixed(1)}% of log volume is at ERROR or SEVERE level — this may indicate application instability or misconfigured log levels.`,
      "warning",
      "Review services with high error log volumes. Configure log processing rules to filter noise from error-classified events.",
      `Error logs: ${errorLogs.toLocaleString()} of ${totalLogs.toLocaleString()} total`
    ) : undefined
  );

  // P3: Debug/trace log contamination
  const debugPct = debugTotal > 0 ? (debugLogs / debugTotal) * 100 : 0;
  const p3Score = debugTotal === 0 ? 50 : debugPct <= 5 ? 100 : debugPct <= 15 ? Math.round(100 - (debugPct - 5) * 5) : 30;
  const p3 = mkProbe(
    "logs.debug", "Debug log contamination", 0.20, p3Score,
    debugTotal === 0 ? "No log data to evaluate" : `${debugPct.toFixed(1)}% debug/trace logs (${debugLogs.toLocaleString()} events)`,
    "< 5% debug/trace log volume",
    debugPct > 15 && debugTotal > 0 ? mkFinding(
      "logs.debug", "High Debug Log Volume",
      `${debugPct.toFixed(1)}% of ingested logs are at DEBUG or TRACE level, consuming unnecessary Grail storage.`,
      "warning",
      "Configure OpenPipeline log processing rules to drop or down-sample DEBUG/TRACE logs before storage.",
      `Debug/trace: ${debugLogs.toLocaleString()} of ${debugTotal.toLocaleString()} events`
    ) : undefined
  );

  // P4: OpenPipeline log pipelines configured
  const p4Score = (openPipelineCount ?? 0) >= 1 ? 100 : 0;
  const p4 = mkProbe(
    "logs.openpipeline", "OpenPipeline configured", 0.25, p4Score,
    `${openPipelineCount ?? 0} OpenPipeline log pipeline configuration${openPipelineCount !== 1 ? "s" : ""}`,
    "≥ 1 OpenPipeline log pipeline",
    (openPipelineCount ?? 0) === 0 ? mkFinding(
      "logs.openpipeline", "OpenPipeline Not Configured",
      "No OpenPipeline log pipeline configurations found. Logs are ingested without processing rules or routing.",
      "warning",
      "Configure OpenPipeline to parse, enrich, route, and filter logs before storage for better cost and quality control.",
      "0 log pipeline configurations"
    ) : undefined
  );

  // P5: Custom Grail buckets with retention
  const allBuckets = bucketR.records;
  const customBuckets = allBuckets.filter(r => !toStr(r["name"]).startsWith("default_"));
  const bucketsWithRetention = customBuckets.filter(r => toNum(r["retention_days"]) > 0);
  const p5Score = customBuckets.length >= 1 ? (bucketsWithRetention.length > 0 ? 100 : 70) : 0;
  const p5 = mkProbe(
    "logs.buckets", "Custom Grail bucket configuration", 0.15, p5Score,
    `${customBuckets.length} custom bucket${customBuckets.length !== 1 ? "s" : ""} (${bucketsWithRetention.length} with explicit retention)`,
    "≥ 1 custom Grail bucket with retention policy",
    customBuckets.length === 0 ? mkFinding(
      "logs.buckets", "No Custom Grail Buckets",
      "All log data is stored in default Grail buckets. Custom buckets enable per-team retention policies and cost allocation.",
      "info",
      "Create custom Grail buckets with targeted retention policies. Route log data by application, environment, or team."
    ) : undefined
  );

  return buildDomain("logs", "Log Management & OpenPipeline", "≡", [p1, p2, p3, p4, p5]);
}
