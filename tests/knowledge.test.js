const { textSimilarity } = require('../src/services/similarity');
const { detectDuplicates } = require('../src/services/duplicateDetector');
const { containsContrast } = require('../src/services/conflictDetector');
const { buildOutline } = require('../src/services/outlineBuilder');
const { computeCoverage } = require('../src/services/coverageChecker');

describe('similarity', () => {
  test('detects semantic overlap between paraphrases', () => {
    const a = 'Resistance exercise increases muscle protein synthesis.';
    const b = 'Strength training stimulates increased muscle protein synthesis.';
    const c = 'Photosynthesis converts light energy into chemical energy in plants.';
    expect(textSimilarity(a, b)).toBeGreaterThan(0.4);
    expect(textSimilarity(a, c)).toBeLessThan(0.15);
  });
});

describe('duplicateDetector', () => {
  test('groups near-identical chunks', () => {
    const chunks = [
      { id: 'a', sourceId: 's1', content: 'Resistance exercise increases muscle protein synthesis.' },
      { id: 'b', sourceId: 's2', content: 'Resistance exercise increases muscle protein synthesis.' },
      { id: 'c', sourceId: 's3', content: 'Completely unrelated topic about marine biology and coral reefs.' }
    ];
    const groups = detectDuplicates(chunks);
    expect(groups.length).toBe(1);
    expect(groups[0].chunkIds.sort()).toEqual(['a', 'b']);
  });
});

describe('conflictDetector', () => {
  test('flags contrastive claims', () => {
    expect(containsContrast('However, later studies failed to replicate the effect.')).toBe(true);
    expect(containsContrast('All studies agreed on the outcome.')).toBe(false);
  });
});

describe('outlineBuilder', () => {
  test('orders topics into chapters', () => {
    const topics = [
      { id: 't1', name: 'Limitations', keywords: [], chunkIds: ['c1'] },
      { id: 't2', name: 'Foundations', keywords: [], chunkIds: ['c2'] },
      { id: 't3', name: 'Evidence Review', keywords: [], chunkIds: ['c3'] }
    ];
    const outline = buildOutline(topics);
    expect(outline.chapters.length).toBeGreaterThan(0);
    expect(outline.chapters[0].title).toMatch(/Foundations/);
  });
});

describe('coverageChecker', () => {
  test('marks thin topics as insufficient', () => {
    const topics = [{ id: 't1', name: 'Topic A', chunkIds: ['x'] }];
    const coverage = computeCoverage(topics, []);
    expect(coverage[0].score).toBe(0);
    expect(coverage[0].insufficient).toBe(true);
  });
});
