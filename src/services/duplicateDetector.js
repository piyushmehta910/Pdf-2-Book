const config = require('../config');
const { textSimilarity } = require('./similarity');
const { id } = require('./storage');

function detectDuplicates(chunks) {
  const groups = [];
  const used = new Set();

  for (let i = 0; i < chunks.length; i++) {
    if (used.has(chunks[i].id)) continue;
    const group = [chunks[i]];
    for (let j = i + 1; j < chunks.length; j++) {
      if (used.has(chunks[j].id)) continue;
      if (textSimilarity(chunks[i].content, chunks[j].content) >= config.dedup.similarityThreshold) {
        group.push(chunks[j]);
        used.add(chunks[j].id);
      }
    }
    if (group.length > 1) {
      groups.push({
        id: id('dup'),
        chunkIds: group.map((c) => c.id),
        sourceIds: [...new Set(group.map((c) => c.sourceId))],
        representative: group[0]
      });
    }
  }
  return groups;
}

module.exports = { detectDuplicates };
