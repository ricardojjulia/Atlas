// ui/app/reports/aiNarrativePdf.ts
//
// Renders a Davis CoPilot markdown answer into the app's dark PDF shell —
// the "Smart Report" artifact. Deliberately simple markdown support
// (headings, bullets, numbered lists, paragraphs; bold/italic markers are
// stripped) because the prompt instruction already requests plain markdown
// without code fences or emoji.
//
// Every page carries an AI-generated disclosure — a Smart Report is a
// draft to review, not an audited document.

import { jsPDF } from "jspdf";
import { NOTO_SANS_BASE64, FONT_AVAILABLE } from "./fonts/notoSansSubset";

/** Register embedded Noto Sans subset so Unicode symbols render in PDFs.
 *  Returns the font name to use: "NotoSans" on success, "helvetica" on failure. */
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

export interface AiNarrativeMeta {
  title: string;
  tenant: string;
  date: string;
  coverage: number;
  utilization: number;
  /** The user request that produced this report — printed under the title. */
  ask: string;
}

const clean = (s: string) => {
  // Strip markdown marks and normalise punctuation.
  let r = s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`{1,3}/g, "")
    .replace(/[""]/g, '"')
    .replace(/·/g, "-")
    .replace(/—/g, "-");
  if (FONT_AVAILABLE) {
    // Noto Sans subset covers ≥ → ≈ and Latin-1 (U+00A0–U+00FF);
    // strip only characters outside that range.
    r = r.replace(/[^\x20-\x7E -ÿ→≈≠≥✓✗]/g, "");
  } else {
    // WinAnsi Helvetica fallback — collapse Unicode symbols to ASCII.
    r = r.replace(/≥/g, ">=").replace(/→/g, "->").replace(/≈/g, "~");
    r = r.replace(/[^\x20-\x7E]/g, "");
  }
  return r;
};

/** Build without saving — lets tests/preview harnesses render offline. */
export function buildAiNarrativePdf(markdown: string, meta: AiNarrativeMeta): jsPDF {
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const BODY_FONT = registerPdfFonts(pdf);
  const W = 210, H = 297, M = 15, CW = W - 2 * M;
  let y = 0;

  // Design tokens — clean white professional theme
  const BG: [number,number,number]       = [255, 255, 255];   // page white
  const SURF: [number,number,number]     = [246, 248, 253];   // card / alt-row tint
  const BLUE: [number,number,number]     = [0, 100, 210];     // Dynatrace brand blue
  const BLUE_DIM: [number,number,number] = [75, 125, 190];    // muted blue accents
  const TEAL: [number,number,number]     = [0, 148, 115];     // recommendation / pass
  const TXT1: [number,number,number]     = [18, 24, 45];      // headlines
  const TXT2: [number,number,number]     = [62, 74, 105];     // body text
  const TXT3: [number,number,number]     = [132, 145, 172];   // labels, captions

  const paintBg = () => { pdf.setFillColor(...BG); pdf.rect(0, 0, W, H, "F"); };
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
    pdf.text(`${meta.tenant}  ·  ${meta.date}`, W / 2, 7.5, { align: "center" });
  };
  const ensureSpace = (need: number) => {
    if (y + need > H - 16) { pdf.addPage(); paintBg(); addRunningHeader(); y = 16; }
  };

  // ── header ──
  paintBg();

  // ── Hero band ──
  const HERO_H = 52;
  pdf.setFillColor(...BLUE);                          // brand-blue hero band
  pdf.rect(0, 0, W, HERO_H, "F");
  pdf.setFillColor(...TEAL);                          // teal left accent
  pdf.rect(0, 0, 5, HERO_H, "F");
  // Decorative diagonals — subtle lighter blue on blue background
  pdf.setDrawColor(20, 118, 232); pdf.setLineWidth(0.25);
  for (let di = 0; di < 6; di++) {
    const ox = W - 55 + di * 10;
    pdf.line(ox, 0, ox + HERO_H * 0.55, HERO_H);
  }
  pdf.setLineWidth(0.2);

  // ATLAS wordmark
  pdf.setFontSize(28); pdf.setFont("helvetica", "bold");
  pdf.setTextColor(255, 255, 255);
  pdf.text("ATLAS", M + 4, 24);
  // Smart Report label
  pdf.setFontSize(7.5); pdf.setFont("helvetica", "normal");
  pdf.setTextColor(200, 225, 255);                    // light on blue hero
  pdf.text("Smart Report  ·  by Dynatrace", M + 4, 33);
  // Separator
  pdf.setDrawColor(255, 255, 255); pdf.setLineWidth(0.6);   // white separator on blue
  pdf.line(M + 4, 38, M + 4 + 70, 38);
  pdf.setLineWidth(0.2);

  // Title (right side of hero)
  pdf.setFontSize(7); pdf.setFont("helvetica", "bold");
  pdf.setTextColor(200, 225, 255);                    // light on blue hero
  pdf.text("REPORT", W - M, 18, { align: "right" });
  const titleLines = pdf.splitTextToSize(clean(meta.title), 80);
  pdf.setFontSize(11); pdf.setFont("helvetica", "bold");
  pdf.setTextColor(255, 255, 255);                    // white title text on blue hero
  pdf.text(titleLines, W - M, 27, { align: "right" });

  y = HERO_H + 10;
  // Meta strip
  pdf.setFontSize(8.5); pdf.setFont(BODY_FONT, "normal");
  pdf.setTextColor(...TXT2);
  pdf.text(`${meta.tenant}  ·  ${meta.date}  ·  Coverage ${meta.coverage}%  ·  Utilization ${meta.utilization}`, W / 2, y, { align: "center" });
  y += 5;
  // Ask (the user's question)
  pdf.setFontSize(7.5);
  pdf.setTextColor(...TXT3);
  const askLines = pdf.splitTextToSize(`"${clean(meta.ask)}"`, CW - 20);
  pdf.text(askLines, W / 2, y, { align: "center" });
  y += askLines.length * 3.6 + 10;

  // ── markdown body ──
  const sectionHeader = (title: string) => {
    ensureSpace(20);
    pdf.setFillColor(...BLUE);
    pdf.rect(M, y - 3, 3, 11, "F");
    pdf.setFillColor(...SURF);
    pdf.rect(M + 3, y - 3, CW - 3, 11, "F");
    pdf.setFontSize(10); pdf.setFont("helvetica", "bold");
    pdf.setTextColor(...TXT1);
    pdf.text(clean(title), M + 10, y + 4.5);
    y += 15;
  };
  const subHeader = (title: string) => {
    ensureSpace(10);
    pdf.setFontSize(9.5); pdf.setFont("helvetica", "bold");
    pdf.setTextColor(...TEAL);
    pdf.text(clean(title), M, y);
    y += 5.5;
  };
  const paragraph = (text: string, indent = 0) => {
    pdf.setFontSize(8.5); pdf.setFont(BODY_FONT, "normal");
    pdf.setTextColor(...TXT2);
    const lines = pdf.splitTextToSize(clean(text), CW - indent);
    for (const ln of lines) {
      ensureSpace(5);
      pdf.text(ln, M + indent, y);
      y += 4.3;
    }
    y += 1.6;
  };
  const bulletItem = (text: string) => {
    ensureSpace(6);
    pdf.setFillColor(...TEAL);
    pdf.circle(M + 1.5, y - 1.2, 0.9, "F");
    paragraph(text, 6);
  };

  const lines = markdown.split(/\r?\n/);
  let paraBuf: string[] = [];
  const flushPara = () => {
    if (paraBuf.length > 0) { paragraph(paraBuf.join(" ")); paraBuf = []; }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (trimmed === "") { flushPara(); continue; }
    if (/^#{1,2}\s+/.test(trimmed)) { flushPara(); sectionHeader(trimmed.replace(/^#{1,2}\s+/, "")); continue; }
    if (/^#{3,6}\s+/.test(trimmed)) { flushPara(); subHeader(trimmed.replace(/^#{3,6}\s+/, "")); continue; }
    if (/^[-*+]\s+/.test(trimmed)) { flushPara(); bulletItem(trimmed.replace(/^[-*+]\s+/, "")); continue; }
    if (/^\d+[.)]\s+/.test(trimmed)) { flushPara(); bulletItem(trimmed); continue; }
    if (/^[-=_*]{3,}$/.test(trimmed)) { flushPara(); continue; }  // horizontal rules
    paraBuf.push(trimmed);
  }
  flushPara();

  // ── footer + AI disclosure on every page ──
  const pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i);
    pdf.setFillColor(...SURF);
    pdf.rect(0, H - 10, W, 10, "F");
    pdf.setFillColor(...BLUE);
    pdf.rect(0, H - 10, W, 1, "F");
    pdf.setFontSize(5.5); pdf.setFont(BODY_FONT, "normal");
    pdf.setTextColor(...TXT3);
    pdf.text(`ATLAS  ·  ${meta.tenant}  ·  ${meta.date}`, M, H - 4);
    pdf.text(`Page ${i} / ${pages}`, W - M, H - 4, { align: "right" });
    pdf.setTextColor(150, 110, 20);                     // darker amber — readable on light footer
    pdf.text("Generated with Davis CoPilot - review before sharing.", W / 2, H - 4, { align: "center" });
  }

  return pdf;
}

/** Browser entry point: build and trigger the download. */
export function generateAiNarrativePdf(markdown: string, meta: AiNarrativeMeta): void {
  buildAiNarrativePdf(markdown, meta).save(`atlas-smart-report-${meta.tenant}-${meta.date || "latest"}.pdf`);
}
