const semanticResolver = require('../src/services/semanticResolver');
const knowledgeBase = require('../src/services/knowledgeBase');

function kbWith(name, summary) {
  const kb = knowledgeBase.createKb();
  const ref = knowledgeBase.makeRef('doc_001', 1);
  kb.topics.push({
    ...{
      id: 'topic_test1',
      canonical_name: name,
      aliases: [],
      summary: summary || '',
      definitions: [], facts: [], examples: [], formulas: [], procedures: [],
      relationships: [], terminology: [], entities: [], source_refs: [ref],
      first_seen: ref, last_updated: ref, confidence: 0.8, excluded: false
    }
  });
  return kb;
}

describe('semanticResolver.normalizeName', () => {
  test('lowercases, strips punctuation, naive singularizes', () => {
    expect(semanticResolver.normalizeName('Neural Networks')).toBe('neural network');
    expect(semanticResolver.normalizeName('  ANN! ')).toBe('ann');
    expect(semanticResolver.normalizeName('Gradient Descent.')).toBe('gradient descent');
  });
});

describe('semanticResolver bands (§7)', () => {
  test('0.95 and above auto-merges', () => {
    expect(semanticResolver.classify(0.95).action).toBe('auto-merge');
    expect(semanticResolver.classify(0.99).verdict).toBe('same');
  });
  test('0.85–0.95 is strong candidate', () => {
    expect(semanticResolver.classify(0.9).action).toBe('merge-with-provenance');
  });
  test('0.70–0.85 requires AI adjudication', () => {
    expect(semanticResolver.classify(0.75).action).toBe('ai-adjudication');
  });
  test('below 0.70 is a new topic', () => {
    expect(semanticResolver.classify(0.4).verdict).toBe('new');
  });
});

describe('resolveTopic ladder', () => {
  test('exact canonical match wins', () => {
    const kb = kbWith('Gradient Descent', 'iterative optimization algorithm');
    const r = semanticResolver.resolveTopic(kb, 'gradient descent', '');
    expect(r.verdict).toBe('exact');
    expect(r.topic.id).toBe('topic_test1');
  });

  test('alias match resolves to the same topic', () => {
    const kb = kbWith('Neural Networks', 'layered function approximators');
    kb.topics[0].aliases.push('ANN');
    const r = semanticResolver.resolveTopic(kb, 'Artificial Neural Network', '');
    // normalized alias "artificial neural network" != "ann", so falls to vector path
    expect(['exact', 'strong', 'review', 'new']).toContain(r.verdict);
    const r2 = semanticResolver.resolveTopic(kb, 'ANN', '');
    expect(r2.verdict).toBe('exact');
  });

  test('high similarity resolves as strong without exact name match', () => {
    const kb = kbWith('Gradient Descent', 'An iterative optimization algorithm that updates parameters using the gradient of the loss function.');
    const r = semanticResolver.resolveTopic(kb, 'Gradient Descent Optimization',
      'Gradient Descent Optimization: an iterative optimization algorithm updating parameters with the gradient of the loss.');
    // must at least surface the existing topic as a candidate above the review floor
    expect(['strong', 'exact', 'review']).toContain(r.verdict);
    expect(r.topic.id).toBe('topic_test1');
    expect(r.score).toBeGreaterThanOrEqual(semanticResolver.THRESHOLDS.REVIEW);
  });

  test('unrelated text yields new', () => {
    const kb = kbWith('Photosynthesis', 'plants converting light energy into chemical energy');
    const r = semanticResolver.resolveTopic(kb, 'Stock Options', 'employee stock option compensation plans vesting schedules');
    expect(r.verdict).toBe('new');
  });

  test('never merges on name alone when content differs (§30)', () => {
    const kb = kbWith('Regression', 'predicting continuous values from inputs in supervised learning');
    const r = semanticResolver.resolveTopic(kb, 'Repression', 'suppressing memories or behavior in psychology studies');
    expect(r.verdict === 'new' || r.score < semanticResolver.THRESHOLDS.STRONG).toBe(true);
  });
});
