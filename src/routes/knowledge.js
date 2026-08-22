const express = require('express');
const storage = require('../services/storage');
const { analyzeProject } = require('../services/pipeline');

const router = express.Router();

router.post('/:projectId/analyze', async (req, res) => {
  try {
    const result = await analyzeProject(req.params.projectId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:projectId/topics', (req, res) => {
  res.json(storage.readCollection(req.params.projectId, 'topics'));
});

router.get('/:projectId/chunks', (req, res) => {
  const { sourceId } = req.query;
  const chunks = storage.readCollection(req.params.projectId, 'chunks');
  res.json(sourceId ? chunks.filter((c) => c.sourceId === sourceId) : chunks);
});

router.get('/:projectId/conflicts', (req, res) => {
  res.json(storage.readCollection(req.params.projectId, 'conflicts'));
});

router.get('/:projectId/duplicates', (req, res) => {
  res.json(storage.readCollection(req.params.projectId, 'duplicates'));
});

router.get('/:projectId/coverage', (req, res) => {
  res.json(storage.readCollection(req.params.projectId, 'coverage'));
});

module.exports = router;
