const express = require('express');
const path = require('path');
const fs = require('fs');
const storage = require('../services/storage');
const config = require('../config');

const router = express.Router();

router.post('/', (req, res) => {
  const project = {
    id: storage.id('prj'),
    title: req.body.title || 'Untitled Project',
    author: req.body.author || '',
    createdAt: new Date().toISOString()
  };
  fs.mkdirSync(path.resolve(config.dataDir, project.id), { recursive: true });
  res.status(201).json(project);
});

router.get('/', (req, res) => {
  const dataDir = path.resolve(config.dataDir);
  if (!fs.existsSync(dataDir)) return res.json([]);
  const projects = fs
    .readdirSync(dataDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const file = path.join(dataDir, d.name, 'project.json');
      if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
      return { id: d.name, title: d.name };
    });
  res.json(projects);
});

router.get('/:projectId', (req, res) => {
  res.json(storage.readCollection(req.params.projectId, 'project'));
});

router.delete('/:projectId', (req, res) => {
  const dir = path.resolve(config.dataDir, req.params.projectId);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
  res.status(204).end();
});

module.exports = router;
