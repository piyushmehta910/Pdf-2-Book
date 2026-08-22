const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'of', 'to', 'for', 'is', 'are', 'was', 'were',
  'be', 'been', 'being', 'with', 'as', 'by', 'that', 'this', 'it', 'its', 'from', 'at', 'not',
  'can', 'may', 'which', 'we', 'our', 'their', 'they', 'have', 'has', 'had', 'also'
]);

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function termVector(text) {
  const vector = new Map();
  for (const token of tokenize(text)) {
    vector.set(token, (vector.get(token) || 0) + 1);
  }
  return vector;
}

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

function textSimilarity(textA, textB) {
  return cosineSimilarity(termVector(textA), termVector(textB));
}

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

module.exports = { tokenize, termVector, cosineSimilarity, textSimilarity, topKeywords };
