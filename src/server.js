const express = require('express');
const path = require('path');
const cors = require('cors');
const config = require('./config');
const logger = require('./logger');
const projectsRouter = require('./routes/projects');
const sourcesRouter = require('./routes/sources');
const knowledgeRouter = require('./routes/knowledge');
const bookRouter = require('./routes/book');
const providersRouter = require('./routes/providers');
const engineRouter = require('./routes/engine');
const webui = require('./webui');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use('/vendor', express.static(path.join(__dirname, '..', 'public', 'vendor'), { maxAge: '1d' }));

app.get('/', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.type('html').send(webui());
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', aiProvider: 'bring-your-own-key' });
});

app.use('/api/projects', projectsRouter);
app.use('/api/projects', sourcesRouter);
app.use('/api/projects', bookRouter);
app.use('/api/knowledge-legacy', knowledgeRouter);
app.use('/api/providers', providersRouter);
app.use('/api', engineRouter);

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
