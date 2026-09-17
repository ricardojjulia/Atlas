import type { Finding } from "../tenantReview/types/review.types";

export type ObsGrade = "A" | "B" | "C" | "D" | "F";

export function scoreToGrade(score: number): ObsGrade {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 65) return "C";
  if (score >= 50) return "D";
  return "F";
}

export interface EstimateResult {
  pgiCount: number;
  serviceCount: number;
  spansPerHour: number;
  logsPerHour: number;
  estimatedGb: number;
}

export interface ObsProbeResult {
  id: string;
  name: string;
  result: "pass" | "fail" | "partial" | "unknown";
  score: number;
  weight: number;
  evidence: string;
  threshold?: string;
  finding?: Finding;
}

export interface ObsDomainResult {
  id: string;
  name: string;
  icon: string;
  score: number;
  grade: ObsGrade;
  probes: ObsProbeResult[];
  findings: Finding[];
  error?: string;
}

export interface RoadmapItem {
  timeframe: "0-30d" | "30-60d" | "60-90d";
  finding: Finding;
  domain: string;
}

export interface ObsFullEvalResults {
  domains: ObsDomainResult[];
  overallScore: number;
  overallGrade: ObsGrade;
  findings: Finding[];
  roadmap: RoadmapItem[];
  scannedRecords: number;
  scannedBytes: number;
  runAt: number; // Date.now() at evaluation completion
}
