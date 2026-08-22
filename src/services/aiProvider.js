const config = require('../config');
const logger = require('../logger');

let openai = null;
if (config.openaiApiKey) {
  const OpenAI = require('openai');
  openai = new OpenAI({ apiKey: config.openaiApiKey });
} else {
  logger.info('No OPENAI_API_KEY set - running in local heuristic mode');
}

async function chat(systemPrompt, userPrompt, options = {}) {
  if (!openai) {
    throw new Error('AI_PROVIDER_UNAVAILABLE');
  }
  const response = await openai.chat.completions.create({
    model: config.openaiModel,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: options.temperature ?? 0.4,
    max_tokens: options.maxTokens ?? 1500
  });
  return response.choices[0].message.content.trim();
}

const aiProvider = {
  available: () => Boolean(openai),

  async generate(prompt, context) {
    return chat(
      'You are an expert book author. Write clear, reader-friendly prose grounded strictly in the provided source material. Never invent facts.',
      `Context:\n${context}\n\nTask: ${prompt}`
    );
  },

  async summarize(text) {
    if (!openai) {
      const sentences = text.match(/[^.!?]+[.!?]/g) || [text];
      return sentences.slice(0, 2).join(' ').trim();
    }
    return chat('Summarize content compactly while keeping key claims and facts.', text);
  },

  async classify(text, candidateLabels) {
    if (!openai) {
      const lower = text.toLowerCase();
      return candidateLabels
        .map((label) => ({ label, score: lower.includes(label.toLowerCase()) ? 1 : 0 }))
        .sort((a, b) => b.score - a.score);
    }
    const raw = await chat(
      'Classify the text into one or more of the given labels. Reply with a comma-separated list of matching labels only.',
      `Labels: ${candidateLabels.join(', ')}\n\nText: ${text.slice(0, 3000)}`
    );
    const chosen = raw.split(',').map((s) => s.trim()).filter(Boolean);
    return candidateLabels.map((label) => ({
      label,
      score: chosen.includes(label) ? 1 : 0
    }));
  },

  async synthesize(sources, topicName) {
    if (!openai) {
      return sources.map((s) => s.content).join('\n\n');
    }
    return chat(
      'You are synthesizing knowledge from multiple research sources into one coherent, well-structured explanation. Combine complementary information, remove repetition, preserve disagreements explicitly, and write for the reader. Ground everything in the sources.',
      `Topic: ${topicName}\n\nSources:\n${sources
        .map((s, i) => `[Source ${i + 1}] ${s.sourceTitle}, page ${s.pageNumber}: ${s.content}`)
        .join('\n\n')}`
    );
  },

  async review(content) {
    if (!openai) {
      return { repetitionCount: 0, issues: [] };
    }
    const raw = await chat(
      'Review the following book section. Report JSON with keys: repetitionCount (number), issues (array of strings describing missing transitions or gaps).',
      content
    );
    try {
      return JSON.parse(raw);
    } catch {
      return { repetitionCount: 0, issues: [] };
    }
  }
};

module.exports = aiProvider;
