require('dotenv').config();

const isServerless = Boolean(process.env.VERCEL);
const defaultDataDir = isServerless ? '/tmp/pdf2book-data' : './data';

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  dataDir: process.env.DATA_DIR || defaultDataDir,
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
