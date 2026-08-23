const STYLES = {
  scholar: {
    label: 'The Scholar',
    icon: '🎓',
    blurb: 'Formal, evidence-heavy literature review',
    persona:
      'You write like a meticulous academic. Structure every note with: Abstract, Source Analysis (comparing what each source claims), Synthesis (unified explanation), Critical Notes (gaps and disagreements). Use precise terminology from the sources.',
    sections: ['Abstract', 'Source Analysis', 'Synthesis', 'Critical Notes']
  },
  builder: {
    label: 'The Builder',
    icon: '🔧',
    blurb: 'Practical step-by-step implementation guide',
    persona:
      'You write like a senior engineer mentoring a colleague. Be action-oriented: define the concept briefly, then focus on how to apply it. Include concrete steps, real-world analogies, common pitfalls, and end with a quick-reference summary.',
    sections: ['What it is', 'Why it matters', 'How to do it', 'Pitfalls', 'Cheat sheet']
  },
  storyteller: {
    label: 'The Storyteller',
    icon: '📖',
    blurb: 'Narrative, engaging knowledge journey',
    persona:
      'You write like a gifted science communicator. Open with a hook that shows why this matters, unfold the ideas as a connected narrative with vivid analogies, surface surprising findings as plot twists, and land on memorable takeaways.',
    sections: ['Hook', 'The Journey', 'Plot Twists', 'The Takeaway']
  },
  architect: {
    label: 'The Architect',
    icon: '🗺️',
    blurb: 'Structured maps, hierarchies and relationships',
    persona:
      'You think in systems. Present topics as structured hierarchies: concept trees, relationship tables, and decision flows. Show how pieces connect before diving into detail. Prefer diagrams-in-text (indented trees, markdown tables) over prose.',
    sections: ['Concept Map', 'Hierarchy', 'Relationships', 'Deep Dives']
  },
  minimalist: {
    label: 'The Minimalist',
    icon: '🪶',
    blurb: 'Clean scannable reference notes',
    persona:
      'You write ultra-concise reference notes. One idea per section, bullets only, bolded key terms, no filler words. Every line should earn its place.',
    sections: []
  }
};

const FORMATS = {
  book: {
    label: 'Long-Form Book',
    icon: '📚',
    directive:
      'Write flowing long-form prose in clear paragraphs with natural transitions between ideas. Use headings for major sections only.',
    polishable: true
  },
  cards: {
    label: 'Modular Cards',
    icon: '🗂️',
    directive:
      'Break the content into self-contained cards. Output one or more card blocks in EXACTLY this format:\nCARD\nFront: <a question or key term>\nBack: <the full explanation, grounded in sources>\nEach card must stand alone.',
    polishable: true
  },
  outline: {
    label: 'Hierarchical Outline',
    icon: '🌲',
    directive:
      'Output ONLY a nested bullet outline (markdown "-" bullets, up to 4 indent levels). Top level = main idea, deeper levels = supporting points and evidence. No paragraphs.',
    polishable: false
  },
  wiki: {
    label: 'Interactive Wiki',
    icon: '🔗',
    directive:
      'Write encyclopedic entries with dense cross-linking. When mentioning another major topic, wrap it in double square brackets like [[Topic Name]]. End the entry with a line "Related: [[A]] · [[B]]".',
    polishable: true
  },
  flashcards: {
    label: 'Q&A Flashcards',
    icon: '⚡',
    directive:
      'Convert ALL key knowledge into question-answer flashcards. Output pairs in EXACTLY this format:\nQ: <specific question>\nA: <complete answer grounded in the sources>\nCover definitions, mechanisms, comparisons and edge cases. No extra prose outside Q/A pairs.',
    polishable: false
  }
};

const DEPTHS = {
  brief: { label: 'Brief', words: '300-450', hint: '~400 words per topic' },
  standard: { label: 'Standard', words: '600-900', hint: '~750 words per topic' },
  deep: { label: 'Deep Dive', words: '1100-1700', hint: '~1400 words per topic' }
};

const TONES = {
  neutral: 'balanced and objective',
  enthusiastic: 'energetic and motivating, without sacrificing accuracy',
  critical: 'skeptical and analytical, probing weaknesses in claims',
  simplified: 'plain language a curious beginner can follow'
};

const CROSSREF = { low: 'rarely cross-reference', medium: 'occasionally cross-reference', high: 'frequently cross-reference' };

const DEFAULT_NOTEBOOK = {
  style: 'scholar',
  format: 'book',
  depth: 'standard',
  tone: 'neutral',
  includeQuotes: true,
  includePageNumbers: true,
  crossRefDensity: 'medium',
  knowledgeGaps: true,
  glossary: false
};

function validateNotebook(input = {}) {
  const nb = { ...DEFAULT_NOTEBOOK };
  if (STYLES[input.style]) nb.style = input.style;
  if (FORMATS[input.format]) nb.format = input.format;
  if (DEPTHS[input.depth]) nb.depth = input.depth;
  if (TONES[input.tone]) nb.tone = input.tone;
  if (CROSSREF[input.crossRefDensity]) nb.crossRefDensity = input.crossRefDensity;
  nb.includeQuotes = typeof input.includeQuotes === 'boolean' ? input.includeQuotes : DEFAULT_NOTEBOOK.includeQuotes;
  nb.includePageNumbers = typeof input.includePageNumbers === 'boolean' ? input.includePageNumbers : DEFAULT_NOTEBOOK.includePageNumbers;
  nb.knowledgeGaps = typeof input.knowledgeGaps === 'boolean' ? input.knowledgeGaps : DEFAULT_NOTEBOOK.knowledgeGaps;
  nb.glossary = typeof input.glossary === 'boolean' ? input.glossary : DEFAULT_NOTEBOOK.glossary;
  return nb;
}

function citationRules(nb) {
  const rules = [];
  rules.push('Cite the origin of every major claim inline using [Source: <source title>, p. <page>].');
  if (!nb.includePageNumbers) rules.push('Omit page numbers from citations; cite source title only.');
  else rules.push('ALWAYS include page numbers in citations.');
  if (nb.includeQuotes) rules.push('Include at least one short verbatim quote (<25 words) where a source phrases something distinctively.');
  return rules.join(' ');
}

function buildPromptAddenda(nb) {
  const style = STYLES[nb.style];
  const format = FORMATS[nb.format];
  const depth = DEPTHS[nb.depth];

  const system =
    'You are an Advanced Knowledge Synthesis Engine writing one section of a larger notebook.\n' +
    style.persona;

  const userParts = [
    `NOTEBOOK STYLE: ${style.label} — ${style.blurb}`,
    `OUTPUT FORMAT: ${format.label}. ${format.directive}`,
    `DEPTH: aim for ${depth.words} words.`,
    `TONE: ${TONES[nb.tone]}.`,
    citationRules(nb),
    nb.crossRefDensity !== 'medium'
      ? `${CROSSREF[nb.crossRefDensity]} other notebook topics.`
      : '',
    format === FORMATS.wiki ? 'Use [[Double Bracket Links]] exactly as instructed.' : '',
    'Never invent information absent from the sources. Preserve exact technical terms. If sources disagree, present both positions and synthesize.'
  ].filter(Boolean);

  return { system, user: userParts.join('\n') };
}

function buildPolishAddenda(nb) {
  const style = STYLES[nb.style];
  const system =
    'You are an expert book editor assembling raw research notes into one polished chapter.\n' +
    style.persona;
  const format = FORMATS[nb.format];
  const user =
    `Merge the provided section notes for this chapter into a seamless whole. ` +
    `Add smooth transitions, remove repetition, keep EVERY factual claim and its [Source: ...] citations intact. ` +
    `Keep the OUTPUT FORMAT instructions: ${format.label} — ${format.directive}\n` +
    `Do not drop any unique insight from any note.`;
  return { system, user };
}

function describe() {
  return {
    styles: Object.entries(STYLES).map(([id, s]) => ({
      id, label: s.label, icon: s.icon, blurb: s.blurb, sections: s.sections
    })),
    formats: Object.entries(FORMATS).map(([id, f]) => ({ id, label: f.label, icon: f.icon })),
    depths: Object.entries(DEPTHS).map(([id, d]) => ({ id, label: d.label, hint: d.hint })),
    tones: Object.keys(TONES),
    crossRef: Object.keys(CROSSREF),
    defaults: DEFAULT_NOTEBOOK
  };
}

module.exports = {
  STYLES,
  FORMATS,
  DEPTHS,
  TONES,
  CROSSREF,
  DEFAULT_NOTEBOOK,
  validateNotebook,
  buildPromptAddenda,
  buildPolishAddenda,
  describe
};
