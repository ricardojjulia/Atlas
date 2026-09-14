import { runDql, toNum } from "../queryRunner";
import { getSettingsObjectCounts } from "../../tenantReview/services/settingsService";
import { getTokenSummary } from "../../tenantReview/services/tokenService";
import { mkProbe, mkFinding, buildDomain } from "../domainUtils";
import type { ObsDomainResult } from "../types";

export async function runGovernanceDomain(): Promise<ObsDomainResult> {
  const [auditR, settingsResult, tokenSummary] = await Promise.all([
    // Grail stores audit events in the audit.logs table; user field is user.id in the audit log schema
    runDql("fetch audit.logs, from:now()-7d | summarize total = count(), uniqueUsers = countDistinct(user.id)"),
    getSettingsObjectCounts([
      "builtin:management-zones",
      "builtin:ownership.teams",
      // builtin:segment — platform segments schema; may vary across DT versions
      "builtin:segment",
    ]),
    getTokenSummary(),
  ]);

  const auditTotal = toNum(auditR.records[0]?.["total"]);
  const auditUsers = toNum(auditR.records[0]?.["uniqueUsers"] ?? auditR.records[0]?.["uniqueusers"] ?? 0);
  const mgmtZones = settingsResult.get("builtin:management-zones") ?? 0;
  const ownershipTeams = settingsResult.get("builtin:ownership.teams") ?? 0;
  const segments = settingsResult.get("builtin:segment") ?? 0;
  const totalTokens = tokenSummary?.totalCount ?? null;
  const disabledTokens = totalTokens != null
    ? (totalTokens - (tokenSummary?.enabledCount ?? totalTokens))
    : null;
  const disabledPct = totalTokens != null && totalTokens > 0
    ? Math.round(((disabledTokens ?? 0) / totalTokens) * 100)
    : 0;

  // P1: Management zones
  const p1Score = (mgmtZones ?? 0) >= 5 ? 100 : (mgmtZones ?? 0) >= 2 ? 70 : (mgmtZones ?? 0) === 1 ? 50 : 0;
  const p1 = mkProbe(
    "gov.mgmtzones", "Management zones configured", 0.20, p1Score,
    `${mgmtZones ?? 0} management zone${mgmtZones !== 1 ? "s" : ""} configured`,
    "≥ 5 management zones for access scoping",
    (mgmtZones ?? 0) === 0 ? mkFinding(
      "gov.mgmtzones", "No Management Zones Configured",
      "No management zones are defined. All users have unscoped access to the full tenant.",
      "warning",
      "Create management zones to scope user access by team, environment, or application domain.",
      "0 management zones"
    ) : (mgmtZones ?? 0) < 3 ? mkFinding(
      "gov.mgmtzones", "Limited Management Zone Coverage",
      `Only ${mgmtZones} management zone${mgmtZones !== 1 ? "s are" : " is"} defined.`,
      "info",
      "Expand management zone definitions to cover all teams and environments with appropriate access boundaries."
    ) : undefined
  );

  // P2: Ownership teams
  const p2Score = (ownershipTeams ?? 0) >= 5 ? 100 : (ownershipTeams ?? 0) >= 2 ? 70 : (ownershipTeams ?? 0) === 1 ? 50 : 0;
  const p2 = mkProbe(
    "gov.ownership", "Ownership teams configured", 0.20, p2Score,
    `${ownershipTeams ?? 0} ownership team${ownershipTeams !== 1 ? "s" : ""} defined`,
    "≥ 5 ownership teams with entity assignments",
    (ownershipTeams ?? 0) === 0 ? mkFinding(
      "gov.ownership", "No Ownership Teams Configured",
      "No ownership teams are defined. Entity ownership and accountability cannot be established.",
      "warning",
      "Configure ownership teams and assign entities to establish clear responsibility for monitoring and incident response.",
      "0 ownership teams"
    ) : undefined
  );

  // P3: Platform segments
  const p3Score = (segments ?? 0) >= 5 ? 100 : (segments ?? 0) >= 2 ? 70 : (segments ?? 0) === 1 ? 50 : 0;
  const p3 = mkProbe(
    "gov.segments", "Platform segments configured", 0.20, p3Score,
    `${segments ?? 0} platform segment${segments !== 1 ? "s" : ""} defined`,
    "≥ 5 segments for data scoping",
    (segments ?? 0) === 0 ? mkFinding(
      "gov.segments", "No Platform Segments Configured",
      "No platform segments are defined. DQL queries and dashboards cannot be filtered by team or application context.",
      "info",
      "Create platform segments to enable scoped DQL queries, segment-aware dashboards, and team-based data access."
    ) : undefined
  );

  // P4: API token hygiene
  const p4Score = totalTokens == null ? 50
    : totalTokens === 0 ? 100
    : disabledPct <= 10 ? 100
    : disabledPct <= 25 ? 80
    : disabledPct <= 50 ? 50
    : 0;
  const p4 = mkProbe(
    "gov.tokens", "API token hygiene", 0.20, p4Score,
    totalTokens == null
      ? "Token inventory unavailable"
      : `${totalTokens} total tokens — ${disabledTokens ?? 0} disabled (${disabledPct}%)`,
    "< 10% disabled tokens in inventory",
    totalTokens != null && disabledPct > 25 ? mkFinding(
      "gov.tokens", "High Disabled API Token Ratio",
      `${disabledPct}% of API tokens are disabled — stale tokens accumulate security surface area.`,
      disabledPct > 50 ? "warning" : "info",
      "Audit and delete disabled API tokens. Implement token rotation policies and least-privilege scoping.",
      `${disabledTokens} of ${totalTokens} tokens disabled`
    ) : undefined
  );

  // P5: Audit trail active
  const p5Score = auditTotal >= 100 ? 100 : auditTotal >= 10 ? 80 : auditTotal >= 1 ? 60 : 0;
  const p5 = mkProbe(
    "gov.audit", "Audit trail activity", 0.20, p5Score,
    auditTotal === 0
      ? "No audit events in last 7 days"
      : `${auditTotal.toLocaleString()} audit events from ${auditUsers} user${auditUsers !== 1 ? "s" : ""} in last 7 days`,
    "≥ 10 audit events per week",
    auditTotal === 0 ? mkFinding(
      "gov.audit", "No Audit Events Detected",
      "No audit log events found in the last 7 days. Compliance and change tracking are not available.",
      "warning",
      "Verify that audit logging is enabled and that the storage:system:read scope is granted for audit log access."
    ) : undefined
  );

  return buildDomain("governance", "Platform Governance", "⚑", [p1, p2, p3, p4, p5]);
}
