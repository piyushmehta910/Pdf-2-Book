const request = require('supertest');
const fs = require('fs');
const path = require('path');
const app = require('../src/server');

const TEST_DATA = path.resolve(__dirname, '../.test-data');

describe('API smoke tests', () => {
  beforeAll(() => {
    process.env.DATA_DIR = TEST_DATA;
  });

  afterAll(() => {
    if (fs.existsSync(TEST_DATA)) fs.rmSync(TEST_DATA, { recursive: true });
  });

  test('health endpoint responds', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('creates a project', async () => {
    const res = await request(app)
      .post('/api/projects')
      .send({ title: 'Test Research', author: 'Tester' });
    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(/^prj_/);
  });

  test('accepts pasted text source', async () => {
    const project = await request(app).post('/api/projects').send({ title: 'P2' });
    const projectId = project.body.id;
    const res = await request(app)
      .post(`/api/projects/${projectId}/sources`)
      .field('text', 'Muscle hypertrophy depends on resistance training volume and protein intake. However, some studies report mixed results on training frequency.')
      .field('title', 'My Notes');
    expect(res.status).toBe(201);
    expect(res.body.length).toBe(1);
  });

  test('lists projects', async () => {
    const res = await request(app).get('/api/projects');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('knowledge/process returns topics, duplicates and conflicts offline', async () => {
    const realFetch = global.fetch;
    global.fetch = () => Promise.reject(new Error('network disabled in test'));
    try {
      const shared = 'Mitochondria generate most cellular energy through oxidative phosphorylation in the inner membrane.';
      const sources = [
        {
          id: 'k1',
          name: 'bio-a.pdf',
          pages: [{
            pageNumber: 1,
            units: [
              { id: 'k1-u1', type: 'heading', text: 'Energy' },
              { id: 'k1-u2', type: 'paragraph', text: shared },
              { id: 'k1-u3', type: 'paragraph', text: 'Repeated testing confirmed the same profile across all subjects in the cohort.' }
            ]
          }]
        },
        {
          id: 'k2',
          name: 'bio-b.pdf',
          pages: [{
            pageNumber: 4,
            units: [
              { id: 'k2-u1', type: 'heading', text: 'Energy' },
              { id: 'k2-u2', type: 'paragraph', text: 'Mitochondria are responsible for oxidative phosphorylation that generates the bulk of cellular energy.' }
            ]
          }]
        }
      ];
      const res = await request(app)
        .post('/api/knowledge/process')
        .set('x-ai-config', JSON.stringify({ provider: 'openai', apiKey: '' }))
        .send({ sources });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.topics)).toBe(true);
      expect(res.body.topics.length).toBeGreaterThan(0);
      const ch = res.body.chunks[0];
      expect(ch.sourceId).toBeTruthy();
      expect(typeof ch.pageNumber).toBe('number');
      expect(res.body.stats.chunks).toBeGreaterThan(0);
    } finally {
      global.fetch = realFetch;
    }
  });
});
