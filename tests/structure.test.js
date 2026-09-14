const { defaultMatter, proposeStructure, buildToc, sanitizeTopics, unionClusters } = require('../src/services/structure');

const SAMPLE_TOPICS = [
  { id: 't1', name: 'Foundations', keywords: ['math', 'linear'], chunkIds: ['c1'], sources: ['s1'], chunkCount: 6, summary: 'Base concepts.' },
  { id: 't2', name: 'Vector Spaces', keywords: ['math', 'vector'], chunkIds: ['c2'], sources: ['s1'], chunkCount: 9, summary: 'Spaces and spans.' },
  { id: 't3', name: 'Limitations', keywords: ['edge', 'risk'], chunkIds: ['c3'], sources: ['s2'], chunkCount: 3, summary: 'Edge cases.' }
];

describe('structure.defaultMatter', () => {
  test('textbook gets cover, preface, toc and references/glossary/index back matter', () => {
    const { frontMatter, backMatter } = defaultMatter('textbook');
    expect(frontMatter.map((f) => f.type)).toEqual(['cover', 'preface', 'toc']);
    expect(backMatter.map((b) => b.type)).toEqual(['references', 'glossary', 'index']);
    expect(frontMatter.every((f) => f.enabled === true)).toBe(true);
  });

  test('novel omits glossary and index back matter', () => {
    const { backMatter } = defaultMatter('novel');
    const types = backMatter.map((b) => b.type);
    expect(types).not.toContain('glossary');
    expect(types).not.toContain('index');
  });

  test('unknown book type falls back to the textbook default', () => {
    const { frontMatter, backMatter } = defaultMatter('does-not-exist');
    expect(frontMatter.length).toBe(3);
    expect(backMatter.some((b) => b.type === 'glossary')).toBe(true);
  });
});

describe('structure.proposeStructure', () => {
  test('groups related topics into chapters and returns a living skeleton', () => {
    const st = proposeStructure({ topics: SAMPLE_TOPICS, bookType: 'textbook', title: 'Linear Algebra' });
    expect(st.title).toBe('Linear Algebra');
    expect(st.bookType).toBe('textbook');
    expect(st.chapters.length).toBeGreaterThan(0);
    expect(st.chapters.length).toBeLessThanOrEqual(SAMPLE_TOPICS.length);
    // topics that share a source + keyword overlap belong to the same chapter
    const allSections = st.chapters.flatMap((c) => c.sections.map((s) => s.topicId));
    expect(allSections.sort()).toEqual(['t1', 't2', 't3']);
  });

  test('every chapter carries number, purpose, topicIds and topic-linked sections', () => {
    const st = proposeStructure({ topics: SAMPLE_TOPICS, bookType: 'research' });
    for (const ch of st.chapters) {
      expect(ch.id).toBeTruthy();
      expect(ch.number).toBeGreaterThan(0);
      expect(ch.title).toBeTruthy();
      expect(typeof ch.purpose).toBe('string');
      expect(ch.topicIds.length).toBeGreaterThan(0);
      for (const s of ch.sections) {
        expect(s.id).toBeTruthy();
        expect(s.title).toBeTruthy();
        expect(s.topicId).toBeTruthy();
        expect(Array.isArray(s.blocks)).toBe(true);
      }
    }
  });

  test('returns stats and empty chapters for empty input', () => {
    const st = proposeStructure({ topics: [], bookType: 'textbook', title: '' });
    expect(st.chapters).toEqual([]);
    expect(st.stats.topics).toBe(0);
    expect(st.stats.chapters).toBe(0);
  });
});

describe('structure.buildToc', () => {
  test('reflects enabled front/back matter and chapter sections in order', () => {
    const st = proposeStructure({ topics: SAMPLE_TOPICS, bookType: 'textbook', title: 'Book' });
    const toc = buildToc(st);
    expect(toc[0].level).toBe('front');
    expect(toc[0].type).toBe('cover');
    const last = toc[toc.length - 1];
    expect(last.level).toBe('back');
    expect(last.type).toBe('index');
    // sections appear after their chapter
    const chIdx = toc.findIndex((e) => e.level === 'chapter');
    const secAfter = toc.slice(chIdx + 1).find((e) => e.level === 'section');
    expect(secAfter).toBeTruthy();
    expect(secAfter.target).toBeTruthy();
  });

  test('disabled matter entries are omitted', () => {
    const st = proposeStructure({ topics: SAMPLE_TOPICS, bookType: 'textbook' });
    st.backMatter[0].enabled = false;
    const toc = buildToc(st);
    expect(toc.some((e) => e.type === 'references')).toBe(false);
  });
});

describe('structure sanitization & clustering helpers', () => {
  test('sanitizeTopics filters invalid entries and caps fields', () => {
    const clean = sanitizeTopics([null, { id: 'ok', name: 'Real Topic' }, { name: 'No Id' }, 'junk']);
    expect(clean.length).toBe(2);
    expect(clean[0].id).toBe('ok');
    expect(clean[1].id).toMatch(/^top_/);
  });

  test('unionClusters joins topics sharing a source and a keyword', () => {
    const groups = unionClusters(SAMPLE_TOPICS);
    const t1Group = groups.find((g) => g.some((t) => t.id === 't1'));
    expect(t1Group.some((t) => t.id === 't2')).toBe(true);
    const t3Group = groups.find((g) => g.some((t) => t.id === 't3'));
    expect(t3Group.some((t) => t.id === 't1')).toBe(false);
  });
});