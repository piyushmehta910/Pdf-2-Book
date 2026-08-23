const aiProvider = require('./aiProvider');
const { buildContext } = require('./contextManager');
const { id } = require('./storage');
const {
  validateNotebook,
  buildPromptAddenda
} = require('./notebookOptions');

function sourceTitleLookup(sources) {
  const map = new Map();
  for (const source of sources) map.set(source.id, source);
  return map;
}

function firstSentences(text, count) {
  const sentences = String(text).match(/[^.!?]+[.!?]/g) || [String(text)];
  return sentences.slice(0, count).join(' ').trim();
}

function condense(text, maxChars) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars).replace(/\s+\S*$/, '') + '…';
}

/* ---------- deterministic fallback renderers per format ---------- */

function extractiveProse(evidence) {
  const seen = new Set();
  const paragraphs = [];
  for (const ev of evidence) {
    const key = ev.content.slice(0, 120).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    paragraphs.push(`${ev.content} [Source: ${ev.sourceTitle}, p. ${ev.pageNumber}]`);
  }
  return paragraphs.join('\n\n');
}

function fallbackOutline(evidence, topicName) {
  const lines = [`- **${topicName}**`];
  evidence.forEach((ev, i) => {
    lines.push(`  - ${condense(firstSentences(ev.content, 1), 160)} [${ev.sourceTitle}, p. ${ev.pageNumber}]`);
    const extra = firstSentences(ev.content.replace(firstSentences(ev.content, 1), ''), 1);
    if (extra && extra.length > 40) lines.push(`    - ${condense(extra, 140)}`);
    if (i === 0) {
      const kw = [...new Set((ev.content.toLowerCase().match(/\b[a-z]{6,}\b/g) || []).slice(0, 4))];
      if (kw.length) lines.push(`  - *Key terms:* ${kw.join(', ')}`);
    }
  });
  return lines.join('\n');
}

function fallbackCards(evidence, topicName) {
  const cards = [];
  evidence.slice(0, 3).forEach((ev) => {
    const sents = ev.content.match(/[^.!?]+[.!?]/g) || [ev.content];
    cards.push({
      front: condense(sents[0], 110),
      back: `${condense(sents.slice(1).join(' ') || sents[0], 420)}\n\n[Source: ${ev.sourceTitle}, p. ${ev.pageNumber}]`
    });
  });
  const content = `## ${topicName}\n\n` + cards.map((c) =>
    `**Front:** ${c.front}\n\n**Back:** ${c.back}`).join('\n\n---\n\n');
  return { content, cards };
}

function fallbackFlashcards(evidence, topicName) {
  const cards = [];
  evidence.forEach((ev) => {
    const sents = ev.content.match(/[^.!?]+[.!?]/g) || [];
    if (!sents.length) return;
    const q = sents.length > 1
      ? `${condense(sents[0], 90)} — what does the source add next about ${topicName}?`
      : `What does the source say about ${topicName}?`;
    cards.push({
      front: q,
      back: condense(sents.slice(1).join(' ') || sents[0], 380) + `\n[Source: ${ev.sourceTitle}, p. ${ev.pageNumber}]`
    });
  });
  if (!cards.length) {
    cards.push({ front: `Summarize ${topicName}.`, back: 'No detailed content available.' });
  }
  const content = `## ${topicName}\n\n` + cards.map((c) =>
    `Q: ${c.front}\n\nA: ${c.back}`).join('\n\n');
  return { content, cards };
}

function fallbackForFormat(nb, evidence, topicName) {
  switch (nb.format) {
    case 'outline':
      return { content: fallbackOutline(evidence, topicName), cards: [] };
    case 'cards':
      return fallbackCards(evidence, topicName);
    case 'flashcards':
      return fallbackFlashcards(evidence, topicName);
    default:
      return { content: extractiveProse(evidence), cards: [] };
  }
}

/* ---------- AI output parsing into structured cards ---------- */

function parseCardBlocks(raw) {
  const cards = [];
  const re = /CARD\s*\nFront:\s*([\s\S]*?)\nBack:\s*([\s\S]*?)(?=\nCARD\s*\n|$)/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const front = m[1].trim();
    const back = m[2].trim();
    if (front && back) cards.push({ front, back });
  }
  return cards;
}

function parseFlashcardPairs(raw) {
  const cards = [];
  const re = /(?:^|\n)Q:\s*(.+)\n+A:\s*([\s\S]*?)(?=\nQ:|$)/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const front = m[1].trim();
    const back = m[2].trim();
    if (front && back) cards.push({ front, back });
  }
  return cards;
}

function cardsToMarkdown(topicName, cards, kind) {
  if (!cards.length) return `## ${topicName}`;
  if (kind === 'flashcards') {
    return `## ${topicName}\n\n` + cards.map((c) => `Q: ${c.front}\n\nA: ${c.back}`).join('\n\n');
  }
  return `## ${topicName}\n\n` + cards.map((c) =>
    `**Front:** ${c.front}\n\n**Back:** ${c.back}`).join('\n\n---\n\n');
}

function appendReferences(content, evidence) {
  const refs = [];
  const seen = new Set();
  for (const ev of evidence) {
    const key = `${ev.sourceTitle}::${ev.pageNumber}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(`- [Source: ${ev.sourceTitle}, p. ${ev.pageNumber}]`);
  }
  if (!refs.length) return content;
  return `${content}\n\n### References\n${refs.join('\n')}`;
}

/* ---------- main entry ---------- */

async function synthesizeTopic(topic, chunks, sources, aiConfig = {}, notebookInput = {}) {
  const notebook = validateNotebook(notebookInput);
  const lookup = sourceTitleLookup(sources);
  const topicChunks = chunks.filter((c) => topic.chunkIds.includes(c.id));

  const evidence = topicChunks.map((c) => ({
    id: c.id,
    content: c.content,
    sourceTitle: (lookup.get(c.sourceId) || {}).title || 'Unknown source',
    pageNumber: c.pageNumber
  }));

  const context = buildContext({
    query: `${topic.name} ${(topic.keywords || []).join(' ')}`,
    items: evidence,
    budgetChars: aiConfig.contextBudget
  });

  let cards = [];
  let content;
  if (aiProvider.available(aiConfig)) {
    try {
      const addenda = buildPromptAddenda(notebook);
      const raw = await aiProvider.synthesize(context.picked, topic.name, aiConfig, addenda);
      if (notebook.format === 'cards') {
        cards = parseCardBlocks(raw);
        content = cardsToMarkdown(topic.name, cards, 'cards');
      } else if (notebook.format === 'flashcards') {
        cards = parseFlashcardPairs(raw);
        content = cardsToMarkdown(topic.name, cards, 'flashcards');
      } else {
        content = raw;
      }
    } catch (_err) {
      const fb = fallbackForFormat(notebook, context.picked, topic.name);
      content = fb.content; cards = fb.cards;
    }
  } else {
    const fb = fallbackForFormat(notebook, context.picked, topic.name);
    content = fb.content; cards = fb.cards;
  }

  const skipRefs = ['flashcards', 'cards', 'outline'].includes(notebook.format);
  if (!skipRefs) content = appendReferences(content, context.picked);

  return {
    id: id('syn'),
    topicId: topic.id,
    topicName: topic.name,
    content,
    cards,
    format: notebook.format,
    style: notebook.style,
    sourceIds: [...new Set(topicChunks.map((c) => c.sourceId))],
    pageRefs: topicChunks.map((c) => ({ sourceId: c.sourceId, page: c.pageNumber })),
    contextStats: {
      chunksAvailable: evidence.length,
      chunksUsed: context.usedChunks,
      charsUsed: context.usedChars,
      budgetChars: context.budgetChars
    },
    generatedAt: new Date().toISOString()
  };
}

module.exports = {
  synthesizeTopic,
  parseCardBlocks,
  parseFlashcardPairs,
  fallbackForFormat
};
