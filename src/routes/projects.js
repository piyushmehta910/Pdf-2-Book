const express = require('express');
const path = require('path');
const fs = require('fs');
const storage = require('../services/storage');
const config = require('../config');
const { validateNotebook } = require('../services/notebookOptions');

const router = express.Router();

function readProjectRecord(projectId) {
  return storage.readCollection(projectId, 'project')[0] || null;
}

router.post('/', (req, res) => {
  const project = {
    id: storage.id('prj'),
    title: req.body.title || 'Untitled Project',
    author: req.body.author || '',
    createdAt: new Date().toISOString()
  };
  fs.mkdirSync(path.resolve(config.dataDir, project.id), { recursive: true });
  storage.writeCollection(project.id, 'project', [project]);
  res.status(201).json(project);
});

router.patch('/:projectId', (req, res) => {
  const projectId = req.params.projectId;
  if (!fs.existsSync(path.resolve(config.dataDir, projectId))) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const existing = readProjectRecord(projectId) || { id: projectId };
  const patch = {};
  if (typeof req.body.title === 'string' && req.body.title.trim()) patch.title = req.body.title.trim().slice(0, 160);
  if (typeof req.body.author === 'string') patch.author = req.body.author.slice(0, 120);
  if (req.body.notebook && typeof req.body.notebook === 'object') {
    patch.notebook = validateNotebook({ ...(existing.notebook || {}), ...req.body.notebook });
  }
  const updated = { ...existing, ...patch };
  storage.writeCollection(projectId, 'project', [updated]);
  res.json(updated);
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
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  res.status(204).end();
});

module.exports = router;
