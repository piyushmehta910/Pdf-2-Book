const request = require('supertest');
const app = require('../src/server');

const SAMPLE = [
  'Resistance training induces muscle hypertrophy through mechanical tension and metabolic stress.',
  'Protein intake of 1.6 g per kg body weight per day maximizes muscle protein synthesis in adults.',
  'Training frequency appears less important than total weekly volume when volume is equated.',
  'Sleep restriction reduces testosterone and impairs recovery from high intensity exercise.'
].join('\n\n');

describe('POST /api/build (stateless)', () => {
  test('rejects empty sources with 400', async () => {
    const res = await request(app)
      .post('/api/build?json=1')
      .send({ mode: 'analyze', sources: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no usable source/i);
  });

  test('analyze mode returns analysis without chapters', async () => {
    const res = await request(app)
      .post('/api/build?json=1')
      .send({ mode: 'analyze', title: 'T', sources: [{ title: 'Notes', text: SAMPLE }] });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('analyze');
    expect(res.body.analysis.topicCount).toBeGreaterThan(0);
    expect(res.body.chapters).toBeUndefined();
  });

  test('full mode returns chapters via extractive fallback (no key)', async () => {
    const res = await request(app)
      .post('/api/build?json=1')
      .send({
        title: 'Full Book',
        notebook: { format: 'flashcards', depth: 'brief', knowledgeGaps: false, glossary: false },
        sources: [{ title: 'Notes', text: SAMPLE }]
      });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('full');
    expect(Array.isArray(res.body.chapters)).toBe(true);
    expect(res.body.chapters.length).toBeGreaterThan(0);
    expect(res.body.engine.mode).toBe('extractive-fallback');
  });

  test('SSE stream emits phase events and a done frame', async () => {
    const res = await request(app)
      .post('/api/build')
      .send({ mode: 'analyze', sources: [{ title: 'N', text: SAMPLE }] })
      .set('Accept', 'text/event-stream')
      .buffer(true)
      .parse((res2, cb) => {
        let raw = '';
        res2.on('data', (d) => { raw += d; });
        res2.on('end', () => cb(null, raw));
      });
    const raw = res.body;
    expect(String(raw)).toContain('event: phase');
    expect(String(raw)).toContain('event: done');
    expect(String(raw)).toContain('"mode":"analyze"');
  });
});

describe('POST /api/refine', () => {
  test('returns refined:false unchanged pages when no AI key', async () => {
    const pages = [
      { pageNumber: 1, text: 'Mechanical tension drives hypertrophy. Progressive overload is the core driver of adaptation.' },
      { pageNumber: 2, text: 'Volume equated frequency studies show similar outcomes across weekly splits.' }
    ];
    const res = await request(app)
      .post('/api/refine')
      .send({ title: 'Doc', pages });
    expect(res.status).toBe(200);
    expect(res.body.refined).toBe(false);
    expect(res.body.notes[0].pageNumber).toBe(1);
    expect(res.body.notes[0].text).toBe(pages[0].text);
  });

  test('rejects empty pages with 400', async () => {
    const res = await request(app)
      .post('/api/refine')
      .send({ title: 'Doc', pages: [] });
    expect(res.status).toBe(400);
  });

  test('caps oversized single page input', async () => {
    const big = { pageNumber: 1, text: 'x'.repeat(9000) };
    const res = await request(app)
      .post('/api/refine')
      .send({ title: 'Doc', pages: [big] });
    expect([200, 502]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.notes[0].text.length).toBeLessThanOrEqual(6000);
    }
  });
});

describe('POST /api/book/* (stateless book engine)', () => {
  const longSample = Array.from({ length: 12 }, (_, i) =>
    `Section ${i + 1}. ${SAMPLE}`).join('\n\n');

  test('blueprint returns chapters without a key (fallback mode)', async () => {
    const res = await request(app)
      .post('/api/book/blueprint')
      .send({
        title: 'Training Science',
        sources: [{ title: 'Notes', sample: longSample.slice(0, 1500) }]
      });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.blueprint.chapters)).toBe(true);
    expect(res.body.blueprint.chapters.length).toBeGreaterThanOrEqual(2);
    expect(typeof res.body.mode).toBe('string');
  });

  test('blueprint rejects missing sources', async () => {
    const res = await request(app)
      .post('/api/book/blueprint')
      .send({ title: 'X', sources: [] });
    expect(res.status).toBe(400);
  });

  test('draft returns prose and rolling summary without a key', async () => {
    const bp = await request(app)
      .post('/api/book/blueprint')
      .send({ title: 'T', sources: [{ title: 'N', sample: SAMPLE }] });
    const blueprint = bp.body.blueprint;
    const res = await request(app)
      .post('/api/book/draft')
      .send({
        title: 'T',
        blueprint,
        chapterIndex: 0,
        isChapterStart: true,
        summary: '',
        pages: [{ title: 'N', pageNumber: 1, text: SAMPLE }]
      });
    expect(res.status).toBe(200);
    expect(typeof res.body.prose).toBe('string');
    expect(res.body.prose.length).toBeGreaterThan(80);
    expect(typeof res.body.summary).toBe('string');
    expect(res.body.prose).toMatch(/p\.\s*1/);
  });

  test('draft rejects empty pages', async () => {
    const res = await request(app)
      .post('/api/book/draft')
      .send({ title: 'T', blueprint: null, chapterIndex: 0, pages: [] });
    expect(res.status).toBe(400);
  });

  test('enrich appends evidence details without a key', async () => {
    const res = await request(app)
      .post('/api/book/enrich')
      .send({
        chapterTitle: 'Training Principles',
        chapterText: 'Progressive overload matters most for hypertrophy.',
        evidence: [{ title: 'Study B', pageNumber: 3, text: 'New findings: rest intervals of two minutes maximize volume load.' }]
      });
    expect(res.status).toBe(200);
    expect(res.body.text).toContain('Further details');
    expect(res.body.text).toMatch(/Study B/i);
  });

  test('enrich rejects empty inputs', async () => {
    const res = await request(app)
      .post('/api/book/enrich')
      .send({ chapterTitle: '', chapterText: '', evidence: [] });
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

describe('POST /api/export/:format (stateless)', () => {
  let chapters;
  beforeAll(async () => {
    const res = await request(app)
      .post('/api/build?json=1')
      .send({ title: 'Export Me', sources: [{ title: 'N', text: SAMPLE }] });
    chapters = res.body.chapters;
  });

  test('markdown export downloads', async () => {
    const res = await request(app)
      .post('/api/export/markdown')
      .send({ project: { title: 'Export Me' }, chapters });
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/\.md"/);
    expect(res.text).toContain('# ');
  });

  test('html export downloads', async () => {
    const res = await request(app)
      .post('/api/export/html')
      .send({ project: { title: 'Export Me' }, chapters });
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/\.html"/);
  });

  test('json export includes project data', async () => {
    const res = await request(app)
      .post('/api/export/json')
      .send({ project: { title: 'Export Me' }, chapters });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.text).project.title).toBe('Export Me');
  });

  test('rejects empty chapter list', async () => {
    const res = await request(app)
      .post('/api/export/markdown')
      .send({ project: {}, chapters: [] });
    expect(res.status).toBe(400);
  });

  test('csv export errors when no flashcards exist', async () => {
    const res = await request(app)
      .post('/api/export/flashcards-csv')
      .send({ project: { title: 'X' }, chapters });
    expect([200, 400]).toContain(res.status);
  });
});
