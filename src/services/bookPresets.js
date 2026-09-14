/**
 * BookPresets — Comprehensive generation profiles, design systems, and page formats (master spec §10, §13, §18, §22, §32).
 * 15 Book Types, 10 Professional Design Systems, and 5 Page Size Presets.
 * Design systems and page sizes live in the shared ThemeLayer (public/themeLayer.js)
 * so the server exporters and the browser live preview consume the SAME data objects.
 */

const themeLayer = require('../../public/themeLayer');

const BOOK_TYPES = {
  academic: {
    id: 'academic',
    label: 'Academic Book',
    blurb: 'Formal citations, structured sections, abstract, literature review style.',
    tone: 'formal scholarly',
    readingLevel: 'graduate researcher',
    depthHint: 'rigorous 700-1100 words per topic, evidence-weighted',
    exampleDensity: 'studies, data, and primary sources as evidence',
    definitionDensity: 'precise scholarly definitions with full context',
    include: { examples: true, exercises: false, summary: true, glossary: true, sources: true, index: true, toc: true, citations: true },
    structure: 'formal sections with abstract, methodology context, citations inline, discussion, references',
    blueprintAddendum: 'Plan as a formal academic monograph: each chapter opens with an abstract, body uses structured argumentation, closes with conclusions and references. Include cross-references between chapters.',
    draftAddendum: 'Write academic prose: use formal register, attribute claims to sources with citations, present evidence before conclusions, use hedged language for uncertain claims ("evidence suggests...").'
  },
  textbook: {
    id: 'textbook',
    label: 'Textbook',
    blurb: 'Definition-forward chapters with worked examples and exercise boxes.',
    tone: 'educational and precise',
    readingLevel: 'undergraduate',
    depthHint: 'thorough explanations, 700-1100 words per major topic',
    exampleDensity: 'one worked example per major concept',
    definitionDensity: 'every technical term defined at first use',
    include: { examples: true, exercises: true, summary: true, glossary: true, sources: true, index: true, toc: true, citations: true },
    structure: 'chapters open with learning objectives, close with a summary; sections build from foundations to applications',
    blueprintAddendum: 'Plan as a rigorous textbook: order chapters so prerequisites always precede dependents. Include chapter purposes and flag where worked examples belong.',
    draftAddendum: 'Write textbook prose: define terms formally at first use, give one worked example per major idea, end each chapter with a short "Summary" paragraph and practical exercises.'
  },
  research: {
    id: 'research',
    label: 'Research Book',
    blurb: 'Literature-review synthesis with methodology comparisons and source attribution.',
    tone: 'scholarly, evidence-weighted',
    readingLevel: 'graduate researcher',
    depthHint: 'analytical 600-900 words per theme, comparisons foregrounded',
    exampleDensity: 'studies, empirical findings, and primary data as evidence',
    definitionDensity: 'precise scholarly definitions',
    include: { examples: false, exercises: false, summary: true, glossary: true, sources: true, index: true, toc: true, citations: true },
    structure: 'thematic chapters comparing claims across documents, disagreements and methodology explicit',
    blueprintAddendum: 'Plan thematic review chapters that compare what different sources claim and highlight empirical consensus vs divergence.',
    draftAddendum: 'Write literature-digest prose: attribute claims to sources inline with citations, compare positions explicitly.'
  },
  technical: {
    id: 'technical',
    label: 'Technical Book',
    blurb: 'Architecture diagrams, code/formula blocks, step-by-step implementation guides.',
    tone: 'pragmatic, engineering-focused',
    readingLevel: 'technical professional',
    depthHint: 'concise, concrete 500-850 words per topic with code/math snippets',
    exampleDensity: 'real-world architectures and implementation examples',
    definitionDensity: 'clear operational definitions of protocols, terms, and data models',
    include: { examples: true, exercises: false, summary: true, glossary: true, sources: true, index: true, toc: true, citations: true },
    structure: 'theory -> architectural model -> concrete procedures -> failure modes & edge cases',
    blueprintAddendum: 'Plan as a technical manual with clear input/output specifications, architectural flows, and procedure blocks.',
    draftAddendum: 'Write technical prose: prioritize clarity, include formula/code blocks where appropriate, provide structured step-by-step procedures.'
  },
  selfhelp: {
    id: 'selfhelp',
    label: 'Self-Help',
    blurb: 'Empowering tone, actionable takeaways, reflection prompts, and structured advice.',
    tone: 'inspiring, empathetic, actionable',
    readingLevel: 'general audience',
    depthHint: 'engaging 450-750 words per topic with stories and takeaways',
    exampleDensity: 'relatable scenarios, transformative anecdotes',
    definitionDensity: 'jargon-free everyday language',
    include: { examples: true, exercises: true, summary: true, glossary: false, sources: false, index: false, toc: true, citations: false },
    structure: 'hook -> personal obstacle -> psychological/practical framework -> actionable steps -> takeaway',
    blueprintAddendum: 'Plan around reader transformation: each chapter addresses a core challenge and delivers actionable tools.',
    draftAddendum: 'Write conversational, empowering prose. Open with relatable dilemmas, break advice into clear steps, include reflection exercises.'
  },
  business: {
    id: 'business',
    label: 'Business Book',
    blurb: 'Executive summaries, strategic frameworks, case studies, and ROI metrics.',
    tone: 'strategic, executive, results-driven',
    readingLevel: 'business leader',
    depthHint: 'scannable 500-800 words per section with callouts and frameworks',
    exampleDensity: 'industry case studies and commercial precedents',
    definitionDensity: 'business terminology defined in context of ROI',
    include: { examples: true, exercises: false, summary: true, glossary: true, sources: true, index: true, toc: true, citations: true },
    structure: 'market challenge -> strategic insight -> implementation framework -> case analysis -> executive summary',
    blueprintAddendum: 'Plan as an authoritative business strategy book with frameworks, key metrics, and strategic recommendations.',
    draftAddendum: 'Write executive prose: lead with bottom-line insights, structure with numbered frameworks, highlight strategic takeaways.'
  },
  biography: {
    id: 'biography',
    label: 'Biography',
    blurb: 'Chronological life arcs, primary quotes, pivotal moments, and character context.',
    tone: 'compelling narrative, historical fidelity',
    readingLevel: 'general reader',
    depthHint: 'vivid 600-950 words per chapter section',
    exampleDensity: 'first-person accounts and historical episodes',
    definitionDensity: 'historical/contextual explanations woven into prose',
    include: { examples: true, exercises: false, summary: false, glossary: false, sources: true, index: true, toc: true, citations: true },
    structure: 'chronological eras with thematic highlights, turning points, and reflective epilogue',
    blueprintAddendum: 'Plan biographical eras chronologically, identifying key turning points and influences.',
    draftAddendum: 'Write rich narrative prose: ground events in time and place, quote primary sources, capture motivation and conflict.'
  },
  novel: {
    id: 'novel',
    label: 'Novel',
    blurb: 'Flowing narrative, drop caps, named chapters, immersive pacing, minimal subheadings.',
    tone: 'literary narrative',
    readingLevel: 'general reader',
    depthHint: 'flowing 500-900 words per chapter section, narrative-driven',
    exampleDensity: 'woven naturally into the narrative',
    definitionDensity: 'terms explained contextually within the flow',
    include: { examples: true, exercises: false, summary: false, glossary: false, sources: false, index: false, toc: true, citations: false },
    structure: 'named chapters with literary openings, flowing paragraphs without subheadings, narrative arcs that carry the reader forward',
    blueprintAddendum: 'Plan chapters like a book: each chapter tells a complete story arc. Avoid subheadings. Create narrative tension and resolution within each chapter.',
    draftAddendum: 'Write in a literary style: open each chapter with a hook or scene-setting. Use flowing paragraphs without bullet points or definitions. Weave concepts into narrative. Avoid subheadings — let the prose carry the structure.'
  },
  guide: {
    id: 'guide',
    label: 'Practical Guide',
    blurb: 'How-to instructions, checklists, tool recommendations, and best practices.',
    tone: 'direct, helpful, advisory',
    readingLevel: 'general practitioner',
    depthHint: 'crisp 400-700 words per topic with actionable tips',
    exampleDensity: 'practical real-life walkthroughs',
    definitionDensity: 'plain explanations of necessary tools and terms',
    include: { examples: true, exercises: true, summary: true, glossary: true, sources: true, index: false, toc: true, citations: false },
    structure: 'overview -> prerequisite checklist -> step-by-step guide -> pro tips -> common pitfalls',
    blueprintAddendum: 'Plan as a comprehensive how-to guide with distinct sections for each practical skill.',
    draftAddendum: 'Write friendly, instructive prose: use bullet points for checklists, numbered steps for procedures, and highlight pro tips.'
  },
  manual: {
    id: 'manual',
    label: 'Instruction Manual',
    blurb: 'Standard operating procedures, safety warnings, and troubleshooting matrices.',
    tone: 'unambiguous, procedural, standardized',
    readingLevel: 'operator/technician',
    depthHint: 'compact 300-600 words per procedure with clear steps',
    exampleDensity: 'troubleshooting scenarios and diagnostic checklists',
    definitionDensity: 'standard terminology strictly formatted',
    include: { examples: false, exercises: false, summary: false, glossary: true, sources: true, index: true, toc: true, citations: false },
    structure: 'system overview -> safety protocol -> standard operation -> maintenance -> troubleshooting matrix',
    blueprintAddendum: 'Plan modular, numbered operating procedures with explicit warning flags.',
    draftAddendum: 'Write precise procedural text: number every step, highlight safety warnings, avoid ambiguous verbs.'
  },
  studyguide: {
    id: 'studyguide',
    label: 'Study Notes',
    blurb: 'Condensed, scannable revision material with recall prompts and key terms.',
    tone: 'crisp and directive',
    readingLevel: 'student revising for exams',
    depthHint: 'condensed 350-600 words per topic, bullets over prose',
    exampleDensity: 'only memory-anchoring examples',
    definitionDensity: 'key terms bolded with one-line definitions',
    include: { examples: true, exercises: true, summary: true, glossary: true, sources: false, index: false, toc: true, citations: false },
    structure: 'topic-per-section with "Key points" bullet blocks and quick recall questions',
    blueprintAddendum: 'Plan compact study notes: group topics into digestible units that each fit one sitting, ordered by typical course sequence.',
    draftAddendum: 'Write condensed study notes: lead each section with Key points bullets (bold key terms), keep prose minimal, add 2-3 recall questions per section.'
  },
  coursebook: {
    id: 'coursebook',
    label: 'Course Book',
    blurb: 'Module-based syllabus structure, weekly readings, discussions, and assignments.',
    tone: 'instructional, structured, pedagogical',
    readingLevel: 'college/university student',
    depthHint: 'structured 600-950 words per module with discussion prompts',
    exampleDensity: 'guided case studies and learning benchmarks',
    definitionDensity: 'formally highlighted glossary terms',
    include: { examples: true, exercises: true, summary: true, glossary: true, sources: true, index: true, toc: true, citations: true },
    structure: 'module overview -> foundational reading -> discussion questions -> seminar exercise -> further readings',
    blueprintAddendum: 'Plan as a 6-12 module course syllabus with progressive learning milestones.',
    draftAddendum: 'Write pedagogical content: open with learning objectives, include critical discussion questions, wrap with assigned exercises.'
  },
  children: {
    id: 'children',
    label: "Children's Book",
    blurb: 'Simple vocabulary, playful tone, short sentences, visual focal points, and moral themes.',
    tone: 'whimsical, engaging, simple, warm',
    readingLevel: 'young reader (ages 6-11)',
    depthHint: 'short 200-400 words per chapter with descriptive flair',
    exampleDensity: 'vibrant, imaginative situations',
    definitionDensity: 'simplified vocabulary with intuitive context',
    include: { examples: true, exercises: false, summary: false, glossary: false, sources: false, index: false, toc: true, citations: false },
    structure: 'short rhythmic chapters with lively dialogue and vivid story beats',
    blueprintAddendum: 'Plan short chapters centered on curiosity, wonder, and relatable adventures.',
    draftAddendum: 'Write playful, accessible prose: use vibrant sensory imagery, short snappy paragraphs, and engaging characters.'
  },
  reference: {
    id: 'reference',
    label: 'Reference Manual',
    blurb: 'Terse, lookup-friendly entries, tables, indices, and exhaustive definitions.',
    tone: 'neutral, encyclopedic',
    readingLevel: 'expert skimming for specifics',
    depthHint: 'dense 200-450 words per entry, tables and lists preferred',
    exampleDensity: 'minimal; only clarifying snippets',
    definitionDensity: 'every entry self-contained',
    include: { examples: false, exercises: false, summary: false, glossary: true, sources: true, index: true, toc: true, citations: true },
    structure: 'alphabetical-or-thematic entries, heavy use of tables and bullet lists',
    blueprintAddendum: 'Plan reference entries: one section per concept, each independently readable.',
    draftAddendum: 'Write terse reference entries: prefer tables and bullet lists, no transitions needed, each entry must stand alone.'
  },
  report: {
    id: 'report',
    label: 'Comprehensive Report',
    blurb: 'Data-driven analysis, findings summary, risk evaluations, and actionable recommendations.',
    tone: 'objective, analytical, authoritative',
    readingLevel: 'analyst / stakeholder',
    depthHint: 'rigorous 500-800 words per section with data tables and callouts',
    exampleDensity: 'metrics, benchmarks, and quantitative findings',
    definitionDensity: 'methodological parameters and KPI definitions',
    include: { examples: true, exercises: false, summary: true, glossary: true, sources: true, index: false, toc: true, citations: true },
    structure: 'executive summary -> key findings -> detailed evidence -> risk analysis -> strategic recommendations',
    blueprintAddendum: 'Plan as an authoritative research report with clear executive summaries and policy recommendations.',
    draftAddendum: 'Write analytical prose: emphasize data, use bullet lists for key findings, and formulate concrete recommendations.'
  },
  custom: {
    id: 'custom',
    label: 'Custom',
    blurb: 'Your own saved combination of options.',
    tone: 'neutral',
    readingLevel: 'general adult',
    depthHint: 'balanced 400-700 words per topic',
    exampleDensity: 'moderate',
    definitionDensity: 'define specialist terms',
    include: { examples: true, exercises: false, summary: true, glossary: true, sources: true, index: true, toc: true, citations: true },
    structure: '',
    blueprintAddendum: '',
    draftAddendum: '',
    isCustom: true
  }
};

const DESIGN_SYSTEMS = themeLayer.THEMES;
const PAGE_SIZES = themeLayer.PAGE_SIZES;

const PRESETS = BOOK_TYPES;
const DEFAULT_PRESET_ID = 'textbook';
const DEFAULT_DESIGN_ID = 'modern';
const DEFAULT_PAGE_SIZE_ID = 'trade_6x9';

function getPreset(id) {
  return BOOK_TYPES[id] || BOOK_TYPES[DEFAULT_PRESET_ID];
}

function getDesign(id) {
  return DESIGN_SYSTEMS[id] || DESIGN_SYSTEMS[DEFAULT_DESIGN_ID];
}

function getPageSize(id) {
  return PAGE_SIZES[id] || PAGE_SIZES[DEFAULT_PAGE_SIZE_ID];
}

function presetExists(id) {
  return Object.prototype.hasOwnProperty.call(BOOK_TYPES, id);
}

/** Validate a user-saved custom preset (stored client-side). */
function validateCustomPreset(input) {
  const base = BOOK_TYPES.custom;
  const out = { ...base, id: 'custom', isCustom: true };
  if (!input || typeof input !== 'object') return out;
  if (typeof input.label === 'string' && input.label.trim()) out.label = input.label.trim().slice(0, 40);
  const strFields = ['tone', 'readingLevel', 'depthHint', 'exampleDensity', 'definitionDensity', 'structure', 'blueprintAddendum', 'draftAddendum'];
  for (const f of strFields) {
    if (typeof input[f] === 'string') out[f] = input[f].slice(0, 500);
  }
  if (input.include && typeof input.include === 'object') {
    for (const k of Object.keys(out.include)) {
      if (typeof input.include[k] === 'boolean') out.include[k] = input.include[k];
    }
  }
  return out;
}

function describe() {
  return Object.values(BOOK_TYPES).map((p) => ({
    id: p.id,
    label: p.label,
    blurb: p.blurb,
    include: p.include
  }));
}

function describeBookTypes() {
  return describe();
}

function describeDesigns() {
  return Object.values(DESIGN_SYSTEMS);
}

function describePageSizes() {
  return Object.values(PAGE_SIZES);
}

module.exports = {
  PRESETS,
  BOOK_TYPES,
  DESIGN_SYSTEMS,
  PAGE_SIZES,
  getPreset,
  getDesign,
  getPageSize,
  presetExists,
  validateCustomPreset,
  describe,
  describeBookTypes,
  describeDesigns,
  describePageSizes,
  DEFAULT_PRESET_ID,
  DEFAULT_DESIGN_ID,
  DEFAULT_PAGE_SIZE_ID
};
