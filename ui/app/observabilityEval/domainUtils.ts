import type { ObsProbeResult, ObsDomainResult } from "./types";
import type { Finding, FindingSeverity } from "../tenantReview/types/review.types";
import { scoreToGrade } from "./types";

export function calcDomainScore(probes: ObsProbeResult[]): number {
  if (!probes.length) return 0;
  const totalW = probes.reduce((s, p) => s + p.weight, 0);
  return totalW > 0 ? Math.round(probes.reduce((s, p) => s + p.score * p.weight, 0) / totalW) : 0;
}

export function mkProbe(
  id: string,
  name: string,
  weight: number,
  score: number,
  evidence: string,
  threshold?: string,
  finding?: Finding
): ObsProbeResult {
  const result: ObsProbeResult["result"] =
    score === 50 ? "unknown" : score >= 100 ? "pass" : score === 0 ? "fail" : "partial";
  return { id, name, result, score: Math.min(100, Math.max(0, score)), weight, evidence, threshold, finding };
}

export function mkFinding(
  id: string,
  title: string,
  description: string,
  severity: FindingSeverity,
  recommendation: string,
  detail?: string,
  actionUrl?: string
): Finding {
  return { id, title, description, severity, recommendation, detail, actionUrl };
}

export function buildDomain(
  id: string,
  name: string,
  icon: string,
  probes: ObsProbeResult[],
  error?: string
): ObsDomainResult {
  // When an error is present, score 0 explicitly — errored domains must not contribute to weighted averages
  const score = error ? 0 : calcDomainScore(probes);
  const grade = scoreToGrade(score);
  const findings = probes.filter(p => p.finding).map(p => p.finding!);
  return { id, name, icon, score, grade, probes, findings, error };
}
