import type { ObsFullEvalResults } from "./types";
import type { Finding, FindingSeverity } from "../tenantReview/types/review.types";

// ── Rule definition ───────────────────────────────────────────────────────────

interface GapRule {
  id: string;
  title: string;
  description: string;
  recommendation: string;
  detail: string;
  strongDomain: string;
  strongThreshold: number; // score >= to fire
  weakDomain: string;
  weakThreshold: number;   // score < to fire
  severity: FindingSeverity;
}

// ── 26 cross-domain correlation rules ─────────────────────────────────────────
//
// Threshold conventions:
//   strongThreshold: 75 — used for core platform capabilities (OneAgent, APM, Davis, Logs, Infra)
//                         where a score ≥75 means meaningful adoption, not just presence
//   strongThreshold: 70 — used for optional/emerging capabilities (Extensions, Automation, BizObs,
//                         DEM partial) where even moderate adoption creates an actionable gap
//   weakThreshold: 50 — default (anything below 50 = D or F = genuine gap)
//   weakThreshold: 60 — only for gap-governance-oneagent where Governance being strong sets an
//                         explicit expectation of actual coverage (governance without agents = hollow)

const GAP_RULES: GapRule[] = [
  {
    id: "gap-apm-dem",
    title: "Backend traced but end-user experience is blind",
    description: "Application Observability is strong — services are instrumented and traces are flowing. But Digital Experience (RUM/Synthetic) coverage is low, so you have no visibility into what real users are experiencing.",
    recommendation: "Deploy RUM to your top web applications and add synthetic monitors for critical user journeys. Correlate user sessions to backend traces for full-stack visibility.",
    detail: "Impact: outages may be user-reported before monitoring catches them. MTTR is higher when there is no user-impact context.",
    strongDomain: "apm", strongThreshold: 75,
    weakDomain: "dem", weakThreshold: 50,
    severity: "warning",
  },
  {
    id: "gap-dem-apm",
    title: "User experience tracked but backend is opaque",
    description: "Digital Experience monitoring is active — you can see user sessions and satisfaction scores. But Application Observability is weak, so when experience degrades you cannot trace it to a root cause service or span.",
    recommendation: "Enable distributed tracing on services backing your monitored web applications. Connect RUM session data to backend traces via OneAgent or OpenTelemetry.",
    detail: "Impact: experience issues are visible but not actionable — teams spend hours finding the backend cause manually.",
    strongDomain: "dem", strongThreshold: 75,
    weakDomain: "apm", weakThreshold: 50,
    severity: "warning",
  },
  {
    id: "gap-oneagent-governance",
    title: "Strong coverage but no ownership or structure",
    description: "OneAgent deployment is healthy — hosts and services are instrumented. But Platform Governance (management zones, ownership teams, segments) is weak, so there is no structure for routing alerts, scoping access, or assigning responsibility.",
    recommendation: "Create management zones aligned to teams or services, assign ownership in the ownership catalog, and define segments for access scoping. This unlocks alerting profiles, SLO ownership, and team-based dashboards.",
    detail: "Impact: broad visibility but no accountability. Alert fatigue is common when all alerts go to everyone.",
    strongDomain: "oneagent", strongThreshold: 75,
    weakDomain: "governance", weakThreshold: 50,
    severity: "warning",
  },
  {
    id: "gap-davis-automation",
    title: "Problems detected but remediation is manual",
    description: "Davis AI is well configured — anomaly detectors and alerting are active. But Automation coverage is low, meaning every problem requires manual intervention to resolve.",
    recommendation: "Build AutomationEngine workflows triggered by Davis problem events. Start with common patterns: restart unhealthy pods, scale services under load, open tickets automatically on critical problems.",
    detail: "Impact: MTTR is driven by human response time rather than automation speed. On-call burden is higher than necessary.",
    strongDomain: "davis", strongThreshold: 75,
    weakDomain: "automation", weakThreshold: 50,
    severity: "warning",
  },
  {
    id: "gap-logs-davis",
    title: "Rich log data but AI anomaly detection is not using it",
    description: "Log Management is strong — Grail is ingesting logs with good signal quality. But Davis AI coverage is low, so log anomalies are not being surfaced automatically.",
    recommendation: "Configure Davis log anomaly detectors on high-value log sources. Enable log metric extraction to feed Davis thresholds. Connect OpenPipeline to Davis event ingestion.",
    detail: "Impact: valuable signals are in logs but require manual log analysis to find them. Incidents are caught late.",
    strongDomain: "logs", strongThreshold: 75,
    weakDomain: "davis", weakThreshold: 50,
    severity: "warning",
  },
  {
    id: "gap-apm-bizobs",
    title: "Technical traces captured but no business KPIs",
    description: "Application Observability is strong — service traces, error rates, and response times are flowing. But Business Observability is weak, so technical metrics are not being connected to business outcomes.",
    recommendation: "Instrument key business transactions as BizEvents (orders, payments, conversions). Build business KPI dashboards. Use BizEvent processing pipelines to enrich with revenue and customer tier data.",
    detail: "Impact: engineering knows services are slow but cannot answer 'how much revenue did we lose?' or 'which customers were affected?'",
    strongDomain: "apm", strongThreshold: 75,
    weakDomain: "bizobs", weakThreshold: 50,
    severity: "info",
  },
  {
    id: "gap-extensions-governance",
    title: "Cloud integrations active but no structure to organize them",
    description: "Extensions and cloud integrations are in use — AWS, Azure, or ActiveGate extensions are pulling in cloud metrics. But Platform Governance is weak, so cloud entities are not organized into management zones or ownership structures.",
    recommendation: "Create management zones that include cloud entities alongside on-premises hosts. Apply ownership tags to cloud workloads. Segment cloud environments (prod/dev/staging) using platform segments.",
    detail: "Impact: cloud data is available but not navigable. Teams cannot quickly scope to their cloud resources during incidents.",
    strongDomain: "extensions", strongThreshold: 70,
    weakDomain: "governance", weakThreshold: 50,
    severity: "info",
  },
  {
    id: "gap-oneagent-apm",
    title: "Hosts covered but service-level tracing is weak",
    description: "OneAgent deployment is strong — hosts and processes are monitored. But Application Observability probes show low active tracing, suggesting services are not being traced at the code level.",
    recommendation: "Verify OneAgent is in full-stack mode (not infrastructure-only) for services that need APM. Add OpenTelemetry instrumentation for polyglot or serverless services. Check for custom service detection rules blocking trace capture.",
    detail: "Impact: process and host metrics are available but no distributed traces, no error detail, no dependency mapping at the service level.",
    strongDomain: "oneagent", strongThreshold: 75,
    weakDomain: "apm", weakThreshold: 50,
    severity: "warning",
  },
  {
    id: "gap-infra-davis",
    title: "Infrastructure monitored but AI alerting is not configured",
    description: "Infrastructure Coverage is solid — hosts, services, and Kubernetes clusters are being monitored. But Davis AI coverage is low, meaning infrastructure anomalies are not being surfaced as actionable problems.",
    recommendation: "Enable Davis anomaly detectors for CPU, memory, disk, and network on critical hosts. Configure alerting profiles to route infrastructure problems to the right teams. Set up SLOs backed by infrastructure metrics.",
    detail: "Impact: monitoring is passive — data is collected but not acted on until humans notice issues in dashboards.",
    strongDomain: "infra", strongThreshold: 75,
    weakDomain: "davis", weakThreshold: 50,
    severity: "warning",
  },
  {
    id: "gap-apm-logs",
    title: "Distributed traces active but logs are not correlated",
    description: "Application Observability is strong — distributed tracing is flowing. But Log Management is weak, meaning traces cannot be correlated with application logs, losing a critical troubleshooting dimension.",
    recommendation: "Enable log ingest via OneAgent or OpenTelemetry. Add trace context injection to application log output (trace ID, span ID). Configure OpenPipeline to enrich logs with service and version metadata.",
    detail: "Impact: engineers switch between trace and log tools manually during incidents, losing context and adding MTTR.",
    strongDomain: "apm", strongThreshold: 75,
    weakDomain: "logs", weakThreshold: 50,
    severity: "warning",
  },
  {
    id: "gap-automation-davis",
    title: "Workflows running but not triggered by Davis problems",
    description: "Automation is active — workflows exist and are executing. But Davis AI coverage is low, so automation is likely triggered on schedules or manually rather than reactively to detected problems.",
    recommendation: "Connect Davis problem events as workflow triggers. Build self-healing workflows that react to specific problem types (deployment issues, resource exhaustion, availability drops).",
    detail: "Impact: automation potential is underutilized. Reactive workflows that respond to AI-detected problems deliver faster MTTR than scheduled ones.",
    strongDomain: "automation", strongThreshold: 70,
    weakDomain: "davis", weakThreshold: 50,
    severity: "info",
  },
  {
    id: "gap-davis-dem",
    title: "AI problem detection active but no user impact correlation",
    description: "Davis AI is well configured — problems are being detected and alerted. But Digital Experience coverage is low, so Davis problems cannot be correlated with user impact, session data, or satisfaction scores.",
    recommendation: "Deploy RUM to surface user impact during Davis problems. Configure Davis to include user experience metrics in problem context. Use synthetic monitors to validate recovery from the user's perspective.",
    detail: "Impact: problems are caught but severity is assessed by engineers, not user impact data — leading to mistriaged priorities.",
    strongDomain: "davis", strongThreshold: 75,
    weakDomain: "dem", weakThreshold: 50,
    severity: "info",
  },
  {
    id: "gap-logs-apm",
    title: "Log pipeline active but no trace context enrichment",
    description: "Log Management is strong — Grail is ingesting and processing logs. But Application Observability is weak, meaning logs lack trace ID enrichment and cannot be linked to distributed traces.",
    recommendation: "Instrument application services to inject OpenTelemetry trace context into log output. Configure OpenPipeline processors to extract and index trace IDs. Enable log-to-trace correlation in the Dynatrace UI.",
    detail: "Impact: logs and traces exist in silos. Correlating them during incidents requires manual effort.",
    strongDomain: "logs", strongThreshold: 75,
    weakDomain: "apm", weakThreshold: 50,
    severity: "info",
  },
  {
    id: "gap-governance-oneagent",
    title: "Management zones defined but agent coverage has gaps",
    description: "Platform Governance is strong — management zones, ownership, and segments are configured. But OneAgent deployment is weak, meaning some entities in your governance structure are not actually being monitored.",
    recommendation: "Audit hosts and services within each management zone for agent coverage. Deploy or update OneAgent on hosts that are scoped into governance structures but showing as unmonitored. Use monitoring candidates to identify gaps.",
    detail: "Impact: governance promises coverage that does not exist — alerting profiles and SLOs within zones may fire on incomplete data.",
    strongDomain: "governance", strongThreshold: 75,
    weakDomain: "oneagent", weakThreshold: 60,
    severity: "warning",
  },
  {
    id: "gap-infra-extensions",
    title: "On-premises infrastructure covered but cloud integrations missing",
    description: "Infrastructure Coverage is solid for managed hosts. But Extensions and cloud integrations are weak, suggesting cloud-native services (Lambda, Azure Functions, GCP) or cloud platform metrics are not being pulled in.",
    recommendation: "Deploy ActiveGate-based cloud integrations for AWS, Azure, or GCP. Enable Extensions 2.0 for cloud-native services not covered by OneAgent. Consider AWS Lambda layer or Azure Monitor integration for serverless gaps.",
    detail: "Impact: cloud workloads are invisible. Hybrid environments have blind spots wherever cloud-native services interact with on-prem.",
    strongDomain: "infra", strongThreshold: 75,
    weakDomain: "extensions", weakThreshold: 50,
    severity: "info",
  },
  {
    id: "gap-apm-automation",
    title: "Application errors detected but no automated recovery",
    description: "Application Observability is strong — error rates and problem detection are working. But Automation coverage is low, meaning application-level failures require manual response.",
    recommendation: "Build recovery workflows triggered by high error rate problems: auto-rollback deployments, restart failing services, scale replicas under load, and notify on-call with context-rich alerts.",
    detail: "Impact: application reliability is bounded by human response time during off-hours or high-volume failure scenarios.",
    strongDomain: "apm", strongThreshold: 75,
    weakDomain: "automation", weakThreshold: 50,
    severity: "info",
  },
  {
    id: "gap-bizobs-logs",
    title: "Business events captured but not enriched with log context",
    description: "Business Observability is active — BizEvents are flowing. But Log Management coverage is low, so business events cannot be correlated with application log output to explain why a business transaction failed.",
    recommendation: "Configure OpenPipeline to extract and emit BizEvents from structured log entries. Enrich BizEvents with log-level detail (error messages, stack traces) via processing pipeline rules.",
    detail: "Impact: business KPIs show anomalies but engineers cannot drill from a business metric drop to the log line that caused it.",
    strongDomain: "bizobs", strongThreshold: 70,
    weakDomain: "logs", weakThreshold: 50,
    severity: "info",
  },
  {
    id: "gap-oneagent-extensions",
    title: "OneAgent covers managed hosts but cloud-native gaps remain",
    description: "OneAgent deployment is strong on managed infrastructure. But Extensions coverage is low, suggesting cloud-native or third-party technology stacks (Kafka, Elasticsearch, custom hardware) are not being monitored.",
    recommendation: "Audit technology stacks not covered by OneAgent auto-injection. Deploy Extensions 2.0 for databases, message brokers, and networking components. Use ActiveGate extensions for infrastructure outside OneAgent reach.",
    detail: "Impact: modern application stacks often include components that OneAgent cannot instrument — leaving dependency gaps in the service map.",
    strongDomain: "oneagent", strongThreshold: 75,
    weakDomain: "extensions", weakThreshold: 50,
    severity: "info",
  },
  {
    id: "gap-dem-davis",
    title: "User sessions tracked but experience anomalies not auto-detected",
    description: "Digital Experience monitoring is active — user action volumes and satisfaction scores are flowing. But Davis AI coverage is low, so experience degradation is not automatically surfaced as a problem.",
    recommendation: "Configure Davis anomaly detectors on Apdex scores, user action duration, and error rates. Set up alerting profiles for experience SLO breaches. Enable Davis baseline detection on synthetic monitor performance.",
    detail: "Impact: experience regressions require a human reviewing dashboards to catch — they are missed during low-traffic hours.",
    strongDomain: "dem", strongThreshold: 70,
    weakDomain: "davis", weakThreshold: 50,
    severity: "info",
  },
  {
    id: "gap-infra-logs",
    title: "Infrastructure covered but log collection is missing",
    description: "Infrastructure Coverage is solid — hosts, services, and processes are monitored at the metric level. But Log Management is weak, meaning application and system logs are not flowing to Grail.",
    recommendation: "Configure OneAgent log monitoring for all host groups, or deploy an OpenTelemetry log collector. Enable automatic log detection in OneAgent host monitoring settings.",
    detail: "Impact: infrastructure anomalies are detected but troubleshooting requires manual SSH to read logs — increasing MTTR and reducing root-cause accuracy.",
    strongDomain: "infra", strongThreshold: 75,
    weakDomain: "logs", weakThreshold: 50,
    severity: "warning",
  },
  {
    id: "gap-dem-governance",
    title: "User experience tracked but no ownership structure for monitored apps",
    description: "Digital Experience monitoring is active — user actions and satisfaction scores are flowing. But Platform Governance is weak, meaning there are no management zones or ownership teams to scope alerts, assign SLO accountability, or route experience issues to the right teams.",
    recommendation: "Create management zones per application or business unit. Assign RUM-monitored applications to ownership teams. Define segments so teams get filtered experience dashboards.",
    detail: "Impact: experience data is available but unaccountable — no team owns SLO breaches or knows they are responsible for a degraded user journey.",
    strongDomain: "dem", strongThreshold: 75,
    weakDomain: "governance", weakThreshold: 50,
    severity: "info",
  },
  {
    id: "gap-oneagent-automation",
    title: "Strong agent coverage but no automated response",
    description: "OneAgent deployment is solid — hosts, processes, and services are actively monitored. But Automation coverage is low, meaning infrastructure events and health changes require manual response rather than programmatic remediation.",
    recommendation: "Build AutomationEngine workflows triggered by OneAgent host health events, process restarts, and deployment markers. Start with auto-restart for failed services and capacity scaling for resource exhaustion.",
    detail: "Impact: OneAgent detects issues in real time, but without automation the mean time to remediate is bounded by human availability.",
    strongDomain: "oneagent", strongThreshold: 75,
    weakDomain: "automation", weakThreshold: 50,
    severity: "warning",
  },
  {
    id: "gap-governance-bizobs",
    title: "Governance structure defined but business KPIs are unowned",
    description: "Platform Governance is mature — management zones, ownership teams, and segments are defined. But Business Observability is weak, meaning business-critical transactions and KPIs are not assigned to the ownership structures already in place.",
    recommendation: "Assign BizEvent sources to ownership teams. Create business KPI dashboards scoped by management zone. Use platform segments to give business stakeholders filtered views of their metrics.",
    detail: "Impact: governance structures exist but are only applied to technical monitoring — business outcomes remain unmeasured and unaccountable.",
    strongDomain: "governance", strongThreshold: 75,
    weakDomain: "bizobs", weakThreshold: 50,
    severity: "info",
  },
  {
    id: "gap-logs-governance",
    title: "Log pipeline active but logs are not scoped to teams",
    description: "Log Management is strong — OpenPipeline and Grail buckets are configured. But Platform Governance is weak, meaning logs are not organized by ownership or management zone, making it hard for teams to filter to their own logs.",
    recommendation: "Add team and service metadata enrichment in OpenPipeline. Create Grail buckets scoped to management zones. Use platform segments so teams can apply a filter and see only their relevant log streams.",
    detail: "Impact: all logs are in a shared pool — every team queries everything, increasing cognitive load and Grail storage cost.",
    strongDomain: "logs", strongThreshold: 70,
    weakDomain: "governance", weakThreshold: 50,
    severity: "info",
  },
];

// ── Evaluator ──────────────────────────────────────────────────────────────────

export function evaluateGaps(results: ObsFullEvalResults): Finding[] {
  const scoreById: Record<string, number> = {};
  for (const d of results.domains) scoreById[d.id] = d.score;

  const findings: Finding[] = [];

  for (const rule of GAP_RULES) {
    const strongScore = scoreById[rule.strongDomain] ?? 0;
    const weakScore   = scoreById[rule.weakDomain]   ?? 0;

    if (strongScore >= rule.strongThreshold && weakScore < rule.weakThreshold) {
      const strongDomain = results.domains.find(d => d.id === rule.strongDomain);
      const weakDomain   = results.domains.find(d => d.id === rule.weakDomain);
      findings.push({
        id: rule.id,
        title: rule.title,
        description: rule.description,
        recommendation: rule.recommendation,
        // Combine score context with the authored impact text so both are visible in the UI
        detail: `${strongDomain?.name ?? rule.strongDomain}: ${strongScore}/100  ·  ${weakDomain?.name ?? rule.weakDomain}: ${weakScore}/100  |  ${rule.detail}`,
        severity: rule.severity,
      });
    }
  }

  // Surface critical/warning first
  const ORDER: Record<FindingSeverity, number> = { critical: 0, warning: 1, info: 2, success: 3 };
  findings.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);

  return findings;
}
