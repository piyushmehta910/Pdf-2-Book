const { buildContext, truncateOnBoundary } = require('../src/services/contextManager');

describe('contextManager', () => {
  const items = [
    { content: 'Hypertrophy is driven by mechanical tension and protein synthesis. '.repeat(20), id: 'c1' },
    { content: 'The weather today is sunny with light winds across the valley. '.repeat(20), id: 'c2' },
    { content: 'Muscle hypertrophy increases cross sectional area after resistance training. '.repeat(20), id: 'c3' }
  ];

  test('ranks relevant chunks above irrelevant ones', () => {
    const ctx = buildContext({ query: 'muscle hypertrophy training', items, budgetChars: 100000 });
    expect(ctx.picked[0].id === 'c1' || ctx.picked[0].id === 'c3').toBe(true);
    expect(ctx.picked[ctx.picked.length - 1].id).toBe('c2');
  });

  test('respects total budget', () => {
    const budget = 1500;
    const ctx = buildContext({ query: '', items, budgetChars: budget });
    expect(ctx.usedChars).toBeLessThanOrEqual(budget);
    ctx.picked.forEach((p) => expect(p.text.length).toBeLessThanOrEqual(budget));
  });

  test('truncates long text on sentence boundary with ellipsis marker', () => {
    const out = truncateOnBoundary('First sentence. Second sentence goes on and on and on.', 25);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(26);
  });

  test('keeps short text intact', () => {
    expect(truncateOnBoundary('Short text.', 50)).toBe('Short text.');
  });

  test('returns empty picked list for empty items', () => {
    const ctx = buildContext({ query: 'anything', items: [], budgetChars: 5000 });
    expect(ctx.picked).toHaveLength(0);
    expect(ctx.usedChars).toBe(0);
  });
});
