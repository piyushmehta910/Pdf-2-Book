require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  dataDir: process.env.DATA_DIR || './data',
  chunk: {
    maxChars: 1200,
    minChars: 200
  },
  dedup: {
    similarityThreshold: 0.82
  },
  coverage: {
    minScore: 0.6
  }
};
