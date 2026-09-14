import { runDql, toNum, toStr } from "../queryRunner";
import { mkProbe, mkFinding, buildDomain } from "../domainUtils";
import type { ObsDomainResult } from "../types";

export async function runApmDomain(segFilter: string): Promise<ObsDomainResult> {
  const sf = segFilter ? `| filter filterSegments("${segFilter}")` : "";

  const [spanSvcR, spanQualityR, cloudFuncR, azureFuncR, faasSvcR, svcMethodR, topSvcR] = await Promise.all([
    runDql(`fetch spans, from:now()-24h\n${sf}\n| filter isNotNull(dt.entity.service)\n| summarize active = countDistinct(dt.entity.service)`),
    runDql(`fetch spans, from:now()-30d\n${sf}\n| summarize total = count(), withDbStatement = countIf(isNotNull(db.statement)), withServiceName = countIf(isNotNull(service.name))`),
    // Filter to recently-seen functions to match the 7d span window below
    runDql("fetch dt.entity.aws_lambda_function | filter toTimestamp(lastSeenTms) > now() - 7d | summarize count()"),
    runDql("fetch dt.entity.azure_function_app | filter toTimestamp(lastSeenTms) > now() - 7d | summarize count()"),
    runDql(`fetch spans, from:now()-7d\n${sf}\n| filter isNotNull(faas.name) or isNotNull(faas.id)\n| summarize instrumented = countDistinct(coalesce(faas.name, faas.id))`),
    runDql("fetch dt.entity.service_method | summarize count()"),
    runDql(`fetch spans, from:now()-24h\n${sf}\n| fieldsAdd svc = coalesce(dt.entity.service, service.name)\n| filter isNotNull(svc)\n| summarize total = count(), errors = countIf(otel.status_code == "ERROR" or error == true or isNotNull(exception.type)), by:{svc}\n| fieldsAdd errorRate = round(toDouble(errors) / toDouble(total) * 100.0, 1)\n| sort total desc\n| limit 20`),
  ]);

  // P1: Services with active tracing
  const activeSvcsWithTraces = toNum(spanSvcR.records[0]?.["active"]);
  const p1Score = activeSvcsWithTraces >= 1 ? 100 : 0;
  const p1 = mkProbe(
    "apm.tracing", "Services with active tracing", 0.20, p1Score,
    `${activeSvcsWithTraces} service${activeSvcsWithTraces !== 1 ? "s" : ""} with distributed trace data in last 24h`,
    "≥ 1 service with active tracing",
    activeSvcsWithTraces === 0 ? mkFinding(
      "apm.tracing", "No Distributed Tracing Data",
      "No services have distributed trace data in the last 24 hours.",
      "critical",
      "Enable distributed tracing via OneAgent code sensors or OpenTelemetry SDK instrumentation."
    ) : undefined
  );

  // P2: Error rate health across top services
  const topSvcs = topSvcR.records;
  const highErrorSvcs = topSvcs.filter(r => toNum(r["errorRate"]) > 5).length;
  const totalTopSvcs = topSvcs.length;
  const errorHealthPct = totalTopSvcs > 0 ? Math.round(((totalTopSvcs - highErrorSvcs) / totalTopSvcs) * 100) : 100;
  const p2Score = totalTopSvcs === 0 ? 50 : highErrorSvcs === 0 ? 100 : errorHealthPct >= 80 ? errorHealthPct : Math.round(errorHealthPct * 0.7);
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
  const p3Score = totalCloudFuncs === 0 ? 100 : funcCovPct >= 80 ? 100 : funcCovPct >= 50 ? funcCovPct : Math.round(funcCovPct * 0.5);
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

  // P4: DB statement capture (checks db.statement — the actual SQL/query text, not just db.system presence)
  const spanTotal = toNum(spanQualityR.records[0]?.["total"]);
  const spanWithDb = toNum(spanQualityR.records[0]?.["withDbStatement"]);
  const dbPct = spanTotal > 0 ? Math.round((spanWithDb / spanTotal) * 100) : 0;
  const p4Score = spanTotal === 0 ? 50 : spanWithDb > 0 ? 100 : 30;
  const p4 = mkProbe(
    "apm.dbcapture", "Database statement capture", 0.15, p4Score,
    spanTotal === 0 ? "No span data available" : `${spanWithDb.toLocaleString()} of ${spanTotal.toLocaleString()} spans have db.statement attribute (${dbPct}%)`,
    "> 0 spans with db.statement captured",
    spanTotal > 0 && spanWithDb === 0 ? mkFinding(
      "apm.dbcapture", "No Database Statement Capture",
      "No spans include the db.statement attribute — SQL query text is not being captured for database call tracing.",
      "info",
      "Enable OneAgent database statement capture in service detection settings, or ensure OTel instrumentation sets the db.statement span attribute.",
      "0 spans with db.statement in 30d window"
    ) : undefined
  );

  // P5: Service method instrumentation
  const svcMethods = toNum(svcMethodR.records[0]?.["count()"]);
  const p5Score = svcMethods >= 10 ? 100 : svcMethods >= 1 ? 70 : 30;
  const p5 = mkProbe(
    "apm.svcmethods", "Service method instrumentation", 0.15, p5Score,
    `${svcMethods.toLocaleString()} service method${svcMethods !== 1 ? "s" : ""} captured`,
    "≥ 10 service methods instrumented"
  );

  // P6: OTel service.name quality
  const spanWithSvcName = toNum(spanQualityR.records[0]?.["withServiceName"]);
  const svcNamePct = spanTotal > 0 ? Math.round((spanWithSvcName / spanTotal) * 100) : 100;
  const p6Score = spanTotal === 0 ? 50 : svcNamePct >= 95 ? 100 : svcNamePct >= 80 ? svcNamePct : Math.round(svcNamePct * 0.7);
  const p6 = mkProbe(
    "apm.svcname", "OTel service.name coverage", 0.20, p6Score,
    spanTotal === 0 ? "No span data to evaluate" : `${svcNamePct}% of spans have service.name attribute`,
    "≥ 95% of spans include service.name",
    svcNamePct < 95 && spanTotal > 0 ? mkFinding(
      "apm.svcname", "Missing service.name Attribute on Spans",
      `${100 - svcNamePct}% of spans are missing the service.name attribute, reducing trace attribution accuracy.`,
      svcNamePct < 80 ? "warning" : "info",
      "Ensure all OpenTelemetry instrumentation sets the service.name resource attribute.",
      `${svcNamePct}% coverage (target: 95%)`
    ) : undefined
  );

  return buildDomain("apm", "Application Observability", "⟳", [p1, p2, p3, p4, p5, p6]);
}
