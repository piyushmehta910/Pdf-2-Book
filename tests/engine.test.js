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
  test('lists all nine presets with metadata', async () => {
    const res = await request(app).get('/api/presets');
    expect(res.status).toBe(200);
    expect(res.body.presets).toHaveLength(9);
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
    // definition sentence captured
    const defs = res.body.kb.topics.flatMap((t) => t.definitions.map((d) => d.text));
    expect(defs.some((d) => /iterative optimization/i.test(d))).toBe(true);
    // formula line captured
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
    const res = await request(app).post('/api/knowledge/consolidate').send({ kb });
    expect(res.status).toBe(200);
    expect(res.body.report.merged.length).toBe(1);
    expect(res.body.kb.topics.some((t) => t.id === 'topic_b2')).toBe(false);
    // normalized duplicate of the canonical name is intentionally not re-added as alias
    expect(res.body.kb.topics[0].aliases).toContain('GD');
    expect(res.body.kb.topics[0].facts.length).toBeGreaterThan(0);
  });

  test('tolerates garbage kb input', async () => {
    const res = await request(app).post('/api/knowledge/consolidate').send({ kb: { topics: 'nope' } });
    expect(res.status).toBe(200);
    expect(res.body.kb.topics).toEqual([]);
  });
});

describe('POST /api/book/plan', () => {
  test('requires a digest', async () => {
    const res = await request(app).post('/api/book/plan').send({});
    expect(res.status).toBe(400);
  });

  test('keyless planning returns deterministic chapters', async () => {
    const extract = await request(app)
      .post('/api/knowledge/extract')
      .send({ pageText: SAMPLE_PAGE, pageNumber: 1, documentId: 'd1', kb: null });
    const res = await request(app)
      .post('/api/book/plan')
      .send({ title: 'ML Notes', presetId: 'studyguide', digest: extract.body.digest });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('fallback');
    expect(res.body.plan.chapters.length).toBeGreaterThanOrEqual(1);
    const allIds = res.body.plan.chapters.flatMap((c) => c.topicIds);
    expect(allIds.length).toBe(extract.body.kb.topics.length);
  });
});

describe('POST /api/book/write', () => {
  test('validates chapter + slice inputs', async () => {
    let res = await request(app).post('/api/book/write').send({});
    expect(res.status).toBe(400);
    res = await request(app).post('/api/book/write').send({ chapter: { title: 'C' }, kbSlice: [] });
    expect(res.status).toBe(400);
  });

  test('keyless writing converts KB slice into sections', async () => {
    const extract = await request(app)
      .post('/api/knowledge/extract')
      .send({ pageText: SAMPLE_PAGE, pageNumber: 1, documentId: 'd1', kb: null });
    const slice = await request(app).post('/api/knowledge/consolidate').send({ kb: extract.body.kb });
    const res = await request(app)
      .post('/api/book/write')
      .send({
        title: 'ML Notes',
        chapter: { title: 'Optimization', purpose: 'core ideas', topicIds: ['x'] },
        presetId: 'textbook',
        kbSlice: slice.body.kb.topics,
        recentSummaries: []
      });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('fallback');
    expect(res.body.sections.length).toBeGreaterThan(0);
    expect(res.body.sections[0].blocks.length).toBeGreaterThan(0);
  });
});

describe('POST /api/book/qa', () => {
  const healthyBook = {
    title: 'T', preface: '', glossary: [{ term: 'LR', definition: 'rate' }],
    tocEntries: [{ title: 'C1', level: 1 }],
    chapters: [{ title: 'C1', sections: [{ title: 'S1', blocks: [{ type: 'paragraph', text: 'Body text here.' }] }] }]
  };

  test('passes healthy books and fails empty ones', async () => {
    let res = await request(app).post('/api/book/qa').send({ book: healthyBook, kb: sampleKb() });
    expect(res.body.status).toBe('pass');
    res = await request(app).post('/api/book/qa').send({ book: { chapters: [] }, kb: sampleKb() });
    expect(res.body.status).toBe('fail');
  });
});

describe('POST /api/export/:format (block-based)', () => {
  const book = {
    title: 'Export Me',
    subtitle: 'v3',
    author: 'Tester',
    preface: 'Intro text.',
    tocEntries: [{ title: 'C1', level: 1 }],
    glossary: [{ term: 'GD', definition: 'Gradient descent' }],
    chapters: [{
      title: 'C1',
      sections: [{
        title: 'S1',
        blocks: [
          { type: 'paragraph', text: 'See [[GD]] details.' },
          { type: 'definition', term: 'LR', definition: 'Learning rate.' },
          { type: 'bullet_list', items: ['a', 'b'] },
          { type: 'formula', expression: 'y=mx+b', explanation: 'line' },
          { type: 'table', headers: ['K', 'V'], rows: [['1', '2']] },
          { type: 'warning', text: 'careful' }
        ]
      }]
    }]
  };

  test('markdown export renders blocks', async () => {
    const res = await request(app).post('/api/export/markdown').send({ book });
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/export-me\.md"/);
    expect(res.text).toContain('# Export Me');
    expect(res.text).toContain('**LR** — Learning rate.');
    expect(res.text).toContain('| K | V |');
  });

  test('html export downloads with wikilinks resolved', async () => {
    const res = await request(app).post('/api/export/html').send({ book });
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/\.html"/);
    expect(res.text).toContain('class="wikilink"');
    expect(res.text).toContain('<table>');
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

describe('GET / (live UI)', () => {
  test('serves the current UI bundle with engine markers', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('refineToggle');
    expect(res.text).toContain('notesModal');
    expect(res.text).toContain('/vendor/pdf.min.js');
  });
});
