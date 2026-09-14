const request = require('supertest');
const app = require('../src/server');

describe('static asset routes', () => {
  const cases = [
    { url: '/app-data.js', type: /javascript/ },
    { url: '/extract.worker.js', type: /javascript/ },
    { url: '/extract-core.js', type: /javascript/ },
    { url: '/sw.js', type: /javascript/ },
    { url: '/pwa/manifest.webmanifest', type: /json|webmanifest/ },
    { url: '/vendor/local-first.js', type: /javascript/ },
    { url: '/vendor/mammoth.browser.min.js', type: /javascript/ },
    { url: '/vendor/pdf.min.js', type: /javascript/ },
    { url: '/vendor/tesseract.min.js', type: /javascript/ }
  ];

  test.each(cases)('serves $url', async ({ url, type }) => {
    const res = await request(app).get(url);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(type);
    expect(res.text.length).toBeGreaterThan(100);
  });

  test('worker route sends no-cache headers', async () => {
    const res = await request(app).get('/extract.worker.js');
    expect(res.headers['cache-control']).toMatch(/no-store|no-cache/);
  });
});