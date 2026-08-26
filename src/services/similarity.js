/**
 * Similarity — TF-IDF weighted cosine similarity, Jaccard index, and keyword extraction.
 * Used for topic deduplication, duplicate detection, and content matching.
 */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'of', 'to', 'for', 'is', 'are', 'was', 'were',
  'be', 'been', 'being', 'with', 'as', 'by', 'that', 'this', 'it', 'its', 'from', 'at', 'not',
  'can', 'may', 'which', 'we', 'our', 'their', 'they', 'have', 'has', 'had', 'also', 'into',
  'than', 'then', 'when', 'where', 'how', 'what', 'who', 'whom', 'each', 'more', 'most',
  'some', 'such', 'only', 'other', 'over', 'very', 'just', 'about', 'above', 'after', 'before',
  'between', 'through', 'during', 'under', 'same', 'own', 'both', 'few', 'too', 'well', 'back',
  'even', 'still', 'new', 'now', 'way', 'many', 'any', 'like', 'make', 'use', 'used', 'using'
]);

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/** Raw term frequency vector (unweighted). */
function termVector(text) {
  const vector = new Map();
  for (const token of tokenize(text)) {
    vector.set(token, (vector.get(token) || 0) + 1);
  }
  return vector;
}

/** TF-IDF weighted vector. Requires a pre-computed IDF map. */
function tfidfVector(text, idfMap) {
  const tf = new Map();
  const tokens = tokenize(text);
  for (const token of tokens) {
    tf.set(token, (tf.get(token) || 0) + 1);
  }
  const vector = new Map();
  for (const [term, freq] of tf) {
    const idf = idfMap.get(term) || 1;
    vector.set(term, freq * idf);
  }
  return vector;
}

/** Build an IDF map from a corpus of text strings. */
function buildIdf(texts) {
  const docFreq = new Map();
  const total = texts.length || 1;
  for (const text of texts) {
    const unique = new Set(tokenize(text));
    for (const token of unique) {
      docFreq.set(token, (docFreq.get(token) || 0) + 1);
    }
  }
  const idf = new Map();
  for (const [term, df] of docFreq) {
    idf.set(term, Math.log((total + 1) / (df + 1)) + 1);
  }
  return idf;
}

/** Cosine similarity between two term-vectors (Map<term, weight>). */
function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [, value] of a) normA += value * value;
  for (const [token, value] of b) {
    normB += value * value;
    if (a.has(token)) dot += a.get(token) * value;
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Jaccard similarity between two token sets. */
function jaccardSimilarity(textA, textB) {
  const setA = new Set(tokenize(textA));
  const setB = new Set(tokenize(textB));
  if (!setA.size && !setB.size) return 0;
  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Combined text similarity: weighted blend of TF-IDF cosine + Jaccard.
 * @param {string} textA
 * @param {string} textB
 * @param {Map} [idfMap] - optional pre-built IDF map for TF-IDF weighting
 * @param {object} [opts] - { cosineWeight: 0.7, jaccardWeight: 0.3 }
 */
function textSimilarity(textA, textB, idfMap, opts) {
  const w = opts || {};
  const cosW = typeof w.cosineWeight === 'number' ? w.cosineWeight : 0.7;
  const jacW = typeof w.jaccardWeight === 'number' ? w.jaccardWeight : 0.3;

  let cosSim;
  if (idfMap && idfMap instanceof Map) {
    cosSim = cosineSimilarity(tfidfVector(textA, idfMap), tfidfVector(textB, idfMap));
  } else {
    cosSim = cosineSimilarity(termVector(textA), termVector(textB));
  }
  const jacSim = jaccardSimilarity(textA, textB);
  return cosSim * cosW + jacSim * jacW;
}

/** Extract the top N keywords by frequency from an array of texts. */
function topKeywords(texts, limit = 8) {
  const combined = new Map();
  for (const text of texts) {
    for (const token of tokenize(text)) {
      combined.set(token, (combined.get(token) || 0) + 1);
    }
  }
  return [...combined.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word]) => word);
}

module.exports = { tokenize, termVector, tfidfVector, buildIdf, cosineSimilarity, jaccardSimilarity, textSimilarity, topKeywords };
