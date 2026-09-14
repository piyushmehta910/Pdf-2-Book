const config = require('../config');
const { textSimilarity } = require('./similarity');
const { id } = require('./storage');

/**
 * detectDuplicates — near-duplicate detection across sources.
 *
 * `opts.embedder` is optional and swappable (a sync facade produced by
 * resolveSyncEmbedder, or a local embedder). When an embedder is supplied the
 * grouping uses embedding cosine similarity; otherwise it falls back to the
 * lexical textSimilarity blend so existing sync callers keep working.
 *
 * Result groups carry full member chunks (with sourceId / pageNumber / section)
 * so downstream services (conflicts, evidence) never have to re-resolve them.
 *
 * @param {Array} chunks - chunk objects with { id, content, sourceId, pageNumber, section }
 * @param {object} [opts] - { embedder, vectors, threshold, onlyAcrossSources }
 */
function detectDuplicates(chunks, opts = {}) {
  const list = Array.isArray(chunks) ? chunks : [];
  const embedder = opts.embedder || null;
  const vectors = opts.vectors || null;
  const threshold = typeof opts.threshold === 'number' ? opts.threshold : config.dedup.similarityThreshold;
  const onlyAcrossSources = Boolean(opts.onlyAcrossSources);

  const vec = (index) => (vectors && vectors[index]) || (embedder && index < list.length ? embedder.embed([list[index].content])[0] : null);
  const sim = (a, b) => {
    const av = vec(a);
    const bv = vec(b);
    if (embedder && av && bv) return embedder.similarity(av, bv);
    return textSimilarity(list[a].content, list[b].content);
  };

  const groups = [];
  const used = new Set();

  for (let i = 0; i < list.length; i++) {
    if (used.has(i)) continue;
    const group = [i];
    for (let j = i + 1; j < list.length; j++) {
      if (used.has(j)) continue;
      if (onlyAcrossSources && list[i].sourceId === list[j].sourceId) continue;
      if (sim(i, j) >= threshold) {
        group.push(j);
        used.add(j);
      }
    }
    if (group.length > 1) {
      const members = group.map((idx) => list[idx]);
      const sourceIds = [...new Set(members.map((c) => c.sourceId))];
      if (onlyAcrossSources && sourceIds.length < 2) continue;
      groups.push({
        id: id('dup'),
        chunkIds: members.map((c) => c.id),
        sourceIds,
        pages: [...new Set(members.map((c) => c.pageNumber))].sort((a, b) => a - b),
        representative: members[0],
        members,
        score: Number(sim(i, group[1]).toFixed(3))
      });
    }
  }
  return groups;
}

module.exports = { detectDuplicates };