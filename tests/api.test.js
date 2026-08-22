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
});
