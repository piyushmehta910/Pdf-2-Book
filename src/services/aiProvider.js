const logger = require('../logger');
const { parseJsonLoose, isArr, isStr } = require('./jsonUtils');

const PROVIDERS = {
  zen: {
    label: 'OpenCode Zen',
    requiresKey: true,
    kind: 'openai',
    baseUrl: 'https://opencode.ai/zen/v1',
    keyUrl: 'https://opencode.ai/auth',
    defaultModel: 'big-pickle',
    embedModel: null,
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
    kind: 'openai',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    keyUrl: 'https://build.nvidia.com',
    defaultModel: 'meta/llama-3.3-70b-instruct',
    embedModel: null,
    models: [
      'meta/llama-3.3-70b-instruct',
      'meta/llama-3.1-8b-instruct',
      'nvidia/llama-3.1-nemotron-70b-instruct',
      'deepseek-ai/deepseek-r1',
      'mistralai/mistral-small-24b-instruct',
      'qwen/qwen2.5-7b-instruct'
    ]
  },
  openai: {
    label: 'OpenAI',
    requiresKey: true,
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    keyUrl: 'https://platform.openai.com/api-keys',
    defaultModel: 'gpt-4o',
    embedModel: 'text-embedding-3-small',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano']
  },
  anthropic: {
    label: 'Anthropic (Claude)',
    requiresKey: true,
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    keyUrl: 'https://console.anthropic.com/',
    defaultModel: 'claude-3-5-sonnet-latest',
    embedModel: null,
    models: ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest', 'claude-3-7-sonnet-latest', 'claude-sonnet-4-20250514']
  },
  gemini: {
    label: 'Google Gemini',
    requiresKey: true,
    kind: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    keyUrl: 'https://aistudio.google.com/app/apikey',
    defaultModel: 'gemini-1.5-pro',
    embedModel: 'text-embedding-004',
    models: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash', 'gemini-2.5-flash']
  },
  ollama: {
    label: 'Local (Ollama / LocalAI)',
    requiresKey: false,
    kind: 'ollama',
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    keyUrl: null,
    defaultModel: 'llama3.1',
    embedModel: null,
    models: ['llama3.1', 'llama3.2', 'qwen2.5', 'mistral', 'phi3']
  }
};

function normalizeOverride(override) {
  if (!override || typeof override !== 'object') return { provider: null };
  const provider = PROVIDERS[override.provider] ? override.provider : null;
  if (!provider) return { provider: null };
  const meta = PROVIDERS[provider];
  const apiKey = override.apiKey || '';
  const model = override.model || meta.defaultModel;
  if (meta.kind === 'openai') {
    const OpenAI = require('openai');
    const client = apiKey ? new OpenAI({ apiKey, baseURL: meta.baseUrl }) : null;
    return { provider, model, apiKey, client, meta };
  }
  return { provider, model, apiKey, client: null, meta };
}

async function fetchWithTimeout(url, fetchOptions, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 30000);
  try {
    return await fetch(url, { ...fetchOptions, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- per-provider completion adapters ---------- */

async function openaiChat(client, model, system, user, options) {
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    temperature: options.temperature ?? 0.4,
    max_tokens: options.maxTokens ?? 1500
  });
  return response.choices[0].message.content.trim();
}

async function anthropicChat(meta, apiKey, model, system, user, options) {
  const res = await fetchWithTimeout(`${meta.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      system,
      max_tokens: options.maxTokens ?? 1500,
      temperature: options.temperature ?? 0.4,
      messages: [{ role: 'user', content: user }]
    })
  }, options.timeoutMs);
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const out = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  return out.trim();
}

async function geminiChat(meta, apiKey, model, system, user, options) {
  const url = `${meta.baseUrl}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: user }] }],
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      generationConfig: {
        temperature: options.temperature ?? 0.4,
        maxOutputTokens: options.maxTokens ?? 1500
      }
    })
  }, options.timeoutMs);
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text || '').join('').trim();
}

async function ollamaChat(meta, apiKey, model, system, user, options) {
  const res = await fetchWithTimeout(`${meta.baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system || '' },
        { role: 'user', content: user }
      ],
      stream: false,
      options: {
        temperature: options.temperature ?? 0.4,
        num_predict: options.maxTokens ?? 1500
      }
    })
  }, options.timeoutMs || 60000);
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return String(data.message?.content || '').trim();
}

/* ---------- per-provider embedding adapters ---------- */

async function openaiEmbed(client, model, texts) {
  const res = await client.embeddings.create({ model: model || 'text-embedding-3-small', input: texts });
  return res.data.map((d) => d.embedding);
}

async function geminiEmbed(meta, apiKey, model, texts) {
  const url = `${meta.baseUrl}/models/${model}:batchEmbedContents?key=${encodeURIComponent(apiKey)}`;
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      requests: texts.map((t) => ({
        model: `models/${model}`,
        content: { parts: [{ text: t }] }
      }))
    })
  });
  if (!res.ok) throw new Error(`Gemini embed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return (data.embeddings || []).map((e) => e.values);
}

async function ollamaEmbed(meta, model, texts) {
  const out = [];
  for (const text of texts) {
    const res = await fetchWithTimeout(`${meta.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, prompt: text })
    }, 30000);
    if (!res.ok) throw new Error(`Ollama embed ${res.status}`);
    const data = await res.json();
    if (!data.embedding) throw new Error('Ollama returned no embedding');
    out.push(data.embedding);
  }
  return out;
}

const EMBEDDING_KINDS = ['openai', 'gemini', 'ollama'];

async function chat(systemPrompt, userPrompt, options = {}, override = {}) {
  const resolved = normalizeOverride(override);
  if (!resolved.provider) throw new Error('AI_PROVIDER_UNAVAILABLE');
  const meta = resolved.meta;
  const model = resolved.model;
  const apiKey = resolved.apiKey;
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 20000;

  if (meta.kind === 'openai') {
    if (!resolved.client) throw new Error('AI_PROVIDER_UNAVAILABLE');
    try {
      return await openaiChat(resolved.client, model, systemPrompt, userPrompt, { ...options, timeoutMs });
    } catch (err) {
      logger.error(`AI chat failed (${resolved.provider}/${model}): ${err.message}`);
      throw err;
    }
  }

  if (!apiKey && meta.requiresKey) throw new Error('AI_PROVIDER_UNAVAILABLE');
  const fn = meta.kind === 'anthropic' ? anthropicChat : (meta.kind === 'gemini' ? geminiChat : ollamaChat);
  try {
    return await fn(meta, apiKey || '', model, systemPrompt, userPrompt, { ...options, timeoutMs });
  } catch (err) {
    logger.error(`AI chat failed (${resolved.provider}/${model}): ${err.message}`);
    throw err;
  }
}

const SYSTEM_AUTHOR =
  'You are an expert book author. Write clear, reader-friendly prose grounded strictly in the provided source material. Never invent facts.';

function localSummary(text) {
  const sentences = text.match(/[^.!?]+[.!?]/g) || [text];
  return sentences.slice(0, 2).join(' ').trim();
}

function chatJson(system, user, options, override) {
  return chat(`${system}\nReply with STRICT JSON only.`, user, options, override)
    .then((raw) => parseJsonLoose(raw))
    .catch(() => null);
}

const aiProvider = {
  PROVIDERS,

  available(override = {}) {
    const resolved = normalizeOverride(override);
    if (!resolved.provider) return false;
    if (resolved.meta.kind === 'openai') return Boolean(resolved.client);
    return resolved.meta.requiresKey ? Boolean(resolved.apiKey) : true;
  },

  describe() {
    return {
      providergroups: ['remote', 'local'],
      providers: Object.entries(PROVIDERS).map(([id, p]) => ({
        id,
        label: p.label,
        requiresKey: p.requiresKey,
        kind: p.kind,
        baseUrl: p.baseUrl,
        keyUrl: p.keyUrl || null,
        defaultModel: p.defaultModel || null,
        embedModel: p.embedModel || null,
        supportsEmbeddings: EMBEDDING_KINDS.includes(p.kind),
        models: p.models || []
      }))
    };
  },

  async testConnection(override = {}) {
    const reply = await chat('Reply with exactly: OK.', 'ping', { maxTokens: 10 }, override);
    return reply.toUpperCase().includes('OK');
  },

  async complete(systemPrompt, userPrompt, options = {}, override = {}) {
    return chat(systemPrompt, userPrompt, options, override);
  },

  /** Embed a batch of strings; throws when the provider cannot embed. */
  async embed(texts, override = {}) {
    const resolved = normalizeOverride(override);
    if (!resolved.provider) throw new Error('AI_PROVIDER_UNAVAILABLE');
    const meta = resolved.meta;
    if (!EMBEDDING_KINDS.includes(meta.kind)) {
      throw new Error(`provider "${meta.kind}" does not support embeddings`);
    }
    if (meta.kind === 'openai') {
      if (!resolved.client) throw new Error('AI_PROVIDER_UNAVAILABLE');
      return openaiEmbed(resolved.client, override.embedModel || meta.embedModel, texts);
    }
    if (meta.kind === 'gemini') {
      return geminiEmbed(meta, resolved.apiKey, override.embedModel || meta.embedModel, texts);
    }
    return ollamaEmbed(meta, resolved.model, texts);
  },

  supportsEmbeddings(override = {}) {
    const resolved = normalizeOverride(override);
    return resolved.provider ? EMBEDDING_KINDS.includes(resolved.meta.kind) : false;
  },

  async generate(prompt, context, override = {}) {
    return chat(SYSTEM_AUTHOR, `Context:\n${context}\n\nTask: ${prompt}`, {}, override);
  },

  async summarize(text, override = {}) {
    if (!aiProvider.available(override)) return localSummary(text);
    return chat('Summarize content compactly while keeping key claims and facts.', text, {}, override);
  },

  async classify(text, candidateLabels, override = {}) {
    if (!aiProvider.available(override)) {
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

  async synthesize(evidence, topicName, override = {}, addenda = null) {
    const system = addenda ? addenda.system :
      'You are synthesizing knowledge from multiple research sources into one coherent, well-structured explanation. Combine complementary information, remove repetition, preserve disagreements explicitly, and write for the reader. Ground everything in the sources. Inline-cite every factual claim with [src(N)] where N is the source number provided below.';
    const task = addenda ? addenda.user : 'Synthesize the sources into one coherent explanation.';
    const body = evidence
      .map((e, i) => `[Source ${i + 1}] ${e.sourceTitle || e.filename || 'source'}, page ${e.pageNumber}${e.section ? ', section ' + e.section : ''}: ${e.text || e.content}`)
      .join('\n\n');
    const raw = await chat(
      system,
      `${task}\n\nTopic: ${topicName}\n\nSources:\n${body}`,
      { maxTokens: 2400 },
      override
    );
    return { text: raw, evidence };
  },

  async review(content, override = {}) {
    if (!aiProvider.available(override)) return { repetitionCount: 0, issues: [] };
    const parsed = await chatJson(
      'Review the following book section. Report JSON with keys: repetitionCount (number), issues (array of strings describing missing transitions or gaps).',
      content,
      {},
      override
    );
    return parsed && typeof parsed === 'object'
      ? { repetitionCount: Number(parsed.repetitionCount) || 0, issues: isArr(parsed.issues) ? parsed.issues.map(String) : [] }
      : { repetitionCount: 0, issues: [] };
  },

  /* ---------- knowledge-oriented interface (analyze / topics / dupes / outline / section) ---------- */

  /** Per-source concept analysis: returns { topics, definitions, facts, summary }. */
  async analyzeSource({ title, sourceId, pages }, override = {}) {
    const body = String(pages || []).length
      ? pages
      : [];
    const text = (Array.isArray(body) ? body.map((p) => `[p.${p.pageNumber}] ${p.text || p.content}`).join('\n\n') : '').slice(0, 12000);
    if (!aiProvider.available(override)) {
      const { topKeywords } = require('./similarity');
      const keywords = topKeywords([text], 6);
      return {
        topics: keywords,
        definitions: [],
        facts: [],
        summary: localSummary(text),
        mode: 'fallback'
      };
    }
    const parsed = await chatJson(
      'You analyze a research source section by section. Extract: {"topics":[string],"definitions":[{"term":string,"definition":string}],"key_facts":[string],"summary":string}. Keep definitions and facts short. Never invent facts.',
      `SOURCE: ${title || 'source'}\n\nCONTENT:\n${text}`,
      { maxTokens: 1200, temperature: 0.2 },
      override
    );
    return {
      topics: isArr(parsed && parsed.topics) ? parsed.topics.map(String).slice(0, 12) : [],
      definitions: isArr(parsed && parsed.definitions) ? parsed.definitions.slice(0, 8) : [],
      facts: isArr(parsed && parsed.key_facts) ? parsed.key_facts.map(String).slice(0, 12) : [],
      summary: isStr(parsed && parsed.summary) ? parsed.summary : localSummary(text),
      sourceId,
      mode: 'ai'
    };
  },

  /** Detect near-duplicate chunks across all sources (embeddings driven). */
  async detectDuplicates(chunks, override = {}) {
    const { makeEmbedder, resolveSyncEmbedder } = require('./embeddings');
    const { detectDuplicates } = require('./duplicateDetector');
    const embedder = await makeEmbedder(override, aiProvider);
    const texts = chunks.map((c) => c.content || '');
    const { embedder: syncEmbedder } = await resolveSyncEmbedder(embedder, texts);
    return detectDuplicates(chunks, { embedder: syncEmbedder, mode: 'embedding' });
  },

  /** Cluster chunks into topics. */
  async findTopics(chunks, override = {}) {
    const { makeEmbedder, resolveSyncEmbedder } = require('./embeddings');
    const { clusterChunks } = require('./knowledgePipeline');
    const embedder = await makeEmbedder(override, aiProvider);
    const texts = chunks.map((c) => c.content || '');
    const { embedder: syncEmbedder, vectors } = await resolveSyncEmbedder(embedder, texts);
    return clusterChunks(chunks, syncEmbedder, null, vectors);
  },

  /** Outline from topic clusters. */
  async buildOutline(topics, override = {}) {
    const { buildOutline } = require('./outlineBuilder');
    const outline = buildOutline(topics);
    if (!aiProvider.available(override)) return { outline, mode: 'fallback' };
    const parsed = await chatJson(
      'You are a book planner. Produce a book outline from the given topic list. Return STRICT JSON {"chapters":[{"title":string,"purpose":string,"topics":[string]}]} with 3-6 chapters.',
      `TOPICS:\n${JSON.stringify(topics.map((t) => ({ name: t.name, keywords: t.keywords || [], chunkCount: t.chunkIds ? t.chunkIds.length : 0 })))}`,
      { maxTokens: 900, temperature: 0.3 },
      override
    );
    if (parsed && isArr(parsed.chapters) && parsed.chapters.length) {
      return { outline: { ...outline, chapters: parsed.chapters.map((c, i) => ({ ...outline.chapters[i] || {}, ...c, number: i + 1 })) }, mode: 'ai' };
    }
    return { outline, mode: 'fallback' };
  }
};

module.exports = aiProvider;