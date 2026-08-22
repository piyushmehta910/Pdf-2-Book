const config = require('../config');

function computeCoverage(topics, chunks) {
  const ASPECTS = ['definition', 'mechanism', 'evidence', 'example', 'application', 'limitation'];
  const report = topics.map((topic) => {
    const topicChunks = chunks.filter((c) => topic.chunkIds.includes(c.id));
    const text = topicChunks.map((c) => c.content).join(' ').toLowerCase();
    const covered = ASPECTS.filter((aspect) => text.includes(aspect)).length;
    const score = topicChunks.length === 0 ? 0 : Math.min(1, covered / ASPECTS.length * 0.6 + Math.min(topicChunks.length, 4) / 4 * 0.4);
    return {
      topicId: topic.id,
      topicName: topic.name,
      score: Math.round(score * 100),
      chunkCount: topicChunks.length,
      insufficient: score < config.coverage.minScore
    };
  });
  return report;
}

module.exports = { computeCoverage };
