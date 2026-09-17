import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { queryExecutionClient } from "@dynatrace-sdk/client-query";
import { getEnvironmentUrl } from "@dynatrace-sdk/app-environment";
import { CAPABILITIES, type CapabilityDef, type Threshold } from "../queries";
import { CRITERION_TIERS, type CriterionTier } from "../data/criterionTiers";
import { scaleQuery, TIER_CONFIG, type ScaleTier } from "../scale-tier";
import { classifySource, type InFlightPerfEntry, type PerfReport } from "../perf/types";
import { buildReport, downloadReport } from "../perf/buildReport";
import { QueryCache } from "../perf/queryCache";
import { getTenantId } from "../utils/tenantId";

export interface TierResult {
  total: number;
  passed: number;
}

export interface UtilizationResult {
  foundation: TierResult;
  bestPractice: TierResult;
  excellence: TierResult;
  level: 0 | 1 | 2 | 3;
  levelLabel: string;
  utilizationScore: number;  // 0-100 weighted score
  utilizationBand: string;  // "N/A" | "Low" | "Moderate" | "Good" | "Excellent"
}

export interface CapabilityResult {
  name: string;
  color: string;
  /** Effective score (adjusted by consolidation when active, otherwise same as rawScore). */
  score: number;
  /** Original score from DQL queries (before consolidation adjustment). */
  rawScore: number;
  details: string[];
  criteriaResults: { id: string; label: string; description: string; value: number; score: number; points: number; error: boolean; notApplicable: boolean; query: string; thresholds: string; tier: CriterionTier; isRatio: boolean; denominator?: number; proxied: boolean }[];
  utilization: UtilizationResult;
  /** Consolidation factor (0–100). 100 = all data in DT, 30 = only 30% of estate in DT. */
  consolidation: number;
  /** Effective utilization score (adjusted by consolidation when active). */
  effectiveUtilizationScore: number;
  /** Number of criteria that returned an error or timeout. Excluded from
   *  the capScore denominator (C6) so transient failures don't mask a
   *  healthy tenant. The UI can surface this as a warning. */
  errorCount: number;
}

export interface QueryStats {
  total: number;
  succeeded: number;
  failed: number;
  scannedBytes: number;
  scannedRecords: number;
  scannedDataPoints: number;
}

export type ViewMode = "coverage" | "utilization" | "recommendations";

export interface EntityCounts {
  hosts: number;
  services: number;
  serviceMethods: number;
  processGroups: number;
  processInstances: number;
  applications: number;
  mobileApps: number;
  k8sClusters: number;
  k8sNamespaces: number;
  k8sNodes: number;
  syntheticTests: number;
  syntheticLocations: number;
  httpChecks: number;
  networkInterfaces: number;
  disks: number;
  logs: number;
  spans: number;
  aiSpans: number;
  events: number;
  problems: number;
  bizEvents: number;
  cloudLogs: number;
  securityEvents: number;
}

export interface CoverageData {
  capabilities: CapabilityResult[];
  totalScore: number;
  overallUtilizationLevel: number;
  loading: boolean;
  idle: boolean;
  progress: number;
  error: string | null;
  tenant: string;
  date: string;
  stats: QueryStats | null;
  entityCounts: EntityCounts | null;
  liveScannedBytes: number;
  liveScannedRecords: number;
  consolidation: Record<string, number>;
  setConsolidation: (factors: Record<string, number>) => void;
  start: (caps?: CapabilityDef[], segmentId?: string) => void;
  refresh: () => void;
  reset: () => void;
  goHome: () => void;
  resume: () => void;
  /** Scale Tier the assessment ran under. Same as the input tier; surfaced
   *  in the result so consumers don't need to re-thread it through props. */
  tier: ScaleTier;
  /** True when results are sampled estimates (tier !== 'exact'). UI uses
   *  this to render the ScaleTierBanner and prefix scores with "≈". */
  sampled: boolean;
  /** Per-query perf rows captured during the most recent run, or null when
   *  no run has completed yet. Includes the raw scan/wall-time/error data
   *  used by the perf report download. The DemoControlBar reads this and
   *  builds the final PerfReport on demand via ../perf/buildReport.ts. */
  perfEntries: InFlightPerfEntry[] | null;
  /** Metadata about the most recent run — populated alongside perfEntries.
   *  Kept on CoverageData rather than in a separate hook so any consumer
   *  has a single source of truth. */
  lastRunMeta: {
    startedAt: string;
    finishedAt: string;
    wallTimeMs: number;
    concurrency: number;
    /** Map of query string → criterion IDs that consumed it. Pre-built
     *  during the run so the analyzer (or the report builder) doesn't have
     *  to re-walk the CAPABILITIES tree to compute coverage attribution. */
    queryConsumers: Map<string, string[]>;
    /** Number of unique queries served from the 24h persistent cache. */
    cacheHits: number;
    /** Number of unique queries that hit Grail. */
    cacheMisses: number;
    /** Bytes that would have been scanned but were served from cache. */
    cachedBytesSaved: number;
    /** Number of unique numerator queries skipped (C3 smart-skip). */
    skippedQueries: number;
    /** Criterion IDs skipped because their entity denominator was 0. */
    skippedCriteria: string[];
  } | null;
  /** Triggers an immediate download of the perf report JSON. No-op when
   *  perfEntries is null (i.e., no run has completed). */
  downloadPerfReport: () => string | null;
  /** Clears the 24h Document Store cache for this tenant. The caller is
   *  expected to follow up with start()/refresh() to actually re-run; this
   *  function only invalidates so the next run misses cache for every query. */
  forceRefresh: () => Promise<void>;
}

function thresholdTarget(thresholds: Threshold[]): { direction: "min" | "max"; value: number } {
  const mins = thresholds.map(t => t.min).filter((v): v is number => typeof v === "number");
  if (mins.length > 0) return { direction: "min", value: Math.max(...mins) };
  const maxes = thresholds.map(t => t.max).filter((v): v is number => typeof v === "number");
  if (maxes.length > 0) return { direction: "max", value: Math.min(...maxes) };
  return { direction: "min", value: 1 };
}

function scoreAgainstThreshold(value: number, thresholds: Threshold[]): { score: number; passed: boolean } {
  const target = thresholdTarget(thresholds);
  if (target.direction === "max") {
    const passed = value <= target.value;
    const score = passed ? 100 : target.value <= 0 ? 0 : Math.max(0, Math.round((target.value / value) * 100));
    return { score, passed };
  }
  const passed = value >= target.value;
  const score = target.value <= 0 ? (passed ? 100 : 0) : Math.min(100, Math.round((value / target.value) * 100));
  return { score, passed };
}

function formatThresholds(thresholds: Threshold[]): string {
  return thresholds
    .slice()
    .sort((a, b) => (b.min ?? Number.NEGATIVE_INFINITY) - (a.min ?? Number.NEGATIVE_INFINITY))
    .map(t => typeof t.min === "number" ? `≥${t.min}` : `≤${t.max}`)
    .join(", ");
}

function extractNumeric(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) return Number(v);
  // timeseries aggregations return arrays (one value per time bin) — take last element
  if (Array.isArray(v) && v.length > 0) {
    for (let i = v.length - 1; i >= 0; i--) {
      if (typeof v[i] === "number") return v[i];
      if (typeof v[i] === "bigint") return Number(v[i]);
    }
  }
  return null;
}

function extractValue(result: any): number {
  try {
    if (!result) return 0;
    const records = result.records || result;
    if (!Array.isArray(records) || records.length === 0) return 0;
    const record = records[0];
    if (record == null) return 0;
    const direct = extractNumeric(record);
    if (direct !== null) return direct;
    if (typeof record === "object") {
      for (const v of Object.values(record)) {
        const n = extractNumeric(v);
        if (n !== null) return n;
      }
    }
    warn("extractValue: no numeric found in record:", JSON.stringify(record));
    return 0;
  } catch {
    return 0;
  }
}

function formatCriterionValue(value: number, isRatio: boolean): string {
  if (!Number.isFinite(value)) return isRatio ? "0%" : "0";
  if (!isRatio) return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
}

interface DqlResult { value: number; scannedBytes: number; scannedRecords: number; scannedDataPoints: number; }

/** Debug logging — disabled in production to avoid noisy output.
 *  Enable via browser console: localStorage.setItem("CCA_DEBUG","1") then reload. */
const DEBUG = typeof window !== "undefined" && localStorage.getItem("CCA_DEBUG") === "1";
const log = (...args: unknown[]) => { if (DEBUG) console.log("[CCA]", ...args); };
const warn = (...args: unknown[]) => { if (DEBUG) console.warn("[CCA]", ...args); };

const MAX_POLL_ATTEMPTS = 10;
const POLL_INTERVAL_MS = 3000;
const QUERY_TIMEOUT_MS = 30000;
const DEFAULT_TIMEFRAME_HOURS = 2;

async function executeDql(query: string, segmentId?: string): Promise<DqlResult> {
  try {
    const response = await queryExecutionClient.queryExecute({
      body: {
        query,
        requestTimeoutMilliseconds: QUERY_TIMEOUT_MS,
        maxResultRecords: 1000,
        defaultTimeframeStart: new Date(Date.now() - DEFAULT_TIMEFRAME_HOURS * 60 * 60 * 1000).toISOString(),
        defaultTimeframeEnd: new Date().toISOString(),
        ...(segmentId ? { filterSegments: [{ id: segmentId }] } : {}),
      },
    });

    // Handle query state — the SDK may return RUNNING/FAILED without a result
    let state = response?.state;
    let res = response?.result;
    let requestToken = (response as any)?.requestToken as string | undefined;

    // If query is still running, poll for result
    if (state === "RUNNING" && requestToken) {
      log(`⏳ Query still running, polling...`, query.substring(0, 60));
      for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
        const poll = await queryExecutionClient.queryPoll({ requestToken });
        state = poll?.state;
        res = poll?.result;
        if (state === "SUCCEEDED" || state === "FAILED" || state === "CANCELLED") break;
      }
    }

    // Handle terminal failure states
    if (state === "FAILED" || state === "CANCELLED") {
      const grail = (res as any)?.metadata?.grail;
      const notifications = grail?.notifications ?? [];
      const errMsg = notifications.map((n: any) => n.message).join("; ") || `Query ${state}`;
      warn(`✗ ${query.substring(0, 80)} → ${errMsg}`);
      return { value: -1, scannedBytes: 0, scannedRecords: 0, scannedDataPoints: 0 };
    }

    const grail = (res as any)?.metadata?.grail;
    const scannedBytes = grail?.scannedBytes ?? 0;
    const scannedRecords = grail?.scannedRecords ?? 0;
    const scannedDataPoints = grail?.scannedDataPoints ?? 0;

    // Log any warnings/notifications from the DQL engine
    const notifications = grail?.notifications ?? [];
    for (const n of notifications) {
      if (n.severity === "ERROR" || n.severity === "WARN") {
        warn(`⚠ DQL ${n.severity}: ${n.message} — query:`, query.substring(0, 60));
      }
    }

    if (!res) {
      warn(`No result for (state=${state}):`, query.substring(0, 80));
      return { value: -1, scannedBytes, scannedRecords, scannedDataPoints };
    }
    let value = 0;
    if (res.records) value = extractValue(res);
    else if (Array.isArray(res)) value = extractValue({ records: res });
    else if (typeof res === "number") value = res;
    else value = extractValue(res);
    if (value === 0) {
      log(`⚠ query returned 0 (state=${state}). Raw record[0]:`, JSON.stringify(res.records?.[0] ?? null), `| records.length=${res.records?.length ?? "N/A"}`);
    }
    log(`✓ ${query.substring(0, 80)} → ${value}`);
    return { value, scannedBytes, scannedRecords, scannedDataPoints };
  } catch (err: any) {
    warn(`✗ ${query.substring(0, 80)} → ERROR:`, err?.message || err);
    return { value: -1, scannedBytes: 0, scannedRecords: 0, scannedDataPoints: 0 };
  }
}

const CONCURRENCY = 10;

/**
 * Returns true for DQL strings of the shape `fetch dt.entity.X | summarize count()`
 * — these are the cheap "how many of this entity exist?" denominators that
 * the C3 smart-skip pass executes first so it can skip numerators tied to
 * absent entity classes (e.g., no kubernetes_cluster → skip k8s log queries).
 *
 * We deliberately keep the regex narrow: any extra pipeline stages
 * (fieldsAdd, expand, filter…) defeat the match. Those queries do real work
 * and don't qualify for the fast-path skip.
 */
function isEntityCountQuery(q: string): boolean {
  return /^\s*fetch\s+dt\.entity\.[a-z_0-9]+\s*\|\s*summarize\s+count\(\)\s*$/.test(q);
}

// Utilization tier weights for weighted scoring
export const FOUNDATION_WEIGHT = 60;
export const BEST_PRACTICE_WEIGHT = 25;
export const EXCELLENCE_WEIGHT = 15;

export interface CapabilityUtilizationResult {
  fPct: number;
  bPct: number;
  ePct: number;
  effB: number;
  effE: number;
  utilizationScore: number;
  utilizationBand: string;
  foundation: TierResult;
  bestPractice: TierResult;
  excellence: TierResult;
  level: 0 | 1 | 2 | 3;
  levelLabel: string;
}

/**
 * Computes the weighted utilization score for a set of criteria results.
 * Extracted so ComparisonPage and other consumers can call it without
 * re-implementing the formula inline.
 *
 * Input type matches the shape of CapabilityResult["criteriaResults"] items.
 */
export function computeCapabilityUtilization(
  criteriaResults: { score: number; points: number; error: boolean; notApplicable: boolean; tier: CriterionTier }[],
): CapabilityUtilizationResult {
  const tierCounts = {
    foundation:   { total: 0, passed: 0 },
    bestPractice: { total: 0, passed: 0 },
    excellence:   { total: 0, passed: 0 },
  };
  const tierScores = {
    foundation:   { total: 0, score: 0 },
    bestPractice: { total: 0, score: 0 },
    excellence:   { total: 0, score: 0 },
  };
  for (const cr of criteriaResults) {
    if (cr.notApplicable) continue;
    const t = cr.tier;
    tierCounts[t].total++;
    tierScores[t].total++;
    tierScores[t].score += cr.score;
    if (!cr.error && cr.points > 0) tierCounts[t].passed++;
  }
  const fPct = tierScores.foundation.total   > 0 ? tierScores.foundation.score   / tierScores.foundation.total   / 100 : 0;
  const bPct = tierScores.bestPractice.total > 0 ? tierScores.bestPractice.score / tierScores.bestPractice.total / 100 : 0;
  const ePct = tierScores.excellence.total   > 0 ? tierScores.excellence.score   / tierScores.excellence.total   / 100 : 0;
  const fPassPct = tierCounts.foundation.total   > 0 ? tierCounts.foundation.passed   / tierCounts.foundation.total   : 0;
  const bPassPct = tierCounts.bestPractice.total > 0 ? tierCounts.bestPractice.passed / tierCounts.bestPractice.total : 0;
  const ePassPct = tierCounts.excellence.total   > 0 ? tierCounts.excellence.passed   / tierCounts.excellence.total   : 0;
  let level: 0 | 1 | 2 | 3 = 0;
  let levelLabel = "Not Adopted";
  if (fPassPct >= 0.5)                              { level = 1; levelLabel = "Foundation"; }
  if (fPassPct >= 1.0 && bPassPct >= 0.5)           { level = 2; levelLabel = "Operational"; }
  if (fPassPct >= 1.0 && bPassPct >= 1.0 && ePassPct >= 0.5) { level = 3; levelLabel = "Optimized"; }
  // Progressive: BP only counts when Foundation >= 80%, Excellence only when BP >= 60%
  const effB = fPct >= 0.8 ? bPct : 0;
  const effE = effB >= 0.6 ? ePct : 0;
  const utilizationScore = Math.round(fPct * FOUNDATION_WEIGHT + effB * BEST_PRACTICE_WEIGHT + effE * EXCELLENCE_WEIGHT);
  const utilizationBand = utilizationScore >= 80 ? "Excellent" : utilizationScore >= 60 ? "Good" : utilizationScore >= 40 ? "Moderate" : utilizationScore >= 20 ? "Low" : "N/A";
  return {
    fPct, bPct, ePct, effB, effE,
    utilizationScore, utilizationBand,
    foundation: tierCounts.foundation,
    bestPractice: tierCounts.bestPractice,
    excellence: tierCounts.excellence,
    level, levelLabel,
  };
}

interface ExecutionResult {
  cache: Map<string, number>;
  totalScannedBytes: number;
  totalScannedRecords: number;
  totalScannedDataPoints: number;
  /** Per-query timing/scan rows captured during execution. The recorder
   *  array is appended to from inside the worker pool — order reflects
   *  completion order, not submission order. */
  perfEntries: InFlightPerfEntry[];
  /** Number of unique queries served from the persistent cache. */
  cacheHits: number;
  /** Number of unique queries that hit Grail. */
  cacheMisses: number;
  /** Total bytes that would have been scanned but were served from cache. */
  cachedBytesSaved: number;
}

async function executeAllUnique(
  queries: string[],
  tier: ScaleTier,
  queryConsumers: Map<string, string[]>,
  persistentCache: QueryCache | null,
  onProgress: (scannedBytes: number, scannedRecords: number) => void,
  segmentId?: string,
): Promise<ExecutionResult> {
  // The cache is keyed by the ORIGINAL query string — the same string that
  // each criterion's `query`/`queryB` field holds. This is intentional: every
  // downstream consumer in this file (scoring, entityCounts extraction,
  // criteria results, snapshot persistence) looks up results by the original
  // string. Scaled execution is therefore transparent to all of them.
  const cache = new Map<string, number>();
  const unique = [...new Set(queries)];
  let idx = 0;
  let totalScannedBytes = 0;
  let totalScannedRecords = 0;
  let totalScannedDataPoints = 0;
  let cacheHits = 0;
  let cacheMisses = 0;
  let cachedBytesSaved = 0;
  const perfEntries: InFlightPerfEntry[] = [];

  async function next(): Promise<void> {
    while (idx < unique.length) {
      const originalQ = unique[idx++];
      // Try the 24h persistent cache first. A hit serves the value at zero
      // Grail cost; a miss falls through to the live executeDql path below.
      // We still emit a PerfQueryEntry for cache hits so the JSON shows the
      // full set of queries the assessment depended on (just with
      // scannedBytes=0 and a tiny wallTime).
      const cached = persistentCache?.get(originalQ, tier);
      if (cached) {
        cache.set(originalQ, cached.v);
        cacheHits++;
        cachedBytesSaved += cached.bytes;
        const ageSec = Math.max(0, Math.floor((Date.now() - cached.ts) / 1000));
        perfEntries.push({
          originalQuery: originalQ,
          executedQuery: scaleQuery(originalQ, tier),
          source: classifySource(originalQ),
          tier,
          // Cache lookup is in-memory; 1ms is a generous upper bound that
          // keeps the entry distinguishable from a live query in the JSON.
          wallTimeMs: 1,
          scannedBytes: 0,
          scannedRecords: 0,
          scannedDataPoints: 0,
          resultValue: cached.v,
          ok: true,
          errorMessage: null,
          usedByCriteria: queryConsumers.get(originalQ) ?? [],
          cached: true,
          cacheAgeSec: ageSec,
        });
        // Progress updates use the cumulative real-scan totals only; cached
        // entries contribute 0 so the live banner shows actual Grail usage.
        onProgress(totalScannedBytes, totalScannedRecords);
        continue;
      }

      // scaleQuery is a no-op in 'exact' mode AND for any query that doesn't
      // target a hot streaming source (entity / metrics / problems pass through).
      // See ../scale-tier.ts for the transformation rules.
      const executedQ = scaleQuery(originalQ, tier);
      const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      let result: DqlResult | null = null;
      let ok = true;
      let errorMessage: string | null = null;
      try {
        result = await executeDql(executedQ, segmentId);
      } catch (err) {
        ok = false;
        errorMessage = err instanceof Error ? err.message : String(err);
        result = { value: -1, scannedBytes: 0, scannedRecords: 0, scannedDataPoints: 0 };
      }
      const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());

      // executeDql treats "value === -1" as an internal error sentinel
      // (matches the cache.get fallback later in the scoring path). When
      // that happens, surface it in the perf log so the analyzer can see
      // which queries silently failed.
      if (result.value === -1 && ok) {
        ok = false;
        errorMessage = errorMessage ?? 'executeDql returned -1 sentinel';
      }

      cache.set(originalQ, result.value);
      cacheMisses++;
      totalScannedBytes += result.scannedBytes;
      totalScannedRecords += result.scannedRecords;
      totalScannedDataPoints += result.scannedDataPoints;
      // Persist successful, non-error results to the 24h cache. Skip errors
      // (we don't want to cache a transient failure for a day) and skip the
      // -1 sentinel (same reason).
      if (ok && result.value !== -1 && persistentCache) {
        persistentCache.set(
          originalQ,
          tier,
          result.value,
          result.scannedBytes,
          result.scannedRecords,
        );
      }
      perfEntries.push({
        originalQuery: originalQ,
        executedQuery: executedQ,
        source: classifySource(originalQ),
        tier,
        wallTimeMs: Math.round(t1 - t0),
        scannedBytes: result.scannedBytes,
        scannedRecords: result.scannedRecords,
        scannedDataPoints: result.scannedDataPoints,
        resultValue: result.value,
        ok,
        errorMessage,
        usedByCriteria: queryConsumers.get(originalQ) ?? [],
        cached: false,
        cacheAgeSec: 0,
      });
      onProgress(totalScannedBytes, totalScannedRecords);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, unique.length) }, () => next()));
  return { cache, totalScannedBytes, totalScannedRecords, totalScannedDataPoints, perfEntries, cacheHits, cacheMisses, cachedBytesSaved };
}

/** Optional extra metadata fed in from useScaleTier so the perf report
 *  download can record exactly which tier was auto-detected vs forced. */
export interface PerfScaleMeta {
  autoTier: ScaleTier | null;
  manualOverride: ScaleTier | null;
  hostCount: number | null;
}

/**
 * The Scale Tier under which the assessment will execute. When omitted,
 * defaults to 'exact' — the safest behavior that matches the app's pre-v2.5
 * semantics. Pass a non-default tier (typically derived from useScaleTier)
 * to enable narrowed time windows + scanLimitGBytes safety nets for log /
 * span / event / bizevent queries. See ../scale-tier.ts for the contract.
 *
 * @param scaleMeta  Optional pass-through of useScaleTier metadata that
 *                   isn't expressible via `tier` alone (autoTier,
 *                   manualOverride, observed hostCount). Surfaces in
 *                   the perf report download so the analyzer can tell
 *                   "user accepted auto xlarge" apart from "user forced
 *                   xlarge on a small tenant".
 */
export function useCoverageData(
  tier: ScaleTier = 'exact',
  scaleMeta?: PerfScaleMeta,
): CoverageData {
  const [capabilities, setCapabilities] = useState<CapabilityResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [idle, setIdle] = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<QueryStats | null>(null);
  const [entityCounts, setEntityCounts] = useState<EntityCounts | null>(null);
  const [liveScannedBytes, setLiveScannedBytes] = useState(0);
  const [liveScannedRecords, setLiveScannedRecords] = useState(0);
  const [consolidation, setConsolidation] = useState<Record<string, number>>({});
  const [runId, setRunId] = useState(0);
  const [perfEntries, setPerfEntries] = useState<InFlightPerfEntry[] | null>(null);
  const [lastRunMeta, setLastRunMeta] = useState<CoverageData['lastRunMeta']>(null);
  // Latest in-memory capabilities, used by downloadPerfReport. We keep this
  // in a ref so the download callback's identity stays stable across renders
  // while still reading the freshest data.
  const capsCacheRef = useRef<CapabilityResult[]>([]);
  const cancelRef = useRef(0);
  const capsRef = useRef<CapabilityDef[]>(CAPABILITIES);
  const segmentIdRef = useRef<string | undefined>(undefined);

  const runAssessment = useCallback(async () => {
    const runToken = ++cancelRef.current;
    setIdle(false);
    setLoading(true);
    setProgress(0);
    setLiveScannedBytes(0);
    setLiveScannedRecords(0);
    setError(null);

    // Captured at the start of the run so it shows up in the perf report
    // even if the run is cancelled mid-flight.
    const runStartedAt = new Date().toISOString();
    const tRunStart = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    // Build the queryConsumers map exactly once per run. It's a static
    // derivation from capsRef.current (the current capability filter).
    const queryConsumers = new Map<string, string[]>();
    for (const cap of capsRef.current) {
      for (const cr of cap.criteria) {
        for (const q of cr.queryB ? [cr.query, cr.queryB] : [cr.query]) {
          const arr = queryConsumers.get(q) ?? [];
          arr.push(cr.id);
          queryConsumers.set(q, arr);
        }
      }
    }


    try {
      // Collect all queries for deduplication (include queryB for cross-entity criteria)
      const caps = capsRef.current;
      const allQueries = caps.flatMap((c) => c.criteria.flatMap((cr) => {
        const queries = cr.queryB ? [cr.query, cr.queryB] : [cr.query];
        if (cr.applicabilityQuery) queries.push(cr.applicabilityQuery);
        return queries;
      }));
      const uniqueCount = new Set(allQueries).size;
      let completed = 0;

      // Load the 24h persistent result cache for this tenant. The load
      // itself is one cheap Doc Store read and serves up to 100% of the
      // queries on a same-day re-run. Falls back to no-cache on any error.
      const tenantId = (() => {
        try {
          const envUrl = getEnvironmentUrl();
          if (envUrl) {
            const id = getTenantId(envUrl);
            if (id) return id;
          }
        } catch { /* ignore */ }
        return 'unknown-tenant';
      })();
      // Segment-scoped runs must never read from or write to the all-tenant
      // persistent cache — the cached values would be unfiltered. We simply
      // pass null here; executeAllUnique treats null as "no cache".
      const segmentId = segmentIdRef.current;
      const persistentCache = segmentId ? null : new QueryCache(tenantId);
      if (persistentCache) await persistentCache.load();

      // ── C3: smart-skip preflight ─────────────────────────────────────────
      // Some criteria depend on entity classes that may not exist in this
      // tenant (e.g., kubernetes_cluster=0 on a non-K8s tenant). When the
      // entity-count denominator returns 0 the ratio numerator/0 produces
      // value=0 anyway, so executing the (often heavy) numerator is pure
      // waste. We do a tiny first pass over JUST the entity-count
      // denominators, decide which criteria to skip, and then run the
      // remaining queries through executeAllUnique without the skippable
      // numerators in the input.
      //
      // The entity-count queries are cheap (no Grail data scan — they read
      // metadata), so the first pass adds negligible wall-time. On tenants
      // where every entity class is populated this is a no-op savings-wise;
      // on tenants without K8s/RUM/mobile/etc it can skip 5–20 expensive
      // numerator queries.
      const entityCountDenoms = Array.from(
        new Set(
          caps.flatMap((c) => c.criteria)
            .map((cr) => cr.queryB)
            .filter((q): q is string => typeof q === 'string' && isEntityCountQuery(q)),
        ),
      );

      const phase1Result = entityCountDenoms.length > 0
        ? await executeAllUnique(entityCountDenoms, tier, queryConsumers, persistentCache, () => {
            // Phase 1 progress is invisible to the user — it completes in a
            // fraction of a second, well before any meaningful UI feedback
            // would matter. Suppressing the callback here keeps the live
            // scan counter monotonically aligned with Grail data scans.
          }, segmentId)
        : null;
      if (cancelRef.current !== runToken) return; // cancelled

      // Compute the criteria skip set from phase 1's results. A criterion
      // is skipped iff its queryB is an entity count AND that count is 0
      // (or -1, the executeDql error sentinel — treating errors as "skip"
      // matches the existing scoring path which would have set value=0).
      const skippedCriteria = new Set<string>();
      const skippedNumeratorQueries = new Set<string>();
      const skipReasonByCriterion = new Map<string, string>();
      if (phase1Result) {
        for (const cap of caps) {
          for (const cr of cap.criteria) {
            if (!cr.queryB || !isEntityCountQuery(cr.queryB)) continue;
            const v = phase1Result.cache.get(cr.queryB);
            if (v === 0 || v === -1 || v == null) {
              skippedCriteria.add(cr.id);
              skippedNumeratorQueries.add(cr.query);
              skipReasonByCriterion.set(cr.id, cr.queryB);
            }
          }
        }
      }

      // Phase 2 input: everything from allQueries MINUS phase 1's denominators
      // (already cached) and MINUS the numerators of skipped criteria. The
      // persistent cache still re-feeds phase 1 results so the dedup math
      // stays consistent.
      const phase1QueriesSet = new Set(entityCountDenoms);
      const phase2Queries = caps.flatMap((c) =>
        c.criteria.flatMap((cr) => {
          if (skippedCriteria.has(cr.id)) {
            // Skip the numerator entirely. Include the denominator only if
            // it ISN'T already covered by phase 1 (it always is for entity
            // counts, but defensive code keeps this correct if the logic
            // above ever changes).
            return cr.queryB && !phase1QueriesSet.has(cr.queryB) ? [cr.queryB] : [];
          }
          const out: string[] = [cr.query];
          if (cr.queryB && !phase1QueriesSet.has(cr.queryB)) out.push(cr.queryB);
          return out;
        }),
      );
      const phase2Unique = new Set(phase2Queries).size;
      // Reset completed so progress reflects phase 2 only (the user-visible
      // path). Phase 1 finished in ~milliseconds anyway.
      completed = 0;
      const totalUniqueForProgress = Math.max(1, phase2Unique);

      const phase2Result = await executeAllUnique(
        phase2Queries,
        tier,
        queryConsumers,
        persistentCache,
        (scannedSoFar, recordsSoFar) => {
          completed++;
          if (cancelRef.current === runToken) {
            setProgress(Math.round((completed / totalUniqueForProgress) * 100));
            setLiveScannedBytes(scannedSoFar);
            setLiveScannedRecords(recordsSoFar);
          }
        },
        segmentId,
      );

      if (cancelRef.current !== runToken) return; // cancelled

      // Merge phase 1 + phase 2 into a single cache and a single perf-entry
      // log. The downstream scoring code reads from `cache` exactly as
      // before — it doesn't need to know about the two-phase machinery.
      const cache = new Map<string, number>([
        ...(phase1Result?.cache ?? []),
        ...phase2Result.cache,
      ]);
      const totalScannedBytes = (phase1Result?.totalScannedBytes ?? 0) + phase2Result.totalScannedBytes;
      const totalScannedRecords = (phase1Result?.totalScannedRecords ?? 0) + phase2Result.totalScannedRecords;
      const totalScannedDataPoints = (phase1Result?.totalScannedDataPoints ?? 0) + phase2Result.totalScannedDataPoints;
      const cacheHits = (phase1Result?.cacheHits ?? 0) + phase2Result.cacheHits;
      const cacheMisses = (phase1Result?.cacheMisses ?? 0) + phase2Result.cacheMisses;
      const cachedBytesSaved = (phase1Result?.cachedBytesSaved ?? 0) + phase2Result.cachedBytesSaved;

      // Synthesise PerfQueryEntry rows for the skipped numerators so the
      // exported JSON shows what was skipped and why — otherwise the
      // analyzer would see a query count drop without explanation.
      const skipPerfEntries: InFlightPerfEntry[] = [];
      for (const cap of caps) {
        for (const cr of cap.criteria) {
          if (!skippedCriteria.has(cr.id)) continue;
          skipPerfEntries.push({
            originalQuery: cr.query,
            executedQuery: cr.query,
            source: classifySource(cr.query),
            tier,
            wallTimeMs: 0,
            scannedBytes: 0,
            scannedRecords: 0,
            scannedDataPoints: 0,
            resultValue: 0,
            ok: true,
            errorMessage: null,
            usedByCriteria: queryConsumers.get(cr.query) ?? [cr.id],
            cached: false,
            cacheAgeSec: 0,
            skipped: true,
            skipReason: skipReasonByCriterion.get(cr.id) ?? '',
          });
        }
      }
      const livePerfEntries: InFlightPerfEntry[] = [
        ...(phase1Result?.perfEntries ?? []),
        ...phase2Result.perfEntries,
        ...skipPerfEntries,
      ];

      const results: CapabilityResult[] = caps.map((cap) => {
        const criteriaResults: CapabilityResult["criteriaResults"] = [];
        const details: string[] = [];

        for (const criterion of cap.criteria) {
          const isSkipped = skippedCriteria.has(criterion.id);
          const valueA = cache.get(criterion.query) ?? -1;
          const valueB = criterion.queryB ? cache.get(criterion.queryB) ?? -1 : undefined;
          const applicabilityValue = criterion.applicabilityQuery ? cache.get(criterion.applicabilityQuery) ?? -1 : 1;
          const applicabilityError = criterion.applicabilityQuery ? applicabilityValue === -1 : false;
          const denominatorError = criterion.queryB ? valueB === -1 : false;
          // isSkipped means the denominator was 0 and the numerator was intentionally not executed —
          // treat as notApplicable rather than error (cache miss on a skipped query is not a failure)
          const isError = !isSkipped && (valueA === -1 || denominatorError);
          let value: number;
          let notApplicable = false;
          if (isError) {
            value = 0;
          } else if (isSkipped) {
            value = 0;
            notApplicable = true;
          } else if (criterion.queryB) {
            // Cross-entity ratio: (queryA / queryB) * 100
            if (!valueB || valueB <= 0) {
              value = 0;
              notApplicable = valueB === 0;
            } else {
              value = Math.min(Math.round((valueA / valueB) * 1000) / 10, 100); // one decimal %, capped at 100
            }
            log(`↔ ${criterion.id}: A=${valueA}, B=${valueB}, ratio=${value}%`);
          } else if (criterion.denominatorConstant != null) {
            // Code-level constant denominator — saves the ~15 GB scan that
            // a "fetch logs | ... | fields always5 = 5"-style queryB would
            // have wasted. Math is identical: value = valueA / N * 100.
            const denom = criterion.denominatorConstant;
            if (denom <= 0) {
              value = 0;
            } else {
              value = Math.min(Math.round((valueA / denom) * 1000) / 10, 100);
            }
            log(`↔ ${criterion.id}: A=${valueA}, B(const)=${denom}, ratio=${value}%`);
          } else {
            value = valueA;
          }
          if (!isError && !applicabilityError && applicabilityValue <= 0) notApplicable = true;
          const thresholdScore = scoreAgainstThreshold(value, criterion.thresholds);
          const passed = isError || notApplicable ? false : thresholdScore.passed;
          const thDesc = formatThresholds(criterion.thresholds);
          const tier = CRITERION_TIERS[criterion.id] || "foundation";
          criteriaResults.push({
            id: criterion.id,
            label: criterion.label,
            description: criterion.description,
            value: isError ? 0 : value,
            score: isError || notApplicable ? 0 : thresholdScore.score,
            points: passed ? 1 : 0,
            error: isError || applicabilityError,
            notApplicable,
            query: criterion.queryB
              ? `${criterion.query}\n÷ ${criterion.queryB}`
              : criterion.denominatorConstant != null
                ? `${criterion.query}\n÷ ${criterion.denominatorConstant} (constant)`
                : criterion.query,
            thresholds: thDesc,
            tier,
            isRatio: !!criterion.queryB || criterion.denominatorConstant != null,
            denominator: criterion.queryB ? valueB : undefined,
            proxied: !!criterion.proxied,
          });
          if (!isError && value > 0) details.push(`${criterion.label}: ${formatCriterionValue(value, !!criterion.queryB)}`);
        }

        // Compute utilization per tier via shared formula (C5)
        const util = computeCapabilityUtilization(criteriaResults);
        const { utilizationScore, utilizationBand } = util;

        const utilization: UtilizationResult = {
          foundation: util.foundation,
          bestPractice: util.bestPractice,
          excellence: util.excellence,
          level: util.level,
          levelLabel: util.levelLabel,
          utilizationScore,
          utilizationBand,
        };

        // C6: exclude both notApplicable AND errored criteria from the
        // denominator — a timed-out query should not drag down a healthy score.
        const scorableCriteria = criteriaResults.filter(cr => !cr.notApplicable && !cr.error);
        const errorCount = criteriaResults.filter(cr => cr.error).length;
        const capScore = scorableCriteria.length > 0
          ? Math.round(scorableCriteria.reduce((sum, cr) => sum + cr.score, 0) / scorableCriteria.length)
          : 0;

        return { name: cap.name, color: cap.color, score: capScore, rawScore: capScore, details, criteriaResults, utilization, consolidation: 100, effectiveUtilizationScore: utilizationScore, errorCount };
      });

      // Log summary
      const totalCriteria = results.reduce((s, c) => s + c.criteriaResults.length, 0);
      const errorCriteria = results.reduce((s, c) => s + c.criteriaResults.filter(cr => cr.error).length, 0);
      setStats({ total: totalCriteria, succeeded: totalCriteria - errorCriteria, failed: errorCriteria, scannedBytes: totalScannedBytes, scannedRecords: totalScannedRecords, scannedDataPoints: totalScannedDataPoints });

      // Persist any new cache entries we just collected. This is fire-and-
      // forget: the run is already done, the user sees results, and we
      // don't want to delay the UI on a Doc Store write. Errors are logged
      // inside flush() and don't surface to the user.
      if (persistentCache) void persistentCache.flush();

      // Stash perf entries + run metadata for the downloader.
      setPerfEntries(livePerfEntries);
      const tRunEndLive = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      setLastRunMeta({
        startedAt: runStartedAt,
        finishedAt: new Date().toISOString(),
        wallTimeMs: Math.round(tRunEndLive - tRunStart),
        concurrency: CONCURRENCY,
        queryConsumers,
        cacheHits,
        cacheMisses,
        cachedBytesSaved,
        skippedQueries: skippedNumeratorQueries.size,
        skippedCriteria: Array.from(skippedCriteria),
      });

      // Extract entity counts from cache (denominator queries)
      const ec = (q: string) => { const v = cache.get(q); return v != null && v > 0 ? v : 0; };
      setEntityCounts({
        hosts: ec('fetch dt.entity.host | summarize count()'),
        services: ec('fetch dt.entity.service | summarize count()'),
        serviceMethods: ec('fetch dt.entity.service_method | summarize count()'),
        processGroups: ec('fetch dt.entity.process_group | summarize count()'),
        processInstances: ec('fetch dt.entity.process_group_instance | summarize count()'),
        applications: ec('fetch dt.entity.application | summarize count()'),
        mobileApps: ec('fetch dt.entity.mobile_application | summarize count()'),
        k8sClusters: ec('fetch dt.entity.kubernetes_cluster | summarize count()'),
        k8sNamespaces: ec('fetch dt.entity.cloud_application_namespace | summarize count()'),
        k8sNodes: ec("timeseries val=avg(dt.kubernetes.container.cpu_usage), by:{k8s.node.name} | fields k8s.node.name | dedup k8s.node.name | summarize c=count()"),
        syntheticTests: ec('fetch dt.entity.synthetic_test | summarize count()'),
        syntheticLocations: ec('fetch dt.entity.synthetic_location | summarize count()'),
        httpChecks: ec('fetch dt.entity.http_check | summarize count()'),
        networkInterfaces: (() => { const nq = 'fetch dt.entity.network_interface | fieldsAdd belongs_to = belongs_to[dt.entity.host] | expand belongs_to | summarize count = countDistinct(belongs_to)'; const v = cache.get(nq); return v != null && v > 0 ? v : 0; })(),
        disks: (() => { const dq = 'fetch dt.entity.disk | fieldsAdd belongs_to = belongs_to[dt.entity.host] | expand belongs_to | summarize count = countDistinct(belongs_to)'; const v = cache.get(dq); return v != null && v > 0 ? v : 0; })(),
        logs: ec('fetch logs | filter timestamp > now() - 2h | summarize count()'),
        spans: ec('fetch spans, from:now()-2h | summarize count()'),
        aiSpans: ec('fetch spans, from:now()-2h | filter isNotNull(gen_ai.system) or isNotNull(gen_ai.provider.name) or isNotNull(gen_ai.request.model) or isNotNull(gen_ai.operation.name) | summarize count()'),
        events: ec('fetch events | filter timestamp > now() - 2h | summarize count()'),
        problems: ec('fetch dt.davis.problems, from:now()-72h | filter not(dt.davis.is_duplicate) | summarize count()'),
        bizEvents: ec('fetch bizevents | filter timestamp > now() - 2h | summarize count()'),
        cloudLogs: ec('fetch logs | filter timestamp > now() - 2h | filter isNotNull(cloud.provider) | summarize count()'),
        securityEvents: ec('fetch events, from:now()-30d | filter event.kind == "SECURITY_EVENT" | fieldsAdd affected = affected_entity_ids | expand affected | filter startsWith(affected, "SERVICE-") | summarize count = countDistinct(affected) | fields count'),
      });
      if (DEBUG) {
        console.group(`[CCA] Assessment Complete`);
        console.log(`Queries: ${totalCriteria - errorCriteria}/${totalCriteria} succeeded, ${errorCriteria} failed`);
        results.forEach(c => {
          console.log(`  ${c.name}: ${c.score}% — ${c.criteriaResults.filter(cr => !cr.error).length}/${c.criteriaResults.length} criteria OK`);
        });
        console.groupEnd();
      }

      setCapabilities(results);
    } catch (err) {
      warn("Assessment failed:", err);
      if (cancelRef.current === runToken) {
        setError(err instanceof Error ? err.message : "Assessment failed");
      }
    } finally {
      if (cancelRef.current === runToken) {
        setLoading(false);
      }
    }
    // tier is read inside; including it as a dep makes the callback
    // identity change when the user switches tier mid-session — the next
    // runId tick then uses the new value.
  }, [tier]);

  useEffect(() => {
    if (runId > 0) runAssessment();
  }, [runAssessment, runId]);

  // Apply consolidation factors to produce adjusted scores
  const adjustedCapabilities = useMemo(() => {
    if (Object.keys(consolidation).length === 0) return capabilities;
    return capabilities.map(cap => {
      const factor = consolidation[cap.name] ?? 100;
      if (factor === 100) return cap;
      const adjScore = Math.round(cap.rawScore * factor / 100);
      const adjMaturity = Math.round(cap.utilization.utilizationScore * factor / 100);
      return { ...cap, consolidation: factor, score: adjScore, effectiveUtilizationScore: adjMaturity };
    });
  }, [capabilities, consolidation]);

  const totalScore = adjustedCapabilities.length > 0
    ? Math.round(adjustedCapabilities.reduce((sum, c) => sum + c.score, 0) / adjustedCapabilities.length)
    : 0;

  const overallUtilizationLevel = adjustedCapabilities.length > 0
    ? Math.round(adjustedCapabilities.reduce((sum, c) => sum + c.effectiveUtilizationScore, 0) / adjustedCapabilities.length)
    : 0;

  const tenant = (() => {
    try {
      const envUrl = getEnvironmentUrl();
      if (envUrl) {
        const id = getTenantId(envUrl);
        if (id) return id;
      }
    } catch { /* ignore */ }
    const h = typeof window !== "undefined" ? window.location.hostname : "unknown";
    return h === "localhost" ? "localhost (dev)" : h.split(".")[0];
  })();

  const startFn = useCallback((caps?: CapabilityDef[], segmentId?: string) => {
    capsRef.current = caps && caps.length > 0 ? caps : CAPABILITIES;
    segmentIdRef.current = segmentId;
    setRunId((n) => n + 1);
  }, []);
  const refreshFn = useCallback(() => setRunId((n) => n + 1), []);
  const resetFn = useCallback(() => { setIdle(true); setCapabilities([]); setStats(null); setEntityCounts(null); setError(null); setConsolidation({}); setPerfEntries(null); setLastRunMeta(null); }, []);
  const goHomeFn = useCallback(() => { setIdle(true); }, []);
  const resumeFn = useCallback(() => {
    if (capabilities.length > 0) setIdle(false);
  }, [capabilities.length]);

  // Keep the capability cache in sync with the latest committed state. Used
  // by downloadPerfReport so the snapshot reflects whatever the user is
  // currently looking at (post-consolidation adjustments included).
  useEffect(() => {
    capsCacheRef.current = adjustedCapabilities;
  }, [adjustedCapabilities]);

  // Built once per (perf state, scale meta, demo) tuple. Closes over the
  // current snapshot of run state so calling it during a subsequent run
  // would still emit the LAST completed run's data — by design: we don't
  // want a half-finished run leaking into a downloadable report.
  // Force-refresh deletes the persistent cache document. Caller is expected
  // to call refresh()/start() next to actually trigger a fresh run. Kept
  // separate so the UI can offer "clear cache without re-running" if needed
  // (e.g., before navigating away).
  const forceRefresh = useCallback(async () => {
    const tenantId = (() => {
      try {
        const envUrl = getEnvironmentUrl();
        if (envUrl) {
          const id = getTenantId(envUrl);
          if (id) return id;
        }
      } catch { /* ignore */ }
      return 'unknown-tenant';
    })();
    const c = new QueryCache(tenantId);
    await c.load();
    await c.clearAndFlush();
  }, []);

  const downloadPerfReport = useCallback((): string | null => {
    if (!perfEntries || !lastRunMeta) return null;
    const report = buildReport({
      startedAt: lastRunMeta.startedAt,
      finishedAt: lastRunMeta.finishedAt,
      wallTimeMs: lastRunMeta.wallTimeMs,
      concurrency: lastRunMeta.concurrency,
      tenant,
      date: new Date().toISOString().split('T')[0],
      demoActive: false,
      demoScenarioId: null,
      scale: {
        tier,
        autoTier: scaleMeta?.autoTier ?? null,
        manualOverride: scaleMeta?.manualOverride ?? null,
        hostCount: scaleMeta?.hostCount ?? null,
      },
      entityCounts,
      capabilities: capsCacheRef.current,
      queryConsumers: lastRunMeta.queryConsumers,
      entries: perfEntries,
      cacheHits: lastRunMeta.cacheHits,
      cacheMisses: lastRunMeta.cacheMisses,
      cachedBytesSaved: lastRunMeta.cachedBytesSaved,
      skippedQueries: lastRunMeta.skippedQueries,
      skippedCriteria: lastRunMeta.skippedCriteria,
    });
    return downloadReport(report);
  }, [perfEntries, lastRunMeta, tenant, tier, scaleMeta, entityCounts]);

  return {
    capabilities: adjustedCapabilities,
    totalScore,
    overallUtilizationLevel,
    loading,
    idle,
    progress,
    error,
    stats,
    entityCounts,
    liveScannedBytes,
    liveScannedRecords,
    consolidation,
    setConsolidation,
    tenant,
    date: new Date().toISOString().split("T")[0],
    start: startFn,
    refresh: refreshFn,
    reset: resetFn,
    goHome: goHomeFn,
    resume: resumeFn,
    tier,
    sampled: TIER_CONFIG[tier].sampled,
    perfEntries,
    lastRunMeta,
    downloadPerfReport,
    forceRefresh,
  };
}
