const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const storage = require('../services/storage');
const { processSource } = require('../services/pipeline');
const config = require('../config');
const logger = require('../logger');

const router = express.Router();
const uploadDir = path.resolve(config.dataDir, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({ dest: uploadDir });

function registerProject(req) {
  const projectId = req.params.projectId;
  const projectFile = path.resolve(config.dataDir, projectId, 'project.json');
  if (!fs.existsSync(projectFile)) {
    fs.mkdirSync(path.dirname(projectFile), { recursive: true });
    fs.writeFileSync(projectFile, JSON.stringify({ id: projectId, title: 'Untitled Project' }, null, 2));
  }
  return projectId;
}

router.post('/:projectId/sources', upload.array('files'), async (req, res) => {
  try {
    const projectId = registerProject(req);
    const pastedText = req.body.text;
    const created = [];

    for (const file of req.files || []) {
      const source = {
        id: storage.id('src'),
        title: file.originalname,
        type: path.extname(file.originalname).toLowerCase() === '.pdf' ? 'pdf' : 'text',
        filePath: file.path,
        status: 'pending',
        createdAt: new Date().toISOString()
      };
      await storage.insert(projectId, 'sources', source);
      created.push(source);
    }

    if (pastedText) {
      const textPath = path.join(uploadDir, `${storage.id('txt')}.txt`);
      fs.writeFileSync(textPath, String(pastedText), 'utf8');
      const source = {
        id: storage.id('src'),
        title: req.body.title || 'Pasted Notes',
        type: 'text',
        filePath: textPath,
        status: 'pending',
        createdAt: new Date().toISOString()
      };
      await storage.insert(projectId, 'sources', source);
      created.push(source);
    }

    res.status(201).json(created);
  } catch (err) {
    logger.error(err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:projectId/sources/:sourceId/process', async (req, res) => {
  try {
    const source = storage.findById(req.params.projectId, 'sources', req.params.sourceId);
    if (!source) return res.status(404).json({ error: 'Source not found' });
    const result = await processSource(req.params.projectId, source);
    res.json(result);
  } catch (err) {
    logger.error(err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:projectId/sources', (req, res) => {
  res.json(storage.readCollection(req.params.projectId, 'sources'));
});

router.delete('/:projectId/sources/:sourceId', async (req, res) => {
  const removed = await storage.removeById(req.params.projectId, 'sources', req.params.sourceId);
  if (!removed) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});

module.exports = router;
