import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useCurrentTheme } from "@dynatrace/strato-components/core";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { Button } from "@dynatrace/strato-components/buttons";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Text, Strong } from "@dynatrace/strato-components/typography";
import { ProgressBar } from "@dynatrace/strato-components/content";
import { useObservabilityFullEval } from "../observabilityEval/useObservabilityFullEval";
import { useObsEvalHistory } from "../observabilityEval/useObsEvalHistory";
import type { ObsEvalSnapshot } from "../observabilityEval/useObsEvalHistory";
import { FindingsTable } from "../tenantReview/components/shared/FindingsTable";
import { useSegments } from "../hooks/useSegments";
import { generateObservabilityEvalPdf } from "../reports/observabilityEvalPdf";
import { APP_VERSION } from "../appVersion";
import type { EstimateResult, ObsFullEvalResults, ObsDomainResult, ObsGrade, RoadmapItem } from "../observabilityEval/types";
import type { Finding } from "../tenantReview/types/review.types";

// ─── Domain catalog (order matches Promise.all in the hook) ───────────────────

const DOMAIN_CATALOG: Array<{ id: string; name: string; icon: string }> = [
  { id: "oneagent",   name: "OneAgent",       icon: "🖥" },
  { id: "infra",      name: "Infrastructure", icon: "🏗" },
  { id: "apm",        name: "APM",            icon: "📈" },
  { id: "logs",       name: "Logs",           icon: "📋" },
  { id: "dem",        name: "DEM / RUM",      icon: "🌐" },
  { id: "davis",      name: "Davis AI",       icon: "🤖" },
  { id: "automation", name: "Automation",     icon: "⚙" },
  { id: "governance", name: "Governance",     icon: "🔒" },
  { id: "bizobs",     name: "Business Obs",   icon: "💼" },
  { id: "extensions", name: "Extensions",     icon: "🔌" },
];

// ─── Formatting helpers ────────────────────────────────────────────────────────

function formatNum(n: number): string { return n.toLocaleString(); }
function formatGb(gb: number): string { return gb < 0.001 ? "< 0.001 GB" : `${gb.toFixed(3)} GB`; }
function formatDps(dps: number): string { return dps < 0.01 ? "< $0.01" : `$${dps.toFixed(2)}`; }

// ─── Grade helpers ─────────────────────────────────────────────────────────────

function gradeColor(grade: ObsGrade): string {
  if (grade === "A") return Colors.Charts.Status.Ideal.Default;
  if (grade === "B") return "#14b8a6";
  if (grade === "C") return Colors.Charts.Status.Warning.Default;
  if (grade === "D") return Colors.Charts.Status.Critical.Default;
  return Colors.Text.Critical.Default;
}

function gradeBg(grade: ObsGrade, dk: boolean): string {
  if (grade === "A") return dk ? "rgba(20,184,80,0.15)" : "rgba(20,184,80,0.10)";
  if (grade === "B") return dk ? "rgba(20,184,166,0.15)" : "rgba(20,184,166,0.10)";
  if (grade === "C") return dk ? "rgba(255,193,7,0.15)" : "rgba(255,193,7,0.10)";
  if (grade === "D") return dk ? "rgba(220,53,69,0.12)" : "rgba(220,53,69,0.08)";
  return dk ? "rgba(220,53,69,0.18)" : "rgba(220,53,69,0.12)";
}

// ─── Card wrapper ──────────────────────────────────────────────────────────────

const Card: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <Flex
    flexDirection="column"
    gap={12}
    style={{
      borderRadius: 12,
      padding: "16px 20px",
      background: Colors.Background.Container.Neutral.Default,
      border: `1px solid ${Colors.Border.Neutral.Default}`,
      ...style,
    }}
  >
    {children}
  </Flex>
);

// ─── Estimate card (pre-run scope preview) ────────────────────────────────────

interface EstimateCardProps { estimate: EstimateResult; dk: boolean; onConfirm: () => void; onCancel: () => void; }

const EstimateCard: React.FC<EstimateCardProps> = ({ estimate, dk, onConfirm, onCancel }) => {
  const text = Colors.Text.Neutral.Default;
  const textSec = Colors.Text.Neutral.Subdued;
  const items = [
    { label: "Process group instances", value: formatNum(estimate.pgiCount) },
    { label: "Services", value: formatNum(estimate.serviceCount) },
    { label: "Spans/hour (last 1h)", value: formatNum(estimate.spansPerHour) },
    { label: "Log events/hour (last 1h)", value: formatNum(estimate.logsPerHour) },
    { label: "Estimated 24h scan volume", value: formatGb(estimate.estimatedGb) },
    { label: "Estimated DPS cost", value: formatDps(estimate.estimatedDps) },
  ];
  const bullets = [
    "OneAgent deployment coverage — full-stack mode, version spread, host groups, network zones",
    "Infrastructure — active vs ghost services, stale PGIs, Kubernetes monitoring",
    "Application observability — tracing, error rates, cloud function gaps, DB capture",
    "Log management — Grail ingest, signal quality, OpenPipeline configuration",
    "Digital experience — RUM apps, user events, session replay, synthetic monitors",
    "Davis AI & alerting — anomaly detectors, SLOs, alerting profiles, problem history",
    "Automation — workflow execution health and deployment tracking",
    "Platform governance — management zones, ownership, segments, API token hygiene, audit trail",
    "Business observability — BizEvent volume and data quality",
    "Extensions & cloud — ActiveGate HA, Extensions 2.0, cloud integrations",
  ];
  return (
    <Flex flexDirection="column" gap={16} style={{ maxWidth: 640 }}>
      <Card>
        <Text style={{ fontSize: 14, fontWeight: 700, color: text, marginBottom: 4 }}>Estimated Scope</Text>
        {items.map(item => (
          <Flex key={item.label} justifyContent="space-between" alignItems="center" gap={16}>
            <Text style={{ fontSize: 13, color: textSec }}>{item.label}</Text>
            <Strong style={{ fontSize: 13, color: text }}>{item.value}</Strong>
          </Flex>
        ))}
        <Flex
          flexDirection="column"
          gap={4}
          style={{
            marginTop: 8,
            padding: "10px 14px",
            borderRadius: 8,
            background: dk ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
            border: `1px solid ${Colors.Border.Neutral.Default}`,
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: 700, color: textSec, marginBottom: 4 }}>10 domains · 46 probes evaluated:</Text>
          {bullets.map(b => (
            <Flex key={b} gap={6} alignItems="flex-start">
              <Text style={{ fontSize: 12, color: Colors.Text.Primary.Default, flexShrink: 0, lineHeight: 1.6 }}>•</Text>
              <Text style={{ fontSize: 12, color: textSec, lineHeight: 1.6 }}>{b}</Text>
            </Flex>
          ))}
        </Flex>
        <Text style={{ fontSize: 11, color: textSec, marginTop: 4, fontStyle: "italic" }}>
          Queries run against live data. All probes are read-only.
        </Text>
      </Card>
      <Flex gap={12} alignItems="center">
        <Button onClick={onConfirm} variant="emphasized" color="primary">Run Full Evaluation →</Button>
        <Text
          role="button"
          tabIndex={0}
          onClick={onCancel}
          onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onCancel(); } }}
          style={{ fontSize: 13, color: textSec, cursor: "pointer", textDecoration: "underline" }}
        >
          Cancel
        </Text>
      </Flex>
    </Flex>
  );
};

// ─── Grade hero (overall result display) ──────────────────────────────────────

interface GradeHeroProps { results: ObsFullEvalResults; dk: boolean; }

const GradeHero: React.FC<GradeHeroProps> = ({ results, dk }) => {
  const text = Colors.Text.Neutral.Default;
  const textSec = Colors.Text.Neutral.Subdued;
  const gc = gradeColor(results.overallGrade);
  const gb = gradeBg(results.overallGrade, dk);
  const criticals = results.findings.filter(f => f.severity === "critical").length;
  const warnings = results.findings.filter(f => f.severity === "warning").length;
  const totalProbes = results.domains.reduce((s, d) => s + d.probes.length, 0);
  const passedProbes = results.domains.reduce((s, d) => s + d.probes.filter(p => p.result === "pass").length, 0);

  return (
    <Flex alignItems="center" gap={24} flexWrap="wrap">
      <Flex
        alignItems="center"
        justifyContent="center"
        flexDirection="column"
        style={{
          width: 100,
          height: 100,
          borderRadius: "50%",
          background: gb,
          border: `3px solid ${gc}`,
          flexShrink: 0,
        }}
      >
        <Text style={{ fontSize: 42, fontWeight: 900, color: gc, lineHeight: 1 }}>{results.overallGrade}</Text>
        <Text style={{ fontSize: 12, color: gc, fontWeight: 600 }}>{results.overallScore}/100</Text>
      </Flex>
      <Flex flexDirection="column" gap={6}>
        <Text style={{ fontSize: 18, fontWeight: 800, color: text }}>Observability Maturity Score</Text>
        <Flex gap={16} flexWrap="wrap">
          <Text style={{ fontSize: 13, color: textSec }}>
            <Strong style={{ color: criticals > 0 ? Colors.Text.Critical.Default : text }}>{criticals}</Strong> critical
          </Text>
          <Text style={{ fontSize: 13, color: textSec }}>
            <Strong style={{ color: warnings > 0 ? Colors.Text.Warning.Default : text }}>{warnings}</Strong> warnings
          </Text>
          <Text style={{ fontSize: 13, color: textSec }}>
            <Strong style={{ color: Colors.Charts.Status.Ideal.Default }}>{passedProbes}</Strong>/{totalProbes} probes passed
          </Text>
          <Text style={{ fontSize: 13, color: textSec }}>
            <Strong style={{ color: text }}>{results.domains.length}</Strong> domains evaluated
          </Text>
        </Flex>
      </Flex>
    </Flex>
  );
};

// ─── Domain heatmap ────────────────────────────────────────────────────────────

interface DomainHeatmapProps { domains: ObsDomainResult[]; dk: boolean; onSelect: (id: string) => void; selectedId: string | null; }

const DomainHeatmap: React.FC<DomainHeatmapProps> = ({ domains, dk, onSelect, selectedId }) => {
  const borderColor = Colors.Border.Neutral.Default;
  return (
    <Flex flexDirection="column" gap={8}>
      <Text style={{ fontSize: 12, fontWeight: 700, color: Colors.Text.Neutral.Subdued, textTransform: "uppercase", letterSpacing: 1 }}>
        Domain Overview
      </Text>
      <Flex flexWrap="wrap" gap={8}>
        {domains.map(d => {
          const gc = gradeColor(d.grade);
          const gb = gradeBg(d.grade, dk);
          const isSelected = selectedId === d.id;
          return (
            <Flex
              key={d.id}
              flexDirection="column"
              alignItems="center"
              gap={4}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(d.id)}
              onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(d.id); } }}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                background: gb,
                border: `2px solid ${isSelected ? gc : "transparent"}`,
                cursor: "pointer",
                minWidth: 120,
                flex: "1 1 120px",
                maxWidth: 180,
                transition: "border-color 0.15s",
              }}
            >
              <Text style={{ fontSize: 18, lineHeight: 1 }}>{d.icon}</Text>
              <Text style={{ fontSize: 20, fontWeight: 900, color: gc, lineHeight: 1 }}>{d.grade}</Text>
              <Text style={{ fontSize: 11, color: gc, fontWeight: 600 }}>{d.score}/100</Text>
              <Text style={{ fontSize: 10, color: Colors.Text.Neutral.Subdued, textAlign: "center", lineHeight: 1.3 }}>{d.name}</Text>
            </Flex>
          );
        })}
      </Flex>
    </Flex>
  );
};

// ─── Domain detail card (probe-level evidence) ────────────────────────────────

interface DomainDetailProps { domain: ObsDomainResult; dk: boolean; }

const DomainDetail: React.FC<DomainDetailProps> = ({ domain, dk }) => {
  const text = Colors.Text.Neutral.Default;
  const textSec = Colors.Text.Neutral.Subdued;
  const borderColor = Colors.Border.Neutral.Default;
  const gc = gradeColor(domain.grade);
  const gb = gradeBg(domain.grade, dk);

  const resultBadge = (result: string): React.ReactElement => {
    const styles: Record<string, { label: string; color: string }> = {
      pass: { label: "PASS", color: Colors.Charts.Status.Ideal.Default },
      partial: { label: "PARTIAL", color: Colors.Charts.Status.Warning.Default },
      fail: { label: "FAIL", color: Colors.Text.Critical.Default },
      unknown: { label: "N/A", color: Colors.Text.Neutral.Subdued },
    };
    const s = styles[result] ?? styles.unknown;
    return (
      <Text style={{ fontSize: 10, fontWeight: 800, color: s.color, textTransform: "uppercase", letterSpacing: 0.5, flexShrink: 0 }}>
        {s.label}
      </Text>
    );
  };

  return (
    <Flex flexDirection="column" gap={8}>
      <Flex alignItems="center" gap={8}>
        <Text style={{ fontSize: 16 }}>{domain.icon}</Text>
        <Text style={{ fontSize: 15, fontWeight: 700, color: text }}>{domain.name}</Text>
        <Flex
          alignItems="center"
          justifyContent="center"
          style={{ padding: "2px 10px", borderRadius: 20, background: gb, border: `1px solid ${gc}` }}
        >
          <Text style={{ fontSize: 13, fontWeight: 800, color: gc }}>{domain.grade} · {domain.score}</Text>
        </Flex>
      </Flex>

      <Flex
        flexDirection="column"
        style={{ borderRadius: 8, overflow: "hidden", border: `1px solid ${borderColor}` }}
      >
        <Flex
          style={{
            padding: "6px 12px",
            background: dk ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
            borderBottom: `1px solid ${borderColor}`,
          }}
        >
          <Text style={{ flex: 2, fontSize: 11, fontWeight: 700, color: textSec, textTransform: "uppercase", letterSpacing: 0.8 }}>Probe</Text>
          <Text style={{ width: 60, textAlign: "center", fontSize: 11, fontWeight: 700, color: textSec, textTransform: "uppercase", letterSpacing: 0.8 }}>Result</Text>
          <Text style={{ width: 50, textAlign: "right", fontSize: 11, fontWeight: 700, color: textSec, textTransform: "uppercase", letterSpacing: 0.8 }}>Score</Text>
        </Flex>
        {domain.probes.map((probe, i) => (
          <Flex
            key={probe.id}
            flexDirection="column"
            style={{
              padding: "8px 12px",
              borderBottom: i < domain.probes.length - 1 ? `1px solid ${borderColor}` : undefined,
              background: i % 2 === 0 ? "transparent" : (dk ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.015)"),
            }}
          >
            <Flex alignItems="center" gap={8}>
              <Text style={{ flex: 2, fontSize: 13, color: text, fontWeight: 500 }}>{probe.name}</Text>
              <Flex style={{ width: 60 }} justifyContent="center">{resultBadge(probe.result)}</Flex>
              <Text style={{ width: 50, textAlign: "right", fontSize: 13, fontWeight: 600, color: text }}>{probe.score}</Text>
            </Flex>
            <Text style={{ fontSize: 12, color: textSec, marginTop: 2 }}>{probe.evidence}</Text>
            {probe.threshold && (
              <Text style={{ fontSize: 11, color: textSec, opacity: 0.7, fontStyle: "italic" }}>Target: {probe.threshold}</Text>
            )}
          </Flex>
        ))}
      </Flex>
    </Flex>
  );
};

// ─── Remediation roadmap ──────────────────────────────────────────────────────

interface RoadmapProps { roadmap: RoadmapItem[]; dk: boolean; }

const RemediationRoadmap: React.FC<RoadmapProps> = ({ roadmap, dk }) => {
  const text = Colors.Text.Neutral.Default;
  const textSec = Colors.Text.Neutral.Subdued;
  const borderColor = Colors.Border.Neutral.Default;

  const buckets: Record<RoadmapItem["timeframe"], { label: string; color: string; items: RoadmapItem[] }> = {
    "0-30d": { label: "0 – 30 Days", color: Colors.Text.Critical.Default, items: [] },
    "30-60d": { label: "30 – 60 Days", color: Colors.Charts.Status.Warning.Default, items: [] },
    "60-90d": { label: "60 – 90 Days", color: Colors.Text.Primary.Default, items: [] },
  };
  for (const item of roadmap) {
    buckets[item.timeframe].items.push(item);
  }

  const criticalsByDomain: Record<string, number> = {};

  return (
    <Flex flexDirection="column" gap={8}>
      <Text style={{ fontSize: 12, fontWeight: 700, color: textSec, textTransform: "uppercase", letterSpacing: 1 }}>
        Remediation Roadmap
      </Text>
      <Flex gap={12} flexWrap="wrap" alignItems="flex-start">
        {(["0-30d", "30-60d", "60-90d"] as const).map(tf => {
          const bucket = buckets[tf];
          return (
            <Flex
              key={tf}
              flexDirection="column"
              gap={8}
              style={{
                flex: "1 1 200px",
                borderRadius: 10,
                padding: "12px 14px",
                background: dk ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
                border: `1px solid ${borderColor}`,
                minWidth: 200,
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: 800, color: bucket.color, textTransform: "uppercase", letterSpacing: 0.5 }}>
                {bucket.label}
              </Text>
              {bucket.items.length === 0 ? (
                <Text style={{ fontSize: 12, color: textSec, fontStyle: "italic" }}>No actions required</Text>
              ) : (
                bucket.items.slice(0, 8).map(item => (
                  <Flex key={item.finding.id} flexDirection="column" gap={2}>
                    <Text style={{ fontSize: 12, fontWeight: 600, color: text }}>{item.finding.title}</Text>
                    <Text style={{ fontSize: 11, color: textSec }}>{item.domain}</Text>
                  </Flex>
                ))
              )}
              {bucket.items.length > 8 && (
                <Text style={{ fontSize: 11, color: textSec, fontStyle: "italic" }}>+{bucket.items.length - 8} more</Text>
              )}
            </Flex>
          );
        })}
      </Flex>
    </Flex>
  );
};

// ─── Results footer ───────────────────────────────────────────────────────────

const ResultsFooter: React.FC<{ results: ObsFullEvalResults; textSec: string }> = ({ results, textSec }) => (
  <Text style={{ fontSize: 12, color: textSec, textAlign: "center" }}>
    {results.domains.length} domains · {results.domains.reduce((s, d) => s + d.probes.length, 0)} probes · {results.findings.length} finding{results.findings.length !== 1 ? "s" : ""} generated
  </Text>
);

// ─── Gap insights card ────────────────────────────────────────────────────────

interface GapInsightsCardProps { findings: Finding[]; dk: boolean; }

const GapInsightsCard: React.FC<GapInsightsCardProps> = ({ findings, dk }) => {
  const text = Colors.Text.Neutral.Default;
  const textSec = Colors.Text.Neutral.Subdued;
  const borderColor = Colors.Border.Neutral.Default;
  const [expanded, setExpanded] = useState(true);

  if (findings.length === 0) return null;

  const warnings = findings.filter(f => f.severity === "warning").length;
  const infos    = findings.filter(f => f.severity === "info").length;

  return (
    <Card>
      {/* Header */}
      <Flex
        justifyContent="space-between"
        alignItems="center"
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(p => !p)}
        onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded(p => !p); } }}
        style={{ cursor: "pointer" }}
      >
        <Flex alignItems="center" gap={12}>
          <Text style={{ fontSize: 14, fontWeight: 800, color: text }}>Gap Insights</Text>
          <Text style={{ fontSize: 12, color: textSec }}>
            Cross-domain coverage gaps — we saw strength here, but you're not covering this
          </Text>
        </Flex>
        <Flex alignItems="center" gap={8}>
          {warnings > 0 && (
            <Text style={{ fontSize: 12, fontWeight: 700, color: Colors.Charts.Status.Warning.Default }}>
              {warnings} gaps
            </Text>
          )}
          {infos > 0 && (
            <Text style={{ fontSize: 12, color: textSec }}>{infos} opportunities</Text>
          )}
          <Text style={{ fontSize: 11, color: textSec, opacity: 0.7 }}>{expanded ? "▲" : "▼"}</Text>
        </Flex>
      </Flex>

      {expanded && (
        <Flex flexDirection="column" gap={8} style={{ marginTop: 4 }}>
          {findings.map(f => {
            const sColor = f.severity === "warning" ? Colors.Charts.Status.Warning.Default
              : f.severity === "critical" ? Colors.Text.Critical.Default
              : Colors.Text.Primary.Default;
            return (
              <Flex
                key={f.id}
                flexDirection="column"
                gap={4}
                style={{
                  padding: "12px 16px",
                  borderRadius: 8,
                  background: f.severity === "warning"
                    ? "rgba(255,193,7,0.06)"
                    : dk ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)",
                  borderLeft: `4px solid ${sColor}`,
                  border: `1px solid ${borderColor}`,
                  borderLeftWidth: 4,
                  borderLeftColor: sColor,
                }}
              >
                <Flex alignItems="center" gap={8}>
                  <Text style={{ fontSize: 10, fontWeight: 800, color: sColor, textTransform: "uppercase", letterSpacing: 0.5, flexShrink: 0 }}>
                    {f.severity === "warning" ? "Gap" : "Opportunity"}
                  </Text>
                  <Text style={{ fontSize: 13, fontWeight: 700, color: text }}>{f.title}</Text>
                </Flex>
                <Text style={{ fontSize: 12, color: textSec, lineHeight: 1.6 }}>{f.description}</Text>
                {f.detail && (
                  <Text style={{ fontSize: 11, color: textSec, opacity: 0.65, fontFamily: "monospace" }}>{f.detail}</Text>
                )}
                {f.recommendation && (
                  <Text style={{ fontSize: 12, color: Colors.Text.Primary.Default, fontStyle: "italic", marginTop: 2 }}>
                    → {f.recommendation}
                  </Text>
                )}
              </Flex>
            );
          })}
        </Flex>
      )}
    </Card>
  );
};

// ─── Score trend sparkline ────────────────────────────────────────────────────

const GRADE_THRESHOLDS = [
  { score: 90, label: "A", color: "#14b850" },
  { score: 80, label: "B", color: "#14b8a6" },
  { score: 65, label: "C", color: "#f5c400" },
  { score: 50, label: "D", color: "#dc7820" },
];

interface ScoreTrendProps { snapshots: ObsEvalSnapshot[]; dk: boolean; }

const ScoreTrend: React.FC<ScoreTrendProps> = ({ snapshots, dk }) => {
  const text = Colors.Text.Neutral.Default;
  const textSec = Colors.Text.Neutral.Subdued;
  const borderColor = Colors.Border.Neutral.Default;

  // Show newest-last so the line reads left-to-right chronologically
  const pts = [...snapshots].reverse().slice(-15);
  if (pts.length < 1) return null;

  const W = 560, H = 100, PAD_L = 32, PAD_R = 16, PAD_T = 10, PAD_B = 24;
  const IW = W - PAD_L - PAD_R;
  const IH = H - PAD_T - PAD_B;

  const xOf = (i: number) => PAD_L + (pts.length === 1 ? IW / 2 : (i / (pts.length - 1)) * IW);
  const yOf = (score: number) => PAD_T + IH - (score / 100) * IH;

  const polyline = pts.map((s, i) => `${xOf(i).toFixed(1)},${yOf(s.overallScore).toFixed(1)}`).join(" ");

  // Delta vs previous run (newest to second-newest)
  const latest = snapshots[0];
  const prev = snapshots[1];
  const delta = prev ? latest.overallScore - prev.overallScore : null;
  const deltaColor = delta === null ? textSec : delta > 0 ? "#14b850" : delta < 0 ? Colors.Text.Critical.Default : textSec;
  const deltaLabel = delta === null ? "" : delta > 0 ? `▲ ${delta}` : delta < 0 ? `▼ ${Math.abs(delta)}` : "━ 0";

  // Domain deltas (only when we have 2+ runs)
  const domainDeltas = prev
    ? latest.domains.map(d => {
        const p = prev.domains.find(x => x.id === d.id);
        return { ...d, delta: p ? d.score - p.score : null };
      })
    : [];

  return (
    <Card>
      <Flex justifyContent="space-between" alignItems="center">
        <Text style={{ fontSize: 13, fontWeight: 700, color: text }}>Score Trend</Text>
        <Flex gap={8} alignItems="center">
          {delta !== null && (
            <Text style={{ fontSize: 13, fontWeight: 700, color: deltaColor }}>{deltaLabel}</Text>
          )}
          <Text style={{ fontSize: 12, color: textSec }}>{pts.length} run{pts.length !== 1 ? "s" : ""}</Text>
        </Flex>
      </Flex>

      {/* SVG sparkline */}
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: W, display: "block" }}>
        {/* Reference lines */}
        {GRADE_THRESHOLDS.map(t => {
          const ry = yOf(t.score);
          return (
            <g key={t.label}>
              <line x1={PAD_L} y1={ry} x2={W - PAD_R} y2={ry}
                stroke={t.color} strokeWidth={0.5} strokeDasharray="3 3" opacity={0.4} />
              <text x={PAD_L - 4} y={ry + 3.5} fontSize={7} fill={t.color} textAnchor="end" opacity={0.7}>{t.label}</text>
            </g>
          );
        })}
        {/* Area fill */}
        <polyline
          points={[
            `${xOf(0).toFixed(1)},${(PAD_T + IH).toFixed(1)}`,
            polyline,
            `${xOf(pts.length - 1).toFixed(1)},${(PAD_T + IH).toFixed(1)}`,
          ].join(" ")}
          fill={dk ? "rgba(20,100,255,0.08)" : "rgba(20,100,255,0.05)"}
          stroke="none"
        />
        {/* Line */}
        <polyline points={polyline} fill="none" stroke="#1464ff" strokeWidth={1.5} strokeLinejoin="round" />
        {/* Dots */}
        {pts.map((s, i) => {
          const gc = gradeColor(s.overallGrade);
          return (
            <g key={s.id}>
              <circle cx={xOf(i)} cy={yOf(s.overallScore)} r={4} fill={gc} />
              <text x={xOf(i)} y={PAD_T + IH + 14} fontSize={7}
                fill={dk ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.35)"}
                textAnchor="middle">
                {s.timestamp.slice(5, 10)}
              </text>
            </g>
          );
        })}
        {/* Score label on latest point */}
        {(() => {
          const last = pts[pts.length - 1];
          const lx = xOf(pts.length - 1);
          const ly = yOf(last.overallScore);
          const gc = gradeColor(last.overallGrade);
          return (
            <text x={lx} y={ly - 7} fontSize={8} fill={gc} textAnchor="middle" fontWeight="bold">
              {last.overallScore}
            </text>
          );
        })()}
      </svg>

      {/* Domain delta table (only when 2+ runs) */}
      {domainDeltas.length > 0 && (
        <Flex flexWrap="wrap" gap={6} style={{ marginTop: 4 }}>
          {domainDeltas.map(d => {
            const dc = d.delta === null ? textSec : d.delta > 0 ? "#14b850" : d.delta < 0 ? Colors.Text.Critical.Default : textSec;
            const dl = d.delta === null ? "" : d.delta > 0 ? `+${d.delta}` : d.delta < 0 ? `${d.delta}` : "=";
            const cat = DOMAIN_CATALOG.find(x => x.id === d.id);
            return (
              <Flex
                key={d.id}
                alignItems="center"
                gap={4}
                style={{
                  padding: "3px 8px",
                  borderRadius: 6,
                  background: dk ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
                  border: `1px solid ${borderColor}`,
                }}
              >
                <Text style={{ fontSize: 11, color: textSec }}>{cat?.icon ?? ""} {d.name}</Text>
                <Text style={{ fontSize: 11, fontWeight: 700, color: gradeColor(d.grade) }}>{d.grade}</Text>
                {dl && <Text style={{ fontSize: 10, color: dc }}>{dl}</Text>}
              </Flex>
            );
          })}
        </Flex>
      )}
    </Card>
  );
};

// ─── Running progress grid ────────────────────────────────────────────────────

interface RunningGridProps {
  domainProgress: ObsDomainResult[];
  totalDomains: number;
  dk: boolean;
}

const RunningGrid: React.FC<RunningGridProps> = ({ domainProgress, totalDomains, dk }) => {
  const textSec = Colors.Text.Neutral.Subdued;
  const doneById = Object.fromEntries(domainProgress.map(d => [d.id, d]));
  const done = domainProgress.length;

  return (
    <Flex flexDirection="column" gap={16} style={{ maxWidth: 640 }}>
      <Flex flexDirection="column" gap={6}>
        <Flex justifyContent="space-between" alignItems="center">
          <Text style={{ fontSize: 14, fontWeight: 700, color: Colors.Text.Neutral.Default }}>
            Running evaluation…
          </Text>
          <Text style={{ fontSize: 13, color: textSec }}>
            {done} / {totalDomains} domains complete
          </Text>
        </Flex>
        <ProgressBar value={(done / totalDomains) * 100} />
      </Flex>

      <Flex flexWrap="wrap" gap={8}>
        {DOMAIN_CATALOG.map(meta => {
          const completed = doneById[meta.id];
          if (completed) {
            const gc = gradeColor(completed.grade);
            const gb = gradeBg(completed.grade, dk);
            return (
              <Flex
                key={meta.id}
                flexDirection="column"
                alignItems="center"
                gap={4}
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  background: gb,
                  border: `2px solid ${gc}`,
                  minWidth: 108,
                  flex: "1 1 108px",
                  maxWidth: 160,
                }}
              >
                <Text style={{ fontSize: 18, lineHeight: 1 }}>{meta.icon}</Text>
                <Text style={{ fontSize: 20, fontWeight: 900, color: gc, lineHeight: 1 }}>{completed.grade}</Text>
                <Text style={{ fontSize: 11, color: gc, fontWeight: 600 }}>{completed.score}/100</Text>
                <Text style={{ fontSize: 10, color: Colors.Text.Neutral.Subdued, textAlign: "center", lineHeight: 1.3 }}>{meta.name}</Text>
              </Flex>
            );
          }
          // Pending tile — pulsing placeholder
          return (
            <Flex
              key={meta.id}
              flexDirection="column"
              alignItems="center"
              gap={4}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                background: dk ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)",
                border: `2px solid ${Colors.Border.Neutral.Default}`,
                minWidth: 108,
                flex: "1 1 108px",
                maxWidth: 160,
                opacity: 0.55,
                animation: "pulse 1.6s ease-in-out infinite",
              }}
            >
              <Text style={{ fontSize: 18, lineHeight: 1 }}>{meta.icon}</Text>
              <Text style={{ fontSize: 20, fontWeight: 900, color: textSec, lineHeight: 1 }}>—</Text>
              <Text style={{ fontSize: 11, color: textSec }}>&nbsp;</Text>
              <Text style={{ fontSize: 10, color: textSec, textAlign: "center", lineHeight: 1.3 }}>{meta.name}</Text>
            </Flex>
          );
        })}
      </Flex>

      <Text style={{ fontSize: 12, color: textSec, fontStyle: "italic" }}>
        All probes are read-only. Domains run in parallel — typically 20–60 seconds total.
      </Text>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.55; }
          50%       { opacity: 0.25; }
        }
      `}</style>
    </Flex>
  );
};

// ─── Main page ────────────────────────────────────────────────────────────────

export const ObservabilityEvaluationPage: React.FC = () => {
  const navigate = useNavigate();
  const dk = useCurrentTheme() === "dark";
  const handle = useObservabilityFullEval();
  const { segments } = useSegments();
  const { snapshots, saveSnapshot } = useObsEvalHistory();
  const [selectedDomainId, setSelectedDomainId] = useState<string | null>(null);
  const [activeSegmentId, setActiveSegmentId] = useState<string | undefined>(undefined);
  const savedRef = useRef(false);

  const text = Colors.Text.Neutral.Default;
  const textSec = Colors.Text.Neutral.Subdued;

  const heroBullets = [
    "46 probes across 10 domains: OneAgent Deployment, Infrastructure, Application Observability, Log Management, Digital Experience, Davis AI & Alerting, Automation, Platform Governance, Business Observability, Extensions & Cloud",
    "Graded scoring (A–F) per domain and overall, matching the architectural review deliverable format",
    "Findings table with severity classification and remediation recommendations",
    "90-day remediation roadmap auto-generated from probe results",
  ];

  const handleDomainSelect = (id: string) => {
    setSelectedDomainId(prev => prev === id ? null : id);
  };

  const selectedDomain = handle.results?.domains.find(d => d.id === selectedDomainId) ?? null;

  // Auto-save snapshot when eval completes (once per run)
  useEffect(() => {
    if (handle.phase !== "done" || !handle.results) return;
    if (savedRef.current) return;
    savedRef.current = true;
    saveSnapshot({
      tenant: window.location.hostname,
      overallScore: handle.results.overallScore,
      overallGrade: handle.results.overallGrade,
      segmentId: activeSegmentId,
      domains: handle.results.domains.map(d => ({ id: d.id, name: d.name, score: d.score, grade: d.grade })),
    });
  }, [handle.phase, handle.results, activeSegmentId, saveSnapshot]);

  // Reset the saved guard when user starts a new run
  useEffect(() => {
    if (handle.phase === "idle") savedRef.current = false;
  }, [handle.phase]);

  return (
    <Flex flexDirection="column" gap={20} style={{ padding: "16px 24px", maxWidth: 960, margin: "0 auto" }}>

      {/* Page header */}
      <Flex alignItems="center" gap={12}>
        <Button onClick={() => navigate("/")} size="condensed">← Back to Assessment</Button>
        <Text style={{ fontSize: 20, fontWeight: 800, color: text }}>Observability Evaluation</Text>
      </Flex>

      {/* Score trend — visible on idle and done when history exists */}
      {(handle.phase === "idle" || handle.phase === "done") && snapshots.length > 0 && (
        <ScoreTrend snapshots={snapshots} dk={dk} />
      )}

      {/* IDLE */}
      {handle.phase === "idle" && (
        <Card style={{ maxWidth: 640 }}>
          <Text style={{ fontSize: 15, fontWeight: 700, color: text }}>
            Automated architectural review — 10 domains, 46 probes, full report
          </Text>
          <Flex flexDirection="column" gap={6}>
            {heroBullets.map(b => (
              <Flex key={b} gap={8} alignItems="flex-start">
                <Text style={{ fontSize: 14, color: Colors.Text.Primary.Default, flexShrink: 0, lineHeight: 1.6 }}>•</Text>
                <Text style={{ fontSize: 13, color: textSec, lineHeight: 1.6 }}>{b}</Text>
              </Flex>
            ))}
          </Flex>
          <Text style={{ fontSize: 12, color: textSec }}>
            Starts with 4 lightweight count queries to estimate scope before running the full evaluation.
          </Text>
          {segments.length > 0 && (
            <Flex flexDirection="column" gap={6}>
              <Text style={{ fontSize: 12, fontWeight: 700, color: textSec }}>Segment filter (optional)</Text>
              <select
                value={activeSegmentId ?? ""}
                onChange={e => setActiveSegmentId(e.target.value || undefined)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: `1px solid ${Colors.Border.Neutral.Default}`,
                  background: Colors.Background.Container.Neutral.Default,
                  color: text,
                  fontSize: 13,
                  maxWidth: 320,
                  cursor: "pointer",
                }}
              >
                <option value="">All data (no segment filter)</option>
                {segments.map(seg => (
                  <option key={seg.id} value={seg.id}>{seg.name}</option>
                ))}
              </select>
            </Flex>
          )}
          <Flex>
            <Button onClick={() => handle.startEstimate(activeSegmentId)} variant="emphasized" color="primary">
              Estimate Scope →
            </Button>
          </Flex>
        </Card>
      )}

      {/* ESTIMATING */}
      {handle.phase === "estimating" && (
        <Flex flexDirection="column" gap={16} alignItems="flex-start">
          <ProgressBar value={-1} />
          <Text style={{ fontSize: 14, color: textSec }}>Scanning entity counts and telemetry volume…</Text>
        </Flex>
      )}

      {/* CONFIRMED */}
      {handle.phase === "confirmed" && handle.estimate && (
        <EstimateCard
          estimate={handle.estimate}
          dk={dk}
          onConfirm={handle.confirm}
          onCancel={handle.cancel}
        />
      )}

      {/* RUNNING */}
      {handle.phase === "running" && (
        <RunningGrid
          domainProgress={handle.domainProgress}
          totalDomains={handle.totalDomains}
          dk={dk}
        />
      )}

      {/* DONE */}
      {handle.phase === "done" && handle.results && (
        <Flex flexDirection="column" gap={20}>

          {/* Overall grade */}
          <Card>
            <GradeHero results={handle.results} dk={dk} />
          </Card>

          {/* Domain heatmap */}
          <Card>
            <DomainHeatmap
              domains={handle.results.domains}
              dk={dk}
              onSelect={handleDomainSelect}
              selectedId={selectedDomainId}
            />
            {selectedDomain && (
              <Flex
                flexDirection="column"
                style={{
                  marginTop: 8,
                  paddingTop: 16,
                  borderTop: `1px solid ${Colors.Border.Neutral.Default}`,
                }}
              >
                <DomainDetail domain={selectedDomain} dk={dk} />
              </Flex>
            )}
            {!selectedDomain && (
              <Text style={{ fontSize: 12, color: textSec, fontStyle: "italic", marginTop: 4 }}>
                Click a domain tile to view probe-level evidence
              </Text>
            )}
          </Card>

          {/* Gap Insights — gap findings (id prefix "gap-") are now included in results.findings */}
          <GapInsightsCard findings={handle.results.findings.filter(f => f.id.startsWith("gap-"))} dk={dk} />

          {/* Findings */}
          {handle.results.findings.length > 0 && (
            <Card>
              <Flex alignItems="center" gap={8}>
                <Text style={{ fontSize: 14, fontWeight: 700, color: text }}>Findings</Text>
                <Text style={{ fontSize: 13, color: textSec }}>
                  ({handle.results.findings.filter(f => f.severity === "critical").length} critical,{" "}
                  {handle.results.findings.filter(f => f.severity === "warning").length} warnings,{" "}
                  {handle.results.findings.filter(f => f.severity === "info").length} informational)
                </Text>
              </Flex>
              <FindingsTable findings={handle.results.findings} />
            </Card>
          )}

          {/* Remediation roadmap */}
          {handle.results.roadmap.length > 0 && (
            <Card>
              <RemediationRoadmap roadmap={handle.results.roadmap} dk={dk} />
            </Card>
          )}

          {/* Footer + actions */}
          <ResultsFooter results={handle.results} textSec={textSec} />
          <Flex gap={12} alignItems="center">
            <Button onClick={handle.reset} size="condensed">↺ Run Again</Button>
            <Button
              size="condensed"
              onClick={() => {
                if (!handle.results) return;
                generateObservabilityEvalPdf(handle.results, {
                  tenant: window.location.hostname,
                  date: new Date().toISOString().slice(0, 10),
                  appVersion: APP_VERSION,
                });
              }}
            >
              ⬇ Export Full Report
            </Button>
          </Flex>
        </Flex>
      )}

      {/* ERROR */}
      {handle.phase === "error" && (
        <Flex
          flexDirection="column"
          gap={12}
          style={{
            borderRadius: 12,
            padding: "16px 20px",
            background: Colors.Background.Container.Critical.Default,
            border: `1px solid ${Colors.Border.Critical.Default}`,
            maxWidth: 600,
          }}
        >
          <Text style={{ fontSize: 14, fontWeight: 700, color: Colors.Text.Critical.Default }}>Evaluation failed</Text>
          {handle.error && (
            <Text style={{ fontSize: 13, color: Colors.Text.Critical.Default }}>{handle.error}</Text>
          )}
          <Flex>
            <Button onClick={handle.reset}>Try Again</Button>
          </Flex>
        </Flex>
      )}
    </Flex>
  );
};
