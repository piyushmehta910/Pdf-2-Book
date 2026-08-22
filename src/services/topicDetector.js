const { topKeywords } = require('./similarity');
const { id } = require('./storage');

function detectTopics(chunks) {
  const topics = [];
  const assigned = new Map();

  for (const chunk of chunks) {
    let bestTopic = null;
    let bestScore = 0;
    for (const topic of topics) {
      const score = topic.keywords.filter((kw) =>
        chunk.content.toLowerCase().includes(kw)
      ).length;
      if (score > bestScore) {
        bestScore = score;
        bestTopic = topic;
      }
    }

    if (bestTopic && bestScore >= 2) {
      assigned.set(chunk.id, bestTopic.id);
    } else {
      const keywords = topKeywords([chunk.content], 5);
      const sectionMatch = (chunk.section || '').trim();
      const name = sectionMatch && sectionMatch !== 'Body'
        ? titleCase(sectionMatch)
        : keywords.length
          ? titleCase(keywords.slice(0, 3).join(' '))
          : `Topic ${topics.length + 1}`;
      const existing = topics.find((t) => normalize(t.name) === normalize(name));
      if (existing) {
        assigned.set(chunk.id, existing.id);
        existing.chunkIds.push(chunk.id);
      } else {
        const topic = {
          id: id('top'),
          name,
          keywords,
          chunkIds: [chunk.id]
        };
        topics.push(topic);
        assigned.set(chunk.id, topic.id);
      }
    }
  }

  for (const topic of topics) {
    if (!topic.chunkIds.length) continue;
  }

  return { topics, assignments: assigned };
}

function mergeSimilarTopics(topics, threshold = 0.6) {
  const merged = [];
  for (const topic of topics) {
    const match = merged.find(
      (m) => textSim(m.keywords.join(' '), topic.keywords.join(' ')) >= threshold
    );
    if (match) {
      match.chunkIds.push(...topic.chunkIds);
      match.keywords = [...new Set([...match.keywords, ...topic.keywords])].slice(0, 8);
    } else {
      merged.push({ ...topic, chunkIds: [...topic.chunkIds] });
    }
  }
  return merged;
}

function textSim(a, b) {
  const tokensA = new Set(a.toLowerCase().split(/\s+/));
  const tokensB = new Set(b.toLowerCase().split(/\s+/));
  let shared = 0;
  for (const t of tokensA) if (tokensB.has(t)) shared++;
  return shared / Math.max(tokensA.size, tokensB.size || 1);
}

function titleCase(text) {
  return String(text)
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}

function normalize(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

module.exports = { detectTopics, mergeSimilarTopics };
