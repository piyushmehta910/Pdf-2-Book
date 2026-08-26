const bookPlanner = require('../src/services/bookPlanner');

const DIGEST = [
  { id: 't_nn', name: 'Neural Networks', summary: 'Layered models.', related: ['Gradient Descent'], counts: { facts: 4 } },
  { id: 't_gd', name: 'Gradient Descent', summary: 'Iterative optimizer.', related: ['Neural Networks'], counts: { facts: 3 } },
  { id: 't_bp', name: 'Backpropagation', summary: 'Gradient computation.', related: ['Gradient Descent'], counts: { facts: 2 } },
  { id: 't_cnn', name: 'CNNs', summary: 'Convolutional networks.', related: [], counts: { facts: 1 } }
];

describe('bookPlanner.fallbackPlan (deterministic)', () => {
  test('clusters relationship-connected topics into shared chapters', () => {
    const plan = bookPlanner.fallbackPlan(DIGEST, 'Deep Learning Basics');
    expect(plan.title).toBe('Deep Learning Basics');
    expect(plan.chapters.length).toBeGreaterThanOrEqual(2);
    // nn + gd + bp are mutually related -> same chapter
    const home = (id) => plan.chapters.find((c) => c.topicIds.includes(id));
    expect(home('t_nn')).toBe(home('t_gd'));
    expect(home('t_gd')).toBe(home('t_bp'));
    // every topic lands exactly once
    const all = plan.chapters.flatMap((c) => c.topicIds);
    expect(new Set(all).size).toBe(all.length);
    expect(all.sort()).toEqual(['t_bp', 't_cnn', 't_gd', 't_nn'].sort());
  });

  test('handles empty digest with a placeholder chapter', () => {
    const plan = bookPlanner.fallbackPlan([], 'Empty');
    expect(plan.chapters.length).toBe(1);
    expect(plan.chapters[0].title).toBe('Findings');
  });
});

describe('bookPlanner.sanitizePlan', () => {
  test('drops unknown topic ids and keeps known ones', () => {
    const fb = bookPlanner.fallbackPlan(DIGEST, 'T');
    fb.__topicIds = new Set(DIGEST.map((d) => d.id));
    const out = bookPlanner.sanitizePlan({
      title: ' AI Book ',
      subtitle: 'v2',
      preface: 'Welcome',
      chapters: [
        { title: 'Foundations', purpose: 'base', topicIds: ['t_nn', 't_ghost'] },
        { title: 'Only Ghosts', purpose: '', topicIds: ['nope'] },
        { title: 'Advanced', purpose: '', topicIds: ['t_gd', 't_bp'] }
      ]
    }, fb);
    expect(out.title).toBe('AI Book');
    const found = out.chapters.find((c) => c.title === 'Foundations');
    expect(found.topicIds).toEqual(['t_nn']);
    // chapter with only unknown ids is filtered out
    expect(out.chapters.some((c) => c.title === 'Only Ghosts')).toBe(false);
  });

  test('rejects single-chapter AI plans, keeps fallback', () => {
    const fb = { title: 'F', chapters: [{ title: 'A', topicIds: ['x'] }, { title: 'B', topicIds: [] }], __topicIds: new Set(['x']) };
    const out = bookPlanner.sanitizePlan({ chapters: [{ title: 'One', topicIds: ['x'] }] }, fb);
    expect(out.chapters.length).toBe(2);
  });

  test('caps chapter count at 12 and truncates long titles', () => {
    const ids = Array.from({ length: 30 }, (_, i) => `id${i}`);
    const fb = { title: 'F', subtitle: '', preface: '', chapters: [], __topicIds: new Set(ids) };
    const chapters = ids.map((id, i) => ({ title: 'C' + i + ' x'.repeat(200), purpose: '', topicIds: [id] }));
    const out = bookPlanner.sanitizePlan({ chapters }, fb);
    expect(out.chapters.length).toBeLessThanOrEqual(12);
    expect(out.chapters[0].title.length).toBeLessThanOrEqual(140);
  });
});

describe('bookPlanner.planFromDigest keyless mode', () => {
  test('returns deterministic plan without an API key', async () => {
    const { plan, mode } = await bookPlanner.planFromDigest(
      { title: 'My Book', digest: DIGEST, presetId: 'studyguide' },
      null
    );
    expect(mode).toBe('fallback');
    expect(plan.chapters.length).toBeGreaterThan(1);
    const all = plan.chapters.flatMap((c) => c.topicIds);
    expect(all).toContain('t_nn');
  });

  test('falls back gracefully when AI throws', async () => {
    jest.mock('../src/services/aiProvider', () => ({
      available: () => true,
      complete: async () => { throw new Error('boom'); }
    }));
    jest.resetModules();
    const planner = require('../src/services/bookPlanner');
    const { plan, mode } = await planner.planFromDigest(
      { title: 'B', digest: DIGEST, presetId: 'textbook' },
      { provider: 'zen', apiKey: 'k', model: 'm' }
    );
    expect(mode).toBe('fallback');
    expect(Array.isArray(plan.chapters)).toBe(true);
  });
});
