const express = require('express');
const cors = require('cors');
const config = require('./config');
const logger = require('./logger');
const projectsRouter = require('./routes/projects');
const sourcesRouter = require('./routes/sources');
const knowledgeRouter = require('./routes/knowledge');
const bookRouter = require('./routes/book');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/', (req, res) => {
  res.json({
    name: 'pdf2book',
    status: 'ok',
    aiProvider: config.openaiApiKey ? 'openai' : 'local-heuristic',
    endpoints: {
      health: '/health',
      projects: '/api/projects',
      sources: '/api/projects/:id/sources',
      knowledge: '/api/knowledge/:id/analyze',
      book: '/api/projects/:id/book',
      exports: '/api/projects/:id/export/markdown'
    }
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', aiProvider: config.openaiApiKey ? 'openai' : 'local-heuristic' });
});

app.use('/api/projects', projectsRouter);
app.use('/api/projects', sourcesRouter);
app.use('/api/projects', bookRouter);
app.use('/api/knowledge', knowledgeRouter);

app.use((err, req, res, _next) => {
  logger.error(err.message);
  res.status(500).json({ error: err.message });
});

if (require.main === module) {
  app.listen(config.port, () => {
    logger.info(`pdf2book server running on http://localhost:${config.port}`);
  });
}

module.exports = app;
