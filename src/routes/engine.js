/**
 * Stateless v3 engine API (master spec §23-29). The client owns the KB
 * (IndexedDB); every endpoint is a pure request->response transform so it can
 * run inside Vercel's 60s serverless window.
 */
const express = require('express');
const aiProvider = require('../services/aiProvider');
const knowledgeBase = require('../services/knowledgeBase');
const semanticResolver = require('../services/semanticResolver');
const ocrCleaner = require('../services/ocrCleaner');
const { extractFromPage } = require('../services/knowledgeExtractor');
const { planFromDigest } = require('../services/bookPlanner');
const { writeChapter, rewriteSection } = require('../services/bookWriter');
const { runQa } = require('../services/bookQa');
const bookPresets = require('../services/bookPresets');
const { slugify, toMarkdown, toHtml, toProjectJson } = require('../services/exporterv2');
const { termVector, cosineSimilarity } = require('../services/similarity');
const { SlidingWindow } = require('../services/contextManager');

const router = express.Router();

/** Per-session sliding context windows, keyed by documentId. */
const slidingWindows = new Map();
function getSlidingWindow(docId, windowSize) {
  const ws = Number(windowSize) || 5;
  const key = docId + '_w' + ws;
  if (!slidingWindows.has(key)) {
    slidingWindows.set(key, new SlidingWindow({ windowSize: ws }));
  }
  return slidingWindows.get(key);
}

function aiConfigFromRequest(req) {
  const raw = req.headers['x-ai-config'];
  if (!raw) return {};
  try {
    const c = JSON.parse(raw);
    return {
      provider: typeof c.provider === 'string' ? c.provider.slice(0, 32) : undefined,
      apiKey: typeof c.apiKey === 'string' ? c.apiKey.slice(0, 512) : undefined,
      model: typeof c.model === 'string' ? c.model.slice(0, 128) : undefined
    };
  } catch (_err) {
    return {};
  }
}

/* ---------- presets & design metadata ---------- */

router.get('/presets', (_req, res) => {
  res.json({
    presets: bookPresets.describeBookTypes(),
    designs: bookPresets.describeDesigns(),
    pageSizes: bookPresets.describePageSizes(),
    defaultPreset: bookPresets.DEFAULT_PRESET_ID,
    defaultDesign: bookPresets.DEFAULT_DESIGN_ID,
    defaultPageSize: bookPresets.DEFAULT_PAGE_SIZE_ID
  });
});

/* ---------- knowledge extraction loop ---------- */

router.post('/knowledge/extract', async (req, res) => {
  try {
    const body = req.body || {};
    const pageText = String(body.pageText || '');
    if (pageText.trim().length < 10) return res.status(400).json({ error: 'pageText must contain readable text' });

    const kb = knowledgeBase.sanitizeKb(body.kb);
    const cleaned = ocrCleaner.cleanOcr(pageText);

    const meta = {
      document_id: String(body.documentId || 'doc').slice(0, 80),
      page: Number(body.pageNumber) || 1,
      file_name: String(body.fileName || '').slice(0, 160)
    };

    const docId = String(body.documentId || 'doc').slice(0, 80);
    const sw = getSlidingWindow(docId, body.contextWindowSize);
    const slidingCtx = sw.buildContextPayload();

    const { extraction, mode, degraded, reason } = await extractFromPage(
      {
        pageText: cleaned.cleaned,
        docContext: body.docContext,
        recentTopics: Array.isArray(body.recentTopics) ? body.recentTopics.map((t) => String(t).slice(0, 80)).slice(0, 30) : [],
        slidingWindow: slidingCtx
      },
      aiConfigFromRequest(req)
    );

    sw.recordPage(extraction);

    const result = knowledgeBase.applyExtraction(kb, extraction, meta);
    res.json({
      kb,
      stats: result.stats,
      kbStats: knowledgeBase.kbStats(kb),
      digest: knowledgeBase.kbDigest(kb),
      ocr: cleaned.stats,
      mode,
      degraded: Boolean(degraded),
      reason: reason || null
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/knowledge/adjudicate', async (req, res) => {
  try {
    const body = req.body || {};
    const a = body.a || {};
    const b = body.b || {};
    if (!String(a.name || '').trim() || !String(b.name || '').trim()) {
      return res.status(400).json({ error: 'Both candidate topics (a.name, b.name) are required' });
    }
    const aiConfig = aiConfigFromRequest(req);
    if (!aiProvider.available(aiConfig)) {
      return res.status(400).json({ error: 'Adjudication requires an AI key (x-ai-config header)' });
    }
    const raw = await aiProvider.complete(
      'You decide whether two candidate topics from a knowledge base are the SAME concept or DIFFERENT concepts. Reply with STRICT JSON only: {"verdict":"merge"|"separate","confidence":number,"reason":string}. Confidence 0-1.',
      `TOPIC A: ${JSON.stringify({ name: String(a.name).slice(0, 120), summary: String(a.summary || '').slice(0, 600), facts: Array.isArray(a.facts) ? a.facts.slice(0, 5).map(String) : [] })}\n\nTOPIC B: ${JSON.stringify({ name: String(b.name).slice(0, 120), summary: String(b.summary || '').slice(0, 600), facts: Array.isArray(b.facts) ? b.facts.slice(0, 5).map(String) : [] })}\n\nCONTEXT: ${String(body.context || '').slice(0, 400)}`,
      { maxTokens: 300, temperature: 0.1, timeoutMs: 25000 },
      aiConfig
    );
    const parsed = require('../services/jsonUtils').parseJsonLoose(raw);
    const verdict = parsed.verdict === 'merge' ? 'merge' : 'separate';
    const confidence = Number(parsed.confidence);
    res.json({
      verdict,
      confidence: Number.isFinite(confidence) ? Math.min(Math.max(confidence, 0), 1) : 0.5,
      reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 500) : ''
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/knowledge/consolidate', (req, res) => {
  try {
    const kb = knowledgeBase.sanitizeKb((req.body || {}).kb);
    const merged = [];
    const review = [];
    const ids = kb.topics.filter((t) => !t.excluded).map((t) => t.id);

    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = kb.topics.find((t) => t.id === ids[i]);
        const b = kb.topics.find((t) => t.id === ids[j]);
        if (!a || !b || a.id === b.id || a.excluded || b.excluded) continue;

        const normA = semanticResolver.normalizeName(a.canonical_name);
        const normB = semanticResolver.normalizeName(b.canonical_name);
        const isNameMatch = normA === normB ||
          (a.aliases || []).some((al) => semanticResolver.normalizeName(al) === normB) ||
          (b.aliases || []).some((bl) => semanticResolver.normalizeName(bl) === normA);

        let score = isNameMatch ? 1.0 : 0;
        if (!isNameMatch) {
          const tvA = termVector(semanticResolver.topicSignature(a));
          const tvB = termVector(semanticResolver.topicSignature(b));
          score = cosineSimilarity(tvA, tvB);
        }

        if (isNameMatch || score >= semanticResolver.THRESHOLDS.AUTO_MERGE) {
          knowledgeBase.mergeTopics(kb, a.id, b.id);
          merged.push({ kept: a.canonical_name, absorbed: b.canonical_name, score: Number(score.toFixed(3)) });
        } else if (score >= semanticResolver.THRESHOLDS.REVIEW) {
          review.push({ a: { id: a.id, name: a.canonical_name }, b: { id: b.id, name: b.canonical_name }, score: Number(score.toFixed(3)) });
        }
      }
    }
    res.json({
      kb,
      report: { merged, review: review.slice(0, 50), thresholds: semanticResolver.THRESHOLDS },
      kbStats: knowledgeBase.kbStats(kb)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------- AI Source Search (master spec §23) ---------- */

router.post('/sources/search', async (req, res) => {
  try {
    const body = req.body || {};
    const query = String(body.query || '').trim();
    if (!query) return res.status(400).json({ error: 'Search query is required' });
    const sources = Array.isArray(body.sources) ? body.sources : [];

    const queryVec = termVector(query.toLowerCase());
    const matches = [];

    for (const src of sources) {
      for (const p of src.pages || []) {
        const text = String(p.text || '');
        if (!text.trim()) continue;
        const pageVec = termVector(text.toLowerCase());
        const sim = cosineSimilarity(queryVec, pageVec);
        const lowerText = text.toLowerCase();
        const includesQuery = lowerText.includes(query.toLowerCase());

        if (sim > 0.08 || includesQuery) {
          matches.push({
            sourceId: src.id,
            sourceTitle: src.title || src.name || 'Source',
            pageNumber: p.pageNumber || 1,
            score: Number((sim + (includesQuery ? 0.3 : 0)).toFixed(3)),
            snippet: text.slice(0, 400)
          });
        }
      }
    }

    matches.sort((a, b) => b.score - a.score);
    const topMatches = matches.slice(0, 8);

    const aiConfig = aiConfigFromRequest(req);
    let answer = '';

    if (aiProvider.available(aiConfig) && topMatches.length) {
      try {
        const context = topMatches.map((m) => `[Source: ${m.sourceTitle}, Page ${m.pageNumber}]: ${m.snippet}`).join('\n\n');
        answer = await aiProvider.complete(
          'You are a research assistant answering questions strictly from the provided source excerpts. Always cite your sources in brackets like [Paper A, p. 12]. Never invent facts.',
          `QUESTION: ${query}\n\nEXCERPTS:\n${context}`,
          { maxTokens: 800, temperature: 0.2, timeoutMs: 20000 },
          aiConfig
        );
      } catch (_e) {
        answer = topMatches.length ? `Found ${topMatches.length} matching excerpts in sources.` : 'No answer generated.';
      }
    }

    res.json({
      query,
      answer: answer || (topMatches.length ? `Found ${topMatches.length} matching excerpts.` : 'No matching evidence found in uploaded sources.'),
      matches: topMatches
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------- book planning / writing / QA / section rewrite ---------- */

router.post('/book/plan', async (req, res) => {
  try {
    const body = req.body || {};
    const digest = Array.isArray(body.digest) ? body.digest.slice(0, 90) : [];
    if (!digest.length) return res.status(400).json({ error: 'digest (topic list) is required' });
    const result = await planFromDigest(
      {
        title: String(body.title || '').slice(0, 160),
        digest,
        presetId: bookPresets.presetExists(body.presetId) ? body.presetId : undefined
      },
      aiConfigFromRequest(req)
    );
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/book/write', async (req, res) => {
  try {
    const body = req.body || {};
    const chapter = body.chapter && typeof body.chapter === 'object' ? body.chapter : null;
    if (!chapter || typeof chapter.title !== 'string') return res.status(400).json({ error: 'chapter.title is required' });
    const kbSlice = Array.isArray(body.kbSlice) ? body.kbSlice : [];
    if (!kbSlice.length) return res.status(400).json({ error: 'kbSlice (retrieved topics) is required' });
    const result = await writeChapter(
      {
        title: String(body.title || '').slice(0, 160),
        chapter: { title: chapter.title.slice(0, 140), purpose: String(chapter.purpose || '').slice(0, 300), topicIds: chapter.topicIds || [] },
        presetId: bookPresets.presetExists(body.presetId) ? body.presetId : undefined,
        kbSlice,
        recentSummaries: Array.isArray(body.recentSummaries) ? body.recentSummaries.map((s) => String(s).slice(0, 700)).slice(-4) : []
      },
      aiConfigFromRequest(req)
    );
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/book/section/rewrite', async (req, res) => {
  try {
    const body = req.body || {};
    const section = body.section;
    if (!section || !Array.isArray(section.blocks)) {
      return res.status(400).json({ error: 'section with blocks array is required' });
    }
    const result = await rewriteSection(
      {
        section,
        action: body.action || 'rewrite',
        customInstruction: String(body.customInstruction || '').slice(0, 500),
        presetId: body.presetId,
        kbSlice: Array.isArray(body.kbSlice) ? body.kbSlice : undefined
      },
      aiConfigFromRequest(req)
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/book/qa', (req, res) => {
  try {
    const body = req.body || {};
    res.json(runQa(body.book, body.kb));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------- exports (block-based final book JSON) ---------- */

router.post('/export/:format', (req, res) => {
  try {
    const body = req.body || {};
    const book = body.book || {};
    if (!Array.isArray(book.chapters) || !book.chapters.length) {
      return res.status(400).json({ error: 'No chapters to export' });
    }
    const base = slugify(book.title || 'book') || 'book';
    const attach = (name, type, content) => {
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      res.type(type).send(content);
    };
    const format = (req.params.format || '').toLowerCase();
    if (format === 'markdown' || format === 'md') {
      attach(`${base}.md`, 'text/markdown; charset=utf-8', toMarkdown(book));
    } else if (format === 'html') {
      attach(`${base}.html`, 'text/html; charset=utf-8', toHtml(book, body.design || 'modern', body.pageSize || 'trade_6x9'));
    } else if (format === 'json') {
      attach(`${base}.json`, 'application/json; charset=utf-8', toProjectJson(book, body.kb || null));
    } else {
      res.status(400).json({ error: 'Unsupported format. Use markdown, html, json.' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
