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
const { writeChapter } = require('../services/bookWriter');
const { runQa } = require('../services/bookQa');
const bookPresets = require('../services/bookPresets');
const { slugify, toMarkdown, toHtml, toProjectJson } = require('../services/exporterv2');

const router = express.Router();

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

/* ---------- presets ---------- */

router.get('/presets', (_req, res) => {
  res.json({ presets: bookPresets.describe(), defaultPreset: bookPresets.DEFAULT_PRESET_ID });
});

/* ---------- knowledge extraction loop ---------- */

router.post('/knowledge/extract', async (req, res) => {
  try {
    const body = req.body || {};
    const pageText = String(body.pageText || '');
    if (pageText.trim().length < 10) return res.status(400).json({ error: 'pageText must contain readable text' });

    const kb = knowledgeBase.sanitizeKb(body.kb);
    // deterministic cleanup first (idempotent; client may have pre-cleaned)
    const cleaned = ocrCleaner.cleanOcr(pageText);

    const meta = {
      document_id: String(body.documentId || 'doc').slice(0, 80),
      page: Number(body.pageNumber) || 1,
      file_name: String(body.fileName || '').slice(0, 160)
    };

    const { extraction, mode, degraded, reason } = await extractFromPage(
      {
        pageText: cleaned.cleaned,
        docContext: body.docContext,
        recentTopics: Array.isArray(body.recentTopics) ? body.recentTopics.map((t) => String(t).slice(0, 80)).slice(0, 30) : []
      },
      aiConfigFromRequest(req)
    );

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
  const aiConfig = aiConfigFromRequest(req);
  if (!aiProvider.available(aiConfig)) {
    return res.status(400).json({ error: 'Adjudication requires an AI key (x-ai-config header)' });
  }
  try {
    const body = req.body || {};
    const a = body.a || {};
    const b = body.b || {};
    if (!String(a.name || '').trim() || !String(b.name || '').trim()) {
      return res.status(400).json({ error: 'Both candidate topics (a.name, b.name) are required' });
    }
    const raw = await aiProvider.complete(
      'You decide whether two candidate topics from a knowledge base are the SAME concept or DIFFERENT concepts. Reply with STRICT JSON only: {"verdict":"merge"|"separate","confidence":number,"reason":string}. Confidence 0-1.',
      `TOPIC A: ${JSON.stringify({ name: String(a.name).slice(0, 120), summary: String(a.summary || '').slice(0, 600), facts: Array.isArray(a.facts) ? a.facts.slice(0, 5).map(String) : [] })}\n\nTOPIC B: ${JSON.stringify({ name: String(b.name).slice(0, 120), summary: String(b.summary || '').slice(0, 600), facts: Array.isArray(b.facts) ? b.facts.slice(0, 5).map(String) : [] })}\n\nCONTEXT: ${String(body.context || '').slice(0, 400)}`,
      { maxTokens: 300, temperature: 0.1, timeoutMs: 25000 },
      aiConfig
    );
    const parsed = JSON.parse(require('../services/jsonUtils').parseJsonLoose(raw));
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
        const verdict = semanticResolver.resolveTopic(kb, b.canonical_name, semanticResolver.topicSignature(b), a.id);
        if (verdict.verdict === 'strong' || verdict.score >= semanticResolver.THRESHOLDS.AUTO_MERGE) {
          knowledgeBase.mergeTopics(kb, a.id, b.id);
          merged.push({ kept: a.canonical_name, absorbed: b.canonical_name, score: Number(verdict.score.toFixed(3)) });
        } else if (verdict.verdict === 'review') {
          review.push({ a: { id: a.id, name: a.canonical_name }, b: { id: b.id, name: b.canonical_name }, score: Number(verdict.score.toFixed(3)) });
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

/* ---------- book planning / writing / QA ---------- */

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
    if (req.params.format === 'markdown') {
      attach(`${base}.md`, 'text/markdown; charset=utf-8', toMarkdown(book));
    } else if (req.params.format === 'html') {
      attach(`${base}.html`, 'text/html; charset=utf-8', toHtml(book));
    } else if (req.params.format === 'json') {
      attach(`${base}.json`, 'application/json; charset=utf-8', toProjectJson(book, body.kb || null));
    } else {
      res.status(400).json({ error: 'Unsupported format. Use markdown, html or json.' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
