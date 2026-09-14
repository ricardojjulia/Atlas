import { runDql, toNum } from "../queryRunner";
import { getExtensionCount } from "../../tenantReview/services/extensionService";
import { mkProbe, mkFinding, buildDomain } from "../domainUtils";
import type { ObsDomainResult } from "../types";

export async function runExtensionsDomain(): Promise<ObsDomainResult> {
  const [agCountR, awsR, azureSubR, extensionCount] = await Promise.all([
    runDql("fetch dt.entity.active_gate | summarize agCount = count()"),
    runDql("fetch dt.entity.aws_credentials | summarize count()"),
    // azure_subscription entities are created by the ActiveGate Azure cloud integration — more reliable than VM count
    runDql("fetch dt.entity.azure_subscription | summarize count()"),
    getExtensionCount(),
  ]);

  const agCount = toNum(agCountR.records[0]?.["agCount"]);
  const awsIntegrations = toNum(awsR.records[0]?.["count()"]);
  const azureSubs = toNum(azureSubR.records[0]?.["count()"]);
  const extCount = extensionCount ?? 0;

  // P1: ActiveGate high availability
  const p1Score = agCount >= 2 ? 100 : agCount === 1 ? 60 : 0;
  const p1 = mkProbe(
    "ext.activegates", "ActiveGate HA coverage", 0.40, p1Score,
    `${agCount} ActiveGate${agCount !== 1 ? "s" : ""} reporting telemetry`,
    "≥ 2 ActiveGates for high availability",
    agCount === 0 ? mkFinding(
      "ext.activegates", "No ActiveGates Detected",
      "No ActiveGates are reporting SFM metrics. OneAgent communication may be direct to Dynatrace SaaS.",
      "info",
      "Deploy at least 2 ActiveGates per network zone for high availability and to support private synthetic locations.",
      "0 ActiveGates detected via SFM metrics"
    ) : agCount === 1 ? mkFinding(
      "ext.activegates", "Single ActiveGate — No High Availability",
      "Only 1 ActiveGate is active. A single ActiveGate is a single point of failure for synthetic, Extension 2.0, and routed telemetry.",
      "warning",
      "Deploy a second ActiveGate in the same network zone to achieve high availability for synthetic execution and Extension 2.0 data collection.",
      "1 ActiveGate detected — HA requires ≥ 2"
    ) : undefined
  );

  // P2: Extensions 2.0 installed
  const p2Score = extCount >= 5 ? 100 : extCount >= 2 ? 70 : extCount >= 1 ? 50 : 0;
  const p2 = mkProbe(
    "ext.extensions", "Extensions 2.0 installed", 0.30, p2Score,
    `${extCount} Extension 2.0 integration${extCount !== 1 ? "s" : ""} installed`,
    "≥ 2 Extensions 2.0 installed",
    extCount === 0 ? mkFinding(
      "ext.extensions", "No Extensions 2.0 Installed",
      "No Extension 2.0 integrations are installed. Custom technology monitoring via extensions is not active.",
      "info",
      "Install Extension 2.0 integrations for technologies not covered by built-in OneAgent sensors (custom databases, network devices, proprietary tech)."
    ) : undefined
  );

  // P3: Cloud integrations (using azure_subscription — created only by AG Azure integration)
  const hasAws = awsIntegrations >= 1;
  const hasAzure = azureSubs >= 1;
  const cloudIntegrations = (hasAws ? 1 : 0) + (hasAzure ? 1 : 0);
  const p3Score = cloudIntegrations >= 2 ? 100 : cloudIntegrations === 1 ? 70 : 50;
  const p3 = mkProbe(
    "ext.cloud", "Cloud integrations present", 0.30, p3Score,
    [
      hasAws ? `AWS: ${awsIntegrations} credential${awsIntegrations !== 1 ? "s" : ""}` : "AWS: none",
      hasAzure ? `Azure: ${azureSubs} subscription${azureSubs !== 1 ? "s" : ""} (via cloud integration)` : "Azure: none",
    ].join(" | "),
    "Cloud integration configured (if applicable)"
  );

  return buildDomain("extensions", "Extensions & Cloud Integrations", "⊕", [p1, p2, p3]);
}
