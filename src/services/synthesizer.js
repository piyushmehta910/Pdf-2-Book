const aiProvider = require('./aiProvider');
const { id } = require('./storage');

function sourceTitleLookup(sources) {
  const map = new Map();
  for (const source of sources) map.set(source.id, source);
  return map;
}

async function synthesizeTopic(topic, chunks, sources) {
  const lookup = sourceTitleLookup(sources);
  const topicChunks = chunks.filter((c) => topic.chunkIds.includes(c.id));

  const evidence = topicChunks.map((c) => ({
    content: c.content,
    sourceTitle: (lookup.get(c.sourceId) || {}).title || 'Unknown source',
    pageNumber: c.pageNumber
  }));

  let content;
  if (aiProvider.available()) {
    try {
      content = await aiProvider.synthesize(evidence, topic.name);
    } catch (_err) {
      content = extractiveSynthesis(evidence, topic.name);
    }
  } else {
    content = extractiveSynthesis(evidence, topic.name);
  }

  return {
    id: id('syn'),
    topicId: topic.id,
    topicName: topic.name,
    content,
    sourceIds: [...new Set(topicChunks.map((c) => c.sourceId))],
    pageRefs: topicChunks.map((c) => ({ sourceId: c.sourceId, page: c.pageNumber })),
    generatedAt: new Date().toISOString()
  };
}

function extractiveSynthesis(evidence, topicName) {
  const seen = new Set();
  const paragraphs = [];
  for (const ev of evidence) {
    const key = ev.content.slice(0, 120).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    paragraphs.push(`${ev.content} (${ev.sourceTitle}, p. ${ev.pageNumber})`);
  }
  return `## ${topicName}\n\n${paragraphs.join('\n\n')}`;
}

async function generateChapter(chapter, syntheses) {
  const topicSyntheses = syntheses.filter((s) => chapter.topics.some((t) => t.id === s.topicId));
  const body = topicSyntheses.map((s) => s.content).join('\n\n');
  return {
    id: chapter.id,
    title: chapter.title,
    number: chapter.number,
    sections: chapter.sections,
    content: `# ${chapter.title}\n\n${body}`,
    sourceIds: [...new Set(topicSyntheses.flatMap((s) => s.sourceIds))],
    generatedAt: new Date().toISOString()
  };
}

module.exports = { synthesizeTopic, generateChapter };
