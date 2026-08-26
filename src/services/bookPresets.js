/**
 * BookPresets — configurable generation profiles (master spec §18, §22).
 * Five core presets per spec: Academic, Textbook, Novel, Minimalist, Visual.
 * Additional presets retained for flexibility.
 */

const PRESETS = {
  academic: {
    id: 'academic',
    label: 'Academic',
    blurb: 'Formal citations, structured sections, abstract, index.',
    tone: 'formal scholarly',
    readingLevel: 'graduate researcher',
    depthHint: 'rigorous 600-1000 words per topic, evidence-weighted',
    exampleDensity: 'studies, data, and primary sources as evidence',
    definitionDensity: 'precise scholarly definitions with context',
    include: { examples: true, exercises: false, summary: true, glossary: true, sources: true, index: true, toc: true },
    structure: 'formal sections with abstract, literature review style, footnotes, conclusion; citations inline',
    blueprintAddendum: 'Plan as a formal academic work: each chapter opens with an abstract, body uses structured argumentation, closes with conclusions and references. Include cross-references between chapters.',
    draftAddendum: 'Write academic prose: use formal register, attribute claims to sources, present evidence before conclusions, use hedged language for uncertain claims ("evidence suggests..."). Include a brief abstract per chapter.'
  },
  textbook: {
    id: 'textbook',
    label: 'Textbook',
    blurb: 'Definition-forward chapters with worked examples.',
    tone: 'educational and precise',
    readingLevel: 'undergraduate',
    depthHint: 'thorough explanations, 700-1100 words per major topic',
    exampleDensity: 'one worked example per major concept',
    definitionDensity: 'every technical term defined at first use',
    include: { examples: true, exercises: true, summary: true, glossary: true, sources: true, index: true, toc: true },
    structure: 'chapters open with learning objectives, close with a summary; sections build from foundations to applications',
    blueprintAddendum: 'Plan as a rigorous textbook: order chapters so prerequisites always precede dependents. Include chapter purposes and flag where worked examples belong.',
    draftAddendum: 'Write textbook prose: define terms formally at first use, give one worked example per major idea, end each chapter with a short "Summary" paragraph and optional exercises.'
  },
  novel: {
    id: 'novel',
    label: 'Novel',
    blurb: 'Flowing narrative, drop caps, named chapters, minimal headings.',
    tone: 'literary narrative',
    readingLevel: 'general reader',
    depthHint: 'flowing 500-900 words per chapter section, narrative-driven',
    exampleDensity: 'woven naturally into the narrative',
    definitionDensity: 'terms explained contextually within the flow',
    include: { examples: true, exercises: false, summary: false, glossary: false, sources: false, index: false, toc: true },
    structure: 'named chapters with literary openings, flowing paragraphs without subheadings, narrative arcs that carry the reader forward',
    blueprintAddendum: 'Plan chapters like a book: each chapter tells a complete story arc. Avoid subheadings. Create narrative tension and resolution within each chapter.',
    draftAddendum: 'Write in a literary style: open each chapter with a hook or scene-setting. Use flowing paragraphs without bullet points or definitions. Weave concepts into narrative. Avoid subheadings — let the prose carry the structure.'
  },
  minimalist: {
    id: 'minimalist',
    label: 'Minimalist',
    blurb: 'Clean, 65-character max width, no decorations, pure content.',
    tone: 'clean and direct',
    readingLevel: 'general adult',
    depthHint: 'concise 350-650 words per topic, no filler',
    exampleDensity: 'only when essential for understanding',
    definitionDensity: 'inline at point of use, no callout boxes',
    include: { examples: false, exercises: false, summary: false, glossary: false, sources: false, index: false, toc: true },
    structure: 'flat hierarchy, short paragraphs, generous whitespace, no decorative elements',
    blueprintAddendum: 'Plan lean chapters with flat structure: no subsections, no decorative elements, just clean prose organized by topic. Keep chapters short.',
    draftAddendum: 'Write minimal prose: short paragraphs (3-5 sentences max), no bullet lists, no definitions blocks, no warnings or callouts. Every sentence must earn its place. Clean transitions between ideas.'
  },
  visual: {
    id: 'visual',
    label: 'Visual',
    blurb: 'Color blocks, emoji icons, callouts, relationship diagrams.',
    tone: 'engaging and visual',
    readingLevel: 'visual learner',
    depthHint: 'bite-sized 300-500 word blocks with visual anchors',
    exampleDensity: 'illustrated examples with visual cues',
    definitionDensity: 'highlighted definition boxes',
    include: { examples: true, exercises: true, summary: true, glossary: true, sources: false, index: false, toc: true },
    structure: 'color-coded sections, emoji-prefixed headings, callout boxes for key concepts, visual relationship indicators',
    blueprintAddendum: 'Plan visually-rich chapters: group related concepts into color-coded sections, include callout boxes for key definitions, use emoji prefixes for section types.',
    draftAddendum: 'Write visually-engaging content: prefix headings with relevant emoji, use callout-style notes and warnings, include relationship indicators (arrows, "leads to", "contrasts with"). Short punchy paragraphs with visual breathing room.'
  },
  studyguide: {
    id: 'studyguide',
    label: 'Study Notes',
    blurb: 'Condensed, scannable revision material with recall prompts.',
    tone: 'crisp and directive',
    readingLevel: 'student revising for exams',
    depthHint: 'condensed 350-600 words per topic, bullets over prose',
    exampleDensity: 'only memory-anchoring examples',
    definitionDensity: 'key terms bolded with one-line definitions',
    include: { examples: true, exercises: false, summary: true, glossary: true, sources: false, index: false, toc: true },
    structure: 'topic-per-section with "Key points" bullet blocks and quick recall questions',
    blueprintAddendum: 'Plan compact study notes: group topics into digestible units that each fit one sitting, ordered by typical course sequence.',
    draftAddendum: 'Write condensed study notes: lead each section with Key points bullets (bold key terms), keep prose minimal, add 2-3 recall questions per section.'
  },
  examprep: {
    id: 'examprep',
    label: 'Exam Preparation',
    blurb: 'High-yield facts, pitfalls, mnemonics and practice questions.',
    tone: 'direct exam-coach energy',
    readingLevel: 'candidate preparing for a test',
    depthHint: 'high-yield 300-500 words per topic, priority markers',
    exampleDensity: 'exam-style question stems as examples',
    definitionDensity: 'definitions only where they are testable',
    include: { examples: true, exercises: true, summary: true, glossary: false, sources: false, index: false, toc: true },
    structure: 'units of related high-yield topics; each section ends with practice questions and pitfall warnings',
    blueprintAddendum: 'Plan by exam weight: put the most-tested material first inside each unit and mark which chapters are core vs optional.',
    draftAddendum: 'Write exam-focused content: mark HIGH-YIELD facts explicitly, add a "Common pitfalls" note block per section, finish with 3 practice Q&A pairs grounded strictly in the source material.'
  },
  beginner: {
    id: 'beginner',
    label: 'Beginner Guide',
    blurb: 'Plain-language journey assuming no prior knowledge.',
    tone: 'warm, encouraging, jargon-free',
    readingLevel: 'complete beginner',
    depthHint: 'gentle 400-650 words per topic with everyday analogies',
    exampleDensity: 'an analogy or everyday example for every abstraction',
    definitionDensity: 'technical terms introduced slowly with plain paraphrase',
    include: { examples: true, exercises: false, summary: true, glossary: true, sources: false, index: false, toc: true },
    structure: 'story-like progression from simplest to more advanced, recaps when returning to ideas',
    blueprintAddendum: 'Plan a gentle learning journey: start from the most concrete, familiar idea in the material and escalate gradually.',
    draftAddendum: 'Write for absolute beginners: prefer everyday analogies before technical phrasing, define any term the reader cannot be assumed to know, keep sentences short.'
  },
  handbook: {
    id: 'handbook',
    label: 'Professional Handbook',
    blurb: 'Practitioner reference with procedures and best practices.',
    tone: 'pragmatic senior-colleague',
    readingLevel: 'working professional',
    depthHint: 'actionable 400-700 words per topic, procedures over theory',
    exampleDensity: 'real-world scenarios over academic examples',
    definitionDensity: 'define only operational vocabulary',
    include: { examples: true, exercises: false, summary: false, glossary: true, sources: true, index: true, toc: true },
    structure: 'task-oriented chapters: what it is, when to use it, how to do it step by step, pitfalls',
    blueprintAddendum: 'Plan task-oriented chapters around what practitioners need to DO.',
    draftAddendum: 'Write practitioner prose: for every concept cover what/when/how, render procedures as numbered steps, call out pitfalls in warning-style notes.'
  },
  reference: {
    id: 'reference',
    label: 'Reference Manual',
    blurb: 'Terse, lookup-friendly entries and tables.',
    tone: 'neutral, encyclopedic',
    readingLevel: 'expert skimming for specifics',
    depthHint: 'dense 200-450 words per entry, tables and lists preferred',
    exampleDensity: 'minimal; only clarifying snippets',
    definitionDensity: 'every entry self-contained',
    include: { examples: false, exercises: false, summary: false, glossary: true, sources: true, index: true, toc: true },
    structure: 'alphabetical-or-thematic entries, heavy use of tables and bullet lists',
    blueprintAddendum: 'Plan reference entries: one section per concept, each independently readable.',
    draftAddendum: 'Write terse reference entries: prefer tables and bullet lists, no transitions needed, each entry must stand alone.'
  },
  tutorial: {
    id: 'tutorial',
    label: 'Tutorial',
    blurb: 'Learn-by-doing walkthroughs building one running project.',
    tone: 'friendly instructor',
    readingLevel: 'hands-on learner',
    depthHint: 'step-driven 500-800 words per lesson',
    exampleDensity: 'a continuous worked thread through all chapters',
    definitionDensity: 'explain exactly when first encountered mid-build',
    include: { examples: true, exercises: true, summary: true, glossary: false, sources: false, index: false, toc: true },
    structure: 'lessons that each produce visible progress; checkpoints recapping what was built',
    blueprintAddendum: 'Plan sequential lessons that build on each other.',
    draftAddendum: 'Write tutorial lessons: follow a learn-by-doing arc, number actionable steps, end each lesson with a checkpoint recap.'
  },
  research: {
    id: 'research',
    label: 'Research Digest',
    blurb: 'Literature-review synthesis with methodology awareness.',
    tone: 'scholarly, evidence-weighted',
    readingLevel: 'graduate researcher',
    depthHint: 'analytical 600-900 words per theme, comparisons foregrounded',
    exampleDensity: 'studies and findings as evidence',
    definitionDensity: 'precise scholarly definitions',
    include: { examples: false, exercises: false, summary: true, glossary: true, sources: true, index: true, toc: true },
    structure: 'thematic chapters comparing claims across documents, disagreements explicit',
    blueprintAddendum: 'Plan thematic review chapters that compare what different sources claim.',
    draftAddendum: 'Write literature-digest prose: attribute claims to sources inline, compare positions explicitly.'
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
    include: { examples: true, exercises: false, summary: true, glossary: true, sources: true, index: true, toc: true },
    structure: '',
    blueprintAddendum: '',
    draftAddendum: '',
    isCustom: true
  }
};

const DEFAULT_PRESET_ID = 'textbook';

function getPreset(id) {
  return PRESETS[id] || PRESETS[DEFAULT_PRESET_ID];
}

function presetExists(id) {
  return Object.prototype.hasOwnProperty.call(PRESETS, id);
}

/** Validate a user-saved custom preset (stored client-side). */
function validateCustomPreset(input) {
  const base = PRESETS.custom;
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
  return Object.values(PRESETS).map((p) => ({
    id: p.id,
    label: p.label,
    blurb: p.blurb,
    include: p.include
  }));
}

module.exports = { PRESETS, getPreset, presetExists, validateCustomPreset, describe, DEFAULT_PRESET_ID };
