const express = require('express');
const storage = require('../services/storage');
const { synthesizeTopic } = require('../services/synthesizer');
const { composeChapters } = require('../services/chapterComposer');
const aiProvider = require('../services/aiProvider');
const {
  toMarkdown, toHtml, toProjectJson, toFlashcardsCsv, writeExport
} = require('../services/exporter');
const { validateNotebook } = require('../services/notebookOptions');
const logger = require('../logger');

const router = express.Router();

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

router.post('/:projectId/book/generate', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const aiConfig = aiConfigFromRequest(req);
    const project = storage.readCollection(projectId, 'project')[0] || {};
    const notebook = validateNotebook({ ...(project.notebook || {}), ...(req.body.notebook || {}) });

    const topics = storage.readCollection(projectId, 'topics');
    const chunks = storage.readCollection(projectId, 'chunks');
    const sources = storage.readCollection(projectId, 'sources');
    const outline = storage.readCollection(projectId, 'outline')[0];
    const coverage = storage.readCollection(projectId, 'coverage');

    if (!outline) return res.status(400).json({ error: 'Run analysis first (POST /api/knowledge/:id/analyze)' });

    const syntheses = [];
    for (const topic of topics) {
      syntheses.push(await synthesizeTopic(topic, chunks, sources, aiConfig, notebook));
    }
    storage.replaceAll(projectId, 'syntheses', syntheses);

    const { chapters, polished } = await composeChapters({
      outline,
      syntheses,
      notebook,
      aiConfig,
      topics,
      coverage,
      chunks
    });
    storage.replaceAll(projectId, 'chapters', chapters);

    if (project.id) {
      storage.updateById(projectId, 'project', project.id, { notebook });
    }

    const version = {
      id: storage.id('rev'),
      createdAt: new Date().toISOString(),
      chapterCount: chapters.length,
      notebook
    };
    storage.insert(projectId, 'revisions', version);

    const engineMode = aiProvider.available(aiConfig)
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

    res.json({
      chapters: chapters.length,
      cards: chapters.reduce((n, c) => n + ((c.cards && c.cards.length) || 0), 0),
      version,
      engine: engineMode,
      notebook,
      context: contextTotals
    });
  } catch (err) {
    logger.error(err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:projectId/book', (req, res) => {
  const chapters = storage.readCollection(req.params.projectId, 'chapters');
  const project = storage.readCollection(req.params.projectId, 'project')[0] || { title: 'Untitled Book' };
  res.json({ project, chapters });
});

router.put('/:projectId/book/chapters/:chapterId', (req, res) => {
  const updated = storage.updateById(req.params.projectId, 'chapters', req.params.chapterId, {
    content: req.body.content,
    title: req.body.title
  });
  if (!updated) return res.status(404).json({ error: 'Chapter not found' });
  res.json(updated);
});

router.get('/:projectId/export/:format', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const project = storage.readCollection(projectId, 'project')[0] || { title: 'Untitled Book' };
    const chapters = storage.readCollection(projectId, 'chapters');

    if (!chapters.length) return res.status(400).json({ error: 'No generated book found' });

    if (req.params.format === 'markdown') {
      const md = toMarkdown(project, chapters);
      const file = writeExport(projectId, 'book.md', md);
      res.download(file);
    } else if (req.params.format === 'html') {
      const html = toHtml(project, chapters);
      const file = writeExport(projectId, 'book.html', html);
      res.download(file);
    } else if (req.params.format === 'flashcards-csv') {
      const csv = toFlashcardsCsv(chapters);
      if (!csv) return res.status(400).json({ error: 'No flashcards in this book — generate with the Q&A Flashcards format first' });
      const file = writeExport(projectId, 'flashcards.csv', csv);
      res.download(file);
    } else if (req.params.format === 'json') {
      const json = toProjectJson(project, {
        chapters,
        topics: storage.readCollection(projectId, 'topics'),
        conflicts: storage.readCollection(projectId, 'conflicts'),
        outline: storage.readCollection(projectId, 'outline')
      });
      const file = writeExport(projectId, 'project.json', json);
      res.download(file);
    } else {
      res.status(400).json({ error: 'Unsupported format. Use markdown, html or json.' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
