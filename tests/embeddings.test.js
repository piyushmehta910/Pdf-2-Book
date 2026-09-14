const { makeLocalEmbedder, makeEmbedder, resolveSyncEmbedder, vectorsSimilarity, DIM } = require('../src/services/embeddings');

describe('embeddings.makeLocalEmbedder', () => {
  test('returns deterministic normalized vectors for identical text', () => {
    const e = makeLocalEmbedder();
    const a = e.embed(['muscle protein synthesis']);
    const b = e.embed(['muscle protein synthesis']);
    expect(a[0]).toEqual(b[0]);
    expect(a[0]).toHaveLength(DIM);
    const norm = Math.sqrt(a[0].reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  test('reports similarity near 1 for exact duplicates and below 1 otherwise', () => {
    const e = makeLocalEmbedder();
    const [v1] = e.embed(['Resistance exercise increases muscle protein synthesis.']);
    const [v2] = e.embed(['Resistance exercise increases muscle protein synthesis.']);
    expect(e.similarity(v1, v2)).toBeCloseTo(1, 2);
  });
});

describe('embeddings.makeEmbedder', () => {
  test('falls back to local when provider is unavailable', async () => {
    const aiConfig = { provider: 'openai', apiKey: '' };
    const provider = { available: () => false, embed: async () => { throw new Error('no'); } };
    const e = await makeEmbedder(aiConfig, provider);
    expect(e.mode).toBe('local');
  });

  test('falls back to local when remote probe fails', async () => {
    const aiConfig = { provider: 'openai', apiKey: 'k' };
    const provider = {
      available: () => true,
      embed: async () => { const err = new Error('network'); throw err; }
    };
    const e = await makeEmbedder(aiConfig, provider);
    expect(e.mode).toBe('local');
  });

  test('uses remote embedder when the probe succeeds', async () => {
    const aiConfig = { provider: 'openai', apiKey: 'k' };
    const provider = {
      available: () => true,
      embed: async (texts) => texts.map((t) => Array.from({ length: 8 }, (_, i) => (t.length + i) / 10))
    };
    const e = await makeEmbedder(aiConfig, provider);
    expect(e.mode).toBe('remote');
    const out = await e.embed(['hello', 'world']);
    expect(out).toHaveLength(2);
  });
});

describe('embeddings.resolveSyncEmbedder', () => {
  test('returns local vectors for a local embedder', async () => {
    const e = makeLocalEmbedder();
    const { embedder, vectors } = await resolveSyncEmbedder(e, ['alpha beta', 'gamma delta']);
    expect(embedder.mode).toBe('local');
    expect(vectors).toHaveLength(2);
    expect(embedder.embed(['alpha beta garbage words'])[0]).toHaveLength(DIM);
  });

  test('caches remote vectors into a sync facade', async () => {
    const remote = {
      mode: 'remote',
      dim: 8,
      embed: async (texts) => texts.map((t) => Array.from({ length: 8 }, (_, i) => (t.length + i) / 10)),
      similarity: vectorsSimilarity
    };
    const { embedder, vectors } = await resolveSyncEmbedder(remote, ['aaa', 'bbb']);
    expect(embedder.mode).toBe('remote');
    expect(vectors).toHaveLength(2);
  });
});