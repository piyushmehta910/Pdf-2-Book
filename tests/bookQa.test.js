const { runQa } = require('../src/services/bookQa');

const TOPICS = [
  { id: 't1', canonical_name: 'Gradient Descent', aliases: ['GD'], excluded: false },
  { id: 't2', canonical_name: 'Learning Rate', aliases: [], excluded: false }
];

const KB = (over = {}) => ({
  topics: TOPICS.map((t) => ({ ...t })),
  conflicts: [{ status: 'unresolved' }, { status: 'resolved' }],
  unresolved_refs: [{ raw: 'x' }],
  glossary: [{ term: 'LR' }],
  documents: [],
  ...over
});

function book(chapters) {
  return {
    meta: { includeToc: true, presetId: 'textbook' },
    title: 'T',
    preface: '',
    chapters,
    tocEntries: [{ title: 'C1', level: 1 }],
    glossary: [{ term: 'LR', definition: 'Learning rate' }]
  };
}

describe('runQa', () => {
  test('passes a healthy book', () => {
    const r = runQa(book([
      { title: 'C1', sections: [{ title: 'S1', blocks: [{ type: 'paragraph', text: 'See [[Gradient Descent]] and [[GD]] too.' }] }] }
    ]), KB());
    expect(r.status).toBe('pass');
    expect(r.statistics.chapters).toBe(1);
    expect(r.statistics.blocks).toBe(1);
    expect(r.statistics.conflicts).toBe(1);
  });

  test('fails on malformed book / no chapters / empty chapter', () => {
    expect(runQa(null, KB()).status).toBe('fail');
    const r = runQa(book([{ title: 'Empty', sections: [] }]), KB());
    expect(r.status).toBe('fail');
    expect(r.errors.join(' ')).toMatch(/no sections/i);
  });

  test('warns on empty sections and duplicate section titles', () => {
    const r = runQa(book([
      { title: 'A', sections: [{ title: 'Same', blocks: [] }, { title: 'Same', blocks: [{ type: 'note', text: 'hi' }] }] }
    ]), KB());
    expect(r.status).toBe('warn');
    expect(r.warnings.join('\n')).toMatch(/empty section/i);
    expect(r.warnings.join('\n')).toMatch(/duplicate section title/i);
    expect(r.statistics.emptySections).toBe(1);
    expect(r.statistics.duplicateSections).toBe(1);
  });

  test('flags cross-references that match no topic', () => {
    const r = runQa(book([
      { title: 'A', sections: [{ title: 'S', blocks: [{ type: 'paragraph', text: 'link [[Nonexistent Thing]]' }] }] }
    ]), KB());
    expect(r.status).toBe('warn');
    expect(r.warnings.join('\n')).toMatch(/\[\[Nonexistent Thing\]\]/);
    expect(r.statistics.brokenRefs).toBe(1);
  });

  test('warns about missing toc when requested and absent', () => {
    const b = book([{ title: 'A', sections: [{ title: 'S', blocks: [{ type: 'note', text: 'x' }] }] }]);
    delete b.tocEntries;
    delete b.glossary;
    const r = runQa(b, KB({ glossary: [] }));
    expect(r.warnings.join('\n')).toMatch(/table of contents/i);
    expect(r.warnings.join('\n')).toMatch(/glossary/i);
  });

  test('counts excluded topics out of statistics', () => {
    const kb = KB();
    kb.topics.push({ id: 't3', canonical_name: 'Junk', aliases: [], excluded: true });
    const r = runQa(book([]), kb);
    expect(r.statistics.topics).toBe(2);
  });
});
