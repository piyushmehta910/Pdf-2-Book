const knowledgeBase = require('../src/services/knowledgeBase');

const META = { document_id: 'doc_001', page: 12, file_name: 'book.pdf' };

const EXTRACTION = {
  page_summary: 'Introduction to neural networks and gradient descent.',
  topics: ['Neural Networks', 'Gradient Descent'],
  new_information: [
    { text: 'A neural network contains input, hidden, and output layers.' },
    'Gradient descent updates model weights iteratively.'
  ],
  definitions: [
    { term: 'Neural Networks', definition: 'Layered function approximators trained via backpropagation.' }
  ],
  key_facts: [{ fact: 'Hidden layers transform representations.' }],
  examples: ['Classifying handwritten digits with a small MLP.'],
  formulas: [{ expression: 'w := w - lr * dL/dw', explanation: 'parameter update rule' }],
  procedures: [{ name: 'Training loop', text: 'forward pass | compute loss | backward pass | update weights' }],
  relationships: [{ from: 'Gradient Descent', type: 'used_by', to: 'Neural Networks' }],
  terminology: [{ term: 'backpropagation', definition: 'algorithm for computing gradients through layers' }],
  contradictions: [],
  unresolved_references: ['this method converges faster (unclear referent)'],
  duplicate_candidates: [],
  future_references: []
};

function freshKb() {
  const kb = knowledgeBase.createKb();
  kb.documents.push({ id: 'doc_001', file_name: 'book.pdf', pages: 20, status: 'processing' });
  return kb;
}

describe('knowledgeBase.applyExtraction', () => {
  test('creates topics with provenance on first sight (§6, §15)', () => {
    const kb = freshKb();
    const { stats } = knowledgeBase.applyExtraction(kb, EXTRACTION, META);
    expect(stats.topicsCreated).toBe(2);
    const nn = kb.topics.find((t) => t.canonical_name === 'Neural Networks');
    expect(nn.first_seen.document_id).toBe('doc_001');
    expect(nn.first_seen.page).toBe(12);
    expect(nn.source_refs.some((r) => r.page === 12)).toBe(true);
  });

  test('attaches facts/definitions/formulas/procedures to the right topic', () => {
    const kb = freshKb();
    knowledgeBase.applyExtraction(kb, EXTRACTION, META);
    const nn = kb.topics.find((t) => t.canonical_name === 'Neural Networks');
    const gd = kb.topics.find((t) => t.canonical_name === 'Gradient Descent');
    expect(nn.definitions.length).toBeGreaterThan(0);
    expect(nn.formulas.some((f) => /dL\/dw/.test(f.text))).toBe(true);
    expect(gd.facts.some((f) => /updates model weights iteratively/.test(f.text))).toBe(true);
  });

  test('does not duplicate identical information (§30 exact duplicate)', () => {
    const kb = freshKb();
    knowledgeBase.applyExtraction(kb, EXTRACTION, META);
    const before = kb.topics.reduce((n, t) => n + t.facts.length, 0);
    knowledgeBase.applyExtraction(kb, EXTRACTION, { ...META, page: 13 });
    const after = kb.topics.reduce((n, t) => n + t.facts.length, 0);
    expect(after - before).toBe(0);
  });

  test('enriches existing topic when later info adds detail (§30 repetition-with-detail)', () => {
    const kb = freshKb();
    knowledgeBase.applyExtraction(kb, EXTRACTION, META);
    knowledgeBase.applyExtraction(kb, {
      topics: ['Neural Networks'],
      new_information: [{ text: 'Hidden layers transform representations nonlinearly using activations.' }]
    }, { ...META, page: 14 });
    const nn = kb.topics.find((t) => t.canonical_name === 'Neural Networks');
    expect(nn.facts.some((f) => /nonlinearly/.test(f.text))).toBe(true);
    expect(nn.last_updated.page).toBe(14);
  });

  test('records conflicts with claims + provenance, status unresolved (§14)', () => {
    const kb = freshKb();
    knowledgeBase.applyExtraction(kb, {
      topics: ['Learning Rate'],
      contradictions: [{
        topic: 'Learning Rate',
        claims: [
          { claim: 'Higher learning rates converge faster.', document_id: 'doc_001', page: 20 },
          { claim: 'Lower learning rates converge faster.', document_id: 'doc_001', page: 21 }
        ]
      }]
    }, { ...META, page: 21 });
    expect(kb.conflicts.length).toBe(1);
    expect(kb.conflicts[0].claims.length).toBe(2);
    expect(kb.conflicts[0].status).toBe('unresolved');
  });

  test('stores unresolved references for context continuation (§10)', () => {
    const kb = freshKb();
    knowledgeBase.applyExtraction(kb, EXTRACTION, META);
    expect(kb.unresolved_refs.some((u) => /this method/.test(u.text))).toBe(true);
  });

  test('terminology feeds the flat glossary', () => {
    const kb = freshKb();
    knowledgeBase.applyExtraction(kb, EXTRACTION, META);
    expect(kb.glossary.backpropagation).toMatch(/gradient/i);
  });
});

describe('knowledgeBase.mergeTopics (§32 cross-document)', () => {
  function twoTopics() {
    const kb = freshKb();
    knowledgeBase.applyExtraction(kb, {
      topics: ['ANN'],
      new_information: [{ text: 'ANNs are universal function approximators.' }]
    }, META);
    knowledgeBase.applyExtraction(kb, {
      topics: ['Neural Networks'],
      new_information: [{ text: 'Neural networks consist of layers.' }]
    }, { document_id: 'doc_002', page: 3 });
    return kb;
  }

  test('merges union of content, aliases, provenance; remaps conflicts', () => {
    const kb = twoTopics();
    const ann = kb.topics.find((t) => t.canonical_name === 'ANN');
    const nn = kb.topics.find((t) => t.canonical_name === 'Neural Networks');
    kb.conflicts.push({
      id: 'conflict_x', topic_id: nn.id, topic_name: nn.canonical_name,
      claims: [{ claim: 'a', document_id: 'doc_002', page: 3 }, { claim: 'b', document_id: 'doc_001', page: 9 }],
      status: 'unresolved'
    });
    const merged = knowledgeBase.mergeTopics(kb, ann.id, nn.id);
    expect(kb.topics.length).toBe(1);
    expect(merged.aliases).toContain('Neural Networks');
    const texts = merged.facts.map((f) => f.text).join(' ');
    expect(texts).toMatch(/universal function approximators/);
    expect(texts).toMatch(/consist of layers/);
    expect(merged.source_refs.map((r) => r.document_id)).toEqual(expect.arrayContaining(['doc_001', 'doc_002']));
    expect(kb.conflicts[0].topic_id).toBe(merged.id);
  });
});

describe('knowledgeBase user curation (§23)', () => {
  test('rename keeps old name as alias; addAlias rejects collisions', () => {
    const kb = freshKb();
    knowledgeBase.applyExtraction(kb, { topics: ['Transformer'] }, META);
    const t = kb.topics[0];
    expect(knowledgeBase.renameTopic(kb, t.id, 'Attention Model')).toBe(true);
    expect(t.aliases).toContain('Transformer');
    expect(knowledgeBase.addAlias(kb, t.id, 'attention model')).toBe(false); // dup of canonical
    expect(knowledgeBase.addAlias(kb, t.id, 'Vaswani architecture')).toBe(true);
  });

  test('exclude removes topic from digest/stats but keeps it stored', () => {
    const kb = freshKb();
    knowledgeBase.applyExtraction(kb, EXTRACTION, META);
    const t = kb.topics[0];
    knowledgeBase.excludeTopic(kb, t.id, true);
    expect(knowledgeBase.kbDigest(kb).some((d) => d.id === t.id)).toBe(false);
    expect(kb.topics.length).toBe(2);
  });

  test('resolveConflict marks resolved', () => {
    const kb = freshKb();
    kb.conflicts.push({ id: 'c1', topic_id: 't', topic_name: 'x', claims: [{ claim: 'a' }, { claim: 'b' }], status: 'unresolved' });
    knowledgeBase.resolveConflict(kb, 'c1', 0);
    expect(kb.conflicts[0].status).toBe('resolved');
  });
});

describe('digest / slice / glossary / stats', () => {
  test('kbDigest exposes counts + relationships for the planner (§17)', () => {
    const kb = freshKb();
    knowledgeBase.applyExtraction(kb, EXTRACTION, META);
    const digest = knowledgeBase.kbDigest(kb);
    const gd = digest.find((d) => d.name === 'Gradient Descent');
    expect(gd.related).toContain('Neural Networks');
    expect(gd.counts.facts).toBeGreaterThan(0);
  });

  test('retrieveSlice trims to budget (§28 — never whole KB)', () => {
    const kb = freshKb();
    for (let i = 0; i < 40; i++) {
      knowledgeBase.applyExtraction(kb, { topics: ['Topic ' + i], new_information: [{ text: 'Fact '.repeat(60) }] },
        { document_id: 'doc_009', page: i + 1 });
    }
    const firstId = kb.topics[0].id;
    const slice = knowledgeBase.retrieveSlice(kb, [firstId], { charsPerTopic: 400, totalChars: 500 });
    expect(JSON.stringify(slice).length).toBeLessThan(900);
    expect(slice[0].name).toBe(kb.topics[0].canonical_name);
  });

  test('glossaryFrom sorted alphabetically', () => {
    const kb = freshKb();
    kb.glossary.zeta = 'z'; kb.glossary.alpha = 'a';
    const g = knowledgeBase.glossaryFrom(kb);
    expect(g[0].term).toBe('alpha');
  });

  test('kbStats counts open conflicts and unresolved refs', () => {
    const kb = freshKb();
    knowledgeBase.applyExtraction(kb, EXTRACTION, META);
    const stats = knowledgeBase.kbStats(kb);
    expect(stats.topics).toBe(2);
    expect(stats.unresolvedRefs).toBeGreaterThanOrEqual(1);
    expect(stats.conflictsOpen).toBe(0);
  });
});

describe('sanitizeKb round-trip', () => {
  test('repairs malformed input into valid KB without throwing', () => {
    const broken = {
      topics: [{ canonical_name: 'A', facts: 'not-an-array', source_refs: [{ bogus: true }] }, null, 'junk'],
      conflicts: [{ id: 'x', claims: 'nope' }],
      glossary: { ok: 'yes', bad: null },
      nonsense: 42
    };
    const kb = knowledgeBase.sanitizeKb(broken);
    expect(kb.topics.length).toBe(1);
    expect(Array.isArray(kb.topics[0].facts)).toBe(true);
    expect(kb.conflicts.length).toBe(0);
    expect(kb.glossary.ok).toBe('yes');
  });

  test('full apply -> sanitize -> apply stays consistent (idempotent shape)', () => {
    const kb = freshKb();
    knowledgeBase.applyExtraction(kb, EXTRACTION, META);
    const restored = knowledgeBase.sanitizeKb(JSON.parse(JSON.stringify(kb)));
    expect(restored.topics.length).toBe(kb.topics.length);
    knowledgeBase.applyExtraction(restored, { topics: ['New Topic'], key_facts: ['Something new.'] }, { ...META, page: 30 });
    expect(restored.topics.length).toBe(kb.topics.length + 1);
  });
});
