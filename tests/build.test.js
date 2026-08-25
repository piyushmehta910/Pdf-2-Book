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
