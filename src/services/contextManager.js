/**
 * ContextManager — relevance-ranked chunk selection + sliding context window
 * for anti-regression and narrative continuity across pages.
 */
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

/**
 * Sliding Context Window — tracks recent pages to prevent anti-regression
 * and maintain narrative continuity across multi-page documents.
 *
 * Maintains:
 *  - Recent page summaries (last N pages, configurable)
 *  - Open questions carried forward
 *  - Already-covered topics list
 *  - Continuity notes chain
 */
class SlidingWindow {
  /**
   * @param {object} opts
   * @param {number} opts.windowSize - number of recent pages to keep (default 5)
   * @param {number} opts.maxTopics - max already-covered topics to inject (default 30)
   * @param {number} opts.maxOpenQuestions - max open questions to carry (default 10)
   */
  constructor(opts) {
    this.windowSize = (opts && opts.windowSize) || 5;
    this.maxTopics = (opts && opts.maxTopics) || 30;
    this.maxOpenQuestions = (opts && opts.maxOpenQuestions) || 10;
    this.recentPages = [];       // { pageNum, summary, topics, continuityNote }
    this.coveredTopics = [];     // ordered list of topic names encountered
    this.openQuestions = [];     // questions carried forward until answered
    this.allSummaries = [];      // full history for context injection
  }

  /**
   * Record an extraction result from a processed page.
   * @param {object} extraction - normalized extraction output
   */
  recordPage(extraction) {
    if (!extraction || typeof extraction !== 'object') return;

    const pageNum = extraction.pageNum || this.recentPages.length + 1;
    const summary = extraction.summary || extraction.page_summary || '';
    const topics = Array.isArray(extraction.topics) ? extraction.topics : [];
    const continuityNote = extraction.continuityNote || '';
    const openQs = Array.isArray(extraction.openQuestions) ? extraction.openQuestions : [];
    const newInsights = Array.isArray(extraction.newInsights) ? extraction.newInsights : [];

    this.recentPages.push({ pageNum, summary, topics, continuityNote, openQs, newInsights });
    if (this.recentPages.length > this.windowSize) {
      this.recentPages.shift();
    }

    // Track covered topics (deduplicate, keep most recent position)
    for (const t of topics) {
      const norm = t.toLowerCase().trim();
      if (!norm) continue;
      const idx = this.coveredTopics.findIndex((ct) => ct.toLowerCase() === norm);
      if (idx >= 0) this.coveredTopics.splice(idx, 1);
      this.coveredTopics.push(t);
    }
    if (this.coveredTopics.length > this.maxTopics) {
      this.coveredTopics = this.coveredTopics.slice(-this.maxTopics);
    }

    // Process open questions: add new ones, mark answered ones
    for (const q of openQs) {
      const norm = q.toLowerCase().trim();
      if (!norm) continue;
      // Check if this question is already tracked
      const existing = this.openQuestions.find((oq) => oq.toLowerCase() === norm);
      if (!existing) {
        this.openQuestions.push(q);
      }
    }

    // Check if any open questions were answered by this page's new insights
    const insightsText = newInsights.join(' ').toLowerCase() + ' ' + summary.toLowerCase();
    this.openQuestions = this.openQuestions.filter((q) => {
      const qWords = q.toLowerCase().replace(/[?!.,]/g, '').split(/\s+/).filter((w) => w.length > 3);
      const answered = qWords.filter((w) => insightsText.includes(w)).length;
      return answered < Math.ceil(qWords.length * 0.5);
    });
    if (this.openQuestions.length > this.maxOpenQuestions) {
      this.openQuestions = this.openQuestions.slice(-this.maxOpenQuestions);
    }

    this.allSummaries.push({ pageNum, summary });
  }

  /**
   * Build the sliding context object for injection into the next extraction prompt.
   * @returns {object} { recentSummaries, openQuestions, coveredTopics, startPage }
   */
  buildContextPayload() {
    const startPage = this.recentPages.length > 0
      ? this.recentPages[0].pageNum
      : 1;
    return {
      recentSummaries: this.recentPages.map((p) => p.summary).filter(Boolean),
      openQuestions: this.openQuestions.slice(),
      coveredTopics: this.coveredTopics.slice(),
      startPage,
      windowSize: this.recentPages.length
    };
  }

  /**
   * Check if a topic was already covered (anti-regression).
   * @param {string} topicName
   * @returns {boolean}
   */
  isAlreadyCovered(topicName) {
    const norm = topicName.toLowerCase().trim();
    return this.coveredTopics.some((t) => t.toLowerCase() === norm);
  }

  /**
   * Get a continuity note describing how a new page connects to recent context.
   * @param {object} extraction
   * @returns {string}
   */
  continuityNoteFor(extraction) {
    if (!this.recentPages.length) return 'First page — no prior context.';
    const newTopics = (extraction.topics || []).filter((t) => !this.isAlreadyCovered(t));
    const returningTopics = (extraction.topics || []).filter((t) => this.isAlreadyCovered(t));
    const parts = [];
    if (newTopics.length) parts.push(`New topics introduced: ${newTopics.join(', ')}`);
    if (returningTopics.length) parts.push(`Continues from earlier: ${returningTopics.join(', ')}`);
    if (extraction.openQuestions && extraction.openQuestions.length) {
      parts.push(`Raises ${extraction.openQuestions.length} open question(s)`);
    }
    return parts.join('. ') || 'Connects to ongoing discussion.';
  }

  /** Get summary statistics about the window state. */
  stats() {
    return {
      windowPages: this.recentPages.length,
      coveredTopics: this.coveredTopics.length,
      openQuestions: this.openQuestions.length,
      totalPages: this.allSummaries.length
    };
  }
}

module.exports = { buildContext, tokenize, scoreRelevance, truncateOnBoundary, SlidingWindow };
