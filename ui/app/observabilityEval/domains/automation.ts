import { workflowsClient } from "@dynatrace-sdk/client-automation";
import { runDql, toNum } from "../queryRunner";
import { mkProbe, mkFinding, buildDomain } from "../domainUtils";
import type { ObsDomainResult } from "../types";

export async function runAutomationDomain(): Promise<ObsDomainResult> {
  const [wfResult, deployR] = await Promise.all([
    workflowsClient.getWorkflows({ limit: 200 }).catch(() => ({ count: 0, results: [] })),
    runDql("fetch events, from:now()-30d | filter event.type == \"CUSTOM_DEPLOYMENT\" | summarize total = count()"),
  ]);

  const totalWorkflows = wfResult.count ?? 0;
  const activeWorkflows = (wfResult.results ?? []).filter(w => w.isDeployed !== false).length;
  const enabledPct = totalWorkflows > 0 ? Math.round((activeWorkflows / totalWorkflows) * 100) : 0;
  const deployEvents = toNum(deployR.records[0]?.["total"]);

  // P1: Workflow definitions exist and are active
  const p1Score = totalWorkflows >= 10 ? 100 : totalWorkflows >= 3 ? 80 : totalWorkflows >= 1 ? 60 : 0;
  const p1 = mkProbe(
    "auto.workflows", "AutomationEngine workflows defined", 0.35, p1Score,
    totalWorkflows === 0
      ? "No AutomationEngine workflows found"
      : `${totalWorkflows} workflow${totalWorkflows !== 1 ? "s" : ""} defined (${activeWorkflows} enabled)`,
    "≥ 3 workflows defined",
    totalWorkflows === 0 ? mkFinding(
      "auto.workflows", "No AutomationEngine Workflows Defined",
      "No workflows are configured in AutomationEngine.",
      "warning",
      "Create workflows to automate operational tasks: incident response, capacity management, deployment validation, and reporting.",
      "0 workflows defined"
    ) : undefined
  );

  // P2: Workflow enablement health (active vs total)
  const p2Score = totalWorkflows === 0 ? 50 : enabledPct >= 80 ? 100 : enabledPct >= 50 ? enabledPct : Math.round(enabledPct * 0.6);
  const p2 = mkProbe(
    "auto.health", "Workflow enablement ratio", 0.35, p2Score,
    totalWorkflows === 0
      ? "No workflow data to evaluate"
      : `${activeWorkflows} of ${totalWorkflows} workflows enabled (${enabledPct}%)`,
    "≥ 80% of workflows enabled",
    totalWorkflows > 0 && enabledPct < 50 ? mkFinding(
      "auto.health", "Most Workflows Disabled",
      `Only ${enabledPct}% of defined workflows are enabled.`,
      enabledPct < 25 ? "warning" : "info",
      "Review disabled workflows in the AutomationEngine UI. Re-enable or delete workflows that are no longer relevant.",
      `Enabled: ${activeWorkflows} of ${totalWorkflows} workflows`
    ) : undefined
  );

  // P3: Deployment event tracking
  const p3Score = deployEvents >= 10 ? 100 : deployEvents >= 1 ? 70 : 0;
  const p3 = mkProbe(
    "auto.deploys", "Deployment event tracking", 0.30, p3Score,
    `${deployEvents.toLocaleString()} custom deployment event${deployEvents !== 1 ? "s" : ""} in last 30 days`,
    "≥ 1 deployment event tracked (release tracking active)",
    deployEvents === 0 ? mkFinding(
      "auto.deploys", "No Deployment Events Tracked",
      "No custom deployment events are present in Grail. Release tracking is not active.",
      "info",
      "Integrate CI/CD pipelines with Dynatrace Events API or use the Release Tracking feature to annotate deployments in the timeline.",
      "0 deployment events in 30 days"
    ) : undefined
  );

  return buildDomain("automation", "Automation & Workflows", "⚙", [p1, p2, p3]);
}
