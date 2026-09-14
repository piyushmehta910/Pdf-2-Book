const request = require('supertest');
const app = require('../src/server');

const SAMPLE_PAGE = `Gradient descent is an iterative optimization algorithm for finding the minimum of a function.
It updates parameters in the opposite direction of the gradient. The update rule is w = w - lr * grad
where lr is the learning rate. A high learning rate can cause divergence while a low one converges slowly.
Neural networks rely on gradient descent during training via backpropagation.`;

function sampleKb() {
  return {
    topics: [{
      id: 'topic_a1', canonical_name: 'Gradient Descent', aliases: ['GD'],
      summary: 'Iterative optimizer.', facts: [{ text: 'Updates weights using gradients.' }],
      definitions: [], examples: [], formulas: [], procedures: [],
      relationships: [], terminology: [], source_refs: [], excluded: false,
      first_seen: { document_id: 'd1', page: 1 }, last_updated: { document_id: 'd1', page: 1 }
    }],
    conflicts: [], unresolved_refs: [], glossary: {}, documents: []
  };
}

describe('GET /api/presets', () => {
  test('lists all sixteen presets with metadata, designs, and page sizes', async () => {
    const res = await request(app).get('/api/presets');
    expect(res.status).toBe(200);
    expect(res.body.presets).toHaveLength(16);
    expect(res.body.designs).toHaveLength(9);
    expect(res.body.pageSizes).toHaveLength(5);
    expect(res.body.defaultPreset).toBe('textbook');
    expect(res.body.presets[0]).toHaveProperty('include');
  });
});

describe('POST /api/knowledge/extract (stateless KB loop)', () => {
  test('rejects pages without readable text', async () => {
    const res = await request(app).post('/api/knowledge/extract').send({ pageText: '   ', kb: null });
    expect(res.status).toBe(400);
  });

  test('keyless heuristic mode grows the KB and returns digest/stats', async () => {
    const res = await request(app)
      .post('/api/knowledge/extract')
      .send({ pageText: SAMPLE_PAGE, pageNumber: 3, documentId: 'doc_9', fileName: 'ml.pdf', kb: null });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('heuristic');
    expect(res.body.kb.topics.length).toBeGreaterThan(0);
    expect(res.body.kbStats.topics).toBeGreaterThan(0);
    expect(Array.isArray(res.body.digest)).toBe(true);
    const defs = res.body.kb.topics.flatMap((t) => t.definitions.map((d) => d.text));
    expect(defs.some((d) => /iterative optimization/i.test(d))).toBe(true);
    const formulas = res.body.kb.topics.flatMap((t) => t.formulas.map((f) => f.expression));
    expect(formulas.some((f) => /w\s*=\s*w/.test(f))).toBe(true);
  });

  test('merges into an existing client KB without duplication', async () => {
    const first = await request(app)
      .post('/api/knowledge/extract')
      .send({ pageText: SAMPLE_PAGE, pageNumber: 1, documentId: 'doc_9', kb: null });
    const kbAfterFirst = first.body.kb;
    const second = await request(app)
      .post('/api/knowledge/extract')
      .send({ pageText: SAMPLE_PAGE, pageNumber: 2, documentId: 'doc_9', kb: kbAfterFirst });
    expect(second.status).toBe(200);
    const names = second.body.kb.topics.map((t) => t.canonical_name);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
    expect(second.body.kbStats.facts).toBeGreaterThanOrEqual(first.body.kbStats.facts);
  });

  test('cleans OCR artifacts before extraction and reports stats', async () => {
    const dirty = 'Neural net-\nworks learn represen-\ntations.\n\n\n\n';
    const res = await request(app)
      .post('/api/knowledge/extract')
      .send({ pageText: dirty, pageNumber: 1, documentId: 'd', kb: null });
    expect(res.body.ocr.dehyphenated).toBeGreaterThan(0);
  });
});

describe('POST /api/knowledge/adjudicate', () => {
  test('requires an AI key', async () => {
    const res = await request(app)
      .post('/api/knowledge/adjudicate')
      .send({ a: { name: 'CNN' }, b: { name: 'Convolutional Neural Network' } });
    expect(res.status).toBe(400);
  });

  test('validates candidate names even with a key-shaped header', async () => {
    const res = await request(app)
      .post('/api/knowledge/adjudicate')
      .set('x-ai-config', JSON.stringify({ provider: 'zen', apiKey: 'k' }))
      .send({ a: {}, b: { name: 'B' } });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/knowledge/consolidate', () => {
  test('merges strong duplicates deterministically and flags review pairs', async () => {
    const kb = sampleKb();
    kb.topics.push({
      ...JSON.parse(JSON.stringify(kb.topics[0])),
      id: 'topic_b2', canonical_name: 'gradient  descent!', aliases: []
    });
    kb.topics.push({
      id: 'topic_c3', canonical_name: 'Learning Rate', aliases: ['alpha'],
      summary: 'Step size multiplier for weight updates.',
      facts: [{ text: 'Controls step size.' }],
      definitions: [], examples: [], formulas: [], procedures: [],
      relationships: [], terminology: [], source_refs: [], excluded: false,
      first_seen: { document_id: 'd1', page: 1 }, last_updated: { document_id: 'd1', page: 1 }
    });

    const res = await request(app).post('/api/knowledge/consolidate').send({ kb });
    expect(res.status).toBe(200);
    expect(res.body.report.merged.length).toBeGreaterThan(0);
    const active = res.body.kb.topics.filter((t) => !t.excluded);
    expect(active.length).toBeLessThan(kb.topics.length);
  });
});

describe('POST /api/sources/search', () => {
  test('searches source pages and returns ranked excerpts', async () => {
    const sources = [
      {
        id: 's1',
        title: 'Machine Learning Basics',
        pages: [
          { pageNumber: 1, text: 'Neural networks use backpropagation to calculate error gradients.' },
          { pageNumber: 2, text: 'Reinforcement learning optimizes reward functions over time.' }
        ]
      }
    ];

    const res = await request(app)
      .post('/api/sources/search')
      .send({ query: 'backpropagation gradients', sources });
    expect(res.status).toBe(200);
    expect(res.body.matches.length).toBeGreaterThan(0);
    expect(res.body.matches[0].sourceTitle).toBe('Machine Learning Basics');
    expect(res.body.matches[0].pageNumber).toBe(1);
  });
});

describe('POST /api/book/section/rewrite', () => {
  test('validates section input and executes rewrite transformation', async () => {
    const section = {
      title: 'Optimization Algorithms',
      blocks: [{ type: 'paragraph', text: 'Gradient descent minimizes the objective function.' }]
    };

    const res = await request(app)
      .post('/api/book/section/rewrite')
      .send({ section, action: 'simplify', presetId: 'beginner' });
    expect(res.status).toBe(200);
    expect(res.body.section).toHaveProperty('title');
    expect(res.body.section).toHaveProperty('blocks');
  });
});

describe('POST /api/book/plan', () => {
  test('produces an outline plan from a topic digest', async () => {
    const digest = [
      { id: 't1', name: 'Gradient Descent', summary: 'Optimization algorithm', related: ['Learning Rate'], weight: 5 },
      { id: 't2', name: 'Learning Rate', summary: 'Step size multiplier', related: ['Gradient Descent'], weight: 3 },
      { id: 't3', name: 'Backpropagation', summary: 'Gradient calculation via chain rule', related: ['Gradient Descent'], weight: 4 }
    ];
    const res = await request(app).post('/api/book/plan').send({ title: 'Deep Learning', digest, presetId: 'textbook' });
    expect(res.status).toBe(200);
    expect(res.body.plan.chapters.length).toBeGreaterThan(0);
    expect(res.body.plan.chapters[0]).toHaveProperty('title');
    expect(res.body.plan.chapters[0]).toHaveProperty('topicIds');
  });
});

describe('POST /api/book/write', () => {
  test('writes validated blocks in keyless fallback mode', async () => {
    const chapter = { title: 'Optimization', purpose: 'Teach gradient descent', topicIds: ['t1'] };
    const kbSlice = [{
      id: 't1', name: 'Gradient Descent', summary: 'Optimization algorithm',
      definitions: [{ term: 'Gradient Descent', text: 'An algorithm that steps downhill.' }],
      facts: [{ text: 'Converges to local minima for convex functions.' }],
      formulas: [{ expression: 'w = w - lr * grad', explanation: 'Update rule' }],
      procedures: [{ text: '1. Compute grad | 2. Update weights | 3. Repeat' }],
      examples: [{ title: 'Linear regression', content: 'Fitting a line to house prices.' }]
    }];
    const res = await request(app).post('/api/book/write').send({ title: 'Book', chapter, presetId: 'textbook', kbSlice });
    expect(res.status).toBe(200);
    expect(res.body.sections.length).toBeGreaterThan(0);
    const types = res.body.sections.flatMap((s) => s.blocks.map((b) => b.type));
    expect(types).toContain('paragraph');
    expect(types).toContain('definition');
    expect(types).toContain('bullet_list');
    expect(types).toContain('formula');
    expect(types).toContain('example');
  });
});

describe('POST /api/book/qa', () => {
  test('scores a healthy book and returns status pass', async () => {
    const book = {
      title: 'Good Book',
      chapters: [{
        title: 'Ch 1',
        sections: [{
          title: 'Sec 1',
          blocks: [{ type: 'paragraph', text: 'Grounded content.' }]
        }]
      }],
      glossary: [{ term: 'T', definition: 'D' }],
      tocEntries: [{ title: 'Ch 1', anchor: '#ch-1' }]
    };
    const kb = { topics: [{ id: 't1', canonical_name: 'T', aliases: [], excluded: false }], conflicts: [], unresolved_refs: [] };
    const res = await request(app).post('/api/book/qa').send({ book, kb });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pass');
    expect(res.body.score).toBeGreaterThanOrEqual(90);
  });
});

describe('POST /api/export/:format', () => {
  const book = {
    title: 'Export Me',
    chapters: [{
      title: 'Chapter 1',
      sections: [{
        title: 'Section 1',
        blocks: [
          { type: 'paragraph', text: 'First paragraph with [[Gradient Descent]] link.' },
          { type: 'table', headers: ['Metric', 'Value'], rows: [['Accuracy', '98%']] }
        ]
      }]
    }],
    glossary: [{ term: 'Gradient Descent', definition: 'Downhill step optimizer' }]
  };

  test('markdown export formats headings and blocks', async () => {
    const res = await request(app).post('/api/export/markdown').send({ book });
    expect(res.status).toBe(200);
    expect(res.text).toContain('# Export Me');
    expect(res.text).toContain('## Chapter 1: Chapter 1');
    expect(res.text).toContain('| Metric | Value |');
  });

  test('html export generates self-contained styled document', async () => {
    const res = await request(app).post('/api/export/html').send({ book, design: 'modern', pageSize: 'trade_6x9' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('<!DOCTYPE html>');
    expect(res.text).toContain('class="wikilink"');
    expect(res.text).toContain('<table>');
  });

  test('html export body text is identical across every theme and page size', async () => {
    const tl = require('../public/themeLayer');
    const norm = (html) => html
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;|&amp;|&quot;|&#x27;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    let baseline = null;
    for (const tid of tl.THEME_IDS) {
      for (const sid of tl.PAGE_SIZE_IDS) {
        const res = await request(app).post('/api/export/html').send({ book, design: tid, pageSize: sid });
        expect(res.status).toBe(200);
        const text = norm(res.text);
        if (baseline === null) baseline = text;
        else expect(text).toBe(baseline);
      }
    }
    expect(baseline).toContain('Export Me');
  });

  test('json export embeds the knowledge base', async () => {
    const res = await request(app).post('/api/export/json').send({ book, kb: sampleKb() });
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.text);
    expect(parsed.book.title).toBe('Export Me');
    expect(parsed.kb.topics[0].canonical_name).toBe('Gradient Descent');
  });

  test('rejects unsupported formats and empty books', async () => {
    let res = await request(app).post('/api/export/csv').send({ book });
    expect(res.status).toBe(400);
    res = await request(app).post('/api/export/markdown').send({ book: {} });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/book/structure', () => {
  test('proposes a book-type-aware structure from topics', async () => {
    const topics = [
      { id: 't1', name: 'Foundations', keywords: ['math'], chunkIds: ['c1'], sources: ['s1'], chunkCount: 5, summary: 'Base concepts.' },
      { id: 't2', name: 'Limitations', keywords: ['risk'], chunkIds: ['c2'], sources: ['s2'], chunkCount: 3, summary: 'Edge cases.' }
    ];
    const res = await request(app).post('/api/book/structure').send({ title: 'Deep Learning', topics, bookType: 'textbook' });
    expect(res.status).toBe(200);
    expect(res.body.frontMatter.some((f) => f.type === 'cover')).toBe(true);
    expect(res.body.chapters.length).toBeGreaterThan(0);
    expect(res.body.backMatter.some((b) => b.type === 'glossary')).toBe(true);
    expect(Array.isArray(res.body.toc)).toBe(true);
    expect(res.body.chapters[0].sections[0].topicId).toBe('t1');
  });

  test('rejects missing topics', async () => {
    const res = await request(app).post('/api/book/structure').send({ bookType: 'novel' });
    expect(res.status).toBe(400);
  });

  test('novel book type omits glossary/index back matter', async () => {
    const res = await request(app).post('/api/book/structure').send({ title: 'Story', topics: [{ id: 't1', name: 'A' }], bookType: 'novel' });
    expect(res.status).toBe(200);
    const types = res.body.backMatter.map((b) => b.type);
    expect(types).not.toContain('glossary');
    expect(types).not.toContain('index');
  });
});

describe('POST /api/export/:format (structure-driven)', () => {
  const structuredBook = {
    title: 'Structured Export',
    frontMatter: [
      { id: 'fm1', type: 'cover', title: 'Cover Page', enabled: true },
      { id: 'fm2', type: 'preface', title: 'Preface', enabled: true, content: 'A short preface.' },
      { id: 'fm3', type: 'toc', title: 'Table of Contents', enabled: true }
    ],
    chapters: [{ title: 'Alpha', sections: [{ title: 'One' }, { title: 'Two' }] }],
    backMatter: [
      { id: 'bm1', type: 'references', title: 'References', enabled: true },
      { id: 'bm2', type: 'index', title: 'Index', enabled: false }
    ],
    references: ['R1'],
    index: [{ term: 'X', pages: [1] }],
    glossary: [{ term: 'T', definition: 'D' }]
  };

  test('enabled front/back matter renders; disabled is skipped', async () => {
    const md = await request(app).post('/api/export/markdown').send({ book: structuredBook });
    expect(md.status).toBe(200);
    expect(md.text).toContain('## Preface\n\nA short preface.');
    expect(md.text).toContain('## References');
    expect(md.text).not.toContain('## Index');
    expect(md.text).not.toContain('## Glossary');
  });

  test('html export emits toc sections and back matter anchors', async () => {
    const html = await request(app).post('/api/export/html').send({ book: structuredBook, design: 'modern', pageSize: 'trade_6x9' });
    expect(html.status).toBe(200);
    expect(html.text).toContain('toc-sections');
    expect(html.text).toContain('id="preface"');
    expect(html.text).toContain('id="references"');
    expect(html.text).not.toContain('id="index"');
  });
});

describe('GET / (live UI)', () => {
  test('serves the current UI bundle with studio engine markers', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('themeToggle');
    expect(res.text).toContain('notesModal');
    expect(res.text).toContain('/vendor/pdf.min.js');
  });
});
