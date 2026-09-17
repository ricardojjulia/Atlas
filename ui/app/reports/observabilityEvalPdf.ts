import { jsPDF } from "jspdf";
import { NOTO_SANS_BASE64, FONT_AVAILABLE } from "./fonts/notoSansSubset";
import type { ObsFullEvalResults, ObsDomainResult, ObsGrade } from "../observabilityEval/types";
import type { Finding, FindingSeverity } from "../tenantReview/types/review.types";
import { evaluateGaps } from "../observabilityEval/gapInsights";

// ── Font registration (same pattern as aiNarrativePdf.ts) ─────────────────────

function registerPdfFonts(doc: jsPDF): string {
  if (!FONT_AVAILABLE) return "helvetica";
  try {
    doc.addFileToVFS("NotoSans-Regular.ttf", NOTO_SANS_BASE64);
    doc.addFont("NotoSans-Regular.ttf", "NotoSans", "normal");
    doc.setFont("NotoSans", "normal");
    doc.getStringUnitWidth("A");
    return "NotoSans";
  } catch {
    doc.setFont("helvetica", "normal");
    return "helvetica";
  }
}

// ── String sanitiser ──────────────────────────────────────────────────────────

function clean(s: string): string {
  let r = s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`{1,3}/g, "")
    .replace(/[""]/g, '"')
    .replace(/—/g, "-")
    .replace(/·/g, ".");
  if (FONT_AVAILABLE) {
    r = r.replace(/[^\x20-\x7E -ÿ→≈≠≥✓✗◈▦⟳≡◉△⚙⚑◇⊕]/g, "");
  } else {
    r = r.replace(/≥/g, ">=").replace(/→/g, "->").replace(/≈/g, "~");
    r = r.replace(/[^\x20-\x7E]/g, "");
  }
  return r;
}

// ── Meta ──────────────────────────────────────────────────────────────────────

export interface ObsEvalPdfMeta {
  tenant: string;
  date: string;
  appVersion: string;
}

// ── Grade / severity helpers ──────────────────────────────────────────────────

function gradeRgb(grade: ObsGrade): [number, number, number] {
  if (grade === "A") return [20, 184, 80];
  if (grade === "B") return [0, 195, 155];
  if (grade === "C") return [230, 180, 0];
  if (grade === "D") return [220, 110, 30];
  return [210, 50, 60];
}

function gradeLabel(grade: ObsGrade): string {
  if (grade === "A") return "Excellent";
  if (grade === "B") return "Good";
  if (grade === "C") return "Fair";
  if (grade === "D") return "Needs Attention";
  return "Critical Gaps";
}

function severityRgb(sev: FindingSeverity): [number, number, number] {
  if (sev === "critical") return [210, 50, 60];
  if (sev === "warning") return [220, 160, 0];
  if (sev === "info") return [80, 130, 210];
  return [20, 180, 80];
}

function severityLabel(sev: FindingSeverity): string {
  return sev.toUpperCase();
}

// ── Build ─────────────────────────────────────────────────────────────────────

export function buildObsEvalPdf(results: ObsFullEvalResults, meta: ObsEvalPdfMeta): jsPDF {
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const BODY_FONT = registerPdfFonts(pdf);

  const W = 210, H = 297, M = 15, CW = W - 2 * M;
  let y = 0;

  // Design tokens — clean white professional theme
  const BG: [number, number, number]       = [255, 255, 255];   // page white
  const SURF: [number, number, number]     = [246, 248, 253];   // card / alt-row tint
  const SURF2: [number, number, number]    = [228, 233, 245];   // table header, dividers
  const BLUE: [number, number, number]     = [0, 100, 210];     // Dynatrace brand blue
  const BLUE_DIM: [number, number, number] = [75, 125, 190];    // muted blue accents
  const TEAL: [number, number, number]     = [0, 148, 115];     // recommendation / pass
  const TXT1: [number, number, number]     = [18, 24, 45];      // headlines
  const TXT2: [number, number, number]     = [62, 74, 105];     // body text
  const TXT3: [number, number, number]     = [132, 145, 172];   // labels, captions

  const paintBg = () => {
    pdf.setFillColor(...BG);
    pdf.rect(0, 0, W, H, "F");
  };

  const addRunningHeader = () => {
    pdf.setFillColor(...SURF);
    pdf.rect(0, 0, W, 10, "F");
    pdf.setFillColor(...BLUE);
    pdf.rect(0, 0, W, 1.5, "F");
    pdf.setFontSize(6); pdf.setFont("helvetica", "bold");
    pdf.setTextColor(...BLUE_DIM);
    pdf.text("ATLAS", M, 7.5);
    pdf.setFont(BODY_FONT, "normal");
    pdf.setTextColor(...TXT3);
    pdf.text(`${meta.tenant}  ·  Observability Evaluation  ·  ${meta.date}`, W / 2, 7.5, { align: "center" });
    pdf.setTextColor(...TXT3);
    pdf.text(`v${meta.appVersion}`, W - M, 7.5, { align: "right" });
  };

  const ensureSpace = (need: number) => {
    if (y + need > H - 16) {
      pdf.addPage();
      paintBg();
      addRunningHeader();
      y = 16;
    }
  };

  // ── Layout helpers ───────────────────────────────────────────────────────────

  const sectionHeader = (title: string) => {
    ensureSpace(22);
    pdf.setFillColor(...BLUE);
    pdf.rect(M, y - 3, 3, 11, "F");
    pdf.setFillColor(...SURF);
    pdf.rect(M + 3, y - 3, CW - 3, 11, "F");
    pdf.setFontSize(10); pdf.setFont("helvetica", "bold");
    pdf.setTextColor(...TXT1);
    pdf.text(clean(title), M + 10, y + 4.5);
    y += 16;
  };

  const subHeader = (title: string, color: [number, number, number] = TEAL) => {
    ensureSpace(12);
    pdf.setFontSize(9); pdf.setFont("helvetica", "bold");
    pdf.setTextColor(...color);
    pdf.text(clean(title), M, y);
    y += 6;
  };

  const bodyText = (text: string, indent = 0, color: [number, number, number] = TXT2) => {
    const lines = pdf.splitTextToSize(clean(text), CW - indent);
    pdf.setFontSize(8.5); pdf.setFont(BODY_FONT, "normal");
    pdf.setTextColor(...color);
    for (const ln of lines) {
      ensureSpace(5);
      pdf.text(ln, M + indent, y);
      y += 4.2;
    }
    y += 1.5;
  };

  const detailText = (text: string, indent = 0) => {
    const lines = pdf.splitTextToSize(clean(text), CW - indent);
    pdf.setFontSize(7.5); pdf.setFont(BODY_FONT, "normal");
    pdf.setTextColor(...TXT3);
    for (const ln of lines) {
      ensureSpace(4);
      pdf.text(ln, M + indent, y);
      y += 3.8;
    }
    y += 1;
  };

  const bulletItem = (text: string, indent = 0, color: [number, number, number] = TEAL) => {
    ensureSpace(6);
    pdf.setFillColor(...color);
    pdf.circle(M + indent + 1.8, y - 1.0, 0.9, "F");
    bodyText(text, indent + 5);
  };

  // ── Grade badge (inline circle in a table cell) ───────────────────────────────

  const gradeBadge = (grade: ObsGrade, cx: number, cy: number, r = 5.5) => {
    const rgb = gradeRgb(grade);
    pdf.setDrawColor(...rgb); pdf.setLineWidth(0.8);
    pdf.circle(cx, cy, r, "S");
    pdf.setFillColor(Math.round(rgb[0] * 0.12 + BG[0] * 0.88), Math.round(rgb[1] * 0.12 + BG[1] * 0.88), Math.round(rgb[2] * 0.12 + BG[2] * 0.88));
    pdf.circle(cx, cy, r - 0.5, "F");
    pdf.setFontSize(7); pdf.setFont("helvetica", "bold");
    pdf.setTextColor(...rgb);
    pdf.text(grade, cx, cy + 2.5, { align: "center" });
    pdf.setLineWidth(0.2);
  };

  // ── Table helpers ─────────────────────────────────────────────────────────────

  interface ColDef { label: string; w: number; align?: "left" | "center" | "right" }

  const tableHeader = (cols: ColDef[], rowH = 8) => {
    ensureSpace(rowH + 4);
    pdf.setFillColor(...SURF2);
    pdf.rect(M, y, CW, rowH, "F");
    let cx = M;
    for (const col of cols) {
      pdf.setFontSize(6.5); pdf.setFont("helvetica", "bold");
      pdf.setTextColor(...TXT3);
      const textX = col.align === "right" ? cx + col.w - 2 : col.align === "center" ? cx + col.w / 2 : cx + 2;
      pdf.text(col.label.toUpperCase(), textX, y + rowH / 2 + 1.5, { align: col.align ?? "left" });
      cx += col.w;
    }
    y += rowH;
  };

  const tableRow = (
    cells: Array<{ text: string; color?: [number, number, number]; bold?: boolean; align?: "left" | "center" | "right" }>,
    cols: ColDef[],
    rowH: number,
    bg: [number, number, number] | null = null,
    badge?: { grade: ObsGrade; colIdx: number }
  ) => {
    ensureSpace(rowH + 2);
    if (bg) { pdf.setFillColor(...bg); pdf.rect(M, y, CW, rowH, "F"); }
    let cx = M;
    for (let i = 0; i < cols.length; i++) {
      const cell = cells[i];
      const col = cols[i];
      if (badge && badge.colIdx === i) {
        gradeBadge(badge.grade as ObsGrade, cx + col.w / 2, y + rowH / 2, 4.5);
      } else if (cell?.text) {
        pdf.setFontSize(8); pdf.setFont("helvetica", cell.bold ? "bold" : "normal");
        pdf.setTextColor(...(cell.color ?? TXT2));
        const textX = (cell.align ?? col.align) === "right" ? cx + col.w - 2
          : (cell.align ?? col.align) === "center" ? cx + col.w / 2
          : cx + 2;
        const lines = pdf.splitTextToSize(clean(cell.text), col.w - 3);
        pdf.text(lines[0] ?? "", textX, y + rowH / 2 + 1.5, { align: cell.align ?? col.align ?? "left" });
      }
      cx += col.w;
    }
    y += rowH;
    // Subtle row separator
    pdf.setDrawColor(SURF2[0], SURF2[1], SURF2[2]);
    pdf.setLineWidth(0.15);
    pdf.line(M, y, M + CW, y);
    pdf.setLineWidth(0.2);
  };

  // ── Finding card ──────────────────────────────────────────────────────────────

  const findingCard = (f: Finding) => {
    const sRgb = severityRgb(f.severity);
    const cardH = 8
      + (f.description ? Math.ceil(pdf.splitTextToSize(clean(f.description), CW - 20).length * 4.2) : 0)
      + (f.detail ? Math.ceil(pdf.splitTextToSize(clean(f.detail), CW - 22).length * 3.8) + 2 : 0)
      + (f.recommendation ? Math.ceil(pdf.splitTextToSize(clean(f.recommendation), CW - 22).length * 3.8) + 2 : 0)
      + 4;
    ensureSpace(Math.min(cardH, 40));
    const cardY = y;
    // Left severity bar
    pdf.setFillColor(...sRgb);
    pdf.rect(M, cardY, 2.5, 12, "F");
    // Severity label
    pdf.setFontSize(6.5); pdf.setFont("helvetica", "bold");
    pdf.setTextColor(...sRgb);
    pdf.text(severityLabel(f.severity), M + 5, y + 5);
    // Title
    pdf.setFontSize(9); pdf.setFont("helvetica", "bold");
    pdf.setTextColor(...TXT1);
    const titleLines = pdf.splitTextToSize(clean(f.title), CW - 8);
    pdf.text(titleLines, M + 5, y + 10);
    y += 10 + titleLines.length * 4.5;
    // Description
    if (f.description) {
      const dLines = pdf.splitTextToSize(clean(f.description), CW - 8);
      pdf.setFontSize(8); pdf.setFont(BODY_FONT, "normal");
      pdf.setTextColor(...TXT2);
      pdf.text(dLines, M + 5, y);
      y += dLines.length * 4.2 + 2;
    }
    // Detail (evidence)
    if (f.detail) {
      const dtLines = pdf.splitTextToSize(clean(f.detail), CW - 10);
      pdf.setFontSize(7); pdf.setFont(BODY_FONT, "normal");
      pdf.setTextColor(...TXT3);
      pdf.text(dtLines, M + 7, y);
      y += dtLines.length * 3.8 + 2;
    }
    // Recommendation
    if (f.recommendation) {
      const rLines = pdf.splitTextToSize(`→ ${clean(f.recommendation)}`, CW - 10);
      pdf.setFontSize(7.5); pdf.setFont(BODY_FONT, "normal");
      pdf.setTextColor(...TEAL);
      pdf.text(rLines, M + 5, y);
      y += rLines.length * 3.8 + 2;
    }
    y += 5;
  };

  // ══════════════════════════════════════════════════════════════════════════════
  // COVER PAGE
  // ══════════════════════════════════════════════════════════════════════════════

  paintBg();

  const HERO_H = 58;
  pdf.setFillColor(...BLUE);                          // brand-blue hero band
  pdf.rect(0, 0, W, HERO_H, "F");
  pdf.setFillColor(...TEAL);                          // teal left accent
  pdf.rect(0, 0, 5, HERO_H, "F");
  // Decorative diagonals — subtly lighter blue on blue background
  pdf.setDrawColor(20, 118, 232); pdf.setLineWidth(0.25);
  for (let di = 0; di < 7; di++) {
    const ox = W - 60 + di * 11;
    pdf.line(ox, 0, ox + HERO_H * 0.6, HERO_H);
  }
  pdf.setLineWidth(0.2);

  // Wordmark
  pdf.setFontSize(28); pdf.setFont("helvetica", "bold");
  pdf.setTextColor(255, 255, 255);
  pdf.text("ATLAS", M + 6, 26);
  pdf.setFontSize(9); pdf.setFont("helvetica", "normal");
  pdf.setTextColor(200, 225, 255);                    // light blue-white on blue hero
  pdf.text("Observability Evaluation Report", M + 6, 36);
  pdf.setFontSize(7); pdf.setFont(BODY_FONT, "normal");
  pdf.setTextColor(180, 205, 245);                    // dimmer light on blue hero
  pdf.text(`${meta.tenant}  ·  ${meta.date}  ·  v${meta.appVersion}`, M + 6, 44);
  pdf.setDrawColor(255, 255, 255); pdf.setLineWidth(0.6);   // white separator on blue
  pdf.line(M + 6, 50, M + 6 + 55, 50);
  pdf.setLineWidth(0.2);

  // Grade circle (right side of hero)
  const gc = results.overallGrade;
  const gRgb = gradeRgb(gc);
  const circleX = W - M - 22;
  const circleY = HERO_H / 2 + 2;
  pdf.setDrawColor(...gRgb); pdf.setLineWidth(1.8);
  pdf.circle(circleX, circleY, 18, "S");
  // Interior: blend grade colour against the blue hero so the circle pops
  pdf.setFillColor(Math.round(gRgb[0] * 0.12 + BLUE[0] * 0.88), Math.round(gRgb[1] * 0.12 + BLUE[1] * 0.88), Math.round(gRgb[2] * 0.12 + BLUE[2] * 0.88));
  pdf.circle(circleX, circleY, 17, "F");
  pdf.setFontSize(28); pdf.setFont("helvetica", "bold");
  pdf.setTextColor(...gRgb);
  pdf.text(gc, circleX, circleY + 7, { align: "center" });
  pdf.setFontSize(7.5); pdf.setFont(BODY_FONT, "normal");
  pdf.setTextColor(220, 235, 255);                    // light on blue hero
  pdf.text(`${results.overallScore} / 100`, circleX, circleY + 21, { align: "center" });
  pdf.setFontSize(6.5);
  pdf.setTextColor(...gRgb);
  pdf.text(gradeLabel(gc), circleX, circleY + 26, { align: "center" });
  pdf.setLineWidth(0.2);

  y = HERO_H + 12;

  // KPI tiles row
  const criticalCount = results.findings.filter(f => f.severity === "critical").length;
  const warningCount = results.findings.filter(f => f.severity === "warning").length;
  const totalProbes = results.domains.reduce((s, d) => s + d.probes.length, 0);
  const passedProbes = results.domains.reduce((s, d) => s + d.probes.filter(p => p.result === "pass").length, 0);

  const kpis = [
    { label: "Domains", value: String(results.domains.length), color: TXT1 },
    { label: "Probes Run", value: String(totalProbes), color: TXT1 },
    { label: "Probes Passed", value: String(passedProbes), color: TEAL },
    { label: "Critical", value: String(criticalCount), color: criticalCount > 0 ? [210, 50, 60] as [number,number,number] : TXT1 },
    { label: "Warnings", value: String(warningCount), color: warningCount > 0 ? [220, 160, 0] as [number,number,number] : TXT1 },
  ];
  const kpiW = CW / kpis.length;
  for (let i = 0; i < kpis.length; i++) {
    const kx = M + i * kpiW + kpiW / 2;
    pdf.setFillColor(...SURF);
    pdf.roundedRect(M + i * kpiW + 1, y, kpiW - 2, 16, 2, 2, "F");
    pdf.setFontSize(14); pdf.setFont("helvetica", "bold");
    pdf.setTextColor(...kpis[i].color);
    pdf.text(kpis[i].value, kx, y + 9, { align: "center" });
    pdf.setFontSize(6); pdf.setFont(BODY_FONT, "normal");
    pdf.setTextColor(...TXT3);
    pdf.text(kpis[i].label, kx, y + 14, { align: "center" });
  }
  y += 22;

  // Intro paragraph
  pdf.setFontSize(8); pdf.setFont(BODY_FONT, "normal");
  pdf.setTextColor(...TXT2);
  const intro = `This report was generated by Atlas using ${totalProbes} automated probes across ${results.domains.length} observability domains. Each probe evaluates a specific aspect of Dynatrace deployment maturity against defined thresholds, producing scored findings and remediation recommendations. The overall grade is a weighted average across all domains.`;
  const introLines = pdf.splitTextToSize(clean(intro), CW);
  pdf.text(introLines, M, y);
  y += introLines.length * 4.3 + 8;

  // Separator
  pdf.setDrawColor(...SURF2); pdf.setLineWidth(0.4);
  pdf.line(M, y, W - M, y);
  y += 10;

  // ══════════════════════════════════════════════════════════════════════════════
  // SECTION 1 — Domain Scorecard
  // ══════════════════════════════════════════════════════════════════════════════

  sectionHeader("Domain Scorecard");

  const scorecardCols: ColDef[] = [
    { label: "#", w: 8, align: "center" },
    { label: "Domain", w: 55 },
    { label: "Grade", w: 18, align: "center" },
    { label: "Score", w: 18, align: "center" },
    { label: "Wt", w: 12, align: "center" },
    { label: "Probes", w: 18, align: "center" },
    { label: "Findings", w: 20, align: "center" },
    { label: "Pass", w: 16, align: "center" },
    { label: "Fail", w: 15, align: "center" },
  ];

  const DOMAIN_WEIGHTS: Record<string, number> = {
    oneagent: 1.0, infra: 0.9, apm: 1.0, logs: 0.9, dem: 0.8,
    davis: 1.0, automation: 0.7, governance: 0.9, bizobs: 0.7, extensions: 0.8,
  };

  tableHeader(scorecardCols, 8);

  for (let i = 0; i < results.domains.length; i++) {
    const d = results.domains[i];
    const passCount = d.probes.filter(p => p.result === "pass").length;
    const failCount = d.probes.filter(p => p.result === "fail").length;
    const wt = DOMAIN_WEIGHTS[d.id] ?? 1.0;
    const rowBg: [number, number, number] | null = i % 2 === 0 ? null : SURF;

    tableRow(
      [
        { text: String(i + 1), align: "center", color: TXT3 },
        { text: d.name, bold: true, color: TXT1 },
        { text: "" }, // filled by badge
        { text: String(d.score), align: "center", bold: true, color: gradeRgb(d.grade) },
        { text: wt.toFixed(1), align: "center", color: TXT3 },
        { text: String(d.probes.length), align: "center", color: TXT2 },
        { text: String(d.findings.length), align: "center", color: d.findings.length > 0 ? [220, 160, 0] : TXT2 },
        { text: String(passCount), align: "center", color: TEAL },
        { text: String(failCount), align: "center", color: failCount > 0 ? [210, 50, 60] : TXT2 },
      ],
      scorecardCols,
      10,
      rowBg,
      { grade: d.grade, colIdx: 2 }
    );
  }
  y += 6;

  // ══════════════════════════════════════════════════════════════════════════════
  // SECTION 2 — Gap Insights (cross-domain correlation)
  // ══════════════════════════════════════════════════════════════════════════════

  const gapFindings = evaluateGaps(results);
  if (gapFindings.length > 0) {
    sectionHeader("Gap Insights — Cross-Domain Coverage Gaps");
    bodyText(
      "The following gaps were identified by correlating domain scores. A strong score in one domain paired with a weak complementary domain signals unrealized observability value.",
      0, TXT2
    );
    y += 4;
    for (const f of gapFindings) {
      const sRgb = f.severity === "warning" ? [220, 160, 0] as [number,number,number] : [80, 130, 210] as [number,number,number];
      const label = f.severity === "warning" ? "GAP" : "OPPORTUNITY";
      ensureSpace(24);
      pdf.setFillColor(...SURF2);
      pdf.rect(M, y, CW, 0.5, "F");
      y += 4;
      // Label + title
      pdf.setFontSize(6.5); pdf.setFont("helvetica", "bold");
      pdf.setTextColor(...sRgb);
      pdf.text(label, M, y);
      pdf.setFontSize(9); pdf.setFont("helvetica", "bold");
      pdf.setTextColor(...TXT1);
      pdf.text(clean(f.title), M + 18, y);
      y += 5;
      // Detail line (scores)
      if (f.detail) {
        pdf.setFontSize(7); pdf.setFont(BODY_FONT, "normal");
        pdf.setTextColor(...TXT3);
        pdf.text(clean(f.detail), M, y);
        y += 4;
      }
      // Description
      if (f.description) {
        const dLines = pdf.splitTextToSize(clean(f.description), CW);
        pdf.setFontSize(8); pdf.setFont(BODY_FONT, "normal");
        pdf.setTextColor(...TXT2);
        for (const ln of dLines) { ensureSpace(5); pdf.text(ln, M, y); y += 4; }
      }
      // Recommendation
      if (f.recommendation) {
        const rLines = pdf.splitTextToSize(`→ ${clean(f.recommendation)}`, CW - 4);
        pdf.setFontSize(7.5); pdf.setFont(BODY_FONT, "normal");
        pdf.setTextColor(...TEAL);
        for (const ln of rLines) { ensureSpace(4); pdf.text(ln, M + 4, y); y += 3.8; }
      }
      y += 6;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // SECTION 3 — Probe Findings
  // ══════════════════════════════════════════════════════════════════════════════

  if (results.findings.length > 0) {
    sectionHeader("Findings");

    const bySeverity: Record<FindingSeverity, Finding[]> = {
      critical: results.findings.filter(f => f.severity === "critical"),
      warning: results.findings.filter(f => f.severity === "warning"),
      info: results.findings.filter(f => f.severity === "info"),
      success: results.findings.filter(f => f.severity === "success"),
    };

    for (const sev of ["critical", "warning", "info"] as FindingSeverity[]) {
      const group = bySeverity[sev];
      if (group.length === 0) continue;
      const sRgb = severityRgb(sev);
      subHeader(`${severityLabel(sev)} (${group.length})`, sRgb);
      for (const f of group) {
        findingCard(f);
      }
      y += 4;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // SECTION 4 — Domain Detail (probe-level evidence)
  // ══════════════════════════════════════════════════════════════════════════════

  sectionHeader("Domain Detail");

  const probeCols: ColDef[] = [
    { label: "Probe", w: 64 },
    { label: "Result", w: 20, align: "center" },
    { label: "Score", w: 16, align: "center" },
    { label: "Evidence", w: 80 },
  ];

  for (const domain of results.domains) {
    ensureSpace(30);
    const dRgb = gradeRgb(domain.grade);

    // Domain sub-header
    pdf.setFillColor(...SURF2);
    pdf.rect(M, y, CW, 10, "F");
    pdf.setFillColor(...dRgb);
    pdf.rect(M, y, 3, 10, "F");
    pdf.setFontSize(9); pdf.setFont("helvetica", "bold");
    pdf.setTextColor(...dRgb);
    pdf.text(`${domain.icon}  ${clean(domain.name)}`, M + 6, y + 7);
    pdf.setFontSize(7.5); pdf.setFont(BODY_FONT, "normal");
    pdf.setTextColor(...TXT3);
    pdf.text(`Grade ${domain.grade}  ·  Score ${domain.score}/100  ·  ${domain.probes.length} probes`, W - M, y + 7, { align: "right" });
    y += 12;

    // Probe table header
    tableHeader(probeCols, 7);

    for (let pi = 0; pi < domain.probes.length; pi++) {
      const probe = domain.probes[pi];
      const resultColors: Record<string, [number, number, number]> = {
        pass: TEAL,
        partial: [220, 160, 0],
        fail: [210, 50, 60],
        unknown: TXT3,
      };
      const resultLabels: Record<string, string> = {
        pass: "PASS",
        partial: "PARTIAL",
        fail: "FAIL",
        unknown: "N/A",
      };
      const rowBg: [number, number, number] | null = pi % 2 === 0 ? null : SURF;

      tableRow(
        [
          { text: probe.name, color: TXT1 },
          { text: resultLabels[probe.result] ?? "?", align: "center", bold: true, color: resultColors[probe.result] ?? TXT3 },
          { text: String(probe.score), align: "center", color: probe.score >= 80 ? TEAL : probe.score >= 50 ? [220, 160, 0] : [210, 50, 60] },
          { text: probe.evidence, color: TXT2 },
        ],
        probeCols,
        9,
        rowBg
      );
    }
    y += 8;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // SECTION 5 — Remediation Roadmap
  // ══════════════════════════════════════════════════════════════════════════════

  sectionHeader("Remediation Roadmap");

  const roadmapBuckets: Record<string, { label: string; color: [number, number, number]; items: typeof results.roadmap }> = {
    "0-30d": { label: "0 – 30 Days (Immediate)", color: [210, 50, 60], items: [] },
    "30-60d": { label: "30 – 60 Days (Short-Term)", color: [220, 160, 0], items: [] },
    "60-90d": { label: "60 – 90 Days (Medium-Term)", color: [80, 130, 210], items: [] },
  };
  for (const item of results.roadmap) {
    roadmapBuckets[item.timeframe]?.items.push(item);
  }

  for (const tf of ["0-30d", "30-60d", "60-90d"] as const) {
    const bucket = roadmapBuckets[tf];
    ensureSpace(18);
    // Band header
    pdf.setFillColor(...SURF2);
    pdf.rect(M, y, CW, 8, "F");
    pdf.setFillColor(...bucket.color);
    pdf.rect(M, y, 3, 8, "F");
    pdf.setFontSize(8.5); pdf.setFont("helvetica", "bold");
    pdf.setTextColor(...bucket.color);
    pdf.text(bucket.label, M + 7, y + 5.5);
    pdf.setFontSize(7); pdf.setFont(BODY_FONT, "normal");
    pdf.setTextColor(...TXT3);
    pdf.text(`${bucket.items.length} action${bucket.items.length !== 1 ? "s" : ""}`, W - M, y + 5.5, { align: "right" });
    y += 10;

    if (bucket.items.length === 0) {
      bodyText("No actions required in this timeframe.", 4, TXT3);
    } else {
      for (const item of bucket.items) {
        ensureSpace(10);
        pdf.setFillColor(...SURF);
        pdf.rect(M, y, CW, 8.5, "F");
        // Severity dot
        pdf.setFillColor(...severityRgb(item.finding.severity));
        pdf.circle(M + 4, y + 4.5, 1.2, "F");
        // Title
        pdf.setFontSize(8.5); pdf.setFont("helvetica", "bold");
        pdf.setTextColor(...TXT1);
        pdf.text(clean(item.finding.title), M + 8, y + 3.5);
        // Domain
        pdf.setFontSize(6.5); pdf.setFont(BODY_FONT, "normal");
        pdf.setTextColor(...TXT3);
        pdf.text(`${item.domain}`, M + 8, y + 7);
        // Recommendation (abbreviated)
        if (item.finding.recommendation) {
          const rText = item.finding.recommendation.length > 90
            ? item.finding.recommendation.slice(0, 87) + "..."
            : item.finding.recommendation;
          pdf.setTextColor(...TXT2);
          pdf.text(clean(rText), W - M, y + 7, { align: "right" });
        }
        y += 10;
      }
    }
    y += 6;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // FOOTER on every page
  // ══════════════════════════════════════════════════════════════════════════════

  const pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i);
    pdf.setFillColor(...SURF);
    pdf.rect(0, H - 10, W, 10, "F");
    pdf.setFillColor(...BLUE);
    pdf.rect(0, H - 10, W, 1, "F");
    pdf.setFontSize(5.5); pdf.setFont(BODY_FONT, "normal");
    pdf.setTextColor(...TXT3);
    pdf.text(`ATLAS  ·  Observability Evaluation  ·  ${meta.tenant}  ·  ${meta.date}`, M, H - 4);
    pdf.text(`Page ${i} / ${pages}`, W - M, H - 4, { align: "right" });
    pdf.setTextColor(...BLUE_DIM);
    pdf.text("Generated by Atlas — Dynatrace Observability Evaluation", W / 2, H - 4, { align: "center" });
  }

  return pdf;
}

/** Browser entry point: build and trigger the download. */
export function generateObservabilityEvalPdf(
  results: ObsFullEvalResults,
  meta: ObsEvalPdfMeta
): void {
  const slug = meta.tenant.replace(/[^a-zA-Z0-9-]/g, "-").replace(/-+/g, "-");
  buildObsEvalPdf(results, meta).save(`atlas-observability-eval-${slug}-${meta.date}.pdf`);
}
