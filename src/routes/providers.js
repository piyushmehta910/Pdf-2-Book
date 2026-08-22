const express = require('express');
const aiProvider = require('../services/aiProvider');
const logger = require('../logger');

const router = express.Router();

router.get('/', (_req, res) => {
  res.json(aiProvider.describe());
});

router.post('/test', async (req, res) => {
  const { provider, apiKey, model } = req.body || {};
  if (!provider) return res.status(400).json({ error: 'provider is required' });
  try {
    await aiProvider.testConnection({ provider, apiKey, model });
    res.json({ ok: true, provider, model: model || null });
  } catch (err) {
    logger.warn(`Provider test failed (${provider}): ${err.message}`);
    res.status(400).json({ ok: false, error: err.message });
  }
});

module.exports = router;
