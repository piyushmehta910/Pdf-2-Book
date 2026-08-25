const express = require('express');
const storage = require('../services/storage');
const { chunkDocument } = require('../services/chunker');
const { detectTopics, mergeSimilarTopics } = require('../services/topicDetector');
const { detectDuplicates } = require('../services/duplicateDetector');
const { detectConflicts } = require('../services/conflictDetector');
const { buildOutline } = require('../services/outlineBuilder');
const { computeCoverage } = require('../services/coverageChecker');
const { synthesizeTopic } = require('../services/synthesizer');
const { composeChapters, slugify } = require('../services/chapterComposer');
const aiProvider = require('../services/aiProvider');
const bookEngine = require('../services/bookEngine');
const { validateNotebook } = require('../services/notebookOptions');
const {
  toMarkdown, toHtml, toFlashcardsCsv, toProjectJson
} = require('../services/exporter');

const router = express.Router();

const MAX_SOURCES = 40;
const MAX_TOTAL_CHARS = 600000;
const MAX_TOPICS = 8;
const TIME_BUDGET_MS = 42000;

function aiConfigFromRequest(req) {
  const raw = req.headers['x-ai-config'];
  if (!raw) return {};
  try {
    const c = JSON.parse(raw);
    const budget = Number(c.contextBudget);
    return {
      provider: typeof c.provider === 'string' ? c.provider.slice(0, 32) : undefined,
      apiKey: typeof c.apiKey === 'string' ? c.apiKey.slice(0, 512) : undefined,
      model: typeof c.model === 'string' ? c.model.slice(0, 128) : undefined,
      contextBudget: Number.isFinite(budget) ? Math.min(Math.max(Math.round(budget), 2000), 64000) : undefined
    };
  } catch (_err) {
    return {};
  }
}

function sanitizeSources(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  let total = 0;
  for (const raw of input.slice(0, MAX_SOURCES)) {
    const s = raw || {};
    const title = String(s.title || 'Source').slice(0, 160) || 'Source';
    let pages = Array.isArray(s.pages) && s.pages.length
      ? s.pages.map((p, i) => ({ pageNumber: Number(p && p.pageNumber) || i + 1, text: String((p && p.text) || '') }))
      : [{ pageNumber: 1, text: String(s.text || '') }];
    pages = pages.filter((p) => p.text.trim()).map((p) => ({ pageNumber: p.pageNumber, text: p.text.slice(0, 200000) }));
    if (!pages.length) continue;
    for (const p of pages) {
      total += p.text.length;
      if (total > MAX_TOTAL_CHARS) break;
    }
    if (total > MAX_TOTAL_CHARS) break;
    out.push({ id: storage.id('src'), title, type: s.type === 'pdf' ? 'pdf' : 'text', pages });
  }
  return out;
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

/* ---------- page-to-notes refinement ---------- */

const REFINE_SYSTEM = 'You convert raw page text from research PDFs into clean study notes. For each page output: one short heading line beginning with "## ", then concise bullets capturing key claims, definitions, formulas, numbers and examples from that page only. Be faithful to the source; never invent facts. Keep wording tight and readable.';

function splitRefinedPages(raw, pages) {
  const out = [];
  const parts = String(raw).split(/\[\[PAGE\s*(\d+)\s*\]\]/);
  for (let i = 1; i < parts.length; i += 2) {
    const pageNumber = parseInt(parts[i], 10);
    const text = parts[i + 1].trim();
    if (text) out.push({ pageNumber, text });
  }
  if (!out.length) return pages.map((p) => ({ pageNumber: p.pageNumber, text: p.text.trim() }));
  return out;
}

router.post('/refine', async (req, res) => {
  const body = req.body || {};
  const aiConfig = aiConfigFromRequest(req);
  const pages = Array.isArray(body.pages) ? body.pages.slice(0, 12) : [];
  const clean = pages
    .map((p, i) => ({ pageNumber: Number(p && p.pageNumber) || i + 1, text: String((p && p.text) || '').slice(0, 6000) }))
    .filter((p) => p.text.trim().length > 20);

  if (!clean.length) return res.status(400).json({ error: 'No page text provided' });

  if (!aiProvider.available(aiConfig)) {
    return res.json({ refined: false, notes: clean.map((p) => ({ pageNumber: p.pageNumber, text: p.text.trim() })) });
  }

  try {
    const sourceTitle = String(body.title || 'Source').slice(0, 160);
    const bodyText = clean.map((p) => `[[PAGE ${p.pageNumber}]]\n${p.text}`).join('\n\n');
    const raw = await aiProvider.complete(
      REFINE_SYSTEM,
      `Source title: ${sourceTitle}\n\nConvert each page below into study notes. Keep every [[PAGE n]] marker exactly as written and put that page's notes under it.\n\n${bodyText}`,
      { maxTokens: 2600, temperature: 0.3 },
      aiConfig
    );
    res.json({ refined: true, notes: splitRefinedPages(raw, clean) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

async function runBuild(payload, aiConfig, notify) {
  const notebook = validateNotebook(payload.notebook || {});
  const project = {
    id: 'local',
    title: String(payload.title || 'Untitled Book').slice(0, 160),
    author: String(payload.author || '').slice(0, 120)
  };

  const sources = sanitizeSources(payload.sources);
  if (!sources.length) throw httpError(400, 'No usable source text was provided');

  notify({ phase: 'chunking', message: `Reading ${sources.length} source(s)…` });
  const chunks = [];
  for (const src of sources) chunks.push(...chunkDocument(src.id, src.pages));
  if (!chunks.length) throw httpError(400, 'Sources contained no extractable text');
  notify({ phase: 'chunking', message: `${chunks.length} passages indexed` });

  const detected = detectTopics(chunks);
  const topics = mergeSimilarTopics(detected.topics).slice(0, MAX_TOPICS);
  const duplicates = detectDuplicates(chunks);
  const conflicts = detectConflicts(chunks, duplicates);
  const outline = buildOutline(topics);
  const coverage = computeCoverage(topics, chunks);

  const analysis = {
    topicCount: topics.length,
    duplicateGroups: duplicates.length,
    conflictCount: conflicts.length,
    chapterCount: outline.chapters.length,
    coverage
  };
  notify({ phase: 'analysis', analysis, message: `${topics.length} topic(s), ${outline.chapters.length} chapter outline` });

  if (payload.mode === 'analyze') {
    return { mode: 'analyze', project, notebook, analysis };
  }

  const startedAt = Date.now();
  const timeLeft = () => TIME_BUDGET_MS - (Date.now() - startedAt);

  const syntheses = [];
  for (let i = 0; i < topics.length; i++) {
    const useAi = timeLeft() > 12000;
    const synthesis = await synthesizeTopic(
      topics[i], chunks, sources, useAi ? aiConfig : {}, notebook
    );
    syntheses.push(synthesis);
    notify({
      phase: 'writing',
      current: i + 1,
      total: topics.length,
      message: `Synthesizing topic ${i + 1}/${topics.length}: ${topics[i].name}`
    });
  }

  const deadline = Date.now() + Math.max(0, Math.min(timeLeft() - 4000, 20000));
  notify({ phase: 'composing', message: 'Composing chapters…' });
  const { chapters, polished } = await composeChapters({
    outline,
    syntheses,
    notebook,
    aiConfig: deadline > Date.now() ? aiConfig : {},
    topics,
    coverage,
    chunks,
    deadline
  });

  const available = aiProvider.available(aiConfig);
  const engine = available
    ? { provider: aiConfig.provider || null, model: aiConfig.model || null, mode: polished ? 'ai-polished' : 'ai' }
    : { provider: null, model: null, mode: 'extractive-fallback' };

  const contextTotals = syntheses.reduce(
    (acc, s) => ({
      charsUsed: acc.charsUsed + (s.contextStats ? s.contextStats.charsUsed : 0),
      chunksUsed: acc.chunksUsed + (s.contextStats ? s.contextStats.chunksUsed : 0),
      chunksAvailable: acc.chunksAvailable + (s.contextStats ? s.contextStats.chunksAvailable : 0)
    }),
    { charsUsed: 0, chunksUsed: 0, chunksAvailable: 0 }
  );

  return {
    mode: 'full',
    project,
    notebook,
    analysis,
    chapters,
    cards: chapters.reduce((n, c) => n + ((c.cards && c.cards.length) || 0), 0),
    engine,
    context: contextTotals
  };
}

function sseInit(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
}

router.post('/build', async (req, res) => {
  const body = req.body || {};
  const aiConfig = aiConfigFromRequest(req);

  if (req.query.json === '1') {
    try {
      const result = await runBuild(body, aiConfig, () => {});
      res.json(result);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
    return;
  }

  sseInit(res);
  let ping = null;
  const schedulePing = () => {
    ping = setTimeout(() => {
      try { res.write(': ping\n\n'); } catch (_e) { /* client gone */ }
      schedulePing();
    }, 5000);
  };
  schedulePing();

  const send = (event, data) => {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch (_e) { /* client gone */ }
  };

  try {
    const result = await runBuild(body, aiConfig, (n) => send('phase', n));
    send('done', result);
  } catch (err) {
    send('error', { error: err.message });
  } finally {
    clearTimeout(ping);
    res.end();
  }
});

router.post('/book/blueprint', async (req, res) => {
  try {
    const body = req.body || {};
    const aiConfig = aiConfigFromRequest(req);
    const sources = Array.isArray(body.sources)
      ? body.sources.filter((s) => s && String(s.sample || '').trim()).slice(0, MAX_SOURCES)
      : [];
    if (!sources.length) return res.status(400).json({ error: 'No source samples provided' });
    const result = await bookEngine.makeBlueprint({
      title: String(body.title || 'Untitled').slice(0, 160),
      tone: body.tone,
      depth: body.depth,
      sources: sources.map((s) => ({
        title: String((s && s.title) || 'Source').slice(0, 160),
        sample: String((s && s.sample) || '').slice(0, 2000)
      }))
    }, aiConfig);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/book/draft', async (req, res) => {
  try {
    const body = req.body || {};
    const aiConfig = aiConfigFromRequest(req);
    const pages = Array.isArray(body.pages) ? body.pages : [];
    if (!pages.length) return res.status(400).json({ error: 'No pages provided for drafting' });
    const result = await bookEngine.draftBatch({
      title: String(body.title || 'Untitled').slice(0, 160),
      blueprint: body.blueprint || null,
      chapterIndex: Number(body.chapterIndex) || 0,
      isChapterStart: Boolean(body.isChapterStart),
      summary: String(body.summary || '').slice(0, 4000),
      pages
    }, aiConfig);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/book/enrich', async (req, res) => {
  try {
    const body = req.body || {};
    const aiConfig = aiConfigFromRequest(req);
    const evidence = Array.isArray(body.evidence) ? body.evidence : [];
    const chapterText = String(body.chapterText || '');
    if (!chapterText.trim() || !evidence.length) {
      return res.status(400).json({ error: 'Chapter text and evidence are both required' });
    }
    const result = await bookEngine.enrichChapter({
      chapterTitle: String(body.chapterTitle || 'Chapter').slice(0, 160),
      chapterText,
      evidence
    }, aiConfig);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/export/:format', (req, res) => {
  try {
    const body = req.body || {};
    const project = body.project || {};
    const chapters = Array.isArray(body.chapters) ? body.chapters : [];
    if (!chapters.length) return res.status(400).json({ error: 'No chapters to export' });

    const base = slugify(project.title || 'book') || 'book';
    const attach = (name, type, content) => {
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      res.type(type).send(content);
    };

    if (req.params.format === 'markdown') {
      attach(`${base}.md`, 'text/markdown; charset=utf-8', toMarkdown(project, chapters));
    } else if (req.params.format === 'html') {
      attach(`${base}.html`, 'text/html; charset=utf-8', toHtml(project, chapters));
    } else if (req.params.format === 'flashcards-csv') {
      const csv = toFlashcardsCsv(chapters);
      if (!csv) return res.status(400).json({ error: 'No flashcards in this book — generate with the Q&A Flashcards format first' });
      attach(`${base}-flashcards.csv`, 'text/csv; charset=utf-8', csv);
    } else if (req.params.format === 'json') {
      attach(`${base}.json`, 'application/json; charset=utf-8', toProjectJson(project, {
        chapters,
        topics: body.topics || [],
        conflicts: body.conflicts || [],
        outline: body.outline || []
      }));
    } else {
      res.status(400).json({ error: 'Unsupported format. Use markdown, html or json.' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
