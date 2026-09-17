import { runDql, toNum } from "../queryRunner";
import { mkProbe, mkFinding, buildDomain } from "../domainUtils";
import type { ObsDomainResult } from "../types";

export async function runApmDomain(segFilter: string): Promise<ObsDomainResult> {
  const sf = segFilter ? `| filter filterSegments("${segFilter}")` : "";

  const [spanSvcR, spanQualityR, cloudFuncR, azureFuncR, faasSvcR, svcMethodR, topSvcR, totalSvcR] = await Promise.all([
    // coalesce captures both OneAgent services (dt.entity.service) and OTel-only services (service.name)
    runDql(`fetch spans, from:now()-24h\n${sf}\n| fieldsAdd svcId = coalesce(dt.entity.service, service.name)\n| filter isNotNull(svcId)\n| summarize active = countDistinct(svcId)`),
    // db.system indicates a DB span exists; db.statement is the captured SQL text
    runDql(`fetch spans, from:now()-30d\n${sf}\n| summarize total = count(), withDbStatement = countIf(isNotNull(db.statement)), withDbSystem = countIf(isNotNull(db.system)), withServiceName = countIf(isNotNull(service.name))`),
    runDql("fetch dt.entity.aws_lambda_function | summarize count()"),
    runDql("fetch dt.entity.azure_function_app | summarize count()"),
    runDql(`fetch spans, from:now()-7d\n${sf}\n| filter isNotNull(faas.name) or isNotNull(faas.id)\n| summarize instrumented = countDistinct(coalesce(faas.name, faas.id))`),
    runDql("fetch dt.entity.service_method | summarize count()"),
    runDql(`fetch spans, from:now()-24h\n${sf}\n| fieldsAdd svc = coalesce(dt.entity.service, service.name)\n| filter isNotNull(svc)\n| summarize total = count(), errors = countIf(otel.status_code == "ERROR" or error == true or isNotNull(exception.type)), by:{svc}\n| fieldsAdd errorRate = round(toDouble(errors) / toDouble(total) * 100.0, 1)\n| sort total desc\n| limit 20`),
    runDql("fetch dt.entity.service | summarize count()"),
  ]);

  // P1: Distributed tracing coverage — ratio of services with active traces vs total detected services
  const activeSvcsWithTraces = toNum(spanSvcR.records[0]?.["active"]);
  const totalSvcs = toNum(totalSvcR.records[0]?.["count()"]);
  // Cap at 100: OTel services (coalesce on service.name) can exceed the OneAgent entity count denominator
  const tracingCovPct = totalSvcs > 0 ? Math.min(100, Math.round((activeSvcsWithTraces / totalSvcs) * 100)) : 0;
  const p1Score = totalSvcs === 0 ? 50
    : activeSvcsWithTraces === 0 ? 0
    : tracingCovPct >= 80 ? 100
    : tracingCovPct >= 50 ? 80
    : tracingCovPct >= 25 ? 60
    : 40;
  const p1 = mkProbe(
    "apm.tracing", "Distributed tracing coverage", 0.20, p1Score,
    totalSvcs === 0
      ? `${activeSvcsWithTraces} service${activeSvcsWithTraces !== 1 ? "s" : ""} with trace data (no service entities detected)`
      : `${activeSvcsWithTraces} of ${totalSvcs} services with distributed traces in last 24h (${tracingCovPct}%)`,
    "≥ 80% of services with active tracing",
    activeSvcsWithTraces === 0 ? mkFinding(
      "apm.tracing", "No Distributed Tracing Data",
      "No services have distributed trace data in the last 24 hours.",
      "critical",
      "Enable distributed tracing via OneAgent code sensors or OpenTelemetry SDK instrumentation."
    ) : tracingCovPct < 50 && totalSvcs > 0 ? mkFinding(
      "apm.tracing", "Low Distributed Tracing Coverage",
      `Only ${tracingCovPct}% of detected services (${activeSvcsWithTraces} of ${totalSvcs}) have distributed trace data.`,
      "warning",
      "Enable OneAgent full-stack mode or add OTel instrumentation to untraced services. Review service detection rules.",
      `Traced: ${activeSvcsWithTraces} | Total services: ${totalSvcs}`
    ) : undefined
  );

  // P2: Error rate health across top services
  const topSvcs = topSvcR.records;
  const highErrorSvcs = topSvcs.filter(r => toNum(r["errorRate"]) > 5).length;
  const totalTopSvcs = topSvcs.length;
  const errorHealthPct = totalTopSvcs > 0 ? Math.round(((totalTopSvcs - highErrorSvcs) / totalTopSvcs) * 100) : 100;
  // Math.max(51,...) prevents Math.round(71×0.7)=50 sentinel collision at errorHealthPct=71-72
  const p2Score = totalTopSvcs === 0 ? 50 : highErrorSvcs === 0 ? 100 : errorHealthPct >= 80 ? errorHealthPct : Math.max(51, Math.round(errorHealthPct * 0.7));
  const p2 = mkProbe(
    "apm.errorrate", "Service error rate health", 0.15, p2Score,
    `${highErrorSvcs} of top ${totalTopSvcs} services have error rate > 5%`,
    "< 20% of top services with error rate > 5%",
    highErrorSvcs > totalTopSvcs * 0.2 ? mkFinding(
      "apm.errorrate", "Elevated Service Error Rates",
      `${highErrorSvcs} of the top ${totalTopSvcs} services by span volume have an error rate above 5%.`,
      highErrorSvcs > totalTopSvcs * 0.5 ? "warning" : "info",
      "Investigate high-error-rate services. Review request failure reasons and enable error detection tuning.",
      `${highErrorSvcs} services with error rate > 5%`
    ) : undefined
  );

  // P3: Cloud function instrumentation gap
  const awsLambdas = toNum(cloudFuncR.records[0]?.["count()"]);
  const azureFuncs = toNum(azureFuncR.records[0]?.["count()"]);
  const totalCloudFuncs = awsLambdas + azureFuncs;
  const instrumentedFuncs = toNum(faasSvcR.records[0]?.["instrumented"]);
  const funcGap = Math.max(0, totalCloudFuncs - instrumentedFuncs);
  const funcCovPct = totalCloudFuncs > 0 ? Math.round((instrumentedFuncs / totalCloudFuncs) * 100) : 100;
  // Math.max(51,...) prevents exact-50% coverage colliding with the unknown sentinel
  const p3Score = totalCloudFuncs === 0 ? 100 : funcCovPct >= 80 ? 100 : funcCovPct >= 50 ? Math.max(51, funcCovPct) : Math.round(funcCovPct * 0.5);
  const p3 = mkProbe(
    "apm.cloudfuncs", "Cloud function instrumentation", 0.15, p3Score,
    totalCloudFuncs === 0
      ? "No cloud functions detected"
      : `${instrumentedFuncs} of ${totalCloudFuncs} cloud functions with trace data (${funcCovPct}%)`,
    "≥ 80% of cloud functions instrumented",
    funcGap > 0 ? mkFinding(
      "apm.cloudfuncs", "Cloud Function Instrumentation Gap",
      `${funcGap} cloud function${funcGap !== 1 ? "s" : ""} monitored at infrastructure level but without distributed trace data.`,
      funcCovPct < 50 ? "warning" : "info",
      "Add AWS Lambda OneAgent layer or Azure Function extension to capture distributed traces from serverless functions.",
      `AWS Lambda: ${awsLambdas} | Azure Functions: ${azureFuncs} | Instrumented: ${instrumentedFuncs}`
    ) : undefined
  );

  // P4: DB statement capture — proportional against db.system spans (the actual DB calls), not total span volume
  const spanTotal = toNum(spanQualityR.records[0]?.["total"]);
  const spanWithDb = toNum(spanQualityR.records[0]?.["withDbStatement"]);
  const spanWithDbSystem = toNum(spanQualityR.records[0]?.["withDbSystem"]);
  const dbCapturePct = spanWithDbSystem > 0 ? Math.round((spanWithDb / spanWithDbSystem) * 100) : 100;
  const p4Score = spanTotal === 0 ? 50
    : spanWithDbSystem === 0 ? 50   // no DB calls detected — N/A
    : dbCapturePct >= 80 ? 100
    : dbCapturePct >= 50 ? 70
    : dbCapturePct > 0 ? 50
    : 30;
  const p4 = mkProbe(
    "apm.dbcapture", "Database statement capture", 0.15, p4Score,
    spanTotal === 0 ? "No span data available"
      : spanWithDbSystem === 0 ? "No database spans detected (N/A)"
      : `${spanWithDb.toLocaleString()} of ${spanWithDbSystem.toLocaleString()} DB spans have db.statement captured (${dbCapturePct}%)`,
    "≥ 80% of DB spans with db.statement captured",
    spanWithDbSystem > 0 && dbCapturePct < 80 ? mkFinding(
      "apm.dbcapture", "Incomplete Database Statement Capture",
      `Only ${dbCapturePct}% of database spans include the db.statement attribute — SQL query text is missing for ${spanWithDbSystem - spanWithDb} DB calls.`,
      dbCapturePct < 50 ? "warning" : "info",
      "Enable OneAgent database statement capture in service detection settings, or ensure OTel instrumentation sets the db.statement span attribute.",
      `${spanWithDb.toLocaleString()} captured | ${spanWithDbSystem.toLocaleString()} total DB spans`
    ) : undefined
  );

  // P5: Service method instrumentation — OTel-only envs don't create dt.entity.service_method entities
  const spanWithSvcName = toNum(spanQualityR.records[0]?.["withServiceName"]);
  const svcMethods = toNum(svcMethodR.records[0]?.["count()"]);
  const isOtelOnly = spanTotal > 0 && spanWithSvcName === spanTotal && svcMethods === 0;
  const p5Score = isOtelOnly ? 50   // OTel-only: service_method entities are not populated — N/A
    : svcMethods >= 10 ? 100
    : svcMethods >= 1 ? 70
    : activeSvcsWithTraces > 0 ? 30   // OneAgent services traced but no method capture
    : 50;
  const p5 = mkProbe(
    "apm.svcmethods", "Service method instrumentation", 0.15, p5Score,
    isOtelOnly
      ? "OTel-only environment — service_method entities not applicable"
      : `${svcMethods.toLocaleString()} service method${svcMethods !== 1 ? "s" : ""} captured`,
    "≥ 10 service methods instrumented"
  );

  // P6: OTel service.name quality — guard for pure OneAgent environments where service.name is not expected
  // If all traces come from OneAgent (dt.entity.service set, service.name absent) this is N/A, not a failure
  const svcNamePct = spanTotal > 0 ? Math.round((spanWithSvcName / spanTotal) * 100) : 100;
  const isOneAgentOnly = spanTotal > 0 && spanWithSvcName === 0 && activeSvcsWithTraces > 0;
  const p6Score = spanTotal === 0 ? 50
    : isOneAgentOnly ? 50   // pure OneAgent environment — service.name is an OTel concept, N/A here
    : svcNamePct >= 95 ? 100
    : svcNamePct >= 80 ? svcNamePct
    : Math.round(svcNamePct * 0.7);
  const p6 = mkProbe(
    "apm.svcname", "OTel service.name coverage", 0.20, p6Score,
    spanTotal === 0 ? "No span data to evaluate"
      : isOneAgentOnly ? "Pure OneAgent environment — service.name attribute not applicable"
      : `${svcNamePct}% of spans have service.name attribute`,
    "≥ 95% of spans include service.name",
    !isOneAgentOnly && svcNamePct < 95 && spanTotal > 0 ? mkFinding(
      "apm.svcname", "Missing service.name Attribute on Spans",
      `${100 - svcNamePct}% of spans are missing the service.name attribute, reducing trace attribution accuracy.`,
      svcNamePct < 80 ? "warning" : "info",
      "Ensure all OpenTelemetry instrumentation sets the service.name resource attribute.",
      `${svcNamePct}% coverage (target: 95%)`
    ) : undefined
  );

  return buildDomain("apm", "Application Observability", "⟳", [p1, p2, p3, p4, p5, p6]);
}
