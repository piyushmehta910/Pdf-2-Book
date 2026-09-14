const {
  normCitation,
  sourceRefToCitation,
  sourceRefFromCitation,
  renderInlineCitation,
  stripInlineTags,
  attachCitations,
  collectCitations,
  annotateBookWithCitations
} = require('../src/services/citations');

const EVIDENCE = [
  { id: 'e1', sourceId: 'src-a', page: 4, section: 'Methods', content: 'Resistance training volume is the primary driver of hypertrophy in untrained adults.' },
  { id: 'e2', sourceId: 'src-b', page: 7, section: 'Results', content: 'Protein intake above 1.6 g/kg adds little additional benefit once volume is adequate.' }
];

describe('citations.normCitation', () => {
  test('normalizes legacy and new reference shapes', () => {
    expect(normCitation({ document_id: 'd1', page: 9, section: 'Intro' })).toEqual({ sourceId: 'd1', page: 9, section: 'Intro' });
    expect(normCitation({ sourceId: 's1', pageNumber: 3 })).toEqual({ sourceId: 's1', page: 3, section: '' });
    expect(normCitation(null)).toBeNull();
  });

  test('round-trips through sourceRef', () => {
    const cit = normCitation({ sourceId: 's2', page: 5, section: 'Safety' });
    expect(sourceRefFromCitation(cit)).toEqual({ document_id: 's2', page: 5, section: 'Safety' });
    expect(sourceRefToCitation({ document_id: 's2', page: 5, section: 'Safety' })).toEqual(cit);
  });
});

describe('citations.attachCitations', () => {
  test('maps numeric citation indexes to evidence', () => {
    const sections = [{ title: 'S', blocks: [{ type: 'paragraph', text: 'Training volume drives hypertrophy.', citations: [1] }] }];
    attachCitations(sections, EVIDENCE);
    expect(sections[0].blocks[0].citations[0]).toEqual({ sourceId: 'src-a', page: 4, section: 'Methods' });
  });

  test('reads inline [src(N)] tags and strips them', () => {
    const sections = [{ title: 'S', blocks: [{ type: 'paragraph', text: 'Volume matters most [src(2)].' }] }];
    attachCitations(sections, EVIDENCE);
    const b = sections[0].blocks[0];
    expect(b.text).not.toMatch(/\[src/);
    expect(b.citations[0].sourceId).toBe('src-b');
  });

  test('falls back to best matching evidence when no markers present', () => {
    const sections = [{ title: 'S', blocks: [{ type: 'paragraph', text: 'Resistance training volume strongly predicts muscle growth.' }] }];
    attachCitations(sections, EVIDENCE);
    expect(sections[0].blocks[0].citations.length).toBeGreaterThan(0);
    expect(sections[0].blocks[0].sourceRef.document_id).toBe('src-a');
  });

  test('keeps blocks with no plausible match ungrounded rather than inventing refs', () => {
    const sections = [{ title: 'S', blocks: [{ type: 'paragraph', text: 'Shrek is a fictional ogre who lives in a swamp in the movie franchise.' }] }];
    attachCitations(sections, EVIDENCE, { threshold: 0.14 });
    expect(sections[0].blocks[0].citations).toEqual([]);
  });

  test('inherits sourceRef when no citations exist yet', () => {
    const sections = [{ title: 'S', blocks: [{ type: 'paragraph', text: 'Only a local claim.', sourceRef: { document_id: 'x1', page: 2 } }] }];
    attachCitations(sections, []);
    expect(sections[0].blocks[0].citations).toEqual([{ sourceId: 'x1', page: 2, section: '' }]);
  });
});

describe('citations.misc', () => {
  test('collectCitations gathers distinct citations across a book', () => {
    const book = { chapters: [{ sections: [{ blocks: [
      { type: 'paragraph', text: 'a', citations: [{ sourceId: 'd1', page: 1, section: '' }] },
      { type: 'paragraph', text: 'b', citations: [{ sourceId: 'd1', page: 1, section: '' }, { sourceId: 'd2', page: 2, section: 'X' }] }
    ] }] }] };
    const all = collectCitations(book);
    expect(all).toHaveLength(2);
    expect(annotateBookWithCitations(book).citationCount).toBe(2);
  });

  test('renderInlineCitation formats page and section', () => {
    expect(renderInlineCitation({ sourceId: 'd1', page: 4, section: 'Methods' }, 'paper.pdf')).toBe('[paper.pdf, p. 4, sec. Methods]');
    expect(stripInlineTags('Text here [2] and [src(1)] continue on.')).toBe('Text here and continue on.');
  });
});