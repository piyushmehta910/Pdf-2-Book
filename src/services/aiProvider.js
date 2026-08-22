const config = require('../config');
const logger = require('../logger');

const PROVIDERS = {
  local: {
    label: 'Local heuristic (no AI)',
    requiresKey: false,
    baseUrl: null
  },
  openai: {
    label: 'OpenAI',
    requiresKey: true,
    baseUrl: 'https://api.openai.com/v1',
    keyUrl: 'https://platform.openai.com/api-keys',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini']
  },
  zen: {
    label: 'OpenCode Zen',
    requiresKey: true,
    baseUrl: 'https://opencode.ai/zen/v1',
    keyUrl: 'https://opencode.ai/auth',
    defaultModel: 'big-pickle',
    models: [
      'big-pickle',
      'nemotron-3-ultra-free',
      'deepseek-v4-flash-free',
      'qwen3.6-plus-free',
      'minimax-m3-free',
      'mimo-v2.5-free',
      'north-mini-code-free',
      'nemotron-3.5-lightning-free',
      'hy3-free'
    ]
  },
  nvidia: {
    label: 'NVIDIA NIM',
    requiresKey: true,
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    keyUrl: 'https://build.nvidia.com',
    defaultModel: 'meta/llama-3.3-70b-instruct',
    models: [
      'meta/llama-3.3-70b-instruct',
      'meta/llama-3.1-8b-instruct',
      'nvidia/llama-3.1-nemotron-70b-instruct',
      'deepseek-ai/deepseek-r1',
      'mistralai/mistral-small-24b-instruct',
      'qwen/qwen2.5-7b-instruct'
    ]
  }
};

function normalizeOverride(override = {}) {
  const provider = PROVIDERS[override.provider] ? override.provider : config.openaiApiKey ? 'openai' : 'local';
  const meta = PROVIDERS[provider];
  if (!meta || !meta.baseUrl) return { provider, client: null };

  let apiKey = override.apiKey || '';
  if (!apiKey && provider === 'openai') apiKey = config.openaiApiKey;
  if (!apiKey) return { provider, client: null };

  const OpenAI = require('openai');
  const client = new OpenAI({ apiKey, baseURL: meta.baseUrl });
  const model = override.model || meta.defaultModel;
  return { provider, model, client };
}

async function chat(systemPrompt, userPrompt, options = {}, override = {}) {
  const resolved = normalizeOverride(override);
  if (!resolved.client) throw new Error('AI_PROVIDER_UNAVAILABLE');

  try {
    const response = await resolved.client.chat.completions.create({
      model: resolved.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: options.temperature ?? 0.4,
      max_tokens: options.maxTokens ?? 1500
    });
    return response.choices[0].message.content.trim();
  } catch (err) {
    logger.error(`AI chat failed (${resolved.provider}/${resolved.model}): ${err.message}`);
    throw err;
  }
}

const SYSTEM_AUTHOR =
  'You are an expert book author. Write clear, reader-friendly prose grounded strictly in the provided source material. Never invent facts.';

function localSummary(text) {
  const sentences = text.match(/[^.!?]+[.!?]/g) || [text];
  return sentences.slice(0, 2).join(' ').trim();
}

const aiProvider = {
  PROVIDERS,

  available(override = {}) {
    return Boolean(normalizeOverride(override).client);
  },

  describe() {
    return {
      serverProvider: config.openaiApiKey ? 'openai' : 'local',
      providers: Object.entries(PROVIDERS).map(([id, p]) => ({
        id,
        label: p.label,
        requiresKey: p.requiresKey,
        keyUrl: p.keyUrl || null,
        defaultModel: p.defaultModel || null,
        models: p.models || []
      }))
    };
  },

  async testConnection(override = {}) {
    const reply = await chat('Reply with exactly: OK.', 'ping', { maxTokens: 10 }, override);
    return reply.toUpperCase().includes('OK');
  },

  async generate(prompt, context, override = {}) {
    return chat(SYSTEM_AUTHOR, `Context:\n${context}\n\nTask: ${prompt}`, {}, override);
  },

  async summarize(text, override = {}) {
    if (!normalizeOverride(override).client) return localSummary(text);
    return chat('Summarize content compactly while keeping key claims and facts.', text, {}, override);
  },

  async classify(text, candidateLabels, override = {}) {
    if (!normalizeOverride(override).client) {
      const lower = text.toLowerCase();
      return candidateLabels
        .map((label) => ({ label, score: lower.includes(label.toLowerCase()) ? 1 : 0 }))
        .sort((a, b) => b.score - a.score);
    }
    const raw = await chat(
      'Classify the text into one or more of the given labels. Reply with a comma-separated list of matching labels only.',
      `Labels: ${candidateLabels.join(', ')}\n\nText: ${text.slice(0, 3000)}`,
      {},
      override
    );
    const chosen = raw.split(',').map((s) => s.trim()).filter(Boolean);
    return candidateLabels.map((label) => ({ label, score: chosen.includes(label) ? 1 : 0 }));
  },

  async synthesize(evidence, topicName, override = {}) {
    if (!normalizeOverride(override).client) {
      return evidence.map((e) => e.content).join('\n\n');
    }
    return chat(
      'You are synthesizing knowledge from multiple research sources into one coherent, well-structured explanation. Combine complementary information, remove repetition, preserve disagreements explicitly, and write for the reader. Ground everything in the sources.',
      `Topic: ${topicName}\n\nSources:\n${evidence
        .map((e, i) => `[Source ${i + 1}] ${e.sourceTitle}, page ${e.pageNumber}: ${e.text || e.content}`)
        .join('\n\n')}`,
      { maxTokens: 1800 },
      override
    );
  },

  async review(content, override = {}) {
    if (!normalizeOverride(override).client) return { repetitionCount: 0, issues: [] };
    const raw = await chat(
      'Review the following book section. Report JSON with keys: repetitionCount (number), issues (array of strings describing missing transitions or gaps).',
      content,
      {},
      override
    );
    try {
      return JSON.parse(raw);
    } catch (_err) {
      return { repetitionCount: 0, issues: [] };
    }
  }
};

module.exports = aiProvider;
