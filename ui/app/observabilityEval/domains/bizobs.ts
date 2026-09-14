import { runDql, toNum } from "../queryRunner";
import { getSettingsObjectCounts } from "../../tenantReview/services/settingsService";
import { mkProbe, mkFinding, buildDomain } from "../domainUtils";
import type { ObsDomainResult } from "../types";

export async function runBizObsDomain(): Promise<ObsDomainResult> {
  const [bizVolR, bizQualR, settingsResult] = await Promise.all([
    runDql("fetch bizevents, from:now()-30d | summarize total = count()"),
    runDql("fetch bizevents, from:now()-30d | summarize total = count(), withType = countIf(isNotNull(event.type)), withProvider = countIf(isNotNull(event.provider))"),
    getSettingsObjectCounts([
      // Try both known schema IDs for BizEvent processing rules across DT versions
      "builtin:bizevents-processing.rule",
      "builtin:bizevents.http.incoming",
    ]),
  ]);

  const bizTotal = toNum(bizVolR.records[0]?.["total"]);
  const bizWithType = toNum(bizQualR.records[0]?.["withType"]);
  const bizWithProvider = toNum(bizQualR.records[0]?.["withProvider"]);
  const typePct = bizTotal > 0 ? Math.round((bizWithType / bizTotal) * 100) : 0;
  const providerPct = bizTotal > 0 ? Math.round((bizWithProvider / bizTotal) * 100) : 0;
  const pipelineRules = settingsResult.get("builtin:bizevents-processing.rule") ?? 0;
  const httpRules = settingsResult.get("builtin:bizevents.http.incoming") ?? 0;

  // P1: Business events flowing — 0 events is a genuine gap for APM-covered tenants (not N/A)
  const p1Score = bizTotal >= 10000 ? 100 : bizTotal >= 1000 ? 80 : bizTotal >= 1 ? 60 : 0;
  const p1 = mkProbe(
    "biz.volume", "Business event ingestion", 0.40, p1Score,
    bizTotal === 0
      ? "No business events detected"
      : `${bizTotal.toLocaleString()} business events in last 30 days`,
    "> 0 business events flowing",
    bizTotal === 0 ? mkFinding(
      "biz.volume", "No Business Events Ingested",
      "No business events found in Grail. Business observability (conversion rates, revenue impact, customer journey tracking) is not active.",
      "info",
      "Integrate key business processes by sending business events via the Business Events API or OpenPipeline HTTP sources. Start with the highest-value transactions: orders, payments, and registrations.",
      "0 business events in 30 days"
    ) : undefined
  );

  // P2: Business event data quality
  const p2Score = bizTotal === 0 ? 50 : typePct >= 90 ? 100 : typePct >= 70 ? 80 : typePct >= 50 ? 60 : 30;
  const p2 = mkProbe(
    "biz.quality", "Business event data quality", 0.35, p2Score,
    bizTotal === 0
      ? "No events to evaluate"
      : `${typePct}% have event.type | ${providerPct}% have event.provider`,
    "≥ 90% of biz events with event.type and event.provider",
    bizTotal > 0 && typePct < 90 ? mkFinding(
      "biz.quality", "Business Event Schema Quality Gap",
      `${100 - typePct}% of business events are missing event.type, reducing query and dashboard effectiveness.`,
      typePct < 70 ? "warning" : "info",
      "Enforce event schema standards: all business events must include event.type and event.provider attributes.",
      `event.type: ${typePct}% | event.provider: ${providerPct}%`
    ) : undefined
  );

  // P3: BizEvent processing pipeline rules
  const totalRules = (pipelineRules ?? 0) + (httpRules ?? 0);
  const p3Score = totalRules >= 3 ? 100 : totalRules >= 1 ? 70 : bizTotal > 0 ? 30 : 50;
  const p3 = mkProbe(
    "biz.pipelines", "Business event processing rules", 0.25, p3Score,
    `${pipelineRules ?? 0} pipeline rule${pipelineRules !== 1 ? "s" : ""}, ${httpRules ?? 0} HTTP ingest rule${httpRules !== 1 ? "s" : ""} configured`,
    "≥ 1 business event pipeline rule configured",
    totalRules === 0 && bizTotal > 0 ? mkFinding(
      "biz.pipelines", "No Business Event Processing Rules",
      "Business events are ingested but no processing pipeline rules are configured for enrichment or routing.",
      "info",
      "Configure business event processing rules to extract attributes, enrich events with entity context, and route to appropriate buckets."
    ) : undefined
  );

  return buildDomain("bizobs", "Business Observability", "◇", [p1, p2, p3]);
}
