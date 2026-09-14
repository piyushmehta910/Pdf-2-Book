/**
 * embeddings.js — swappable text embedding backend.
 *
 * `makeLocalEmbedder()` builds deterministic hashed TF-IDF vectors with no
 * dependencies. `makeEmbedder(aiConfig)` tries a remote provider first (via
 * aiProvider.embed) and falls back to the local embedder on any failure, so
 * the rest of the pipeline always has a working embedder.
 *
 * Embedder contract (kept synchronous where possible so legacy callers stay
 * sync):
 *   {
 *     mode: 'local' | 'remote',
 *     dim: number,
 *     embed: (texts: string[]) => number[][]   // normalized-ish vectors
 *     similarity: (a: number[], b: number[]) => number
 *   }
 */

const { buildIdf, tfidfVector, cosineSimilarity } = require('./similarity');

const DIM = 256;
// FNV-1a style hash so identical tokens always land in the same dimension.
function hashToDim(token, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h % DIM;
}

function makeLocalEmbedder() {
  let idfMap = null;
  // lazy IDF refresh keeps embedding consistent across batches in one
  // pipeline run; callers can rebuild() when the corpus changes.
  const rebuild = (texts) => { idfMap = buildIdf(texts); };

  function vectorsFor(texts) {
    const tfidf = texts.map((t) => tfidfVector(t, idfMap || new Map()));
    return tfidf.map((vec) => {
      const out = new Array(DIM).fill(0);
      for (const [token, weight] of vec) {
        out[hashToDim(token, 0x9E3779B9)] += weight;
      }
      const norm = Math.sqrt(out.reduce((s, v) => s + v * v, 0)) || 1;
      for (let i = 0; i < out.length; i++) out[i] /= norm;
      return out;
    });
  }

  return {
    mode: 'local',
    dim: DIM,
    rebuild,
    embed: (texts) => {
      if (!idfMap) rebuild(texts);
      return vectorsFor(texts);
    },
    similarity: (a, b) => cosineSimilarity(new Map(a.map((v, i) => [i, v])), new Map(b.map((v, i) => [i, v])))
  };
}

function vectorsSimilarity(a, b) {
  if (!a || !b || !a.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function makeEmbedder(aiConfig, aiProvider) {
  if (aiProvider && aiProvider.embed && aiConfig && aiProvider.available(aiConfig)) {
    try {
      // Probe with one short string; if it resolves, remote embedding works.
      const probe = await aiProvider.embed(['probe'], aiConfig);
      if (probe && probe[0] && probe[0].length) {
        return {
          mode: 'remote',
          dim: probe[0].length,
          embed: async (texts) => {
            try {
              const out = await aiProvider.embed(texts, aiConfig);
              return out && out.length === texts.length ? out : null;
            } catch (_err) {
              return null;
            }
          },
          similarity: vectorsSimilarity
        };
      }
    } catch (_err) {
      // fall through to local
    }
  }
  return makeLocalEmbedder();
}

/** Precompute sync embedder from remote vectors so the rest of the pipeline can stay synchronous. */
async function resolveSyncEmbedder(embedder, texts) {
  const local = makeLocalEmbedder();
  if (!embedder || embedder.mode === 'local') {
    local.rebuild(texts);
    return { embedder: local, vectors: local.embed(texts) };
  }
  const vectors = await embedder.embed(texts);
  if (!vectors) {
    local.rebuild(texts);
    return { embedder: local, vectors: local.embed(texts) };
  }
  // A sync facade over the already-computed vectors lets detectDuplicates /
  // clustering reuse the cached remote embeddings without double calls.
  const cached = (ts) => ts.map((_, i) => vectors[i] || new Array(embedder.dim).fill(0));
  return {
    embedder: { mode: 'remote', dim: embedder.dim, embed: cached, similarity: embedder.similarity },
    vectors
  };
}

module.exports = {
  makeLocalEmbedder,
  makeEmbedder,
  resolveSyncEmbedder,
  vectorsSimilarity,
  DIM
};