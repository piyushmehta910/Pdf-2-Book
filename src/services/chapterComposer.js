const aiProvider = require('./aiProvider');
const { buildPolishAddenda } = require('./notebookOptions');

const POLISH_INPUT_CAP = 3200;
const FORMATS_POLISHABLE = new Set(['book', 'wiki', 'cards']);

function condense(text, maxChars) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars).replace(/\s+\S*$/, '') + '…';
}

function slugify(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function keywordSet(topic) {
  const words = new Set(
    [...String(topic.name).toLowerCase().matchAll(/\b[a-z]{4,}\b/g)].map((m) => m[0])
  );
  for (const kw of topic.keywords || []) {
    if (kw.length >= 4) words.add(kw.toLowerCase());
  }
  return words;
}

function overlapScore(setA, setB) {
  let shared = 0;
  for (const w of setA) if (setB.has(w)) shared++;
  return shared;
}

function relatedChaptersFor(chapterIndex, chapterMetas) {
  const self = chapterMetas[chapterIndex];
  const scored = [];
  chapterMetas.forEach((meta, i) => {
    if (i === chapterIndex) return;
    const score = overlapScore(self.words, meta.words);
    if (score >= 2) scored.push({ title: meta.title, score });
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, 3).map((s) => s.title);
}

async function polishChapter(chapterTitle, topicSyntheses, previousTitles, notebook, aiConfig) {
  const addenda = buildPolishAddenda(notebook);
  const sections = topicSyntheses.map((s) =>
    `### Section note: ${s.topicName}\n${condense(s.content, POLISH_INPUT_CAP)}`
  ).join('\n\n');

  const continuity = previousTitles.length
    ? `Chapters already written (do not repeat them, ensure smooth flow from them): ${previousTitles.join('; ')}.\n\n`
    : '';

  const raw = await aiProvider.complete(
    addenda.system,
    `${addenda.user}\n\n${continuity}Chapter title: ${chapterTitle}\n\nSection notes:\n${sections}`,
    { maxTokens: 3600 },
    aiConfig
  );
  return raw;
}

function buildKnowledgeGapsChapter(coverage) {
  const weak = (coverage || []).filter((c) => c.insufficient);
  if (!weak.length) return null;
  const lines = [
    '# Appendix: Knowledge Gaps',
    '',
    'These topics are under-covered by your current sources. Consider adding material before relying on them.',
    ''
  ];
  for (const gap of weak) {
    lines.push(`- **${gap.topicName}** — coverage ${gap.score}% (${gap.chunkCount} chunk(s)). Add sources covering this topic's definition, evidence and limitations.`);
  }
  return {
    id: 'ch_gaps',
    title: 'Appendix: Knowledge Gaps',
    type: 'appendix',
    number: null,
    content: lines.join('\n'),
    sourceIds: [],
    generatedAt: new Date().toISOString()
  };
}

function buildGlossaryChapter(topics, chunks) {
  const entries = [];
  const seen = new Set();
  for (const topic of topics) {
    for (const kw of (topic.keywords || []).slice(0, 3)) {
      const key = kw.toLowerCase();
      if (key.length < 5 || seen.has(key)) continue;
      const host = chunks.find((c) => c.content.toLowerCase().includes(key));
      if (!host) continue;
      const sentenceMatch = host.content.match(new RegExp(`[^.!?]*\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[^.!?]*[.!?]`, 'i'));
      if (!sentenceMatch) continue;
      seen.add(key);
      entries.push(`- **${kw}** — ${condense(sentenceMatch[0].trim(), 180)}`);
      if (entries.length >= 12) break;
    }
    if (entries.length >= 12) break;
  }
  if (entries.length < 2) return null;
  return {
    id: 'ch_glossary',
    title: 'Appendix: Glossary',
    type: 'appendix',
    number: null,
    content: ['# Appendix: Glossary', '', ...entries].join('\n'),
    sourceIds: [],
    generatedAt: new Date().toISOString()
  };
}

async function composeChapters({ outline, syntheses, notebook, aiConfig = {}, topics = [], coverage = [], chunks = [] }) {
  const canPolish =
    aiProvider.available(aiConfig) &&
    FORMATS_POLISHABLE.has(notebook.format) &&
    notebook.style !== 'minimalist';

  const metas = outline.chapters.map((chapter) => ({
    title: chapter.title,
    words: chapter.topics.reduce((acc, t) => {
      const topic = topics.find((x) => x.id === t.id) || t;
      for (const w of keywordSet(topic)) acc.add(w);
      return acc;
    }, new Set())
  }));

  const chapters = [];
  const previousTitles = [];

  for (let i = 0; i < outline.chapters.length; i++) {
    const chapter = outline.chapters[i];
    const topicSyntheses = syntheses.filter((s) => chapter.topics.some((t) => t.id === s.topicId));

    let body = topicSyntheses.map((s) => s.content).join('\n\n');
    if (canPolish && topicSyntheses.length) {
      try {
        body = await polishChapter(chapter.title, topicSyntheses, previousTitles, notebook, aiConfig);
      } catch (_err) {
        // keep concatenated fallback body
      }
    }

    if (notebook.format === 'wiki') {
      const related = relatedChaptersFor(i, metas);
      if (related.length) {
        body += `\n\n**Related:** ${related.map((t) => `[[${t}]]`).join(' · ')}`;
      }
    }

    const cards = ['cards', 'flashcards'].includes(notebook.format)
      ? topicSyntheses.flatMap((s) => s.cards || [])
      : [];

    previousTitles.push(chapter.title);

    chapters.push({
      id: chapter.id,
      title: chapter.title,
      number: chapter.number,
      type: 'chapter',
      sections: chapter.sections,
      content: `# ${chapter.title}\n\n${body}`,
      cards,
      sourceIds: [...new Set(topicSyntheses.flatMap((s) => s.sourceIds))],
      generatedAt: new Date().toISOString()
    });
  }

  if (notebook.knowledgeGaps) {
    const gaps = buildKnowledgeGapsChapter(coverage);
    if (gaps) chapters.push(gaps);
  }
  if (notebook.glossary) {
    const glossary = buildGlossaryChapter(topics, chunks);
    if (glossary) chapters.push(glossary);
  }

  return { chapters, polished: canPolish };
}

module.exports = { composeChapters, slugify };
