// ═══════════════════════════════════════════════════════════
// DQL Queries & Coverage Rules v5 — 100% COVERAGE MODEL
//
// EVERY criterion measures a coverage percentage (0–100%):
//   query  = numerator (entities/signals with the feature)
//   queryB = denominator (total entities/signals eligible)
//   result = query / queryB × 100
//
// OTel-inclusive: queries detect data from OneAgent, OpenTelemetry,
// and any other ingest source. No OneAgent-specific filters.
// ═══════════════════════════════════════════════════════════

export interface Threshold {
  min?: number;
  max?: number;
}

export interface Criterion {
  id: string;
  label: string;
  description: string;
  query: string;
  /** Denominator query — result = query / queryB × 100 (coverage %). Omit for queries that compute ratio internally. */
  queryB?: string;
  /** Optional query that determines whether the criterion applies to the tenant. */
  applicabilityQuery?: string;
  /** Hard-coded denominator when the expected value is a known constant
   *  (e.g., "5 expected log levels"). Use this INSTEAD of queryB whenever
   *  the denominator would be a query that just discards its result and
   *  returns a literal — those queries waste ~15 GB of Grail scan each
   *  (confirmed in the v2.5.0 perf report) for zero information gain.
   *  Mutually exclusive with queryB; useCoverageData honors queryB first. */
  denominatorConstant?: number;
  /** Set by applyTraceProxyMode (../trace-proxy.ts) when this criterion's
   *  span query was replaced with a metric/topology proxy. Surfaces as the
   *  "≈ proxy" chip on criteria rows and in the perf/PDF disclosures. */
  proxied?: boolean;
  thresholds: Threshold[];
}

export interface CapabilityDef {
  name: string;
  color: string;
  criteria: Criterion[];
}

const AI_SPANS_QUERY = "fetch spans, from:now()-72h | filter isNotNull(gen_ai.system) or isNotNull(gen_ai.provider.name) or isNotNull(gen_ai.request.model) or isNotNull(gen_ai.operation.name) | summarize count()";
const BIZEVENTS_QUERY = "fetch bizevents | filter timestamp > now() - 2h | summarize count()";

export const CAPABILITIES: CapabilityDef[] = [
  // ─── 1. INFRASTRUCTURE OBSERVABILITY ───
  {
    name: "Infrastructure Observability",
    color: "#3B82F6",
    criteria: [
      {
        id: "i1", label: "Host CPU coverage (%)",
        description: "Percentage of monitored hosts with active CPU usage metrics from any source (OneAgent, OTel, cloud integration).",
        query: "timeseries val=avg(dt.host.cpu.usage), by:{dt.entity.host} | fields dt.entity.host | dedup dt.entity.host | summarize c=count()",
        queryB: "fetch dt.entity.host | summarize count()",
        thresholds: [{ min: 90 }, { min: 50 }, { min: 1 }],
      },
      {
        id: "i2", label: "Host memory coverage (%)",
        description: "Percentage of monitored hosts with active memory usage metrics.",
        query: "timeseries val=avg(dt.host.memory.usage), by:{dt.entity.host} | fields dt.entity.host | dedup dt.entity.host | summarize c=count()",
        queryB: "fetch dt.entity.host | summarize count()",
        thresholds: [{ min: 90 }, { min: 50 }, { min: 1 }],
      },
      {
        id: "i3", label: "Host disk coverage (%)",
        description: "Percentage of monitored hosts with active disk utilization metrics.",
        query: "timeseries val=avg(dt.host.disk.used.percent), by:{dt.entity.host} | fields dt.entity.host | dedup dt.entity.host | summarize c=count()",
        queryB: "fetch dt.entity.host | summarize count()",
        thresholds: [{ min: 80 }, { min: 50 }, { min: 1 }],
      },
      {
        id: "i4", label: "Host availability coverage (%)",
        description: "Percentage of monitored hosts with availability metrics — basis for SLA reporting.",
        query: "timeseries val=sum(dt.host.availability), by:{dt.entity.host} | fields dt.entity.host | dedup dt.entity.host | summarize c=count()",
        queryB: "fetch dt.entity.host | summarize count()",
        thresholds: [{ min: 90 }, { min: 50 }, { min: 1 }],
      },
      {
        id: "i5", label: "Host network coverage (%)",
        description: "Percentage of monitored hosts with network interface entities.",
        query: "fetch dt.entity.network_interface | fieldsAdd belongs_to = belongs_to[dt.entity.host] | expand belongs_to | summarize count = countDistinct(belongs_to)",
        queryB: "fetch dt.entity.host | summarize count()",
        thresholds: [{ min: 80 }, { min: 50 }, { min: 1 }],
      },
      {
        id: "i6", label: "Process CPU coverage (%)",
        description: "Percentage of process groups with active CPU usage metrics.",
        query: "timeseries val=avg(dt.process.cpu.usage), by:{dt.entity.process_group_instance} | fields dt.entity.process_group_instance | dedup dt.entity.process_group_instance | summarize c=count()",
        queryB: "fetch dt.entity.process_group_instance | summarize count()",
        thresholds: [{ min: 70 }, { min: 30 }, { min: 1 }],
      },
      {
        id: "i7", label: "K8s cluster coverage (%)",
        description: "Percentage of Kubernetes clusters with active workload monitoring.",
        query: "timeseries val=avg(dt.kubernetes.container.cpu_usage), by:{k8s.cluster.name} | fields k8s.cluster.name | dedup k8s.cluster.name | summarize c=count()",
        queryB: "fetch dt.entity.kubernetes_cluster | summarize count()",
        applicabilityQuery: "fetch dt.entity.kubernetes_cluster | summarize count()",
        thresholds: [{ min: 90 }, { min: 50 }, { min: 1 }],
      },
      {
        id: "i8", label: "Host disk entity coverage (%)",
        description: "Percentage of hosts with disk entities detected.",
        query: "fetch dt.entity.disk | fieldsAdd belongs_to = belongs_to[dt.entity.host] | expand belongs_to | summarize count = countDistinct(belongs_to)",
        queryB: "fetch dt.entity.host | summarize count()",
        thresholds: [{ min: 80 }, { min: 50 }, { min: 1 }],
      },
      {
        id: "i9", label: "Davis problem coverage (%)",
        description: "Percentage of hosts covered by Davis AI problem detection.",
        query: "fetch dt.davis.problems, from:now()-72h | filter not(dt.davis.is_duplicate) | fieldsAdd affected = affected_entity_ids | expand affected | filter startsWith(affected, \"HOST-\") | summarize count = countDistinct(affected)",
        queryB: "fetch dt.entity.host | summarize count()",
        thresholds: [{ min: 10 }, { min: 1 }],
      },
      {
        id: "i10", label: "Cloud workload coverage (%)",
        description: "Percentage of K8s namespaces with running cloud-native workloads.",
        query: "fetch dt.entity.cloud_application | fieldsAdd ns = belongs_to[dt.entity.cloud_application_namespace] | expand ns | summarize count = countDistinct(ns)",
        queryB: "fetch dt.entity.cloud_application_namespace | summarize count()",
        applicabilityQuery: "fetch dt.entity.cloud_application_namespace | summarize count()",
        thresholds: [{ min: 80 }, { min: 50 }, { min: 1 }],
      },
      {
        id: "i11", label: "Host-process topology (%)",
        description: "Percentage of hosts with detected process groups — validates entity relationship discovery.",
        query: "fetch dt.entity.process_group_instance | fieldsAdd host = belongs_to[dt.entity.host] | expand host | summarize count = countDistinct(host)",
        queryB: "fetch dt.entity.host | summarize count()",
        thresholds: [{ min: 90 }, { min: 60 }, { min: 1 }],
      },
      {
        id: "i12", label: "K8s workload mapping (%)",
        description: "Percentage of Kubernetes clusters with at least one detected cloud application namespace — validates workload topology.",
        query: "fetch dt.entity.kubernetes_cluster | fieldsAdd ns = contains[dt.entity.cloud_application_namespace] | expand ns | summarize count = countDistinct(id)",
        queryB: "fetch dt.entity.kubernetes_cluster | summarize count()",
        applicabilityQuery: "fetch dt.entity.kubernetes_cluster | summarize count()",
        thresholds: [{ min: 80 }, { min: 50 }, { min: 1 }],
      },
      // ── Cloud Platform Monitoring ──
      {
        id: "i13", label: "Cloud host log enrichment (%)",
        description: "Percentage of hosts with cloud provider context in log data — validates cloud integration feeding host-level metadata.",
        query: "fetch logs | filter timestamp > now() - 2h | filter isNotNull(cloud.provider) | summarize count = countDistinct(dt.entity.host) | fields count",
        queryB: "fetch dt.entity.host | summarize count()",
        thresholds: [{ min: 80 }, { min: 50 }, { min: 1 }],
      },
      {
        id: "i14", label: "Cloud log enrichment (%)",
        description: "Percentage of log records enriched with cloud provider metadata.",
        query: "fetch logs | filter timestamp > now() - 2h | filter isNotNull(cloud.provider) | summarize count()",
        queryB: "fetch logs | filter timestamp > now() - 2h | summarize count()",
        thresholds: [{ min: 50 }, { min: 20 }, { min: 1 }],
      },
      {
        id: "i15", label: "Cloud region enrichment (%)",
        description: "Percentage of cloud-enriched logs that also contain region metadata — validates multi-region observability depth.",
        query: "fetch logs | filter timestamp > now() - 2h | filter isNotNull(cloud.provider) and isNotNull(cloud.region) | summarize count()",
        queryB: "fetch logs | filter timestamp > now() - 2h | filter isNotNull(cloud.provider) | summarize count()",
        thresholds: [{ min: 80 }, { min: 40 }, { min: 1 }],
      },
      {
        id: "i16", label: "Cloud AZ enrichment (%)",
        description: "Percentage of cloud-enriched logs with availability zone metadata — validates resilience observability across failure domains.",
        query: "fetch logs | filter timestamp > now() - 2h | filter isNotNull(cloud.provider) and isNotNull(cloud.availability_zone) | summarize count()",
        queryB: "fetch logs | filter timestamp > now() - 2h | filter isNotNull(cloud.provider) | summarize count()",
        thresholds: [{ min: 80 }, { min: 40 }, { min: 1 }],
      },
      {
        id: "i17", label: "Cloud account enrichment (%)",
        description: "Percentage of cloud-enriched logs with account ID metadata — validates multi-account cloud governance.",
        query: "fetch logs | filter timestamp > now() - 2h | filter isNotNull(cloud.provider) and isNotNull(cloud.account.id) | summarize count()",
        queryB: "fetch logs | filter timestamp > now() - 2h | filter isNotNull(cloud.provider) | summarize count()",
        thresholds: [{ min: 80 }, { min: 40 }, { min: 1 }],
      },
      {
        id: "i18", label: "Cloud span enrichment (%)",
        description: "Percentage of services with cloud provider context in span data.",
        query: "fetch spans, from:now()-2h | filter isNotNull(cloud.provider) | summarize count = countDistinct(coalesce(dt.entity.service, service.name)) | fields count",
        queryB: "fetch dt.entity.service | summarize count()",
        thresholds: [{ min: 50 }, { min: 20 }, { min: 1 }],
      },
      {
        id: "i19", label: "K8s node monitoring depth (%)",
        description: "Percentage of K8s clusters with at least one monitored node — validates node-level cloud compute monitoring.",
        query: `fetch dt.entity.kubernetes_cluster
| fieldsAdd nodeCount = arraySize(toRelationships.isManagedBy)
| filter nodeCount > 0
| summarize count()`,
        queryB: "fetch dt.entity.kubernetes_cluster | summarize count()",
        applicabilityQuery: "fetch dt.entity.kubernetes_cluster | summarize count()",
        thresholds: [{ min: 80 }, { min: 50 }, { min: 1 }],
      },
      {
        id: "i20", label: "Cloud namespace metric coverage (%)",
        description: "Percentage of K8s namespaces with active container metrics — validates cloud workload observability.",
        query: "timeseries val=avg(dt.kubernetes.container.cpu_usage), by:{k8s.namespace.name} | fields k8s.namespace.name | dedup k8s.namespace.name | summarize c=count()",
        queryB: "fetch dt.entity.cloud_application_namespace | summarize count()",
        applicabilityQuery: "fetch dt.entity.cloud_application_namespace | summarize count()",
        thresholds: [{ min: 80 }, { min: 50 }, { min: 1 }],
      },
      // ── Container Health ──
      {
        id: "i21", label: "Container restart monitoring (%)",
        description: "Percentage of K8s namespaces with container restart tracking — critical for detecting CrashLoopBackOff and OOM issues.",
        query: "timeseries val=max(dt.kubernetes.container.restarts), by:{k8s.namespace.name} | fields k8s.namespace.name | dedup k8s.namespace.name | summarize c=count()",
        queryB: "fetch dt.entity.cloud_application_namespace | summarize count()",
        applicabilityQuery: "fetch dt.entity.cloud_application_namespace | summarize count()",
        thresholds: [{ min: 80 }, { min: 50 }, { min: 1 }],
      },
      {
        id: "i22", label: "Container resource limits (%)",
        description: "Percentage of K8s namespaces with defined resource limits — essential for cluster stability and resource governance.",
        query: "timeseries val=avg(dt.kubernetes.container.limits_cpu), by:{k8s.namespace.name} | fields k8s.namespace.name | dedup k8s.namespace.name | summarize c=count()",
        queryB: "fetch dt.entity.cloud_application_namespace | summarize count()",
        applicabilityQuery: "fetch dt.entity.cloud_application_namespace | summarize count()",
        thresholds: [{ min: 80 }, { min: 50 }, { min: 1 }],
      },
    ],
  },

  // ─── 2. APPLICATION OBSERVABILITY ───
  {
    name: "Application Observability",
    color: "#8B5CF6",
    criteria: [
      {
        id: "a1", label: "Service tracing coverage (%)",
        description: "Percentage of detected services with active span data in the last 2h (OneAgent or OTel).",
        query: "fetch spans, from:now()-2h | summarize count = countDistinct(coalesce(dt.entity.service, service.name)) | fields count",
        queryB: "fetch dt.entity.service | summarize count()",
        thresholds: [{ min: 80 }, { min: 50 }, { min: 1 }],
      },
      {
        id: "a2", label: "Service method coverage (%)",
        description: "Percentage of services with method-level tracing.",
        query: "fetch dt.entity.service_method | summarize count()",
        queryB: "fetch dt.entity.service | summarize count()",
        thresholds: [{ min: 60 }, { min: 30 }, { min: 1 }],
      },
      {
        id: "a3", label: "Root span coverage (%)",
        description: "Percentage of services with root spans (incoming requests) in the last 2h.",
        query: "fetch spans, from:now()-2h | filter request.is_root_span == true | summarize count = countDistinct(coalesce(dt.entity.service, service.name)) | fields count",
        queryB: "fetch dt.entity.service | summarize count()",
        thresholds: [{ min: 70 }, { min: 40 }, { min: 1 }],
      },
      {
        id: "a4", label: "OTel instrumentation coverage (%)",
        description: "Percentage of services with OpenTelemetry spans — vendor-neutral instrumentation adoption.",
        query: "fetch spans, from:now()-2h | filter isNotNull(otel.scope.name) or isNotNull(telemetry.sdk.name) or isNotNull(telemetry.sdk.language) | summarize count = countDistinct(coalesce(dt.entity.service, service.name)) | fields count",
        queryB: "fetch dt.entity.service | summarize count()",
        thresholds: [{ min: 50 }, { min: 20 }, { min: 1 }],
      },
      {
        id: "a5", label: "Response time coverage (%)",
        description: "Percentage of services with response time metrics (p95).",
        query: "timeseries val=percentile(dt.service.request.response_time, 95), by:{dt.entity.service} | fields dt.entity.service | dedup dt.entity.service | summarize c=count()",
        queryB: "fetch dt.entity.service | summarize count()",
        thresholds: [{ min: 80 }, { min: 50 }, { min: 1 }],
      },
      {
        id: "a6", label: "Failure tracking coverage (%)",
        description: "Percentage of services with failure rate metrics.",
        query: "timeseries val=sum(dt.service.request.failure_count), by:{dt.entity.service} | fields dt.entity.service | dedup dt.entity.service | summarize c=count()",
        queryB: "fetch dt.entity.service | summarize count()",
        thresholds: [{ min: 70 }, { min: 40 }, { min: 1 }],
      },
      {
        id: "a7", label: "Throughput coverage (%)",
        description: "Percentage of services with request count/throughput metrics.",
        query: "timeseries val=sum(dt.service.request.count), by:{dt.entity.service} | fields dt.entity.service | dedup dt.entity.service | summarize c=count()",
        queryB: "fetch dt.entity.service | summarize count()",
        thresholds: [{ min: 80 }, { min: 50 }, { min: 1 }],
      },
      {
        id: "a8", label: "Database span coverage (%)",
        description: "Percentage of services with database operation spans.",
        query: "fetch spans, from:now()-2h | filter isNotNull(db.system) | summarize count = countDistinct(coalesce(dt.entity.service, service.name)) | fields count",
        queryB: "fetch dt.entity.service | summarize count()",
        thresholds: [{ min: 30 }, { min: 10 }, { min: 1 }],
      },
      {
        id: "a9", label: "Messaging span coverage (%)",
        description: "Percentage of services with messaging spans (Kafka, RabbitMQ, SQS).",
        query: "fetch spans, from:now()-2h | filter isNotNull(messaging.system) | summarize count = countDistinct(coalesce(dt.entity.service, service.name)) | fields count",
        queryB: "fetch dt.entity.service | summarize count()",
        thresholds: [{ min: 20 }, { min: 5 }, { min: 1 }],
      },
      {
        id: "a10", label: "Multi-service trace depth (%)",
        description: "Percentage of traces spanning 2+ services — validates distributed tracing depth.",
        query: "fetch spans, from:now()-2h | summarize services = countDistinct(coalesce(dt.entity.service, service.name)), by: {trace.id} | filter services > 1 | summarize count()",
        queryB: "fetch spans, from:now()-2h | summarize countDistinct(trace.id)",
        thresholds: [{ min: 30 }, { min: 10 }, { min: 1 }],
      },
      {
        id: "a11", label: "Service-process mapping (%)",
        description: "Percentage of services with associated process groups — validates service-to-infrastructure topology.",
        query: "fetch dt.entity.service | fieldsAdd pgi = runs_on[dt.entity.process_group_instance] | expand pgi | summarize count = countDistinct(id)",
        queryB: "fetch dt.entity.service | summarize count()",
        thresholds: [{ min: 80 }, { min: 50 }, { min: 1 }],
      },
      {
        id: "a12", label: "Service tagging utilization (%)",
        description: "Percentage of services with at least one tag assigned — tags enable release tracking, ownership, and filtering.",
        query: "fetch dt.entity.service | fieldsAdd t = tags | expand t | summarize count = countDistinct(id)",
        queryB: "fetch dt.entity.service | summarize count()",
        thresholds: [{ min: 50 }, { min: 20 }, { min: 1 }],
      },
      {
        id: "a13", label: "Database call depth (%)",
        description: "Percentage of DB-using services that interact with 2+ database systems — validates deep database monitoring across the stack.",
        query: "fetch spans, from:now()-2h | filter isNotNull(db.system) | fieldsAdd _svc = coalesce(dt.entity.service, service.name) | summarize systems = countDistinct(db.system), by:{_svc} | filter systems >= 2 | summarize count()",
        queryB: "fetch spans, from:now()-2h | filter isNotNull(db.system) | summarize count = countDistinct(coalesce(dt.entity.service, service.name))",
        thresholds: [{ min: 30 }, { min: 10 }, { min: 1 }],
      },
      {
        id: "a14", label: "Frontend trace correlation (%)",
        description: "Percentage of web applications with request events carrying a trace id so browser activity can be tied back to backend spans.",
        query: "fetch user.events, from:now()-24h | filter characteristics.has_request == true | filter isNotNull(trace.id) | summarize c=countDistinct(dt.rum.application.entity) | fields c",
        queryB: "fetch dt.entity.application | summarize count()",
        thresholds: [{ min: 60 }, { min: 25 }, { min: 1 }],
      },
      {
        id: "a15", label: "Route metadata coverage (%)",
        description: "Percentage of services whose spans expose HTTP method and route metadata for deeper trace enrichment.",
        query: "fetch spans, from:now()-2h | filter isNotNull(http.request.method) and isNotNull(http.route) | summarize c=countDistinct(coalesce(dt.entity.service, service.name)) | fields c",
        queryB: "fetch dt.entity.service | summarize count()",
        thresholds: [{ min: 70 }, { min: 35 }, { min: 1 }],
      },
      {
        id: "a16", label: "Exception trace coverage (%)",
        description: "Percentage of services whose spans surface exception details so failures stay visible in the trace itself.",
        query: "fetch spans, from:now()-2h | filter isNotNull(exception.type) or isNotNull(exception.message) | summarize c=countDistinct(coalesce(dt.entity.service, service.name)) | fields c",
        queryB: "fetch dt.entity.service | summarize count()",
        thresholds: [{ min: 50 }, { min: 20 }, { min: 1 }],
      },
      {
        id: "a17", label: "Release context coverage (%)",
        description: "Percentage of services with version or deployment metadata in spans so incidents can be tied to releases.",
        query: "fetch spans, from:now()-2h | filter isNotNull(service.version) or isNotNull(deployment.environment) | summarize c=countDistinct(coalesce(dt.entity.service, service.name)) | fields c",
        queryB: "fetch dt.entity.service | summarize count()",
        thresholds: [{ min: 50 }, { min: 20 }, { min: 1 }],
      },
      {
        id: "a18", label: "Trace-log correlation coverage (%)",
        description: "Percentage of logs carrying trace or span identifiers so trace improvements can be validated from the log stream.",
        query: "fetch logs | filter timestamp > now() - 2h | filter isNotNull(trace_id) or isNotNull(span_id) | summarize count()",
        queryB: "fetch logs | filter timestamp > now() - 2h | summarize count()",
        thresholds: [{ min: 60 }, { min: 25 }, { min: 1 }],
      },
    ],
  },

  // ─── 3. DIGITAL EXPERIENCE ───
  {
    name: "Digital Experience",
    color: "#EC4899",
    criteria: [
      {
        id: "d1", label: "RUM action coverage (%)",
        description: "Percentage of web applications with active user action metrics.",
        query: "timeseries val=sum(dt.frontend.user_action.count), by:{dt.entity.application} | fields dt.entity.application | dedup dt.entity.application | summarize c=count()",
        queryB: "fetch dt.entity.application | summarize count()",
        applicabilityQuery: "fetch dt.entity.application | summarize count()",
        thresholds: [{ min: 80 }, { min: 50 }, { min: 1 }],
      },
      {
        id: "d2", label: "Session tracking coverage (%)",
        description: "Percentage of web applications with active session tracking.",
        query: "timeseries val=avg(dt.frontend.session.active.estimated_count), by:{dt.entity.application} | fields dt.entity.application | dedup dt.entity.application | summarize c=count()",
        queryB: "fetch dt.entity.application | summarize count()",
        applicabilityQuery: "fetch dt.entity.application | summarize count()",
        thresholds: [{ min: 80 }, { min: 50 }, { min: 1 }],
      },
      {
        id: "d3", label: "LCP coverage (%)",
        description: "Percentage of web applications with Largest Contentful Paint metrics — Core Web Vital.",
        query: "timeseries val=avg(dt.frontend.web.page.largest_contentful_paint), by:{dt.entity.application} | fields dt.entity.application | dedup dt.entity.application | summarize c=count()",
        queryB: "fetch dt.entity.application | summarize count()",
        applicabilityQuery: "fetch dt.entity.application | summarize count()",
        thresholds: [{ min: 80 }, { min: 50 }, { min: 1 }],
      },
      {
        id: "d4", label: "INP coverage (%)",
        description: "Percentage of web applications with Interaction to Next Paint metrics — Core Web Vital.",
        query: "timeseries val=avg(dt.frontend.web.page.interaction_to_next_paint), by:{dt.entity.application} | fields dt.entity.application | dedup dt.entity.application | summarize c=count()",
        queryB: "fetch dt.entity.application | summarize count()",
        applicabilityQuery: "fetch dt.entity.application | summarize count()",
        thresholds: [{ min: 80 }, { min: 50 }, { min: 1 }],
      },
      {
        id: "d5", label: "CLS coverage (%)",
        description: "Percentage of web applications with Cumulative Layout Shift metrics — Core Web Vital.",
        query: "timeseries val=avg(dt.frontend.web.page.cumulative_layout_shift), by:{dt.entity.application} | fields dt.entity.application | dedup dt.entity.application | summarize c=count()",
        queryB: "fetch dt.entity.application | summarize count()",
        applicabilityQuery: "fetch dt.entity.application | summarize count()",
        thresholds: [{ min: 80 }, { min: 50 }, { min: 1 }],
      },
      {
        id: "d6", label: "Frontend error coverage (%)",
        description: "Percentage of web applications with error tracking enabled.",
        query: "timeseries val=sum(dt.frontend.error.count), by:{dt.entity.application} | fields dt.entity.application | dedup dt.entity.application | summarize c=count()",
        queryB: "fetch dt.entity.application | summarize count()",
        applicabilityQuery: "fetch dt.entity.application | summarize count()",
        thresholds: [{ min: 70 }, { min: 40 }, { min: 1 }],
      },
      {
        id: "d7", label: "Synthetic HTTP coverage (%)",
        description: "Percentage of web applications covered by HTTP synthetic monitors.",
        query: "fetch dt.entity.http_check | summarize count()",
        queryB: "fetch dt.entity.application | summarize count()",
        applicabilityQuery: "fetch dt.entity.application | summarize count()",
        thresholds: [{ min: 100 }, { min: 50 }, { min: 1 }],
      },
      {
        id: "d8", label: "Synthetic browser coverage (%)",
        description: "Percentage of web applications covered by browser-based synthetic tests.",
        query: "fetch dt.entity.synthetic_test | summarize count()",
        queryB: "fetch dt.entity.application | summarize count()",
        applicabilityQuery: "fetch dt.entity.application | summarize count()",
        thresholds: [{ min: 100 }, { min: 50 }, { min: 1 }],
      },
      {
        id: "d9", label: "Mobile app coverage (%)",
        description: "Percentage of total applications that have mobile monitoring.",
        query: "fetch dt.entity.mobile_application | summarize count()",
        queryB: "fetch dt.entity.application | fieldsAdd type = \"web\" | append [fetch dt.entity.mobile_application | fieldsAdd type = \"mob\"] | summarize count()",
        applicabilityQuery: "fetch dt.entity.mobile_application | summarize count()",
        thresholds: [{ min: 30 }, { min: 10 }, { min: 1 }],
      },
      {
        id: "d10", label: "Synthetic location diversity (%)",
        description: "Ratio of synthetic locations to total synthetic monitors.",
        query: "fetch dt.entity.synthetic_location | summarize count()",
        queryB: "fetch dt.entity.http_check | fieldsAdd type = \"http\" | append [fetch dt.entity.synthetic_test | fieldsAdd type = \"browser\"] | summarize count()",
        applicabilityQuery: "fetch dt.entity.http_check | fieldsAdd type = \"http\" | append [fetch dt.entity.synthetic_test | fieldsAdd type = \"browser\"] | summarize count()",
        thresholds: [{ min: 100 }, { min: 50 }, { min: 1 }],
      },
      {
        id: "d11", label: "Synthetic availability coverage (%)",
        description: "Ratio of synthetic monitors to web applications — validates proactive availability monitoring.",
        query: "fetch dt.entity.http_check | fieldsAdd type = \"http\" | append [fetch dt.entity.synthetic_test | fieldsAdd type = \"browser\"] | summarize count()",
        queryB: "fetch dt.entity.application | summarize count()",
        applicabilityQuery: "fetch dt.entity.application | summarize count()",
        thresholds: [{ min: 100 }, { min: 50 }, { min: 1 }],
      },
      {
        id: "d12", label: "Session replay coverage (%)",
        description: "Percentage of web applications with session replay data so customer journeys can be replayed and investigated.",
        query: "fetch user.replays, from:now()-24h | summarize c=countDistinct(dt.rum.application.entity) | fields c",
        queryB: "fetch dt.entity.application | summarize count()",
        thresholds: [{ min: 40 }, { min: 15 }, { min: 1 }],
      },
      {
        id: "d13", label: "Navigation journey coverage (%)",
        description: "Percentage of web applications with navigation events so funnels, paths, and drop-offs can be understood.",
        query: "fetch user.events, from:now()-24h | filter characteristics.has_navigation == true | summarize c=countDistinct(dt.rum.application.entity) | fields c",
        queryB: "fetch dt.entity.application | summarize count()",
        thresholds: [{ min: 60 }, { min: 25 }, { min: 1 }],
      },
      {
        id: "d14", label: "Page/view summary coverage (%)",
        description: "Percentage of web and mobile applications with page or view summary data for engagement analysis.",
        query: "fetch user.events, from:now()-24h | filter characteristics.has_page_summary == true or characteristics.has_view_summary == true | summarize c=countDistinct(dt.rum.application.entity) | fields c",
        queryB: "fetch dt.entity.application | summarize count()",
        thresholds: [{ min: 60 }, { min: 25 }, { min: 1 }],
      },
      {
        id: "d15", label: "Mobile crash coverage (%)",
        description: "Percentage of mobile applications with crash or ANR telemetry for mobile demystification and triage.",
        query: "fetch user.events, from:now()-7d | filter characteristics.has_crash == true or characteristics.has_anr == true | summarize c=countDistinct(dt.rum.application.entity) | fields c",
        queryB: "fetch dt.entity.mobile_application | summarize count()",
        applicabilityQuery: "fetch dt.entity.mobile_application | summarize count()",
        thresholds: [{ min: 50 }, { min: 20 }, { min: 1 }],
      },
    ],
  },

  // ─── 4. LOG ANALYTICS ───
  {
    name: "Log Analytics",
    color: "#F59E0B",
    criteria: [
      {
        id: "l1", label: "Host log coverage (%)",
        description: "Percentage of hosts sending log data in the last 2h.",
        query: "fetch logs | filter timestamp > now() - 2h | filter isNotNull(dt.entity.host) | summarize count = countDistinct(dt.entity.host) | fields count",
        queryB: "fetch dt.entity.host | summarize count()",
        thresholds: [{ min: 80 }, { min: 50 }, { min: 1 }],
      },
      {
        id: "l2", label: "Service log coverage (%)",
        description: "Percentage of services with associated log data.",
        query: "fetch logs | filter timestamp > now() - 2h | filter isNotNull(dt.entity.service) | summarize count = countDistinct(dt.entity.service) | fields count",
        queryB: "fetch dt.entity.service | summarize count()",
        thresholds: [{ min: 60 }, { min: 30 }, { min: 1 }],
      },
      {
        id: "l3", label: "Trace-correlated logs (%)",
        description: "Percentage of log records enriched with trace_id.",
        query: "fetch logs | filter timestamp > now() - 2h | filter isNotNull(trace_id) | summarize count()",
        queryB: "fetch logs | filter timestamp > now() - 2h | summarize count()",
        thresholds: [{ min: 30 }, { min: 10 }, { min: 1 }],
      },
      {
        id: "l4", label: "Entity-enriched logs (%)",
        description: "Percentage of log records enriched with host entity context.",
        query: "fetch logs | filter timestamp > now() - 2h | filter isNotNull(dt.entity.host) | summarize count()",
        queryB: "fetch logs | filter timestamp > now() - 2h | summarize count()",
        thresholds: [{ min: 70 }, { min: 30 }, { min: 1 }],
      },
      {
        id: "l5", label: "Process group log correlation (%)",
        description: "Percentage of log records enriched with process group context.",
        query: "fetch logs | filter timestamp > now() - 2h | filter isNotNull(dt.process_group.id) | summarize count()",
        queryB: "fetch logs | filter timestamp > now() - 2h | summarize count()",
        thresholds: [{ min: 30 }, { min: 10 }, { min: 1 }],
      },
      {
        id: "l6", label: "Log source diversity (%)",
        description: "Ratio of distinct log sources to total hosts — validates breadth of log ingestion across infrastructure.",
        query: "fetch logs | filter timestamp > now() - 2h | summarize countDistinct(log.source)",
        queryB: "fetch dt.entity.host | summarize count()",
        thresholds: [{ min: 100 }, { min: 50 }, { min: 10 }],
      },
      {
        id: "l7", label: "Error log coverage (%)",
        description: "Percentage of services whose logs include ERROR-level entries.",
        query: 'fetch logs | filter timestamp > now() - 2h | filter loglevel == "ERROR" | filter isNotNull(dt.entity.service) | summarize count = countDistinct(dt.entity.service) | fields count',
        queryB: "fetch dt.entity.service | summarize count()",
        thresholds: [{ min: 30 }, { min: 10 }, { min: 1 }],
      },
      {
        id: "l8", label: "K8s log coverage (%)",
        description: "Percentage of K8s namespaces with log data.",
        query: "fetch logs | filter timestamp > now() - 2h | filter isNotNull(k8s.namespace.name) | summarize countDistinct(k8s.namespace.name)",
        queryB: "fetch dt.entity.cloud_application_namespace | summarize count()",
        thresholds: [{ min: 80 }, { min: 50 }, { min: 1 }],
      },
      {
        id: "l9", label: "Log severity diversity (%)",
        description: "Percentage of severity levels being ingested (out of 5: ERROR, WARN, INFO, DEBUG, TRACE).",
        query: "fetch logs | filter timestamp > now() - 2h | summarize countDistinct(loglevel)",
        // denominator was previously a query that scanned ~15 GB of logs just
        // to discard the count and return the literal 5. See Task #51 / v2.5.1
        // perf-waste audit. Now expressed as a code constant.
        denominatorConstant: 5,
        thresholds: [{ min: 60 }, { min: 40 }],
      },
      {
        id: "l10", label: "Log retention validation (%)",
        description: "Percentage of distinct log sources with data in the last 24h vs 2h.",
        query: "fetch logs | filter timestamp > now() - 24h | summarize countDistinct(log.source)",
        queryB: "fetch logs | filter timestamp > now() - 2h | summarize countDistinct(log.source)",
        thresholds: [{ min: 90 }, { min: 70 }, { min: 1 }],
      },
      {
        id: "l11", label: "Dedicated buckets usage",
        description: "Number of distinct Grail buckets used for log storage (expected >= 2 for proper segregation).",
        query: "fetch logs, scanLimitGBytes:-1 | filter timestamp > now() - 2h | summarize countDistinct(dt.system.bucket)",
        denominatorConstant: 2,
        thresholds: [{ min: 100 }, { min: 50 }],
      },
      {
        id: "l12", label: "Structured logging (%)",
        description: "Percentage of logs containing structured JSON content for better parsing and analysis.",
        query: `fetch logs | filter timestamp > now() - 2h | filter contains(content, "{") | summarize count()`,
        queryB: "fetch logs | filter timestamp > now() - 2h | summarize count()",
        thresholds: [{ min: 50 }, { min: 20 }, { min: 1 }],
      },
      {
        id: "l13", label: "Span-correlated logs (%)",
        description: "Percentage of logs enriched with span_id for granular trace-to-log linking (deeper than trace_id alone).",
        query: "fetch logs | filter timestamp > now() - 2h | filter isNotNull(span_id) | summarize count()",
        queryB: "fetch logs | filter timestamp > now() - 2h | summarize count()",
        thresholds: [{ min: 30 }, { min: 10 }, { min: 1 }],
      },
      {
        id: "l14", label: "Multi-source host logging (%)",
        description: "Percentage of hosts receiving logs from 2+ distinct sources — indicates balanced log distribution.",
        query: "fetch logs | filter timestamp > now() - 2h | filter isNotNull(dt.entity.host) | summarize sources = countDistinct(log.source), by:{dt.entity.host} | filter sources >= 2 | summarize count()",
        queryB: "fetch dt.entity.host | summarize count()",
        thresholds: [{ min: 50 }, { min: 20 }, { min: 1 }],
      },
      {
        id: "l15", label: "Log-based events",
        description: "Presence of events generated from log data — indicates established log-based alerting.",
        query: 'fetch events | filter timestamp > now() - 24h | filter event.kind == "LOG" | summarize count()',
        denominatorConstant: 1,
        thresholds: [{ min: 100 }, { min: 50 }],
      },
      {
        id: "l16", label: "Custom attribute enrichment (%)",
        description: "Percentage of logs enriched with custom device entities for extended context.",
        query: "fetch logs | filter timestamp > now() - 2h | filter isNotNull(dt.entity.custom_device) | summarize count()",
        queryB: "fetch logs | filter timestamp > now() - 2h | summarize count()",
        thresholds: [{ min: 30 }, { min: 10 }, { min: 1 }],
      },
      {
        id: "l17", label: "Dedicated log bucket usage (%)",
        description: "Percentage of expected dedicated log buckets in use (out of 3) — enables cost-effective retention, tiered storage, and compliance-driven log separation.",
        query: `fetch dt.system.buckets
| filter type == "logs" and name != "default"
| summarize count()`,
        denominatorConstant: 3,
        thresholds: [{ min: 100 }, { min: 33 }, { min: 1 }],
      },
      {
        id: "l18", label: "Log-level severity diversity (%)",
        description: "Percentage of severity levels being ingested (out of 5: ERROR, WARN, INFO, DEBUG, TRACE) — confirms log instrumentation captures the full spectrum.",
        query: "fetch logs, from:now()-2h\n| summarize count = countDistinct(loglevel)",
        denominatorConstant: 5,
        thresholds: [{ min: 80 }, { min: 40 }, { min: 1 }],
      },
    ],
  },

  // ─── 5. APPLICATION SECURITY ───
  {
    name: "Application Security",
    color: "#EF4444",
    criteria: [
      {
        id: "s1", label: "Service security activity (30d, %)",
        description: "Percentage of services with security events in the last 30 days. This measures recent AppSec utilization, not merely configuration.",
        query: 'fetch events, from:now()-30d | filter event.kind == "SECURITY_EVENT" | fieldsAdd affected = affected_entity_ids | expand affected | filter startsWith(affected, "SERVICE-") | summarize count = countDistinct(affected) | fields count',
        queryB: "fetch dt.entity.service | summarize count()",
        thresholds: [{ min: 30 }, { min: 10 }, { min: 1 }],
      },
      {
        id: "s2", label: "Security event type coverage (%)",
        description: "Percentage of security event types detected vs expected categories.",
        query: 'fetch events | filter event.kind == "SECURITY_EVENT" | filter timestamp > now() - 24h | summarize countDistinct(event.type)',
        denominatorConstant: 5,
        thresholds: [{ min: 60 }, { min: 20 }],
      },
      {
        id: "s3", label: "Runtime vulnerability baseline (%)",
        description: "Percentage of services with runtime vulnerability evidence in the last 30 days.",
        query: 'fetch events, from:now()-30d | filter event.kind == "SECURITY_EVENT" | filter contains(lower(toString(event.type)), "vulnerab") or contains(lower(toString(event.category)), "vulnerab") | fieldsAdd affected = affected_entity_ids | expand affected | filter startsWith(affected, "SERVICE-") | summarize count = countDistinct(affected) | fields count',
        queryB: "fetch dt.entity.service | summarize count()",
        thresholds: [{ min: 100 }],
      },
      {
        id: "s4", label: "Database interaction security (%)",
        description: "Percentage of services with database operation tracing — SQL injection detection surface coverage.",
        query: "fetch spans, from:now()-2h | filter isNotNull(db.system) | summarize count = countDistinct(coalesce(dt.entity.service, service.name)) | fields count",
        queryB: "fetch dt.entity.service | summarize count()",
        thresholds: [{ min: 30 }, { min: 10 }, { min: 1 }],
      },
      {
        id: "s5", label: "Error log security coverage (%)",
        description: "Percentage of services with ERROR-level logs.",
        query: 'fetch logs | filter timestamp > now() - 2h | filter loglevel == "ERROR" | filter isNotNull(dt.entity.service) | summarize count = countDistinct(dt.entity.service) | fields count',
        queryB: "fetch dt.entity.service | summarize count()",
        thresholds: [{ min: 30 }, { min: 10 }, { min: 1 }],
      },
      {
        id: "s6", label: "Warn log security coverage (%)",
        description: "Percentage of services with WARN-level logs.",
        query: 'fetch logs | filter timestamp > now() - 2h | filter loglevel == "WARN" | filter isNotNull(dt.entity.service) | summarize count = countDistinct(dt.entity.service) | fields count',
        queryB: "fetch dt.entity.service | summarize count()",
        thresholds: [{ min: 30 }, { min: 10 }, { min: 1 }],
      },
      {
        id: "s7", label: "Event kind diversity (%)",
        description: "Percentage of event kinds monitored vs expected (out of 5).",
        query: "fetch events | filter timestamp > now() - 2h | summarize countDistinct(event.kind)",
        denominatorConstant: 5,
        thresholds: [{ min: 60 }, { min: 40 }],
      },
      {
        id: "s8", label: "Failed request coverage (%)",
        description: "Percentage of services with failed request tracking.",
        query: "fetch spans, from:now()-2h | filter request.is_root_span == true | filter request.is_failed == true | summarize count = countDistinct(coalesce(dt.entity.service, service.name)) | fields count",
        queryB: "fetch dt.entity.service | summarize count()",
        thresholds: [{ min: 20 }, { min: 5 }, { min: 1 }],
      },
      {
        id: "s9", label: "Davis security problem coverage (%)",
        description: "Percentage of services covered by Davis AI problem detection.",
        query: 'fetch dt.davis.problems, from:now()-72h | filter not(dt.davis.is_duplicate) | fieldsAdd affected = affected_entity_ids | expand affected | filter startsWith(affected, "SERVICE-") | summarize count = countDistinct(affected)',
        queryB: "fetch dt.entity.service | summarize count()",
        thresholds: [{ min: 10 }, { min: 1 }],
      },
      {
        id: "s10", label: "HTTP request surface coverage (%)",
        description: "Percentage of services with HTTP request tracing — validates attack surface visibility for web application security (OWASP Top 10).",
        query: "fetch spans, from:now()-2h | filter isNotNull(http.request.method) | summarize count = countDistinct(coalesce(dt.entity.service, service.name)) | fields count",
        queryB: "fetch dt.entity.service | summarize count()",
        thresholds: [{ min: 80 }, { min: 50 }, { min: 1 }],
      },
      {
        id: "s11", label: "Attack detection activity (30d, %)",
        description: "Percentage of services with attack-related security events in the last 30 days — validates recent Runtime Application Protection utilization.",
        query: 'fetch events, from:now()-30d | filter event.kind == "SECURITY_EVENT" | filter contains(lower(toString(event.type)), "attack") or contains(lower(toString(event.category)), "attack") or contains(lower(toString(event.provider)), "appsec") | fieldsAdd affected = affected_entity_ids | expand affected | filter startsWith(affected, "SERVICE-") | summarize count = countDistinct(affected) | fields count',
        queryB: "fetch dt.entity.service | summarize count()",
        thresholds: [{ min: 10 }, { min: 1 }],
      },
    ],
  },

  // ─── 6. THREAT OBSERVABILITY ───
  {
    name: "Threat Observability",
    color: "#F97316",
    criteria: [
      {
        id: "t1", label: "Davis problem entity coverage (%)",
        description: "Percentage of hosts with entities affected by Davis AI problem detection in 72h.",
        query: "fetch dt.davis.problems, from:now()-72h | filter not(dt.davis.is_duplicate) | fieldsAdd affected = affected_entity_ids | expand affected | filter startsWith(affected, \"HOST-\") | summarize count = countDistinct(affected)",
        queryB: "fetch dt.entity.host | summarize count()",
        thresholds: [{ min: 20 }, { min: 5 }, { min: 1 }],
      },
      {
        id: "t2", label: "Problem entity correlation (%)",
        description: "Percentage of Davis problems with identified affected entities — validates entity topology linkage for root cause analysis.",
        query: "fetch dt.davis.problems, from:now()-72h | filter not(dt.davis.is_duplicate) | filter isNotNull(affected_entity_ids) | summarize count()",
        queryB: "fetch dt.davis.problems, from:now()-72h | filter not(dt.davis.is_duplicate) | summarize count()",
        thresholds: [{ min: 80 }, { min: 50 }, { min: 1 }],
      },
      {
        id: "t3", label: "Problem category coverage (%)",
        description: "Percentage of problem categories detected (out of 4: AVAILABILITY, ERROR, SLOWDOWN, RESOURCE).",
        query: "fetch dt.davis.problems, from:now()-72h | filter not(dt.davis.is_duplicate) | summarize countDistinct(event.category)",
        denominatorConstant: 4,
        thresholds: [{ min: 75 }, { min: 50 }, { min: 25 }],
      },
      {
        id: "t4", label: "Security event service coverage (%)",
        description: "Percentage of services with security events detected.",
        query: 'fetch events, from:now()-30d | filter event.kind == "SECURITY_EVENT" | fieldsAdd affected = affected_entity_ids | expand affected | filter startsWith(affected, "SERVICE-") | summarize count = countDistinct(affected) | fields count',
        queryB: "fetch dt.entity.service | summarize count()",
        thresholds: [{ min: 20 }, { min: 5 }, { min: 1 }],
      },
      {
        id: "t5", label: "Error log threat coverage (%)",
        description: "Percentage of hosts with ERROR-level logs for threat detection.",
        query: 'fetch logs | filter timestamp > now() - 2h | filter loglevel == "ERROR" | filter isNotNull(dt.entity.host) | summarize count = countDistinct(dt.entity.host) | fields count',
        queryB: "fetch dt.entity.host | summarize count()",
        thresholds: [{ min: 30 }, { min: 10 }, { min: 1 }],
      },
      {
        id: "t6", label: "Host security log coverage (%)",
        description: "Percentage of hosts with ERROR or WARN log events in the last 2h — validates threat signal generation per host.",
        query: `fetch logs, from:now()-2h
| filter loglevel == "ERROR" or loglevel == "WARN"
| summarize count = countDistinct(dt.entity.host)`,
        queryB: "fetch dt.entity.host | summarize count()",
        thresholds: [{ min: 100 }, { min: 50 }, { min: 10 }],
      },
      {
        id: "t7", label: "Log entity enrichment (%)",
        description: "Percentage of logs enriched with host entity context.",
        query: "fetch logs | filter timestamp > now() - 2h | filter isNotNull(dt.entity.host) | summarize count()",
        queryB: "fetch logs | filter timestamp > now() - 2h | summarize count()",
        thresholds: [{ min: 70 }, { min: 30 }, { min: 1 }],
      },
      {
        id: "t8", label: "Trace-correlated threat logs (%)",
        description: "Percentage of logs with trace_id for attack path tracking.",
        query: "fetch logs | filter timestamp > now() - 2h | filter isNotNull(trace_id) | summarize count()",
        queryB: "fetch logs | filter timestamp > now() - 2h | summarize count()",
        thresholds: [{ min: 30 }, { min: 10 }, { min: 1 }],
      },
      {
        id: "t9", label: "Recurring affected entity detection (%)",
        description: "Percentage of affected entities that appear in multiple problems (repeat offenders).",
        query: "fetch dt.davis.problems, from:now()-72h | filter not(dt.davis.is_duplicate) | fieldsAdd affected = affected_entity_ids | expand affected | summarize problem_count = count(), by:{affected} | filter problem_count > 1 | summarize count()",
        queryB: "fetch dt.davis.problems, from:now()-72h | filter not(dt.davis.is_duplicate) | fieldsAdd affected = affected_entity_ids | expand affected | summarize count = countDistinct(affected)",
        thresholds: [{ min: 10 }, { min: 1 }],
      },
      {
        id: "t10", label: "Problem resolution coverage (%)",
        description: "Percentage of detected problems that were resolved (CLOSED).",
        query: 'fetch dt.davis.problems, from:now()-72h | filter not(dt.davis.is_duplicate) | filter event.status == "CLOSED" | summarize count()',
        queryB: "fetch dt.davis.problems, from:now()-72h | filter not(dt.davis.is_duplicate) | summarize count()",
        thresholds: [{ min: 50 }, { min: 20 }, { min: 1 }],
      },
      {
        id: "t11", label: "Event entity correlation (%)",
        description: "Percentage of events with affected entity IDs — validates event-to-topology linkage for incident response.",
        query: "fetch events | filter timestamp > now() - 2h | filter isNotNull(affected_entity_ids) | summarize count()",
        queryB: "fetch events | filter timestamp > now() - 2h | summarize count()",
        thresholds: [{ min: 50 }, { min: 20 }, { min: 1 }],
      },
    ],
  },

  // ─── 7. AI OBSERVABILITY ───
  {
    name: "AI Observability",
    color: "#06B6D4",
    criteria: [
      {
        id: "ai1", label: "AI span service coverage (%)",
        description: "Percentage of services with AI/LLM spans.",
        query: "fetch spans, from:now()-72h | filter isNotNull(gen_ai.system) or isNotNull(gen_ai.provider.name) or isNotNull(gen_ai.request.model) or isNotNull(gen_ai.operation.name) | summarize count = countDistinct(coalesce(dt.entity.service, service.name)) | fields count",
        queryB: "fetch dt.entity.service | summarize count()",
        applicabilityQuery: AI_SPANS_QUERY,
        thresholds: [{ min: 10 }, { min: 5 }, { min: 1 }],
      },
      {
        id: "ai2", label: "Token tracking coverage (%)",
        description: "Percentage of AI spans with token usage tracking.",
        query: "fetch spans, from:now()-72h | filter isNotNull(gen_ai.system) or isNotNull(gen_ai.provider.name) or isNotNull(gen_ai.request.model) or isNotNull(gen_ai.operation.name) | filter isNotNull(gen_ai.usage.input_tokens) or isNotNull(gen_ai.usage.output_tokens) | summarize count()",
        queryB: "fetch spans, from:now()-72h | filter isNotNull(gen_ai.system) or isNotNull(gen_ai.provider.name) or isNotNull(gen_ai.request.model) or isNotNull(gen_ai.operation.name) | summarize count()",
        applicabilityQuery: AI_SPANS_QUERY,
        thresholds: [{ min: 80 }, { min: 50 }, { min: 1 }],
      },
      {
        id: "ai3", label: "AI provider diversity (%)",
        description: "Percentage of known AI providers detected vs expected (out of 5).",
        query: "fetch spans, from:now()-72h | filter isNotNull(gen_ai.system) or isNotNull(gen_ai.provider.name) or isNotNull(gen_ai.request.model) or isNotNull(gen_ai.operation.name) | fieldsAdd provider = coalesce(gen_ai.system, gen_ai.provider.name) | summarize countDistinct(provider)",
        denominatorConstant: 5,
        applicabilityQuery: AI_SPANS_QUERY,
        thresholds: [{ min: 40 }, { min: 20 }],
      },
      {
        id: "ai4", label: "Agent invocation coverage (%)",
        description: "Percentage of AI spans with agent invocation tracing.",
        query: "fetch spans, from:now()-72h | filter isNotNull(gen_ai.system) or isNotNull(gen_ai.provider.name) or isNotNull(gen_ai.request.model) or isNotNull(gen_ai.operation.name) | filter isNotNull(gen_ai.agent.name) | summarize count()",
        queryB: "fetch spans, from:now()-72h | filter isNotNull(gen_ai.system) or isNotNull(gen_ai.provider.name) or isNotNull(gen_ai.request.model) or isNotNull(gen_ai.operation.name) | summarize count()",
        applicabilityQuery: AI_SPANS_QUERY,
        thresholds: [{ min: 30 }, { min: 10 }, { min: 1 }],
      },
      {
        id: "ai5", label: "Prompt/response tracing coverage (%)",
        description: "Percentage of AI spans with prompt or response tracing.",
        query: "fetch spans, from:now()-72h | filter isNotNull(gen_ai.system) or isNotNull(gen_ai.provider.name) or isNotNull(gen_ai.request.model) or isNotNull(gen_ai.operation.name) | filter isNotNull(gen_ai.prompt) or isNotNull(gen_ai.completion) or isNotNull(gen_ai.input.messages) or isNotNull(gen_ai.output.messages) | summarize count()",
        queryB: "fetch spans, from:now()-72h | filter isNotNull(gen_ai.system) or isNotNull(gen_ai.provider.name) or isNotNull(gen_ai.request.model) or isNotNull(gen_ai.operation.name) | summarize count()",
        applicabilityQuery: AI_SPANS_QUERY,
        thresholds: [{ min: 80 }, { min: 50 }, { min: 1 }],
      },
      {
        id: "ai6", label: "AI error tracking coverage (%)",
        description: "Percentage of AI spans with error status tracking.",
        query: 'fetch spans, from:now()-72h | filter isNotNull(gen_ai.system) or isNotNull(gen_ai.provider.name) or isNotNull(gen_ai.request.model) or isNotNull(gen_ai.operation.name) | filter status_code == "ERROR" | summarize count()',
        queryB: "fetch spans, from:now()-72h | filter isNotNull(gen_ai.system) or isNotNull(gen_ai.provider.name) or isNotNull(gen_ai.request.model) or isNotNull(gen_ai.operation.name) | summarize count()",
        applicabilityQuery: AI_SPANS_QUERY,
        thresholds: [{ min: 1 }],
      },
      {
        id: "ai7", label: "Guardrail coverage (%)",
        description: "Percentage of AI spans with guardrail monitoring.",
        query: "fetch spans, from:now()-72h | filter isNotNull(gen_ai.system) or isNotNull(gen_ai.provider.name) or isNotNull(gen_ai.request.model) or isNotNull(gen_ai.operation.name) | filter isNotNull(gen_ai.guardrail) | summarize count()",
        queryB: "fetch spans, from:now()-72h | filter isNotNull(gen_ai.system) or isNotNull(gen_ai.provider.name) or isNotNull(gen_ai.request.model) or isNotNull(gen_ai.operation.name) | summarize count()",
        applicabilityQuery: AI_SPANS_QUERY,
        thresholds: [{ min: 50 }, { min: 20 }, { min: 1 }],
      },
      {
        id: "ai8", label: "Cost tracking coverage (%)",
        description: "Percentage of AI spans with cost tracking.",
        query: "fetch spans, from:now()-72h | filter isNotNull(gen_ai.system) or isNotNull(gen_ai.provider.name) or isNotNull(gen_ai.request.model) or isNotNull(gen_ai.operation.name) | filter isNotNull(gen_ai.usage.cost) | summarize count()",
        queryB: "fetch spans, from:now()-72h | filter isNotNull(gen_ai.system) or isNotNull(gen_ai.provider.name) or isNotNull(gen_ai.request.model) or isNotNull(gen_ai.operation.name) | summarize count()",
        applicabilityQuery: AI_SPANS_QUERY,
        thresholds: [{ min: 50 }, { min: 20 }, { min: 1 }],
      },
      {
        id: "ai9", label: "AI tracing service breadth (%)",
        description: "Percentage of total spans that are AI-related.",
        query: "fetch spans, from:now()-72h | filter isNotNull(gen_ai.system) or isNotNull(gen_ai.provider.name) or isNotNull(gen_ai.request.model) or isNotNull(gen_ai.operation.name) | summarize count()",
        queryB: "fetch spans, from:now()-72h | summarize count()",
        applicabilityQuery: AI_SPANS_QUERY,
        thresholds: [{ min: 5 }, { min: 1 }],
      },
      {
        id: "ai10", label: "AI latency tracking coverage (%)",
        description: "Percentage of AI traces with latency (TTFT or duration) data for performance SLO tracking.",
        query: `fetch spans, from:now()-72h
| filter isNotNull(gen_ai.system) or isNotNull(gen_ai.provider.name)
| filter isNotNull(gen_ai.server.time_to_first_token) or isNotNull(gen_ai.server.ttft) or duration > 0
| summarize count = countDistinct(trace_id)`,
        queryB: `fetch spans, from:now()-72h
| filter isNotNull(gen_ai.system) or isNotNull(gen_ai.provider.name)
| summarize count = countDistinct(trace_id)`,
        applicabilityQuery: AI_SPANS_QUERY,
        thresholds: [{ min: 50 }, { min: 20 }, { min: 1 }],
      },
      {
        id: "ai11", label: "AI model diversity (%)",
        description: "Percentage of expected AI models detected (out of 5 baseline models) — indicates coverage across providers and use cases.",
        query: `fetch spans, from:now()-72h
| filter isNotNull(gen_ai.system) or isNotNull(gen_ai.provider.name)
| summarize count = countDistinct(gen_ai.request.model)`,
        denominatorConstant: 5,
        applicabilityQuery: AI_SPANS_QUERY,
        thresholds: [{ min: 80 }, { min: 40 }, { min: 1 }],
      },
      {
        id: "ai12", label: "AI operation type coverage (%)",
        description: "Percentage of expected AI operation types detected (out of 5 baseline types: chat, embeddings, completions, etc.).",
        query: `fetch spans, from:now()-72h
| filter isNotNull(gen_ai.system) or isNotNull(gen_ai.provider.name)
| summarize count = countDistinct(gen_ai.operation.name)`,
        denominatorConstant: 5,
        applicabilityQuery: AI_SPANS_QUERY,
        thresholds: [{ min: 80 }, { min: 40 }, { min: 1 }],
      },
    ],
  },

  // ─── 8. BUSINESS OBSERVABILITY ───
  {
    name: "Business Observability",
    color: "#10B981",
    criteria: [
      {
        id: "b1", label: "Service bizevent coverage (%)",
        description: "Percentage of services with associated business events.",
        query: "fetch bizevents | filter timestamp > now() - 2h | filter isNotNull(dt.entity.service) | summarize count = countDistinct(dt.entity.service) | fields count",
        queryB: "fetch dt.entity.service | summarize count()",
        applicabilityQuery: BIZEVENTS_QUERY,
        thresholds: [{ min: 30 }, { min: 10 }, { min: 1 }],
      },
      {
        id: "b2", label: "Bizevent type diversity (%)",
        description: "Percentage of expected business event types detected (out of 10 baseline types).",
        query: "fetch bizevents | filter timestamp > now() - 2h | summarize countDistinct(event.type)",
        denominatorConstant: 10,
        applicabilityQuery: BIZEVENTS_QUERY,
        thresholds: [{ min: 60 }, { min: 30 }],
      },
      {
        id: "b3", label: "Events with service context (%)",
        description: "Percentage of business events linked to services.",
        query: "fetch bizevents | filter timestamp > now() - 2h | filter isNotNull(dt.entity.service) | summarize count()",
        queryB: "fetch bizevents | filter timestamp > now() - 2h | summarize count()",
        applicabilityQuery: BIZEVENTS_QUERY,
        thresholds: [{ min: 50 }, { min: 20 }, { min: 1 }],
      },
      {
        id: "b4", label: "Bizevent provider diversity (%)",
        description: "Percentage of expected business event providers detected (out of 5 baseline providers).",
        query: "fetch bizevents | filter timestamp > now() - 2h | summarize countDistinct(event.provider)",
        denominatorConstant: 5,
        applicabilityQuery: BIZEVENTS_QUERY,
        thresholds: [{ min: 60 }, { min: 20 }],
      },
      {
        id: "b5", label: "Revenue data coverage (%)",
        description: "Percentage of business events with revenue/monetary value.",
        query: "fetch bizevents | filter timestamp > now() - 2h | filter isNotNull(revenue) or isNotNull(amount) or isNotNull(value) | summarize count()",
        queryB: "fetch bizevents | filter timestamp > now() - 2h | summarize count()",
        applicabilityQuery: BIZEVENTS_QUERY,
        thresholds: [{ min: 30 }, { min: 10 }, { min: 1 }],
      },
      {
        id: "b6", label: "Session-linked events (%)",
        description: "Percentage of business events linked to RUM sessions.",
        query: "fetch bizevents | filter timestamp > now() - 2h | filter isNotNull(dt.rum.session_id) | summarize count()",
        queryB: "fetch bizevents | filter timestamp > now() - 2h | summarize count()",
        applicabilityQuery: BIZEVENTS_QUERY,
        thresholds: [{ min: 30 }, { min: 10 }, { min: 1 }],
      },
      {
        id: "b7", label: "Trace-linked events (%)",
        description: "Percentage of business events correlated with distributed traces.",
        query: "fetch bizevents | filter timestamp > now() - 2h | filter isNotNull(trace_id) | summarize count()",
        queryB: "fetch bizevents | filter timestamp > now() - 2h | summarize count()",
        applicabilityQuery: BIZEVENTS_QUERY,
        thresholds: [{ min: 30 }, { min: 10 }, { min: 1 }],
      },
      {
        id: "b8", label: "Cost center coverage (%)",
        description: "Percentage of business events with cost center or product data.",
        query: "fetch bizevents | filter timestamp > now() - 2h | filter isNotNull(dt.cost.costcenter) or isNotNull(dt.cost.product) | summarize count()",
        queryB: "fetch bizevents | filter timestamp > now() - 2h | summarize count()",
        applicabilityQuery: BIZEVENTS_QUERY,
        thresholds: [{ min: 20 }, { min: 5 }, { min: 1 }],
      },
    ],
  },

  // ─── 9. SOFTWARE DELIVERY ───
  {
    name: "Software Delivery",
    color: "#6366F1",
    criteria: [
      {
        id: "sd1", label: "Service deployment coverage (%)",
        description: "Percentage of services with deployment events in 24h.",
        query: 'fetch events | filter event.kind == "DAVIS_EVENT" or event.kind == "CUSTOM_DEPLOYMENT" | filter timestamp > now() - 24h | fieldsAdd affected = affected_entity_ids | expand affected | filter startsWith(affected, "SERVICE-") | summarize count = countDistinct(affected) | fields count',
        queryB: "fetch dt.entity.service | summarize count()",
        thresholds: [{ min: 30 }, { min: 10 }, { min: 1 }],
      },
      {
        id: "sd2", label: "Custom deployment coverage (%)",
        description: "Percentage of services with custom deployment markers from CI/CD.",
        query: 'fetch events | filter event.kind == "CUSTOM_DEPLOYMENT" | filter timestamp > now() - 24h | fieldsAdd affected = affected_entity_ids | expand affected | filter startsWith(affected, "SERVICE-") | summarize count = countDistinct(affected) | fields count',
        queryB: "fetch dt.entity.service | summarize count()",
        thresholds: [{ min: 20 }, { min: 5 }, { min: 1 }],
      },
      {
        id: "sd3", label: "Event kind diversity (%)",
        description: "Percentage of event kinds present (out of 5 main kinds).",
        query: "fetch events | filter timestamp > now() - 2h | summarize countDistinct(event.kind)",
        denominatorConstant: 5,
        thresholds: [{ min: 60 }, { min: 40 }],
      },
      {
        id: "sd4", label: "Event type diversity (%)",
        description: "Percentage of expected delivery event types detected (out of 10 baseline types).",
        query: "fetch events | filter timestamp > now() - 2h | summarize countDistinct(event.type)",
        denominatorConstant: 10,
        thresholds: [{ min: 60 }, { min: 30 }],
      },
      {
        id: "sd5", label: "Service request baseline (%)",
        description: "Percentage of services with active request throughput — foundation for quality gates and SLO definition.",
        query: "timeseries val=sum(dt.service.request.count), by:{dt.entity.service} | fields dt.entity.service | dedup dt.entity.service | summarize c=count()",
        queryB: "fetch dt.entity.service | summarize count()",
        thresholds: [{ min: 90 }, { min: 60 }, { min: 1 }],
      },
      {
        id: "sd6", label: "Service failure baseline (%)",
        description: "Percentage of services with failure rate tracking — essential for release validation and quality gate decisions.",
        query: "timeseries val=sum(dt.service.request.failure_count), by:{dt.entity.service} | fields dt.entity.service | dedup dt.entity.service | summarize c=count()",
        queryB: "fetch dt.entity.service | summarize count()",
        thresholds: [{ min: 80 }, { min: 50 }, { min: 1 }],
      },
      {
        id: "sd7", label: "Process group coverage (%)",
        description: "Percentage of services with associated process groups.",
        query: "fetch dt.entity.service | fieldsAdd pgi = runs_on[dt.entity.process_group_instance] | expand pgi | summarize count = countDistinct(id)",
        queryB: "fetch dt.entity.service | summarize count()",
        thresholds: [{ min: 70 }, { min: 40 }, { min: 1 }],
      },
      {
        id: "sd8", label: "Davis problem detection (%)",
        description: "Percentage of services covered by Davis AI problem detection — validates automated quality feedback loop.",
        query: 'fetch dt.davis.problems, from:now()-72h | filter not(dt.davis.is_duplicate) | fieldsAdd affected = affected_entity_ids | expand affected | filter startsWith(affected, "SERVICE-") | summarize count = countDistinct(affected)',
        queryB: "fetch dt.entity.service | summarize count()",
        thresholds: [{ min: 30 }, { min: 10 }, { min: 1 }],
      },
      {
        id: "sd9", label: "Process group tagging (%)",
        description: "Percentage of process groups with at least one tag — tags enable release tracking, version management, and ownership.",
        query: "fetch dt.entity.process_group | fieldsAdd t = tags | expand t | summarize count = countDistinct(id)",
        queryB: "fetch dt.entity.process_group | summarize count()",
        thresholds: [{ min: 50 }, { min: 20 }, { min: 1 }],
      },
      {
        id: "sd10", label: "Ownership assignment (%)",
        description: "Percentage of services with assigned ownership tags — validates team responsibility mapping for incident response.",
        query: "fetch dt.entity.service | fieldsAdd t = tags | expand t | filter contains(toString(t), \"owner\") or contains(toString(t), \"team\") | summarize count = countDistinct(id)",
        queryB: "fetch dt.entity.service | summarize count()",
        thresholds: [{ min: 50 }, { min: 20 }, { min: 1 }],
      },
      {
        id: "sd11", label: "SLO adoption coverage (%)",
        description: "Percentage of services covered by at least one service level objective — the single strongest indicator of reliability engineering maturity.",
        query: "fetch dt.entity.service_level_objective\n| summarize count()",
        queryB: "fetch dt.entity.service\n| summarize count()",
        thresholds: [{ min: 50 }, { min: 20 }, { min: 1 }],
      },
      {
        id: "sd12", label: "Active SLO coverage (%)",
        description: "Percentage of defined SLOs that are currently enabled and enforcing reliability targets.",
        query: "fetch dt.entity.service_level_objective\n| filter enabled == true\n| summarize count()",
        queryB: "fetch dt.entity.service_level_objective\n| summarize count()",
        thresholds: [{ min: 80 }, { min: 50 }, { min: 1 }],
      },
      {
        id: "sd13", label: "Automation workflow adoption (%)",
        description: "Percentage of expected automation workflows active (out of 5 baseline) — indicates the team has moved from passive monitoring to active automated remediation.",
        query: `fetch bizevents, from:now()-24h
| filter event.type == "com.dynatrace.automations.workflow.run"
| summarize count = countDistinct(workflow.id)`,
        denominatorConstant: 5,
        thresholds: [{ min: 100 }, { min: 40 }, { min: 1 }],
      },
    ],
  },


];
