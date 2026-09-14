const CONTRAST_MARKERS = [
  'however', 'whereas', 'in contrast', 'on the other hand', 'contrary',
  'but studies', 'failed to', 'no significant', 'disputed', 'mixed results'
];

const { id } = require('./storage');
const { tokenize, textSimilarity } = require('./similarity');

function containsContrast(text) {
  const lower = String(text).toLowerCase();
  return CONTRAST_MARKERS.some((marker) => lower.includes(marker));
}

/** If both claims carry numeric assertions that differ, they likely conflict. */
function numericConflict(a, b) {
  const numsA = String(a).match(/\d+(?:\.\d+)?%?/g) || [];
  const numsB = String(b).match(/\d+(?:\.\d+)?%?/g) || [];
  if (!numsA.length || !numsB.length) return false;
  const setA = new Set(numsA);
  const setB = new Set(numsB);
  const shared = [...setA].filter((n) => setB.has(n)).length;
  const sameNumbers = shared === setA.size && shared === setB.size;
  if (sameNumbers) return false;
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));
  let common = 0;
  for (const t of tokensA) if (tokensB.has(t)) common++;
  return common >= 2;
}

function claimSide(chunk) {
  return {
    claim: String(chunk.content || chunk.text || '').slice(0, 400),
    sourceId: chunk.sourceId,
    page: chunk.pageNumber || 0,
    section: chunk.section || 'Body'
  };
}

function buildConflict(a, b, topicName, opts) {
  const sideA = claimSide(a);
  const sideB = claimSide(b);
  return {
    id: id('cfl'),
    topic: topicName || 'Unresolved',
    topicId: (opts && opts.topicId) || null,
    flagged: true,
    claimA: sideA.claim,
    sourceA: a.sourceId,
    pageA: a.pageNumber || 0,
    sectionA: a.section || 'Body',
    claimB: sideB.claim,
    sourceB: b.sourceId,
    pageB: b.pageNumber || 0,
    sectionB: b.section || 'Body',
    sources: [...new Set([a.sourceId, b.sourceId])],
    claims: [sideA, sideB],
    hint: (opts && opts.hint) || 'Sources appear to disagree on this claim.',
    resolution: null
  };
}

/**
 * detectConflicts — pairwise conflicts among near-duplicate chunks
 * (backwards-compatible signature used by pipeline.analyzeProject).
 */
function detectConflicts(chunks, duplicates = []) {
  const conflicts = [];
  const seen = new Set();
  for (const dup of duplicates) {
    const members = (chunks || []).filter((c) => dup.chunkIds.includes(c.id));
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        if (members[i].sourceId === members[j].sourceId) continue;
        const a = members[i];
        const b = members[j];
        const key = [a.id, b.id].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        if (containsContrast(a.content) || containsContrast(b.content)) {
          conflicts.push(buildConflict(a, b, a.section, { hint: 'Contrasting language detected across sources.' }));
        }
      }
    }
  }
  return conflicts;
}

/**
 * detectConflictsFromClusters — richer detection over topic clusters:
 * within one topic, chunks from *different* sources that overlap heavily yet
 * diverge (numbers differ or contrast markers) get flagged as conflicts, so
 * the generator is forced to present both sides instead of silently picking one.
 *
 * @param {object} input - { chunks, topics, duplicates }
 * @param {object} opts - { embedder, vectors, lowSim, highSim }
 */
function detectConflictsFromClusters({ chunks, topics, duplicates }, opts = {}) {
  const list = Array.isArray(chunks) ? chunks : [];
  const byId = new Map(list.map((c) => [c.id, c]));
  const conflicts = [];
  const seen = new Set();

  const simOf = (a, b) => {
    if (opts.embedder && opts.vectors) {
      const ia = list.findIndex((c) => c.id === a.id);
      const ib = list.findIndex((c) => c.id === b.id);
      if (ia >= 0 && ib >= 0 && opts.vectors[ia] && opts.vectors[ib]) {
        return opts.embedder.similarity(opts.vectors[ia], opts.vectors[ib]);
      }
    }
    return textSimilarity(a.content, b.content);
  };

  const lowSim = typeof opts.lowSim === 'number' ? opts.lowSim : 0.4;
  const highSim = typeof opts.highSim === 'number' ? opts.highSim : 0.97;

  const consider = (a, b, topicName, topicId) => {
    if (!a || !b || a.sourceId === b.sourceId) return;
    const key = [a.id, b.id].sort().join('|');
    if (seen.has(key)) return;
    seen.add(key);
    const sim = simOf(a, b);
    if (sim < lowSim || sim >= highSim) return;
    const disagree = containsContrast(a.content) || containsContrast(b.content) || numericConflict(a.content, b.content);
    if (!disagree) return;
    conflicts.push(buildConflict(a, b, topicName, {
      topicId,
      hint: sim >= 0.6 ? 'Near-duplicate claims from different sources diverge.' : 'Overlapping claims from different sources disagree.'
    }));
  };

  // 1) within-topic clusters (the primary signal)
  for (const topic of Array.isArray(topics) ? topics : []) {
    const members = (topic.chunkIds || []).map((cid) => byId.get(cid)).filter(Boolean);
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        consider(members[i], members[j], topic.name, topic.id);
      }
    }
  }

  // 2) explicit duplicate groups (already high-similarity across sources)
  for (const dup of Array.isArray(duplicates) ? duplicates : []) {
    const members = (dup.chunkIds || []).map((cid) => byId.get(cid)).filter(Boolean);
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        consider(members[i], members[j], dup.topic || members[i].section || 'Duplicate group', null);
      }
    }
  }

  return conflicts;
}

module.exports = {
  detectConflicts,
  detectConflictsFromClusters,
  containsContrast,
  numericConflict
};