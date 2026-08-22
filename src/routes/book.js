const express = require('express');
const storage = require('../services/storage');
const { synthesizeTopic, generateChapter } = require('../services/synthesizer');
const { toMarkdown, toHtml, toProjectJson, writeExport } = require('../services/exporter');
const logger = require('../logger');

const router = express.Router();

router.post('/:projectId/book/generate', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const topics = storage.readCollection(projectId, 'topics');
    const chunks = storage.readCollection(projectId, 'chunks');
    const sources = storage.readCollection(projectId, 'sources');
    const outline = storage.readCollection(projectId, 'outline')[0];

    if (!outline) return res.status(400).json({ error: 'Run analysis first (POST /api/knowledge/:id/analyze)' });

    const syntheses = [];
    for (const topic of topics) {
      syntheses.push(await synthesizeTopic(topic, chunks, sources));
    }
    storage.replaceAll(projectId, 'syntheses', syntheses);

    const chapters = [];
    for (const chapter of outline.chapters) {
      chapters.push(await generateChapter(chapter, syntheses));
    }
    storage.replaceAll(projectId, 'chapters', chapters);

    const version = {
      id: storage.id('rev'),
      createdAt: new Date().toISOString(),
      chapterCount: chapters.length
    };
    storage.insert(projectId, 'revisions', version);

    res.json({ chapters: chapters.length, version });
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
