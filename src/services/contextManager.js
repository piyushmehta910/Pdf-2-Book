const config = require('../config');

function tokenize(text) {
  return (String(text).toLowerCase().match(/[a-z][a-z0-9'-]{2,}/g) || []);
}

function scoreRelevance(text, queryTokens) {
  if (!queryTokens.length) return 0;
  const tokens = new Set(tokenize(text));
  let hits = 0;
  for (const t of queryTokens) {
    if (tokens.has(t)) hits++;
  }
  return hits / queryTokens.length;
}

function truncateOnBoundary(text, maxChars) {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, Math.max(0, maxChars - 1));
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('\n'));
  const trimmed = stop > cut.length * 0.5 ? cut.slice(0, stop + 1) : cut.trimEnd();
  return `${trimmed} …`;
}

function buildContext({ query, items = [], budgetChars, perItemCap }) {
  const budget = budgetChars || config.context.budgetChars;
  const cap = perItemCap || config.context.perChunkCap;
  const queryTokens = tokenize(query);

  const ranked = items
    .map((item) => ({ item, score: scoreRelevance(item.content, queryTokens) }))
    .sort((a, b) => b.score - a.score);

  const picked = [];
  let usedChars = 0;

  for (const { item, score } of ranked) {
    const remaining = budget - usedChars;
    if (remaining < 200) break;
    const text = truncateOnBoundary(item.content, Math.min(cap, remaining));
    usedChars += text.length;
    picked.push({ ...item, text, score: Number(score.toFixed(3)) });
  }

  return {
    picked,
    usedChunks: picked.length,
    totalItems: items.length,
    usedChars,
    budgetChars: budget
  };
}

module.exports = { buildContext, tokenize, scoreRelevance, truncateOnBoundary };
