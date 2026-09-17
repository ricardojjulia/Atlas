// ui/app/reports/personaReports.ts
//
// Persona-targeted PDF reports — Executive / Tactical / Technical.
//
// All three are client-side jsPDF documents built ONLY from assessment
// data (no Davis / no network), so they work on any customer tenant.
// Visual language: dark navy pages, blue top bar, rounded KPI boxes.
//
// Every claim in the text is backed by a chart drawn from the same data:
//   - capability radar (canvas render reused from TechRadar)
//   - coverage vs utilization grouped bars
//   - evolution line over saved snapshots
//   - tier (FND/BP/EXC) stacked pass bars
//   - per-check gap bars (current value vs operative threshold)
//   - OK/GAP/ERR status distribution strips
//
//   Executive  — posture, evidence charts, strengths/exposures, quick
//                wins, next-quarter recommendations.
//   Tactical   — gap landscape chart + 30/60/90-day plan with gap bars,
//                capability board with tier stacks. For team leads.
//   Technical  — every criterion with value vs threshold, gap bar, tier,
//                proxy marker; failing ones include remediation, doc
//                link and the exact DQL. Reference for engineers.
//
// PDF font note: when NOTO_SANS_BASE64 is populated in fonts/notoSansSubset.ts,
// a Noto Sans TTF subset is embedded — enabling ✓ ✗ ≈ ≥ → in PDFs.
// When the font data is absent the code falls back to WinAnsi Helvetica with
// ASCII workarounds (OK/GAP, >=, ->, ~).

import { jsPDF } from "jspdf";
import { CRITERION_REMEDIATION } from "../data/criterionRemediation";
import { renderRadarToDataURL } from "../components/CovUtilRadar";
import { renderScatterToDataURL, scatterAspectRatio } from "../components/CapabilityScatter";
import { NOTO_SANS_BASE64, FONT_AVAILABLE } from "./fonts/notoSansSubset";

/** Register the embedded Noto Sans subset with the jsPDF instance.
 *  Returns the font name to use: "NotoSans" on success, "helvetica" on
 *  any failure (bad font data, jsPDF version mismatch, etc.). */
function registerPdfFonts(doc: jsPDF): string {
  if (!FONT_AVAILABLE) return "helvetica";
  try {
    doc.addFileToVFS("NotoSans-Regular.ttf", NOTO_SANS_BASE64);
    doc.addFont("NotoSans-Regular.ttf", "NotoSans", "normal");
    doc.setFont("NotoSans", "normal");
    // Probe width measurement — throws if the font's widths table is missing.
    // This surfaces the failure here rather than mid-render.
    doc.getStringUnitWidth("A");
    return "NotoSans";
  } catch {
    doc.setFont("helvetica", "normal");
    return "helvetica";
  }
}

export type PersonaLang = "en" | "pt" | "es";
export type ReportPersona = "executive" | "tactical" | "technical" | "custom";

/** Composable report sections — the personas are fixed compositions of
 *  these; "custom" renders whatever subset the user picked, always in
 *  canonical order (overview -> business -> plan -> technical). */
export type ReportSectionId =
  | "posture" | "covVsUtilization" | "tierPass" | "evolution"
  | "strengths" | "quickWins" | "nextStage" | "nextQuarter"
  | "adoption"
  | "gapLandscape" | "impactByTeam" | "plan" | "board" | "nextLevel" | "cadence"
  | "statusDist" | "techDetail" | "appendix";

export const SECTION_ORDER: ReportSectionId[] = [
  "posture", "covVsUtilization", "tierPass", "evolution",
  "strengths", "quickWins", "nextStage", "nextQuarter",
  "adoption",
  "gapLandscape", "impactByTeam", "plan", "board", "nextLevel", "cadence",
  "statusDist", "techDetail", "appendix",
];

export interface CustomReportOptions {
  /** Free-text title shown on the cover. Falls back to the localized "Custom Report". */
  title?: string;
  sections: ReportSectionId[];
}

export interface PersonaCriterion {
  id: string;
  label: string;
  description: string;
  value: number;
  points: number;
  error: boolean;
  query: string;
  thresholds: string;      // e.g. "≥90, ≥50, ≥1"
  tier: "foundation" | "bestPractice" | "excellence";
  isRatio: boolean;
  proxied?: boolean;
}

export interface PersonaCapability {
  name: string;
  color: string;
  score: number;
  criteriaResults: PersonaCriterion[];
  utilization: {
    foundation: { total: number; passed: number };
    bestPractice: { total: number; passed: number };
    excellence: { total: number; passed: number };
    levelLabel: string;
    utilizationScore: number;
    utilizationBand: string;
  };
}

export interface PersonaReportInput {
  capabilities: PersonaCapability[];
  totalScore: number;
  overallUtilizationLevel: number;
  tenant: string;
  date: string;
  stats: { scannedRecords: number; succeeded: number; total: number; failed: number } | null;
  entityCounts: { hosts: number; services: number; applications: number; k8sClusters: number } | null;
  /** Saved snapshots (oldest → newest) for the evolution chart. Optional. */
  history?: { timestamp: string; totalScore: number }[];
  /** Who actually uses the platform, per capability (from useAppAdoption).
   *  Reported alongside coverage — never folded into any score. */
  adoption?: {
    windowDays: number;
    totalUsers: number;
    byCapability: Record<string, { users: number; rate: number; apps: { appId: string; users: number; queries: number }[] }>;
  };
}

/* ── i18n ─────────────────────────────────────────────────────────── */

interface S {
  reportOf: string;
  execTitle: string; tactTitle: string; techTitle: string; customTitle: string;
  coverage: string; utilization: string; criteriaPassing: string; entitiesMonitored: string;
  postureTitle: string; verdictStrong: string; verdictMixed: string; verdictEarly: string;
  analysisTitle: string;
  avgLabel: string; bestLabel: string; worstLabel: string; spreadLabel: string;
  spreadNote: (pts: number) => string;
  tierPassTitle: string;
  tierNote: (fnd: number, bp: number, exc: number) => string;
  covVsUtilTitle: string; legCoverage: string; legUtilization: string;
  covVsUtilNote: string;
  evolutionTitle: string; evolutionNote: (n: number, delta: string) => string;
  strengthsTitle: string; exposuresTitle: string; notActivated: string;
  checksOk: (p: number, t: number) => string;
  failingChecksOf: (n: number, t: number) => string;
  quickWinsTitle: string; quickWinsIntro: string; gapPts: (g: string) => string;
  targetLabel: string;
  nextQuarterTitle: string;
  recGates: (caps: string) => string;
  recLift: (cap: string, s: number) => string;
  recWins: (n: number) => string;
  gapLandscapeTitle: string; gapLandscapeIntro: string;
  planTitle: string; planIntro: string;
  teamLabel: (team: string) => string;
  teamSummary: (n: number, pts: string) => string;
  impactChartTitle: string; impactChartNote: string;
  effortLow: string; effortMed: string; effortHigh: string;
  boardTitle: string; level: string; topGaps: string; noGaps: string;
  cadenceTitle: string; cadenceItems: string[];
  currentVsTarget: (v: string, t: string) => string;
  techIntro: string; statusOk: string; statusGap: string; statusErr: string;
  statusDistTitle: string;
  trend: string;
  adoptionTitle: string;
  adoptionIntro: (days: number, total: number) => string;
  adoptionNote: string;
  adoptionNobody: string;
  adoptionUsers: (n: number) => string;
  adoptionShare: (n: number, total: number, pct: number) => string;
  adoptionKpiTotal: string;
  adoptionKpiTop: string;
  adoptionKpiUnused: string;
  adoptionTopNote: (cap: string, n: number) => string;
  adoptionUnusedNote: (caps: string) => string;
  adoptionAllUsed: string;
  checksOkShort: (n: number) => string;
  ptsOverall: (x: string) => string;
  unlockTag: string;
  nextStageTitle: string;
  stageNow: (band: string, score: number) => string;
  stageNext: (band: string, pts: number) => string;
  stageMax: string;
  winsImpact: (n: number, pts: string) => string;
  nextLevelTitle: string;
  nlLine: (cur: string, next: string) => string;
  nlNeeds: (n: number) => string;
  nlMaxed: string;
  tierShort: Record<"foundation" | "bestPractice" | "excellence", string>;
  proxyNote: string; remediation: string; docs: string; queryLabel: string;
  appendixTitle: string; hosts: string; services: string; apps: string; clusters: string;
  recordsScanned: string; queriesOk: string;
  footer: (tenant: string, date: string) => string;
  page: (i: number, n: number) => string;
  none: string;
}

const STRINGS: Record<PersonaLang, S> = {
  en: {
    reportOf: "Dynatrace Atlas",
    execTitle: "Executive Report", tactTitle: "Tactical Report", techTitle: "Technical Report", customTitle: "Custom Report",
    coverage: "COVERAGE", utilization: "UTILIZATION", criteriaPassing: "CRITERIA PASSING", entitiesMonitored: "ENTITIES MONITORED",
    postureTitle: "Observability Posture at a Glance",
    verdictStrong: "Strong foundation: the platform is broadly adopted. Focus shifts from activation to depth and standardization.",
    verdictMixed: "Mixed posture: strong pillars coexist with under-used capabilities. Targeted activation unlocks fast, visible wins.",
    verdictEarly: "Early stage: most capabilities are not yet activated. A structured enablement plan will produce rapid gains.",
    analysisTitle: "Analysis",
    avgLabel: "Average", bestLabel: "Best", worstLabel: "Lowest", spreadLabel: "Spread",
    spreadNote: (pts) => `${pts}% separate the strongest and weakest capability - the gap itself is the roadmap.`,
    tierPassTitle: "Pass Rate by Utilization Tier",
    tierNote: (f, b, e) => `Foundation ${f}%, Best Practice ${b}%, Excellence ${e}% - Foundation gates the formula: gaps there suppress everything above.`,
    covVsUtilTitle: "Coverage vs Utilization by Capability",
    legCoverage: "Coverage %", legUtilization: "Utilization /100",
    covVsUtilNote: "Where the Utilization bar trails the coverage bar, the capability is activated but used shallowly - depth, not licensing, is the lever.",
    evolutionTitle: "Score Evolution",
    evolutionNote: (n, d) => `${n} saved snapshots - overall coverage moved ${d}% across the period.`,
    strengthsTitle: "Where the Platform Is Already Paying Off",
    exposuresTitle: "Business Exposures to Address",
    notActivated: "not yet activated",
    checksOk: (p, t) => `${p}/${t} checks passing`,
    failingChecksOf: (n, t) => `${n} of ${t} checks failing`,
    quickWinsTitle: "Quick Wins - Smallest Effort, Visible Gain",
    quickWinsIntro: "Checks closest to passing. The bar shows the measured value; the tick marks the pass threshold:",
    gapPts: (g) => `${g}% to go`,
    targetLabel: "target",
    nextQuarterTitle: "Where to Improve Next",
    recGates: (caps) => `Unlock Foundation gates in ${caps} - Foundation caps the whole Utilization formula for these capabilities.`,
    recLift: (cap, s) => `Lift ${cap} (currently ${s}%) - the lowest-coverage capability drags the overall posture.`,
    recWins: (n) => `Close the ${n} quick wins above - visible score movement builds momentum for the wider program.`,
    gapLandscapeTitle: "Gap Landscape - Shortest Path to Score Gains",
    gapLandscapeIntro: "The ten failing checks closest to their threshold. Bar = measured value, tick = pass bar:",
    planTitle: "Improvements by Team",
    planIntro: "Each improvement is grouped under the team that owns it, ordered by score impact. No dates - teams pull work as capacity allows.",
    teamLabel: (team) => team,
    teamSummary: (n, pts) => `${n} improvements - up to +${pts}% overall`,
    impactChartTitle: "Improvement Potential by Team",
    impactChartNote: "Bar length = how much overall coverage this team can add by closing its open checks. The widest bar is where effort pays off most.",
    effortLow: "small", effortMed: "medium", effortHigh: "large",
    boardTitle: "Capability Board",
    level: "Level", topGaps: "Top gaps", noGaps: "No failing checks - keep monitoring.",
    cadenceTitle: "How Teams Work These Improvements",
    cadenceItems: [
      "Each team owns the improvements listed under its name - one owner per check, no shared accountability.",
      "Foundation-tier improvements come first inside every team: they gate everything above them.",
      "Re-run this assessment after a batch of improvements lands; snapshots are saved for comparison.",
      "Track progress by improvements closed and coverage gained, not by elapsed time.",
    ],
    currentVsTarget: (v, t) => `now ${v} ${FONT_AVAILABLE ? "→" : "->"} target ${t}`,
    techIntro: "Every criterion evaluated by the assessment, with live values, thresholds, and remediation for the failing ones.",
    statusOk: FONT_AVAILABLE ? "✓" : "OK", statusGap: FONT_AVAILABLE ? "✗" : "GAP", statusErr: "ERR",
    statusDistTitle: "Check Status Distribution by Capability",
    trend: "TREND",
    adoptionTitle: "Who Actually Uses the Platform",
    adoptionIntro: (days, total) => `${total} people opened a Dynatrace app in the last ${days} days. Coverage says the data is there; this says whether anyone is looking at it.`,
    adoptionNote: "Counts distinct users per app that ran a query. Configuration-only apps and API traffic are not represented.",
    adoptionNobody: "no active users",
    adoptionUsers: (n) => (n === 1 ? "1 user" : `${n} users`),
    adoptionShare: (n, total, pct) => `${n} of ${total} (${pct}%)`,
    adoptionKpiTotal: "ACTIVE USERS",
    adoptionKpiTop: "MOST USED",
    adoptionKpiUnused: "NO USERS",
    adoptionTopNote: (cap, n) => `${cap} draws the widest audience: ${n} people opened its apps.`,
    adoptionUnusedNote: (caps) => `Nobody opened the apps serving ${caps}. The data may be collected, but no one is acting on it.`,
    adoptionAllUsed: "Every capability has at least one active user.",
    checksOkShort: (n) => `${n} checks passing - no action needed.`,
    ptsOverall: (x) => `+${x}% overall`,
    unlockTag: "unlocks next level",
    nextStageTitle: "Path to the Next Stage",
    stageNow: (band, score) => `Current stage: ${band} (${score}/100 Utilization)`,
    stageNext: (band, pts) => `Next stage: ${band} - ${pts}% of Utilization away. Foundation checks weigh 60% of the formula: close those first.`,
    stageMax: "Highest stage reached - focus shifts to standardization and continuous verification.",
    winsImpact: (n, pts) => `Closing the ${n} quick wins above adds ~+${pts}% coverage overall - the fastest measurable move toward the next stage.`,
    nextLevelTitle: "How to Reach the Next Level",
    nlLine: (cur, next) => `${cur} ${FONT_AVAILABLE ? "→" : "->"} ${next}`,
    nlNeeds: (n) => `pass ${n} more check${n > 1 ? "s" : ""}:`,
    nlMaxed: "Optimized - model ceiling reached, keep monitoring.",
    tierShort: { foundation: "FND", bestPractice: "BP", excellence: "EXC" },
    proxyNote: `${FONT_AVAILABLE ? "≈" : "~"} proxy: measured via service metrics/topology (Traces on Grail not enabled).`,
    remediation: "Remediation", docs: "Docs", queryLabel: "DQL",
    appendixTitle: "Appendix - Environment & Run",
    hosts: "Hosts", services: "Services", apps: "Web apps", clusters: "K8s clusters",
    recordsScanned: "records scanned", queriesOk: "queries OK",
    footer: (t, d) => `Dynatrace Atlas  |  ${t}  |  ${d}`,
    page: (i, n) => `Page ${i} / ${n}`,
    none: "None",
  },
  pt: {
    reportOf: "Dynatrace Atlas",
    execTitle: "Relatorio Executivo", tactTitle: "Relatorio Tatico", techTitle: "Relatorio Tecnico", customTitle: "Relatorio Personalizado",
    coverage: "COBERTURA", utilization: "UTILIZACAO", criteriaPassing: "CRITERIOS OK", entitiesMonitored: "ENTIDADES MONITORADAS",
    postureTitle: "Postura de Observabilidade em Resumo",
    verdictStrong: "Base solida: a plataforma esta amplamente adotada. O foco passa de ativacao para profundidade e padronizacao.",
    verdictMixed: "Postura mista: pilares fortes convivem com capacidades subutilizadas. Ativacao direcionada gera ganhos rapidos e visiveis.",
    verdictEarly: "Estagio inicial: a maioria das capacidades ainda nao foi ativada. Um plano estruturado de habilitacao produz ganhos rapidos.",
    analysisTitle: "Analise",
    avgLabel: "Media", bestLabel: "Melhor", worstLabel: "Menor", spreadLabel: "Amplitude",
    spreadNote: (pts) => `${pts}% separam a capacidade mais forte da mais fraca - essa distancia e o proprio roadmap.`,
    tierPassTitle: "Aprovacao por Tier de Utilizacao",
    tierNote: (f, b, e) => `Foundation ${f}%, Best Practice ${b}%, Excellence ${e}% - Foundation trava a formula: gaps ali suprimem tudo acima.`,
    covVsUtilTitle: "Cobertura vs Utilizacao por Capacidade",
    legCoverage: "Cobertura %", legUtilization: "Utilizacao /100",
    covVsUtilNote: "Onde a barra de Utilizacao fica atras da de cobertura, a capacidade esta ativada mas usada de forma rasa - a alavanca e profundidade, nao licenciamento.",
    evolutionTitle: "Evolucao do Score",
    evolutionNote: (n, d) => `${n} snapshots salvos - a cobertura geral moveu ${d}% no periodo.`,
    strengthsTitle: "Onde a Plataforma Ja Gera Valor",
    exposuresTitle: "Exposicoes de Negocio a Enderecar",
    notActivated: "ainda nao ativada",
    checksOk: (p, t) => `${p}/${t} checks aprovados`,
    failingChecksOf: (n, t) => `${n} de ${t} checks reprovados`,
    quickWinsTitle: "Vitorias Rapidas - Menor Esforco, Ganho Visivel",
    quickWinsIntro: "Checks mais proximos de passar. A barra mostra o valor medido; o traco marca o threshold de aprovacao:",
    gapPts: (g) => `faltam ${g}%`,
    targetLabel: "meta",
    nextQuarterTitle: "Onde Melhorar em Seguida",
    recGates: (caps) => `Destravar os gates de Foundation em ${caps} - Foundation limita toda a formula de Utilizacao dessas capacidades.`,
    recLift: (cap, s) => `Elevar ${cap} (hoje ${s}%) - a capacidade de menor cobertura puxa a postura geral para baixo.`,
    recWins: (n) => `Fechar as ${n} vitorias rapidas acima - movimento visivel de score cria momentum para o programa.`,
    gapLandscapeTitle: "Paisagem de Gaps - Caminho Mais Curto para Ganhar Score",
    gapLandscapeIntro: "Os dez checks reprovados mais proximos do threshold. Barra = valor medido, traco = linha de aprovacao:",
    planTitle: "Melhorias por Time",
    planIntro: "Cada melhoria esta agrupada sob o time que a executa, ordenada por impacto no score. Sem datas - cada time puxa o trabalho conforme a capacidade.",
    teamLabel: (team) => team,
    teamSummary: (n, pts) => `${n} melhorias - ate +${pts}% no geral`,
    impactChartTitle: "Potencial de Melhoria por Time",
    impactChartNote: "Tamanho da barra = quanto de cobertura geral o time pode adicionar fechando seus checks abertos. A barra mais larga e onde o esforco rende mais.",
    effortLow: "pequeno", effortMed: "medio", effortHigh: "grande",
    boardTitle: "Painel por Capacidade",
    level: "Nivel", topGaps: "Maiores gaps", noGaps: "Nenhum check reprovado - manter monitoramento.",
    cadenceTitle: "Como os Times Trabalham Estas Melhorias",
    cadenceItems: [
      "Cada time e dono das melhorias listadas sob seu nome - um responsavel por check, sem responsabilidade compartilhada.",
      "Melhorias de Foundation vem primeiro dentro de cada time: elas travam tudo o que vem acima.",
      "Rodar este assessment apos um lote de melhorias entrar; os snapshots ficam salvos para comparacao.",
      "Acompanhar o progresso por melhorias fechadas e cobertura ganha, nao por tempo decorrido.",
    ],
    currentVsTarget: (v, t) => `hoje ${v} ${FONT_AVAILABLE ? "→" : "->"} meta ${t}`,
    techIntro: "Todos os criterios avaliados pelo assessment, com valores reais, thresholds e remediacao para os reprovados.",
    statusOk: FONT_AVAILABLE ? "✓" : "OK", statusGap: FONT_AVAILABLE ? "✗" : "GAP", statusErr: "ERR",
    statusDistTitle: "Distribuicao de Status dos Checks por Capacidade",
    trend: "TENDENCIA",
    adoptionTitle: "Quem Realmente Usa a Plataforma",
    adoptionIntro: (days, total) => `${total} pessoas abriram algum app Dynatrace nos ultimos ${days} dias. A cobertura diz que o dado existe; isto diz se alguem esta olhando.`,
    adoptionNote: "Conta usuarios distintos por app que executou consulta. Apps apenas de configuracao e trafego de API nao aparecem.",
    adoptionNobody: "sem usuarios ativos",
    adoptionUsers: (n) => (n === 1 ? "1 usuario" : `${n} usuarios`),
    adoptionShare: (n, total, pct) => `${n} de ${total} (${pct}%)`,
    adoptionKpiTotal: "USUARIOS ATIVOS",
    adoptionKpiTop: "MAIS USADA",
    adoptionKpiUnused: "SEM USUARIOS",
    adoptionTopNote: (cap, n) => `${cap} tem a maior audiencia: ${n} pessoas abriram seus apps.`,
    adoptionUnusedNote: (caps) => `Ninguem abriu os apps de ${caps}. O dado pode estar sendo coletado, mas ninguem esta agindo sobre ele.`,
    adoptionAllUsed: "Todas as capacidades tem ao menos um usuario ativo.",
    checksOkShort: (n) => `${n} checks aprovados - nenhuma acao necessaria.`,
    ptsOverall: (x) => `+${x}% no score geral`,
    unlockTag: "destrava o proximo nivel",
    nextStageTitle: "Caminho para a Proxima Etapa",
    stageNow: (band, score) => `Etapa atual: ${band} (${score}/100 de Utilizacao)`,
    stageNext: (band, pts) => `Proxima etapa: ${band} - faltam ${pts}% de Utilizacao. Checks Foundation pesam 60% da formula: feche-os primeiro.`,
    stageMax: "Etapa maxima atingida - o foco passa a ser padronizacao e verificacao continua.",
    winsImpact: (n, pts) => `Fechar as ${n} vitorias rapidas acima adiciona ~+${pts}% de cobertura geral - o movimento mensuravel mais rapido rumo a proxima etapa.`,
    nextLevelTitle: "Como Alcancar o Proximo Nivel",
    nlLine: (cur, next) => `${cur} ${FONT_AVAILABLE ? "→" : "->"} ${next}`,
    nlNeeds: (n) => `aprovar mais ${n} check${n > 1 ? "s" : ""}:`,
    nlMaxed: "Optimized - teto do modelo atingido, manter monitoramento.",
    tierShort: { foundation: "FND", bestPractice: "BP", excellence: "EXC" },
    proxyNote: `${FONT_AVAILABLE ? "≈" : "~"} proxy: medido via metricas de servico/topologia (Traces on Grail nao habilitado).`,
    remediation: "Remediacao", docs: "Docs", queryLabel: "DQL",
    appendixTitle: "Apendice - Ambiente & Execucao",
    hosts: "Hosts", services: "Servicos", apps: "Apps web", clusters: "Clusters K8s",
    recordsScanned: "registros varridos", queriesOk: "queries OK",
    footer: (t, d) => `Dynatrace Atlas  |  ${t}  |  ${d}`,
    page: (i, n) => `Pagina ${i} / ${n}`,
    none: "Nenhum",
  },
  es: {
    reportOf: "Dynatrace Atlas",
    execTitle: "Informe Ejecutivo", tactTitle: "Informe Tactico", techTitle: "Informe Tecnico", customTitle: "Informe Personalizado",
    coverage: "COBERTURA", utilization: "UTILIZACION", criteriaPassing: "CRITERIOS OK", entitiesMonitored: "ENTIDADES MONITOREADAS",
    postureTitle: "Postura de Observabilidad en Resumen",
    verdictStrong: "Base solida: la plataforma esta ampliamente adoptada. El foco pasa de activacion a profundidad y estandarizacion.",
    verdictMixed: "Postura mixta: pilares fuertes conviven con capacidades subutilizadas. La activacion dirigida genera logros rapidos y visibles.",
    verdictEarly: "Etapa inicial: la mayoria de las capacidades aun no se activaron. Un plan estructurado de habilitacion produce ganancias rapidas.",
    analysisTitle: "Analisis",
    avgLabel: "Promedio", bestLabel: "Mejor", worstLabel: "Menor", spreadLabel: "Amplitud",
    spreadNote: (pts) => `${pts}% separan la capacidad mas fuerte de la mas debil - esa distancia es el propio roadmap.`,
    tierPassTitle: "Aprobacion por Tier de Utilizacion",
    tierNote: (f, b, e) => `Foundation ${f}%, Best Practice ${b}%, Excellence ${e}% - Foundation bloquea la formula: brechas alli suprimen todo lo demas.`,
    covVsUtilTitle: "Cobertura vs Utilizacion por Capacidad",
    legCoverage: "Cobertura %", legUtilization: "Utilizacion /100",
    covVsUtilNote: "Donde la barra de Utilizacion queda detras de la de cobertura, la capacidad esta activada pero usada superficialmente - la palanca es profundidad, no licenciamiento.",
    evolutionTitle: "Evolucion del Score",
    evolutionNote: (n, d) => `${n} snapshots guardados - la cobertura general se movio ${d}% en el periodo.`,
    strengthsTitle: "Donde la Plataforma Ya Genera Valor",
    exposuresTitle: "Exposiciones de Negocio a Abordar",
    notActivated: "aun no activada",
    checksOk: (p, t) => `${p}/${t} checks aprobados`,
    failingChecksOf: (n, t) => `${n} de ${t} checks reprobados`,
    quickWinsTitle: "Logros Rapidos - Menor Esfuerzo, Ganancia Visible",
    quickWinsIntro: "Checks mas cercanos a aprobar. La barra muestra el valor medido; la marca indica el umbral:",
    gapPts: (g) => `faltan ${g}%`,
    targetLabel: "meta",
    nextQuarterTitle: "Donde Mejorar a Continuacion",
    recGates: (caps) => `Desbloquear los gates de Foundation en ${caps} - Foundation limita toda la formula de Utilizacion de esas capacidades.`,
    recLift: (cap, s) => `Elevar ${cap} (hoy ${s}%) - la capacidad de menor cobertura arrastra la postura general.`,
    recWins: (n) => `Cerrar los ${n} logros rapidos de arriba - movimiento visible de score crea impulso para el programa.`,
    gapLandscapeTitle: "Paisaje de Brechas - Camino Mas Corto para Ganar Score",
    gapLandscapeIntro: "Los diez checks reprobados mas cercanos a su umbral. Barra = valor medido, marca = linea de aprobacion:",
    planTitle: "Mejoras por Equipo",
    planIntro: "Cada mejora esta agrupada bajo el equipo que la ejecuta, ordenada por impacto en el score. Sin fechas - cada equipo toma el trabajo segun su capacidad.",
    teamLabel: (team) => team,
    teamSummary: (n, pts) => `${n} mejoras - hasta +${pts}% en general`,
    impactChartTitle: "Potencial de Mejora por Equipo",
    impactChartNote: "Largo de la barra = cuanta cobertura general puede agregar el equipo cerrando sus checks abiertos. La barra mas ancha es donde el esfuerzo rinde mas.",
    effortLow: "pequeno", effortMed: "medio", effortHigh: "grande",
    boardTitle: "Tablero por Capacidad",
    level: "Nivel", topGaps: "Mayores brechas", noGaps: "Ningun check reprobado - mantener monitoreo.",
    cadenceTitle: "Como los Equipos Trabajan Estas Mejoras",
    cadenceItems: [
      "Cada equipo es dueno de las mejoras listadas bajo su nombre - un responsable por check, sin responsabilidad compartida.",
      "Las mejoras de Foundation van primero dentro de cada equipo: bloquean todo lo que viene arriba.",
      "Ejecutar este assessment despues de que entre un lote de mejoras; los snapshots quedan guardados para comparar.",
      "Medir el progreso por mejoras cerradas y cobertura ganada, no por tiempo transcurrido.",
    ],
    currentVsTarget: (v, t) => `hoy ${v} ${FONT_AVAILABLE ? "→" : "->"} meta ${t}`,
    techIntro: "Todos los criterios evaluados por el assessment, con valores reales, umbrales y remediacion para los reprobados.",
    statusOk: FONT_AVAILABLE ? "✓" : "OK", statusGap: FONT_AVAILABLE ? "✗" : "GAP", statusErr: "ERR",
    statusDistTitle: "Distribucion de Estado de Checks por Capacidad",
    adoptionTitle: "Quien Usa Realmente la Plataforma",
    adoptionIntro: (days, total) => `${total} personas abrieron alguna app de Dynatrace en los ultimos ${days} dias. La cobertura dice que el dato existe; esto dice si alguien lo esta mirando.`,
    adoptionNote: "Cuenta usuarios distintos por app que ejecuto consultas. Apps solo de configuracion y trafico de API no aparecen.",
    adoptionNobody: "sin usuarios activos",
    adoptionUsers: (n) => (n === 1 ? "1 usuario" : `${n} usuarios`),
    adoptionShare: (n, total, pct) => `${n} de ${total} (${pct}%)`,
    adoptionKpiTotal: "USUARIOS ACTIVOS",
    adoptionKpiTop: "MAS USADA",
    adoptionKpiUnused: "SIN USUARIOS",
    adoptionTopNote: (cap, n) => `${cap} tiene la mayor audiencia: ${n} personas abrieron sus apps.`,
    adoptionUnusedNote: (caps) => `Nadie abrio las apps de ${caps}. El dato puede estar recolectandose, pero nadie actua sobre el.`,
    adoptionAllUsed: "Todas las capacidades tienen al menos un usuario activo.",
    trend: "TENDENCIA",
    checksOkShort: (n) => `${n} checks aprobados - ninguna accion necesaria.`,
    ptsOverall: (x) => `+${x}% en el score general`,
    unlockTag: "desbloquea el proximo nivel",
    nextStageTitle: "Camino a la Proxima Etapa",
    stageNow: (band, score) => `Etapa actual: ${band} (${score}/100 de Utilizacion)`,
    stageNext: (band, pts) => `Proxima etapa: ${band} - faltan ${pts}% de Utilizacion. Los checks Foundation pesan 60% de la formula: cierrelos primero.`,
    stageMax: "Etapa maxima alcanzada - el foco pasa a estandarizacion y verificacion continua.",
    winsImpact: (n, pts) => `Cerrar los ${n} logros rapidos de arriba agrega ~+${pts}% de cobertura general - el movimiento medible mas rapido hacia la proxima etapa.`,
    nextLevelTitle: "Como Alcanzar el Proximo Nivel",
    nlLine: (cur, next) => `${cur} ${FONT_AVAILABLE ? "→" : "->"} ${next}`,
    nlNeeds: (n) => `aprobar ${n} check${n > 1 ? "s" : ""} mas:`,
    nlMaxed: "Optimized - techo del modelo alcanzado, mantener monitoreo.",
    tierShort: { foundation: "FND", bestPractice: "BP", excellence: "EXC" },
    proxyNote: `${FONT_AVAILABLE ? "≈" : "~"} proxy: medido via metricas de servicio/topologia (Traces on Grail no habilitado).`,
    remediation: "Remediacion", docs: "Docs", queryLabel: "DQL",
    appendixTitle: "Apendice - Entorno y Ejecucion",
    hosts: "Hosts", services: "Servicios", apps: "Apps web", clusters: "Clusters K8s",
    recordsScanned: "registros escaneados", queriesOk: "queries OK",
    footer: (t, d) => `Dynatrace Atlas  |  ${t}  |  ${d}`,
    page: (i, n) => `Pagina ${i} / ${n}`,
    none: "Ninguno",
  },
};

/** One-line business value (strength) / risk (exposure) per capability. */
const BIZ: Record<string, Record<PersonaLang, { value: string; risk: string }>> = {
  "Infrastructure Observability": {
    en: { value: "Compute estate is visible end to end - capacity and incident triage are data-driven.", risk: "Blind spots in hosts/K8s mean outages are found by users, not by the platform." },
    pt: { value: "O parque computacional esta visivel ponta a ponta - capacidade e triagem guiadas por dados.", risk: "Pontos cegos em hosts/K8s fazem indisponibilidades serem descobertas por usuarios, nao pela plataforma." },
    es: { value: "El parque de computo es visible de punta a punta - capacidad y triage guiados por datos.", risk: "Puntos ciegos en hosts/K8s hacen que los usuarios descubran las caidas antes que la plataforma." },
  },
  "Application Observability": {
    en: { value: "Service performance and failures are traced automatically - MTTR drops with AI root cause.", risk: "Slow or failing transactions cannot be traced to a cause - every incident becomes a war room." },
    pt: { value: "Performance e falhas de servicos rastreadas automaticamente - MTTR cai com causa raiz por IA.", risk: "Transacoes lentas ou com erro nao chegam a uma causa - cada incidente vira war room." },
    es: { value: "Rendimiento y fallas de servicios trazados automaticamente - el MTTR baja con causa raiz por IA.", risk: "Transacciones lentas o con error no llegan a una causa - cada incidente se vuelve war room." },
  },
  "Digital Experience": {
    en: { value: "Real users and synthetics measure what customers actually feel - before they complain.", risk: "No visibility into what customers experience - churn and revenue impact go undetected." },
    pt: { value: "Usuarios reais e sinteticos medem o que o cliente sente - antes da reclamacao.", risk: "Sem visibilidade da experiencia do cliente - churn e impacto em receita passam despercebidos." },
    es: { value: "Usuarios reales y sinteticos miden lo que el cliente siente - antes de que reclame.", risk: "Sin visibilidad de la experiencia del cliente - churn e impacto en ingresos pasan inadvertidos." },
  },
  "Log Analytics": {
    en: { value: "Logs are centralized in Grail with entity/trace context - investigations take minutes.", risk: "Fragmented logs slow every investigation and hide the evidence audits require." },
    pt: { value: "Logs centralizados no Grail com contexto de entidade/trace - investigacoes em minutos.", risk: "Logs fragmentados atrasam toda investigacao e escondem evidencias exigidas em auditoria." },
    es: { value: "Logs centralizados en Grail con contexto de entidad/trace - investigaciones en minutos.", risk: "Logs fragmentados retrasan toda investigacion y ocultan la evidencia que exigen las auditorias." },
  },
  "Application Security": {
    en: { value: "Runtime vulnerabilities are detected where they run - prioritized by real exposure.", risk: "Vulnerabilities in production are invisible - exposure is unknown until an incident or audit." },
    pt: { value: "Vulnerabilidades detectadas em runtime, onde executam - priorizadas por exposicao real.", risk: "Vulnerabilidades em producao invisiveis - exposicao desconhecida ate um incidente ou auditoria." },
    es: { value: "Vulnerabilidades detectadas en runtime, donde ejecutan - priorizadas por exposicion real.", risk: "Vulnerabilidades en produccion invisibles - exposicion desconocida hasta un incidente o auditoria." },
  },
  "Threat Observability": {
    en: { value: "Threats are correlated with topology and problems - response starts with context.", risk: "Attack signals are scattered - detection and response depend on manual correlation." },
    pt: { value: "Ameacas correlacionadas com topologia e problemas - a resposta ja comeca com contexto.", risk: "Sinais de ataque dispersos - deteccao e resposta dependem de correlacao manual." },
    es: { value: "Amenazas correlacionadas con topologia y problemas - la respuesta empieza con contexto.", risk: "Senales de ataque dispersas - deteccion y respuesta dependen de correlacion manual." },
  },
  "AI Observability": {
    en: { value: "LLM usage, cost and errors are traced - AI features ship with production discipline.", risk: "AI features run without telemetry - cost overruns and silent failures surface too late." },
    pt: { value: "Uso, custo e erros de LLM rastreados - features de IA operam com disciplina de producao.", risk: "Features de IA sem telemetria - estouros de custo e falhas silenciosas aparecem tarde demais." },
    es: { value: "Uso, costo y errores de LLM trazados - las features de IA operan con disciplina de produccion.", risk: "Features de IA sin telemetria - sobrecostos y fallas silenciosas aparecen demasiado tarde." },
  },
  "Business Observability": {
    en: { value: "Business KPIs are tied to IT context - incidents are measured in revenue, not CPU.", risk: "IT and business speak different languages - impact of incidents on revenue is guesswork." },
    pt: { value: "KPIs de negocio ligados ao contexto de TI - incidentes medidos em receita, nao em CPU.", risk: "TI e negocio falam linguas diferentes - impacto de incidentes na receita e achismo." },
    es: { value: "KPIs de negocio ligados al contexto de TI - incidentes medidos en ingresos, no en CPU.", risk: "TI y negocio hablan idiomas distintos - el impacto de incidentes en ingresos es especulacion." },
  },
  "Software Delivery": {
    en: { value: "Releases carry deployment context - quality gates catch regressions before customers do.", risk: "Deployments are invisible to observability - release regressions are found in production." },
    pt: { value: "Releases com contexto de deployment - quality gates pegam regressoes antes do cliente.", risk: "Deployments invisiveis para a observabilidade - regressoes de release sao achadas em producao." },
    es: { value: "Releases con contexto de deployment - los quality gates atrapan regresiones antes que el cliente.", risk: "Deployments invisibles para la observabilidad - las regresiones se descubren en produccion." },
  },
};

/** Which team owns each capability's improvements. The assessment has no
 *  tenant ownership data (that lives in Settings > Ownership), so this is
 *  the standard role split every platform team recognises — used to group
 *  the plan by TEAM instead of by date. */
const CAP_TEAM: Record<string, Record<PersonaLang, string>> = {
  "Infrastructure Observability": { en: "Platform / Infrastructure", pt: "Plataforma / Infraestrutura", es: "Plataforma / Infraestructura" },
  "Application Observability":    { en: "Application / Dev teams",   pt: "Times de Aplicacao / Dev",    es: "Equipos de Aplicacion / Dev" },
  "Digital Experience":           { en: "Frontend / Digital Experience", pt: "Frontend / Experiencia Digital", es: "Frontend / Experiencia Digital" },
  "Log Analytics":                { en: "Platform / Observability",  pt: "Plataforma / Observabilidade", es: "Plataforma / Observabilidad" },
  "Application Security":         { en: "Security / AppSec",         pt: "Seguranca / AppSec",          es: "Seguridad / AppSec" },
  "Threat Observability":         { en: "Security Operations",       pt: "Operacoes de Seguranca",      es: "Operaciones de Seguridad" },
  "AI Observability":             { en: "AI / ML Engineering",       pt: "Engenharia de IA / ML",       es: "Ingenieria de IA / ML" },
  "Business Observability":       { en: "Business / Data teams",     pt: "Times de Negocio / Dados",    es: "Equipos de Negocio / Datos" },
  "Software Delivery":            { en: "SRE / Release Engineering", pt: "SRE / Engenharia de Release", es: "SRE / Ingenieria de Release" },
};

const teamFor = (capName: string, lang: PersonaLang): string =>
  CAP_TEAM[capName]?.[lang] ?? capName;

/* ── data helpers ─────────────────────────────────────────────────── */

const hexToRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16),
];

/** Lowest numeric bar in a thresholds string — the operative pass bar. */
function lowestThreshold(thresholds: string): number {
  const nums = (thresholds.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  return nums.length ? Math.min(...nums) : 50;
}

const clean = (s: string) => {
  // When the Noto Sans subset is available the PDF can render ≥ → ≈ directly;
  // strip them to ASCII only as a fallback for WinAnsi Helvetica.
  let r = s.replace(/[""]/g, '"').replace(/·/g, "-");
  if (!FONT_AVAILABLE) r = r.replace(/≥/g, ">=").replace(/→/g, "->").replace(/≈/g, "~");
  return r;
};
const stripPct = (label: string) => label.replace(/\s*\(%\)\s*$/, "");

interface FailingCheck {
  cap: string; capColor: string; cr: PersonaCriterion; th: number; gap: number;
}

function failingChecks(caps: PersonaCapability[]): FailingCheck[] {
  return caps.flatMap(cap =>
    cap.criteriaResults
      .filter(cr => cr.points === 0 && !cr.error)
      .map(cr => {
        const th = lowestThreshold(cr.thresholds);
        return { cap: cap.name, capColor: cap.color, cr, th, gap: Math.max(0, th - cr.value) };
      }),
  ).sort((a, b) => a.gap - b.gap);
}

/** The minimal, cheapest set of checks that unlocks the capability's next
 *  utilization level. Mirrors useCoverageData's level ladder:
 *    L0 Not Adopted -> L1 Foundation   fPct >= 0.5
 *    L1 -> L2 Operational              fPct = 1.0 and bPct >= 0.5
 *    L2 -> L3 Optimized                bPct = 1.0 and ePct >= 0.5
 *  Checks are picked smallest-gap-first inside each required tier. */
function nextLevelPlan(cap: PersonaCapability): { current: string; next: string | null; needed: { cr: PersonaCriterion; th: number; gap: number }[] } {
  const m = cap.utilization;
  const fPct = m.foundation.total ? m.foundation.passed / m.foundation.total : 1;
  const bPct = m.bestPractice.total ? m.bestPractice.passed / m.bestPractice.total : 1;
  const ePct = m.excellence.total ? m.excellence.passed / m.excellence.total : 1;
  let level: 0 | 1 | 2 | 3 = 0;
  if (fPct >= 0.5) level = 1;
  if (fPct >= 1 && bPct >= 0.5) level = 2;
  if (fPct >= 1 && bPct >= 1 && ePct >= 0.5) level = 3;

  const failsIn = (tier: PersonaCriterion["tier"]) =>
    cap.criteriaResults
      .filter(cr => cr.tier === tier && !cr.error && cr.points === 0)
      .map(cr => {
        const th = lowestThreshold(cr.thresholds);
        return { cr, th, gap: Math.max(0, th - cr.value) };
      })
      .sort((a, b) => a.gap - b.gap);

  const needed: { cr: PersonaCriterion; th: number; gap: number }[] = [];
  const take = (tier: PersonaCriterion["tier"], n: number) => {
    if (n > 0) needed.push(...failsIn(tier).slice(0, n));
  };

  const labels = ["Not Adopted", "Foundation", "Operational", "Optimized"];
  if (level === 0) {
    take("foundation", Math.ceil(m.foundation.total * 0.5) - m.foundation.passed);
  } else if (level === 1) {
    take("foundation", m.foundation.total - m.foundation.passed);
    take("bestPractice", Math.ceil(m.bestPractice.total * 0.5) - m.bestPractice.passed);
  } else if (level === 2) {
    take("bestPractice", m.bestPractice.total - m.bestPractice.passed);
    take("excellence", Math.ceil(m.excellence.total * 0.5) - m.excellence.passed);
  } else {
    return { current: labels[3], next: null, needed: [] };
  }
  return { current: labels[level], next: labels[level + 1], needed };
}

/* ── main entry ───────────────────────────────────────────────────── */

/** Build the document without saving — separated so tests/preview harnesses
 *  can render the PDF outside a browser (jsPDF works in Node; the radar
 *  canvas render degrades gracefully when `document` is unavailable). */
export function buildPersonaReport(
  persona: ReportPersona,
  input: PersonaReportInput,
  lang: PersonaLang = "en",
  custom?: CustomReportOptions,
): jsPDF | null {
  const { capabilities, totalScore, overallUtilizationLevel, tenant, date, stats, entityCounts, history } = input;
  if (capabilities.length === 0) return null;
  const T = STRINGS[lang];

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const BODY_FONT = registerPdfFonts(pdf);
  const W = 210, H = 297, M = 15, CW = W - 2 * M;
  let y = 0;

  // Design tokens — clean white professional theme
  const BG: [number,number,number]       = [255, 255, 255];   // page white
  const SURF: [number,number,number]     = [246, 248, 253];   // card / alt-row tint
  const SURF2: [number,number,number]    = [228, 233, 245];   // table header, dividers
  const BLUE: [number,number,number]     = [0, 100, 210];     // Dynatrace brand blue
  const BLUE_DIM: [number,number,number] = [75, 125, 190];    // muted blue accents
  const TEAL: [number,number,number]     = [0, 148, 115];     // recommendation / pass
  const TXT1: [number,number,number]     = [18, 24, 45];      // headlines
  const TXT2: [number,number,number]     = [62, 74, 105];     // body text
  const TXT3: [number,number,number]     = [132, 145, 172];   // labels, captions
  const BORDER: [number,number,number]   = [205, 214, 228];   // gridlines on white

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
    const runMeta = `${tenant}  ·  ${date || ""}`;
    pdf.text(runMeta, W / 2, 7.5, { align: "center" });
  };
  const ensureSpace = (need: number) => {
    if (y + need > H - 16) { pdf.addPage(); paintBg(); addRunningHeader(); y = 16; }
  };
  const sectionHeader = (title: string, _rgb?: [number, number, number]) => {
    ensureSpace(20);
    // Left accent bar
    pdf.setFillColor(...BLUE);
    pdf.rect(M, y - 3, 3, 11, "F");
    // Subtle surface background
    pdf.setFillColor(...SURF);
    pdf.rect(M + 3, y - 3, CW - 3, 11, "F");
    pdf.setFontSize(10); pdf.setFont("helvetica", "bold");
    pdf.setTextColor(...TXT1);
    pdf.text(clean(title), M + 10, y + 4.5);
    y += 15;
  };
  const bodyText = (text: string, size = 8.5, color: [number, number, number] = TXT2, indent = 0, maxW = CW - indent) => {
    pdf.setFontSize(size); pdf.setFont(BODY_FONT, "normal");
    pdf.setTextColor(color[0], color[1], color[2]);
    const lines = pdf.splitTextToSize(clean(text), maxW);
    for (const ln of lines) {
      ensureSpace(5);
      pdf.text(ln, M + indent, y);
      y += size * 0.5;
    }
  };

  const header = (personaTitle: string) => {
    paintBg();

    // ── Hero band (top 58mm) ──
    const HERO_H = 58;
    pdf.setFillColor(...BLUE);                          // brand-blue hero band
    pdf.rect(0, 0, W, HERO_H, "F");

    // Left accent stripe (full hero height)
    pdf.setFillColor(...TEAL);                          // teal left accent
    pdf.rect(0, 0, 5, HERO_H, "F");

    // Decorative diagonal lines (right side of hero) — subtle on blue
    pdf.setDrawColor(20, 118, 232); pdf.setLineWidth(0.25);
    for (let i = 0; i < 6; i++) {
      const ox = W - 55 + i * 10;
      pdf.line(ox, 0, ox + HERO_H * 0.55, HERO_H);
    }
    pdf.setLineWidth(0.2);

    // ATLAS wordmark
    pdf.setFontSize(34); pdf.setFont("helvetica", "bold");
    pdf.setTextColor(255, 255, 255);
    pdf.text("ATLAS", M + 4, 28);

    // Tagline
    pdf.setFontSize(7.5); pdf.setFont("helvetica", "normal");
    pdf.setTextColor(200, 225, 255);                    // light on blue hero
    pdf.text("Tenant Intelligence Platform  ·  by Dynatrace", M + 4, 38);

    // Thin separator line below wordmark
    pdf.setDrawColor(255, 255, 255); pdf.setLineWidth(0.6);   // white separator on blue
    pdf.line(M + 4, 43, M + 4 + 80, 43);
    pdf.setLineWidth(0.2);

    // Report type label (upper right of hero band)
    pdf.setFontSize(7); pdf.setFont("helvetica", "bold");
    pdf.setTextColor(200, 225, 255);                    // light on blue hero
    pdf.text("REPORT TYPE", W - M, 28, { align: "right" });
    pdf.setFontSize(12); pdf.setFont("helvetica", "bold");
    pdf.setTextColor(255, 255, 255);                    // white title on blue hero
    pdf.text(clean(personaTitle), W - M, 38, { align: "right" });

    // ── Tenant / date strip ──
    y = HERO_H + 12;
    pdf.setFontSize(9); pdf.setFont(BODY_FONT, "normal");
    pdf.setTextColor(...TXT2);
    pdf.text(`${tenant}  ·  ${date || new Date().toLocaleDateString()}`, M + 4, y);
    y += 14;
  };

  const kpiRow = (metrics: { value: string; label: string; color: [number, number, number] }[]) => {
    const gap = 5;
    const bw = (CW - (metrics.length - 1) * gap) / metrics.length;
    const bh = 28;
    metrics.forEach((m, i) => {
      const x = M + i * (bw + gap);
      // Card background
      pdf.setFillColor(...SURF);
      pdf.roundedRect(x, y, bw, bh, 3, 3, "F");
      // Top coloured stripe
      pdf.setFillColor(...m.color);
      pdf.roundedRect(x, y, bw, 3.5, 3, 3, "F");
      pdf.rect(x, y + 1.5, bw, 2, "F"); // fill in the rounded bottom of stripe
      // Value — large bold number
      pdf.setFontSize(20); pdf.setFont("helvetica", "bold");
      pdf.setTextColor(...m.color);
      pdf.text(m.value, x + bw / 2, y + 18, { align: "center" });
      // Label
      pdf.setFontSize(5.5); pdf.setFont("helvetica", "bold");
      pdf.setTextColor(...TXT3);
      pdf.text(m.label.toUpperCase(), x + bw / 2, y + 24, { align: "center" });
    });
    y += bh + 10;
  };

  const bullet = (text: string, color: [number, number, number] = TXT2) => {
    ensureSpace(6);
    pdf.setFillColor(...TEAL);
    pdf.circle(M + 1.5, y - 1.2, 0.9, "F");
    bodyText(text, 8.5, color, 6);
    y += 1.5;
  };

  // Silence unused variable warning — SURF2 is available for future use
  void SURF2;

  /* ── chart primitives (pure jsPDF vectors) ─────────────────────── */

  /** Mini bar with a pass-threshold tick. Scale is fixed 0-100. */
  const gapBar = (x: number, w: number, value: number, th: number, color: [number, number, number]) => {
    const bh = 2.6;
    pdf.setFillColor(215, 220, 232);                    // light track on white bg
    pdf.roundedRect(x, y - bh + 0.6, w, bh, 0.8, 0.8, "F");
    const v = Math.min(100, Math.max(0, value));
    if (v > 0) {
      pdf.setFillColor(color[0], color[1], color[2]);
      pdf.roundedRect(x, y - bh + 0.6, Math.max(1.2, w * v / 100), bh, 0.8, 0.8, "F");
    }
    const tx = x + w * Math.min(100, th) / 100;
    pdf.setDrawColor(255, 200, 90); pdf.setLineWidth(0.5);
    pdf.line(tx, y - bh - 0.6, tx, y + 1.4);
    pdf.setLineWidth(0.2);
  };

  /** Grouped horizontal bars: coverage vs utilization per capability. */
  const covVsMatChart = () => {
    // legend
    ensureSpace(8);
    pdf.setFontSize(6); pdf.setFont(BODY_FONT, "normal");
    pdf.setFillColor(80, 180, 255); pdf.rect(M, y - 2.4, 3, 2.4, "F");
    pdf.setTextColor(...TXT2);
    pdf.text(T.legCoverage, M + 4.5, y);
    pdf.setFillColor(180, 130, 255); pdf.rect(M + 30, y - 2.4, 3, 2.4, "F");
    pdf.text(T.legUtilization, M + 34.5, y);
    y += 5;
    const nameW = 60, valW = 12;
    const bx = M + nameW, bw = CW - nameW - valW;
    for (const cap of [...capabilities].sort((a, b) => b.score - a.score)) {
      ensureSpace(10);
      pdf.setFontSize(7); pdf.setFont("helvetica", "bold");
      pdf.setTextColor(...TXT2);
      pdf.text(clean(cap.name), M, y + 2.6);
      // gridlines
      pdf.setDrawColor(...BORDER); pdf.setLineWidth(0.15);
      for (const g of [25, 50, 75, 100]) pdf.line(bx + bw * g / 100, y - 1, bx + bw * g / 100, y + 6.2);
      // coverage bar
      pdf.setFillColor(215, 220, 232); pdf.rect(bx, y, bw, 2.4, "F");
      pdf.setFillColor(80, 180, 255);
      if (cap.score > 0) pdf.rect(bx, y, Math.max(1, bw * cap.score / 100), 2.4, "F");
      // utilization bar
      pdf.setFillColor(215, 220, 232); pdf.rect(bx, y + 3, bw, 2.4, "F");
      pdf.setFillColor(180, 130, 255);
      if (cap.utilization.utilizationScore > 0) pdf.rect(bx, y + 3, Math.max(1, bw * cap.utilization.utilizationScore / 100), 2.4, "F");
      pdf.setFontSize(6.5); pdf.setFont(BODY_FONT, "normal");
      pdf.setTextColor(80, 180, 255);
      pdf.text(`${cap.score}%`, bx + bw + 2, y + 2.2);
      pdf.setTextColor(180, 130, 255);
      pdf.text(`${cap.utilization.utilizationScore}`, bx + bw + 2, y + 5.4);
      y += 9;
    }
    y += 2;
  };

  /** Line chart of totalScore over saved snapshots. */
  const evolutionChart = (points: { label: string; value: number }[]) => {
    const gh = 32;
    ensureSpace(gh + 14);
    const gx = M + 8, gw = CW - 12;
    // y gridlines + labels
    pdf.setFontSize(5.5); pdf.setFont(BODY_FONT, "normal");
    for (const g of [0, 25, 50, 75, 100]) {
      const yy = y + gh - gh * g / 100;
      pdf.setDrawColor(...BORDER); pdf.setLineWidth(0.15);
      pdf.line(gx, yy, gx + gw, yy);
      pdf.setTextColor(...TXT2);
      pdf.text(`${g}`, gx - 2, yy + 1, { align: "right" });
    }
    const n = points.length;
    const px = (i: number) => gx + (n === 1 ? gw / 2 : (gw / (n - 1)) * i);
    const py = (v: number) => y + gh - gh * Math.min(100, Math.max(0, v)) / 100;
    // line
    pdf.setDrawColor(80, 180, 255); pdf.setLineWidth(0.7);
    for (let i = 1; i < n; i++) pdf.line(px(i - 1), py(points[i - 1].value), px(i), py(points[i].value));
    // dots + value labels + x labels
    for (let i = 0; i < n; i++) {
      pdf.setFillColor(80, 180, 255);
      pdf.circle(px(i), py(points[i].value), 0.9, "F");
      pdf.setFontSize(5.5); pdf.setTextColor(...BLUE);
      pdf.text(`${points[i].value}`, px(i), py(points[i].value) - 2, { align: "center" });
      if (n <= 8 || i % 2 === 0 || i === n - 1) {
        pdf.setTextColor(...TXT2);
        pdf.text(points[i].label, px(i), y + gh + 3.5, { align: "center" });
      }
    }
    pdf.setLineWidth(0.2);
    y += gh + 8;
  };

  /** Stacked FND/BP/EXC bar: width proportional to tier size, solid = passed. */
  const tierStackedBar = (x: number, w: number, cap: PersonaCapability) => {
    const m = cap.utilization;
    const tiers: { label: string; passed: number; total: number; color: [number, number, number] }[] = [
      { label: T.tierShort.foundation, ...m.foundation, color: [80, 180, 255] },
      { label: T.tierShort.bestPractice, ...m.bestPractice, color: [180, 130, 255] },
      { label: T.tierShort.excellence, ...m.excellence, color: [120, 230, 180] },
    ];
    const totalN = tiers.reduce((s, t) => s + t.total, 0) || 1;
    let cx = x;
    for (const t of tiers) {
      const tw = (t.total / totalN) * w;
      if (tw <= 0) continue;
      // dim background = total, solid = passed
      // Pastel tint: 20% colour + 80% white — works on a white page
      pdf.setFillColor(Math.round(t.color[0] * 0.2 + 204), Math.round(t.color[1] * 0.2 + 204), Math.round(t.color[2] * 0.2 + 204));
      pdf.rect(cx, y, tw - 0.6, 3, "F");
      const pw = t.total > 0 ? (t.passed / t.total) * (tw - 0.6) : 0;
      pdf.setFillColor(t.color[0], t.color[1], t.color[2]);
      if (pw > 0) pdf.rect(cx, y, pw, 3, "F");
      pdf.setFontSize(5); pdf.setTextColor(...TXT2);
      pdf.text(`${t.label} ${t.passed}/${t.total}`, cx, y + 6);
      cx += tw;
    }
    y += 8;
  };

  /** Proportional OK/GAP/ERR strip with counts. */
  const statusStrip = (x: number, w: number, ok: number, gap: number, err: number) => {
    const total = ok + gap + err || 1;
    const seg: { n: number; color: [number, number, number] }[] = [
      { n: ok, color: [100, 220, 160] }, { n: gap, color: [255, 170, 90] }, { n: err, color: [255, 120, 120] },
    ];
    let cx = x;
    for (const s of seg) {
      if (s.n <= 0) continue;
      const sw = (s.n / total) * w;
      pdf.setFillColor(s.color[0], s.color[1], s.color[2]);
      pdf.rect(cx, y - 2.6, sw - 0.4, 3.2, "F");
      if (sw > 6) {
        pdf.setFontSize(5.5); pdf.setFont("helvetica", "bold");
        pdf.setTextColor(10, 12, 26);
        pdf.text(`${s.n}`, cx + sw / 2, y - 0.2, { align: "center" });
      }
      cx += sw;
    }
  };

  const ec = entityCounts;
  const totalCriteria = capabilities.reduce((s, c) => s + c.criteriaResults.length, 0);
  const passedCriteria = capabilities.reduce((s, c) => s + c.criteriaResults.filter(cr => !cr.error && cr.points > 0).length, 0);
  const failing = failingChecks(capabilities);
  const anyProxied = capabilities.some(c => c.criteriaResults.some(cr => cr.proxied));
  const sortedByScore = [...capabilities].sort((a, b) => b.score - a.score);

  const tierTotals = capabilities.reduce(
    (acc, c) => {
      acc.f.passed += c.utilization.foundation.passed; acc.f.total += c.utilization.foundation.total;
      acc.b.passed += c.utilization.bestPractice.passed; acc.b.total += c.utilization.bestPractice.total;
      acc.e.passed += c.utilization.excellence.passed; acc.e.total += c.utilization.excellence.total;
      return acc;
    },
    { f: { passed: 0, total: 0 }, b: { passed: 0, total: 0 }, e: { passed: 0, total: 0 } },
  );
  const pct = (p: number, t: number) => (t > 0 ? Math.round((p / t) * 100) : 0);

  const historyPoints = (history ?? [])
    .slice()
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .slice(-12)
    .map(h => ({ label: h.timestamp.slice(5, 10), value: h.totalScore }));

  const bestCap = sortedByScore[0];
  const worstCap = sortedByScore[sortedByScore.length - 1];

  /* ── composable section renderers — personas are fixed compositions
     of these; "custom" renders the user-chosen subset ── */

  const kpiOverview = () => {
    const entTotal = ec ? ec.hosts + ec.services + ec.applications + ec.k8sClusters : 0;
    const delta = historyPoints.length >= 2
      ? historyPoints[historyPoints.length - 1].value - historyPoints[0].value
      : null;
    kpiRow([
      { value: `${totalScore}%`, label: T.coverage, color: [80, 180, 255] },
      { value: `${overallUtilizationLevel}/100`, label: T.utilization, color: [180, 130, 255] },
      // People on the platform sits with the headline numbers when we have
      // it — the coverage/utilization pair says nothing about audience.
      ...(input.adoption
        ? [{ value: `${input.adoption.totalUsers}`, label: T.adoptionKpiTotal, color: [120, 200, 255] as [number, number, number] }]
        : []),
      delta !== null
        ? { value: `${delta >= 0 ? "+" : ""}${delta}%`, label: T.trend, color: delta >= 0 ? [100, 220, 160] as [number, number, number] : [255, 140, 120] as [number, number, number] }
        : { value: entTotal >= 1000 ? `${(entTotal / 1000).toFixed(1)}K` : `${entTotal}`, label: T.entitiesMonitored, color: [255, 180, 80] as [number, number, number] },
    ]);
  };

  const kpiTactical = () => {
    kpiRow([
      { value: `${totalScore}%`, label: T.coverage, color: [80, 180, 255] },
      { value: `${overallUtilizationLevel}/100`, label: T.utilization, color: [180, 130, 255] },
      { value: `${failing.length}`, label: "GAPS", color: [255, 140, 120] },
    ]);
  };

  const secProxyNote = () => {
    if (anyProxied) { y += 2; bodyText(T.proxyNote, 7, [200, 170, 90]); }
  };

  const secPosture = () => {
    sectionHeader(T.postureTitle);
    // The app's signature chart — the Coverage x Utilization dual radar exactly
    // as rendered on the Executive Summary screen (same canvas code).
    try {
      const radar = renderRadarToDataURL(
        capabilities.map(c => ({
          name: c.name,
          coverage: c.score,
          utilization: c.utilization.utilizationScore,
          color: c.color,
        })),
        760, { darkBg: true, format: "jpeg" },
      );
      if (radar) {
        const iw = 156, ih = Math.round(156 / 1.35);
        ensureSpace(ih + 4);
        pdf.addImage(radar, "JPEG", (W - iw) / 2, y - 2, iw, ih);
        y += ih + 2;
      }
    } catch { /* canvas unavailable — skip radar, the verdict stands alone */ }
    const activated = capabilities.filter(c => c.score > 0).length;
    const verdict = totalScore >= 60 ? T.verdictStrong : activated >= capabilities.length / 2 ? T.verdictMixed : T.verdictEarly;
    bodyText(verdict, 9, TXT2);
    // Stage in one breath — no ladder mechanics, just where we are and
    // how far the next stage is.
    const boundariesP = [20, 40, 60, 80];
    const bandNamesP = ["N/A", "Low", "Moderate", "Good", "Excellent"];
    const curIdxP = boundariesP.filter(b => overallUtilizationLevel >= b).length;
    bodyText(T.stageNow(bandNamesP[curIdxP], overallUtilizationLevel), 8.5, TXT2);
    if (curIdxP < 4) bodyText(T.stageNext(bandNamesP[curIdxP + 1], boundariesP[curIdxP] - overallUtilizationLevel), 8.5, TXT2);
    y += 5;
  };

  const secCovVsUtilization = () => {
    sectionHeader(T.covVsUtilTitle);
    // The app's Capability Map (Coverage x Utilization bubble chart) — same
    // canvas renderer as the Executive Summary screen. Falls back to the
    // grouped bars when canvas is unavailable (offline harness).
    let embedded = false;
    try {
      const scatter = renderScatterToDataURL(
        capabilities.map(c => ({ name: c.name, x: c.score, y: c.utilization.utilizationScore, color: c.color })),
        1200, { darkBg: true, format: "jpeg" },
      );
      if (scatter) {
        const iw = 150, ih = Math.round(150 * scatterAspectRatio(capabilities.length, 1200));
        ensureSpace(ih + 4);
        pdf.addImage(scatter, "JPEG", (W - iw) / 2, y - 2, iw, ih);
        y += ih + 2;
        embedded = true;
      }
    } catch { /* canvas unavailable */ }
    if (!embedded) covVsMatChart();
    bodyText(T.covVsUtilNote, 8, TXT2);
    y += 4;
  };

  // Pass rate by tier — evidence for the Utilization story
  const secTierPass = () => {
    sectionHeader(T.tierPassTitle);
    const tierRows: { label: string; passed: number; total: number; color: [number, number, number] }[] = [
      { label: "Foundation", ...tierTotals.f, color: [80, 180, 255] },
      { label: "Best Practice", ...tierTotals.b, color: [180, 130, 255] },
      { label: "Excellence", ...tierTotals.e, color: [120, 230, 180] },
    ];
    for (const t of tierRows) {
      ensureSpace(8);
      const p = pct(t.passed, t.total);
      pdf.setFontSize(7.5); pdf.setFont("helvetica", "bold");
      pdf.setTextColor(...TXT2);
      pdf.text(t.label, M, y + 3);
      const bx = M + 40, bw = CW - 40 - 26;
      pdf.setFillColor(215, 220, 232); pdf.roundedRect(bx, y, bw, 4, 1, 1, "F");
      pdf.setFillColor(t.color[0], t.color[1], t.color[2]);
      if (p > 0) pdf.roundedRect(bx, y, Math.max(2, bw * p / 100), 4, 1, 1, "F");
      pdf.setFontSize(7.5); pdf.setTextColor(t.color[0], t.color[1], t.color[2]);
      pdf.text(`${p}%  (${t.passed}/${t.total})`, bx + bw + 3, y + 3.4);
      y += 7.5;
    }
    bodyText(T.tierNote(pct(tierTotals.f.passed, tierTotals.f.total), pct(tierTotals.b.passed, tierTotals.b.total), pct(tierTotals.e.passed, tierTotals.e.total)), 8, TXT2);
    y += 4;
  };

  /** Adoption — who opens the apps that serve each capability. Reported
   *  next to coverage so "the data is there" and "someone looks at it"
   *  can be read together. Never feeds a score. */
  const secAdoption = () => {
    const ad = input.adoption;
    if (!ad || Object.keys(ad.byCapability).length === 0) return;
    sectionHeader(T.adoptionTitle);
    bodyText(T.adoptionIntro(ad.windowDays, ad.totalUsers), 8.5, TXT2);
    y += 3;


    // ── People first: the headline numbers before the per-capability bars.
    const ranked = [...capabilities]
      .map(c => ({ name: c.name, users: ad.byCapability[c.name]?.users ?? 0 }))
      .sort((a, b) => b.users - a.users);
    const topCap = ranked[0];
    const unused = ranked.filter(r => r.users === 0);
    kpiRow([
      { value: `${ad.totalUsers}`, label: T.adoptionKpiTotal, color: [120, 200, 255] },
      { value: topCap ? `${topCap.users}` : "0", label: T.adoptionKpiTop, color: [100, 220, 160] },
      { value: `${unused.length}`, label: T.adoptionKpiUnused, color: unused.length > 0 ? [255, 140, 120] : [100, 220, 160] },
    ]);
    if (topCap && topCap.users > 0) bodyText(T.adoptionTopNote(clean(topCap.name), topCap.users), 8, TEAL);
    if (unused.length > 0) {
      bodyText(T.adoptionUnusedNote(unused.map(u => clean(u.name)).join(", ")), 8, [180, 40, 40]);
    } else {
      bodyText(T.adoptionAllUsed, 8, TEAL);
    }
    y += 4;
    const nameW = 62, valW = 40;
    const bx = M + nameW, bw = CW - nameW - valW;
    for (const cap of [...capabilities].sort((a, b) => (ad.byCapability[b.name]?.users ?? 0) - (ad.byCapability[a.name]?.users ?? 0))) {
      ensureSpace(9);
      const entry = ad.byCapability[cap.name];
      const users = entry?.users ?? 0;
      const rgb = hexToRgb(cap.color);
      pdf.setFontSize(7); pdf.setFont("helvetica", "bold");
      pdf.setTextColor(...TXT2);
      pdf.text(clean(cap.name), M, y + 3);
      // Grid + users bar
      pdf.setDrawColor(...BORDER); pdf.setLineWidth(0.15);
      for (const q of [25, 50, 75, 100]) pdf.line(bx + bw * q / 100, y - 0.5, bx + bw * q / 100, y + 5);
      pdf.setFillColor(215, 220, 232);
      pdf.roundedRect(bx, y, bw, 4, 1, 1, "F");
      // Bar length = share of the whole active population, so a long bar
      // always means "most people", never "most among these nine".
      const rate = entry?.rate ?? 0;
      if (users > 0) {
        pdf.setFillColor(rgb[0], rgb[1], rgb[2]);
        pdf.roundedRect(bx, y, Math.max(2, bw * (rate / 100)), 4, 1, 1, "F");
      }
      // The people count is the point of this section — print it bold and
      // a size up so it reads before the bar does.
      if (users > 0) {
        pdf.setFontSize(9); pdf.setFont("helvetica", "bold");
        pdf.setTextColor(...TEAL);
        pdf.text(T.adoptionShare(users, ad.totalUsers, rate), bx + bw + 3, y + 3.6);
      } else {
        pdf.setFontSize(8); pdf.setFont("helvetica", "bold");
        pdf.setTextColor(255, 140, 120);
        pdf.text(T.adoptionNobody, bx + bw + 3, y + 3.6);
      }
      y += 6;
      // The apps behind the number, so the reader can act on it.
      const appList = (entry?.apps ?? []).slice(0, 3)
        .map(a => `${a.appId} (${a.users})`).join(", ");
      if (appList) {
        pdf.setFontSize(6); pdf.setTextColor(...TXT2);
        pdf.text(clean(appList).slice(0, 120), bx, y + 1.5);
        y += 3.5;
      }
      y += 1.5;
    }
    y += 2;
    bodyText(T.adoptionNote, 7, TXT2);
    y += 3;
  };

  const secEvolution = () => {
    if (historyPoints.length < 2) return;
    sectionHeader(T.evolutionTitle);
    evolutionChart(historyPoints);
    const delta = historyPoints[historyPoints.length - 1].value - historyPoints[0].value;
    bodyText(T.evolutionNote(historyPoints.length, `${delta >= 0 ? "+" : ""}${delta}`), 8, TXT2);
    y += 4;
  };

  const secStrengths = () => {
    sectionHeader(T.strengthsTitle, [18, 80, 55]);
    for (const cap of sortedByScore.filter(c => c.score >= 60).slice(0, 3)) {
      const line = BIZ[cap.name]?.[lang]?.value;
      const passed = cap.criteriaResults.filter(cr => !cr.error && cr.points > 0).length;
      bullet(`${cap.name} (${cap.score}% - ${T.checksOk(passed, cap.criteriaResults.length)}): ${line ?? ""}`, TEAL);
    }
    y += 4;

    sectionHeader(T.exposuresTitle, [110, 40, 45]);
    for (const cap of [...capabilities].sort((a, b) => a.score - b.score).slice(0, 3)) {
      const line = BIZ[cap.name]?.[lang]?.risk;
      const failingN = cap.criteriaResults.filter(cr => !cr.error && cr.points === 0).length;
      const scoreTxt = cap.score === 0 ? T.notActivated : `${cap.score}% - ${T.failingChecksOf(failingN, cap.criteriaResults.length)}`;
      bullet(`${cap.name} (${scoreTxt}): ${line ?? ""}`, [180, 40, 40]);
    }
    y += 4;
  };

  const secQuickWins = () => {
    sectionHeader(T.quickWinsTitle, [120, 90, 20]);
    bodyText(T.quickWinsIntro, 8.5);
    y += 3;
    for (const f of failing.slice(0, 5)) {
      ensureSpace(9);
      pdf.setFontSize(7.5); pdf.setFont("helvetica", "bold");
      pdf.setTextColor(...TXT1);
      pdf.text(`${stripPct(clean(f.cr.label))}  (${f.cap})`, M, y);
      pdf.setFont(BODY_FONT, "normal"); pdf.setFontSize(7);
      pdf.setTextColor(160, 110, 0);
      pdf.text(`${f.cr.value}% vs ${FONT_AVAILABLE ? "≥" : ">="}${f.th}%  -  ${T.gapPts(f.gap.toFixed(0))}`, W - M, y, { align: "right" });
      y += 4;
      gapBar(M, CW - 40, f.cr.value, f.th, hexToRgb(f.capColor));
      y += 4.5;
    }
    y += 3;
  };

  // ── Path to the next stage — Utilization ladder + quantified moves ──
  const secNextStage = () => {
    sectionHeader(T.nextStageTitle, [40, 60, 120]);
    {
      ensureSpace(18);
      const bands: { from: number; to: number; label: string; color: [number, number, number] }[] = [
        { from: 0, to: 20, label: "N/A", color: [90, 95, 125] },
        { from: 20, to: 40, label: "Low", color: [255, 140, 120] },
        { from: 40, to: 60, label: "Moderate", color: [255, 200, 90] },
        { from: 60, to: 80, label: "Good", color: [120, 200, 255] },
        { from: 80, to: 100, label: "Excellent", color: [100, 220, 160] },
      ];
      const bx = M, bw = CW;
      for (const b of bands) {
        const x0 = bx + bw * b.from / 100, x1 = bx + bw * b.to / 100;
        const reached = overallUtilizationLevel >= b.from;
        // Reached = full colour; unreached = 20% colour + 80% white (pastel tint on white page)
        pdf.setFillColor(
          Math.round(b.color[0] * (reached ? 1 : 0.2) + (reached ? 0 : 204)),
          Math.round(b.color[1] * (reached ? 1 : 0.2) + (reached ? 0 : 204)),
          Math.round(b.color[2] * (reached ? 1 : 0.2) + (reached ? 0 : 204)),
        );
        pdf.rect(x0, y + 3, x1 - x0 - 0.8, 4, "F");
        pdf.setFontSize(5.5); pdf.setFont(BODY_FONT, "normal");
        pdf.setTextColor(...TXT2);
        pdf.text(b.label, (x0 + x1) / 2, y + 10.5, { align: "center" });
      }
      // marker at current overall utilization
      const mx = bx + bw * Math.min(100, overallUtilizationLevel) / 100;
      pdf.setDrawColor(255, 255, 255); pdf.setLineWidth(0.6);
      pdf.line(mx, y + 1.4, mx, y + 8.6);
      pdf.setFontSize(6.5); pdf.setFont("helvetica", "bold");
      pdf.setTextColor(...TXT1);                        // dark label on white page (above the band)
      pdf.text(`${overallUtilizationLevel}`, mx, y, { align: "center" });
      pdf.setLineWidth(0.2);
      y += 15;
    }
    const boundaries = [20, 40, 60, 80];
    const bandNames = ["N/A", "Low", "Moderate", "Good", "Excellent"];
    const curIdx = boundaries.filter(b => overallUtilizationLevel >= b).length;
    bodyText(T.stageNow(bandNames[curIdx], overallUtilizationLevel), 9, TXT2);
    if (curIdx < 4) {
      bodyText(T.stageNext(bandNames[curIdx + 1], boundaries[curIdx] - overallUtilizationLevel), 8.5, TXT2);
    } else {
      bodyText(T.stageMax, 8.5, TXT2);
    }
    const topWins = failing.slice(0, 5);
    if (topWins.length > 0) {
      const winsPts = topWins.reduce((s, f) => {
        const capN = capabilities.find(c => c.name === f.cap)?.criteriaResults.length ?? 1;
        return s + (100 / capN) / capabilities.length;
      }, 0);
      bodyText(T.winsImpact(topWins.length, winsPts.toFixed(1)), 8.5, TXT2);
    }
    y += 5;
  };

  const secNextQuarter = () => {
    sectionHeader(T.nextQuarterTitle);
    // Move 1 — quick wins, with the expected score movement up front.
    const topWinsQ = failing.slice(0, 5);
    if (topWinsQ.length > 0) {
      const winsPtsQ = topWinsQ.reduce((s, f) => {
        const capN = capabilities.find(c => c.name === f.cap)?.criteriaResults.length ?? 1;
        return s + (100 / capN) / capabilities.length;
      }, 0);
      bullet(T.winsImpact(topWinsQ.length, winsPtsQ.toFixed(1)), TXT2);
    }
    // Move 2 — unlock Foundation gates (they cap everything above).
    const gateCaps = capabilities.filter(c => c.utilization.foundation.passed < c.utilization.foundation.total);
    if (gateCaps.length > 0) bullet(T.recGates(gateCaps.slice(0, 3).map(c => c.name).join(", ")));
    // Move 3 — lift the weakest pillar, framed by its business risk.
    if (worstCap && worstCap.score < 90) {
      const risk = BIZ[worstCap.name]?.[lang]?.risk;
      bullet(`${T.recLift(worstCap.name, worstCap.score)}${risk ? ` ${risk}` : ""}`);
    }
  };

  // Gap landscape — the evidence chart for the whole plan
  const secGapLandscape = () => {
    sectionHeader(T.gapLandscapeTitle, [120, 90, 20]);
    bodyText(T.gapLandscapeIntro, 8);
    y += 3;
    for (const f of failing.slice(0, 10)) {
      ensureSpace(8);
      pdf.setFontSize(6.5); pdf.setFont(BODY_FONT, "normal");
      pdf.setTextColor(...TXT2);
      const lbl = `${stripPct(clean(f.cr.label))} (${f.cap})`;
      pdf.text(lbl.length > 62 ? lbl.slice(0, 62) + "..." : lbl, M, y);
      y += 3.4;
      gapBar(M, CW - 44, f.cr.value, f.th, hexToRgb(f.capColor));
      pdf.setFontSize(6.5); pdf.setTextColor(160, 110, 0);
      pdf.text(`${f.cr.value}% ${FONT_AVAILABLE ? "→" : "->"} ${f.th}%`, W - M, y - 0.4, { align: "right" });
      y += 3.6;
    }
    y += 3;
  };

  /** Improvements grouped by the team that owns them, each team ordered by
   *  the score it can add. No dates anywhere — sequencing inside a team is
   *  by tier (Foundation first) and by effort, never by calendar. */
  const teamGroups = () => {
    const byTeam = new Map<string, { team: string; color: string; items: FailingCheck[]; pts: number }>();
    for (const f of failing) {
      const team = teamFor(f.cap, lang);
      const capN = capabilities.find(c => c.name === f.cap)?.criteriaResults.length ?? 1;
      const gain = (100 / capN) / capabilities.length;
      const g = byTeam.get(team) ?? { team, color: f.capColor, items: [], pts: 0 };
      g.items.push(f);
      g.pts += gain;
      byTeam.set(team, g);
    }
    // Foundation first inside each team, then smallest gap (cheapest win).
    const tierRank = (t: PersonaCriterion["tier"]) => (t === "foundation" ? 0 : t === "bestPractice" ? 1 : 2);
    for (const g of byTeam.values()) {
      g.items.sort((a, b) => tierRank(a.cr.tier) - tierRank(b.cr.tier) || a.gap - b.gap);
    }
    return [...byTeam.values()].sort((a, b) => b.pts - a.pts);
  };

  /** Horizontal bars: how many coverage points each team can add. This is
   *  the chart that makes the "who improves what" theme legible at a glance. */
  const secImpactByTeam = () => {
    const groups = teamGroups();
    if (groups.length === 0) { bodyText(T.none, 8); return; }
    sectionHeader(T.impactChartTitle);
    const maxPts = Math.max(...groups.map(g => g.pts), 0.1);
    const nameW = 62, valW = 26;
    const bx = M + nameW, bw = CW - nameW - valW;
    for (const g of groups) {
      ensureSpace(9);
      const rgb = hexToRgb(g.color);
      pdf.setFontSize(7); pdf.setFont("helvetica", "bold");
      pdf.setTextColor(...TXT2);
      pdf.text(clean(g.team).slice(0, 34), M, y + 3);
      pdf.setDrawColor(...BORDER); pdf.setLineWidth(0.15);
      for (const q of [25, 50, 75, 100]) pdf.line(bx + bw * q / 100, y - 0.5, bx + bw * q / 100, y + 5);
      pdf.setFillColor(215, 220, 232);
      pdf.roundedRect(bx, y, bw, 4, 1, 1, "F");
      pdf.setFillColor(rgb[0], rgb[1], rgb[2]);
      pdf.roundedRect(bx, y, Math.max(2, bw * (g.pts / maxPts)), 4, 1, 1, "F");
      pdf.setFontSize(7); pdf.setFont(BODY_FONT, "normal");
      pdf.setTextColor(...TEAL);
      pdf.text(`+${g.pts.toFixed(1)}%`, bx + bw + 3, y + 3.4);
      pdf.setTextColor(...TXT2);
      pdf.text(`${g.items.length}`, W - M, y + 3.4, { align: "right" });
      y += 7.5;
    }
    y += 2;
    bodyText(T.impactChartNote, 8, TXT2);
    y += 3;
  };

  const secPlan = () => {
    sectionHeader(T.planTitle);
    bodyText(T.planIntro, 8, TXT2);
    y += 3;
    const unlockIds = new Map<string, Set<string>>();
    for (const cap of capabilities) {
      unlockIds.set(cap.name, new Set(nextLevelPlan(cap).needed.map(n => n.cr.id)));
    }
    const groups = teamGroups();
    if (groups.length === 0) { bodyText(T.none, 8); return; }
    for (const g of groups) {
      // Team header — owner of everything listed under it.
      ensureSpace(12);
      const rgb = hexToRgb(g.color);
      pdf.setFontSize(9.5); pdf.setFont("helvetica", "bold");
      pdf.setTextColor(rgb[0], rgb[1], rgb[2]);
      pdf.text(clean(T.teamLabel(g.team)), M, y);
      pdf.setFontSize(7); pdf.setFont(BODY_FONT, "normal");
      pdf.setTextColor(...TXT2);
      pdf.text(T.teamSummary(g.items.length, g.pts.toFixed(1)), W - M, y, { align: "right" });
      y += 5;
      for (const f of g.items.slice(0, 6)) {
        ensureSpace(12);
        pdf.setDrawColor(...BORDER); pdf.setLineWidth(0.3);
        pdf.rect(M + 1, y - 2.8, 3, 3);
        // Plain-language improvement (remediation first sentence).
        const rem = CRITERION_REMEDIATION[f.cr.id]?.action;
        const action = rem ? rem.split(". ")[0] : stripPct(clean(f.cr.label));
        pdf.setFontSize(8); pdf.setFont("helvetica", "bold");
        pdf.setTextColor(...TXT1);
        const actLines = pdf.splitTextToSize(clean(action), CW - 12).slice(0, 2);
        pdf.text(actLines, M + 7, y);
        y += actLines.length * 3.9;
        // Effort replaces the old date tag: gap size is the honest proxy.
        const effort = f.gap <= 10 ? T.effortLow : f.gap <= 40 ? T.effortMed : T.effortHigh;
        const capN = capabilities.find(c => c.name === f.cap)?.criteriaResults.length ?? 1;
        const gain = ((100 / capN) / capabilities.length).toFixed(1);
        const unlock = unlockIds.get(f.cap)?.has(f.cr.id) ? `  -  ${T.unlockTag}` : "";
        pdf.setFont(BODY_FONT, "normal"); pdf.setFontSize(7);
        pdf.setTextColor(...TXT2);
        pdf.text(`${T.currentVsTarget(`${f.cr.value}%`, `${FONT_AVAILABLE ? "≥" : ">="}${f.th}%`)}  (${T.tierShort[f.cr.tier]}, ${effort})`, M + 7, y);
        pdf.setTextColor(...TEAL);
        pdf.text(`${T.ptsOverall(gain)}${unlock}`, W - M, y, { align: "right" });
        y += 3.4;
        gapBar(M + 7, 90, f.cr.value, f.th, rgb);
        y += 5;
      }
      y += 3;
    }
  };

  const secBoard = () => {
    sectionHeader(T.boardTitle);
    // One line per capability: score bar, level, open-gap count. The
    // detail lives in the prioritized plan — no repetition here.
    for (const cap of [...capabilities].sort((a, b) => a.score - b.score)) {
      ensureSpace(9);
      const rgb = hexToRgb(cap.color);
      const gaps = failing.filter(f => f.cap === cap.name).length;
      pdf.setFontSize(7.5); pdf.setFont("helvetica", "bold");
      pdf.setTextColor(rgb[0], rgb[1], rgb[2]);
      pdf.text(clean(cap.name), M, y + 3);
      const bx = M + 62, bw = CW - 62 - 62;
      pdf.setFillColor(215, 220, 232);
      pdf.roundedRect(bx, y, bw, 4, 1, 1, "F");
      pdf.setFillColor(rgb[0], rgb[1], rgb[2]);
      if (cap.score > 0) pdf.roundedRect(bx, y, Math.max(2, bw * cap.score / 100), 4, 1, 1, "F");
      pdf.setFontSize(7); pdf.setFont(BODY_FONT, "normal");
      pdf.setTextColor(...TXT2);
      pdf.text(`${cap.score}%  -  ${clean(cap.utilization.levelLabel)}  -  ${gaps} gaps`, bx + bw + 3, y + 3.4);
      y += 7.5;
    }
    y += 3;
  };

  // ── Per-capability next-level unlock: the minimal cheapest check set ──
  const secNextLevel = () => {
    sectionHeader(T.nextLevelTitle, [40, 60, 120]);
    for (const cap of [...capabilities].sort((a, b) => a.score - b.score)) {
      const plan = nextLevelPlan(cap);
      const rgb = hexToRgb(cap.color);
      ensureSpace(9);
      pdf.setFontSize(8); pdf.setFont("helvetica", "bold");
      pdf.setTextColor(rgb[0], rgb[1], rgb[2]);
      pdf.text(clean(cap.name), M, y);
      pdf.setFont(BODY_FONT, "normal"); pdf.setFontSize(7.5);
      pdf.setTextColor(...TXT2);
      pdf.text(plan.next ? T.nlLine(plan.current, plan.next) : T.nlMaxed, W - M, y, { align: "right" });
      y += 4;
      if (plan.next && plan.needed.length > 0) {
        bodyText(T.nlNeeds(plan.needed.length), 7, TXT2, 4);
        for (const n of plan.needed.slice(0, 5)) {
          bodyText(`- ${stripPct(clean(n.cr.label))}: ${n.cr.value}% vs ${FONT_AVAILABLE ? "≥" : ">="}${n.th}% (${T.tierShort[n.cr.tier]})`, 7, TXT2, 8);
        }
        if (plan.needed.length > 5) bodyText(`+${plan.needed.length - 5}...`, 7, TXT2, 8);
      }
      y += 3;
    }
    y += 2;
  };

  const secCadence = () => {
    sectionHeader(T.cadenceTitle);
    for (const item of T.cadenceItems) bullet(item);
  };

  // Status distribution — one strip per capability
  const secStatusDist = () => {
    sectionHeader(T.statusDistTitle);
    for (const cap of capabilities) {
      ensureSpace(7);
      const ok = cap.criteriaResults.filter(cr => !cr.error && cr.points > 0).length;
      const gapN = cap.criteriaResults.filter(cr => !cr.error && cr.points === 0).length;
      const errN = cap.criteriaResults.filter(cr => cr.error).length;
      pdf.setFontSize(7); pdf.setFont("helvetica", "bold");
      pdf.setTextColor(...TXT2);
      pdf.text(clean(cap.name), M, y);
      statusStrip(M + 62, CW - 62 - 14, ok, gapN, errN);
      pdf.setFontSize(6.5); pdf.setFont(BODY_FONT, "normal");
      pdf.setTextColor(...TXT2);
      pdf.text(`${ok + gapN + errN}`, W - M, y, { align: "right" });
      y += 6;
    }
    y += 4;
  };

  const secTechDetail = () => {
    for (const cap of capabilities) {
      const rgb = hexToRgb(cap.color);
      sectionHeader(`${cap.name}  -  ${cap.score}%  -  ${cap.utilization.levelLabel}`, [Math.round(rgb[0] * 0.35), Math.round(rgb[1] * 0.35), Math.round(rgb[2] * 0.35)]);
      tierStackedBar(M, CW, cap);
      // Next-level unlock: the exact minimal check set, cheapest first.
      const plan = nextLevelPlan(cap);
      if (!plan.next) {
        bodyText(T.nlMaxed, 7, TEAL);
      } else if (plan.needed.length > 0) {
        bodyText(`${T.nextLevelTitle}: ${T.nlLine(plan.current, plan.next)} - ${T.nlNeeds(plan.needed.length)}`, 7.5, BLUE);
        for (const n of plan.needed) {
          bodyText(`- ${n.cr.id}  ${stripPct(clean(n.cr.label))}: ${n.cr.value}% vs ${FONT_AVAILABLE ? "≥" : ">="}${n.th}% (${T.tierShort[n.cr.tier]})`, 6.5, TXT2, 4);
        }
      }
      y += 2;

      // Passing checks collapse into one line — attention goes to gaps.
      const passingN = cap.criteriaResults.filter(cr => !cr.error && cr.points > 0).length;
      if (passingN > 0) bodyText(`${T.statusOk}: ${T.checksOkShort(passingN)}`, 7.5, TEAL);
      y += 1;

      for (const cr of cap.criteriaResults) {
        const passed = !cr.error && cr.points > 0;
        if (passed) continue;
        const th = lowestThreshold(cr.thresholds);
        ensureSpace(7);
        const badge: [string, [number, number, number]] = cr.error
          ? [T.statusErr, [255, 120, 120]]
          : [T.statusGap, [255, 170, 90]];
        // Badge: use NotoSans when available so ✓/✗ symbols render; fall back to
        // helvetica-bold for WinAnsi (OK/GAP text is fine in bold).
        pdf.setFontSize(6.5);
        pdf.setFont(FONT_AVAILABLE ? "NotoSans" : "helvetica", FONT_AVAILABLE ? "normal" : "bold");
        pdf.setTextColor(badge[1][0], badge[1][1], badge[1][2]);
        pdf.text(badge[0], M, y);
        pdf.setFontSize(8); pdf.setTextColor(...TXT1);
        const proxyTag = cr.proxied ? `  [${FONT_AVAILABLE ? "≈" : "~"} proxy]` : "";
        pdf.setFont(BODY_FONT, "normal");
        pdf.text(`${stripPct(clean(cr.label))}${proxyTag}`, M + 10, y);
        pdf.setFont(BODY_FONT, "normal");
        pdf.setFontSize(7); pdf.setTextColor(...TXT2);
        pdf.text(`${cr.value}${cr.isRatio ? "%" : ""}  vs  ${clean(cr.thresholds)}   ${T.tierShort[cr.tier]}`, W - M, y, { align: "right" });
        y += 4;

        if (!passed && !cr.error) {
          // gap bar as visual evidence of distance to the pass bar
          if (cr.isRatio) {
            ensureSpace(5);
            gapBar(M + 10, 80, cr.value, th, rgb);
            y += 4;
          }
          const rem = CRITERION_REMEDIATION[cr.id];
          if (rem) {
            bodyText(`${T.remediation}: ${rem.action}`, 7, TEAL, 10);
            if (rem.docLink) bodyText(`${T.docs}: ${rem.docLink}`, 6, [110, 140, 200], 10);
          }
          pdf.setFont("courier", "normal"); pdf.setFontSize(5.5);
          pdf.setTextColor(...BLUE_DIM);
          const qLines = pdf.splitTextToSize(`${T.queryLabel}: ${clean(cr.query)}`, CW - 10);
          for (const ln of qLines.slice(0, 6)) {
            ensureSpace(3.2);
            pdf.text(ln, M + 10, y);
            y += 2.8;
          }
          pdf.setFont(BODY_FONT, "normal");
          y += 2;
        } else {
          y += 0.5;
        }
      }
      y += 4;
    }
  };

  const secAppendix = () => {
    sectionHeader(T.appendixTitle);
    if (ec) {
      bodyText(`${T.hosts}: ${ec.hosts.toLocaleString()}   ${T.services}: ${ec.services.toLocaleString()}   ${T.apps}: ${ec.applications.toLocaleString()}   ${T.clusters}: ${ec.k8sClusters.toLocaleString()}`, 8);
    }
    if (stats) {
      bodyText(`${stats.scannedRecords.toLocaleString()} ${T.recordsScanned}  -  ${stats.succeeded}/${stats.total} ${T.queriesOk}`, 8);
    }
  };

  /* ═════════ persona dispatch — fixed compositions + custom ═════════ */

  // Lean compositions: every persona answers its ONE question fast.
  // Executive (1 page): where are we, what is at risk, what 3 moves next.
  // Tactical: one prioritized action list + a one-line board.
  // Technical: gaps only, with remediation + DQL; passing = one line.
  // The dropped sections (charts, ladder, landscape, unlocks…) remain
  // available a la carte through the Custom report builder.
  if (persona === "executive") {
    header(T.execTitle);
    kpiOverview();
    secPosture();            // chart: capability radar (same as the app)
    secCovVsUtilization();   // chart: capability map (same as the app)
    secAdoption();           // chart: who actually uses each capability
    secImpactByTeam();       // chart: where improvement pays off, by team
    secStrengths();
    secNextQuarter();
    secProxyNote();
  }

  if (persona === "tactical") {
    header(T.tactTitle);
    kpiTactical();
    secImpactByTeam();       // chart: which team can add the most points
    secGapLandscape();       // chart: checks closest to their threshold
    secPlan();               // improvements grouped by owning team
    secBoard();
    secCadence();
    secProxyNote();
  }

  if (persona === "technical") {
    header(T.techTitle);
    bodyText(T.techIntro, 9, TXT2);
    if (anyProxied) bodyText(T.proxyNote, 7.5, [200, 170, 90]);
    y += 4;
    secStatusDist();         // chart: OK/GAP/ERR strips per capability
    secCovVsUtilization();   // chart: capability map
    secTechDetail();
    secAppendix();
  }

  if (persona === "custom") {
    const title = custom?.title?.trim() ? custom.title.trim() : T.customTitle;
    header(title);
    kpiOverview();
    const renderers: Record<ReportSectionId, () => void> = {
      posture: secPosture,
      covVsUtilization: secCovVsUtilization,
      tierPass: secTierPass,
      evolution: secEvolution,
      adoption: secAdoption,
      strengths: secStrengths,
      quickWins: secQuickWins,
      nextStage: secNextStage,
      nextQuarter: secNextQuarter,
      gapLandscape: secGapLandscape,
      impactByTeam: secImpactByTeam,
      plan: secPlan,
      board: secBoard,
      nextLevel: secNextLevel,
      cadence: secCadence,
      statusDist: secStatusDist,
      techDetail: secTechDetail,
      appendix: secAppendix,
    };
    const chosen = new Set(custom?.sections ?? []);
    for (const id of SECTION_ORDER) if (chosen.has(id)) renderers[id]();
    secProxyNote();
  }

  /* ── footer on every page ── */
  const pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i);
    // Footer bar
    pdf.setFillColor(...SURF);
    pdf.rect(0, H - 10, W, 10, "F");
    pdf.setFillColor(...BLUE);
    pdf.rect(0, H - 10, W, 1, "F");
    pdf.setFontSize(5.5); pdf.setFont(BODY_FONT, "normal");
    pdf.setTextColor(...TXT3);
    pdf.text(`ATLAS  ·  ${T.footer(tenant ?? "", date ?? "")}`, M, H - 4);
    pdf.text(T.page(i, pages), W - M, H - 4, { align: "right" });
  }

  return pdf;
}

/** Browser entry point: build and trigger the download. */
export function generatePersonaReport(
  persona: ReportPersona,
  input: PersonaReportInput,
  lang: PersonaLang = "en",
  custom?: CustomReportOptions,
): void {
  const pdf = buildPersonaReport(persona, input, lang, custom);
  if (!pdf) return;
  pdf.save(`atlas-${persona}-report-${input.tenant}-${input.date || "latest"}-${lang}.pdf`);
}
