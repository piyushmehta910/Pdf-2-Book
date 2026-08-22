const CONTRAST_MARKERS = [
  'however', 'whereas', 'in contrast', 'on the other hand', 'contrary',
  'but studies', 'failed to', 'no significant', 'disputed', 'mixed results'
];

const { id } = require('./storage');

function containsContrast(text) {
  const lower = String(text).toLowerCase();
  return CONTRAST_MARKERS.some((marker) => lower.includes(marker));
}

function detectConflicts(chunks, duplicates = []) {
  const conflicts = [];

  const candidatePairs = [];
  for (const dup of duplicates) {
    const members = chunks.filter((c) => dup.chunkIds.includes(c.id));
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        candidatePairs.push([members[i], members[j]]);
      }
    }
  }

  for (const [a, b] of candidatePairs) {
    if (containsContrast(a.content) || containsContrast(b.content)) {
      conflicts.push({
        id: id('cfl'),
        topic: a.section,
        claimA: a.content.slice(0, 400),
        sourceA: a.sourceId,
        pageA: a.pageNumber,
        claimB: b.content.slice(0, 400),
        sourceB: b.sourceId,
        pageB: b.pageNumber,
        resolution: null
      });
    }
  }
  return conflicts;
}

module.exports = { detectConflicts, containsContrast };
