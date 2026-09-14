const { buildChunks, chunksFromSource, clusterChunks, processSources } = require('../src/services/knowledgePipeline');
const { makeLocalEmbedder } = require('../src/services/embeddings');

function sourceWithUnits(sourceId, pages) {
  return {
    id: sourceId,
    name: sourceId + '.pdf',
    pages: pages.map((p) => ({
      pageNumber: p.pageNumber,
      units: (p.units || []).map((u, i) => Object.assign({ id: sourceId + '-u' + i }, u)),
      text: p.text || ''
    }))
  };
}

describe('knowledgePipeline.buildChunks', () => {
  test('chunks typed units and keeps provenance', () => {
    const src = sourceWithUnits('s1', [
      {
        pageNumber: 1,
        units: [
          { type: 'heading', text: 'Methods' },
          { type: 'paragraph', text: 'Muscle growth tracks training volume and protein intake.' }
        ]
      }
    ]);
    const chunks = buildChunks([src]);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    chunks.forEach((c) => {
      expect(c.sourceId).toBe('s1');
      expect(typeof c.pageNumber).toBe('number');
      expect(c.section).toBeTruthy();
      expect(typeof c.index).toBe('number');
    });
  });

  test('falls back to page text when units are absent', () => {
    const chunks = chunksFromSource({ id: 's2', pages: [{ pageNumber: 2, text: '## Intro\n\nPlain text body without units.' }] });
    expect(chunks.length).toBeGreaterThan(0);
    chunks.forEach((c) => expect(c.sourceId).toBe('s2'));
  });
});

describe('knowledgePipeline.clusterChunks', () => {
  test('groups same-topic chunks together', () => {
    const embedder = makeLocalEmbedder();
    const chunks = Array.from({ length: 10 }, (_, i) => ({
      id: 'c' + i,
      sourceId: 's' + (i % 3),
      pageNumber: (i % 4) + 1,
      section: 'Body',
      content: 'Muscle hypertrophy depends on resistance training volume and protein intake for athletes.'
    }));
    const vectors = embedder.embed(chunks.map((c) => c.content));
    const topics = clusterChunks(chunks, embedder, null, vectors);
    expect(topics.length).toBeGreaterThan(0);
    expect(topics[0].chunkCount).toBeGreaterThan(1);
    expect(topics[0].sources.length).toBeGreaterThan(1);
  });

  test('separates unrelated topics', () => {
    const embedder = makeLocalEmbedder();
    const chunks = [
      { id: 'a', sourceId: 's1', pageNumber: 1, section: 'Body', content: 'Cardiac output rises during aerobic exercise training in healthy adults.' },
      { id: 'b', sourceId: 's2', pageNumber: 2, section: 'Body', content: 'The capital of a country is usually the seat of government and parliament.' },
      { id: 'c', sourceId: 's3', pageNumber: 3, section: 'Body', content: 'Baking soda reacts with vinegar to produce carbon dioxide gas.' }
    ];
    const vectors = embedder.embed(chunks.map((c) => c.content));
    const topics = clusterChunks(chunks, embedder, null, vectors);
    expect(topics.length).toBeGreaterThan(1);
  });
});

describe('knowledgePipeline.processSources', () => {
  test('end to end: duplicates, topics, conflicts and outline', async () => {
    const sharesA = 'Creatine supplementation increases intramuscular phosphocreatine stores and boosts high intensity performance.';
    const sharesB = 'Supplementing creatine raises muscle phosphocreatine and improves performance in short bursts of high intensity effort.';
    const sources = [
      sourceWithUnits('s1', [
        { pageNumber: 1, units: [
          { type: 'heading', text: 'Supplementation' },
          { type: 'paragraph', text: sharesA },
          { type: 'paragraph', text: 'A repeated controlled trial observed the same training outcomes across forty subjects.' }
        ] },
        { pageNumber: 2, units: [
          { type: 'heading', text: 'Safety' },
          { type: 'paragraph', text: 'No adverse events were reported at the tested daily dose in this cohort.' }
        ] }
      ]),
      sourceWithUnits('s2', [
        { pageNumber: 1, units: [
          { type: 'heading', text: 'Supplementation' },
          { type: 'paragraph', text: sharesB },
          { type: 'paragraph', text: 'An independent laboratory replicated the identical training outcomes across another forty subjects.' }
        ] },
        { pageNumber: 2, units: [
          { type: 'heading', text: 'Safety' },
          { type: 'paragraph', text: 'Higher doses caused gastrointestinal discomfort in some participants during the trial.' }
        ] }
      ])
    ];

    const result = await processSources({ sources, embedder: makeLocalEmbedder() });
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.topics.length).toBeGreaterThanOrEqual(2);
    expect(result.outline.chapters.length).toBeGreaterThan(0);
    expect(result.stats.sources).toBe(2);
    const topic = result.topics.find((t) => String(t.name).toLowerCase().indexOf('supplementation') >= 0 || t.sources && t.sources.length > 1);
    expect(topic).toBeTruthy();
    result.chunks.forEach((c) => {
      expect(c.sourceId).toBeTruthy();
      expect(c.pageNumber).toBeTruthy();
      expect(c.section).toBeTruthy();
    });
  });

  test('surfaces at least the duplicate pairs that are near-identical', async () => {
    const text = 'The mitochondria are the powerhouse of the cell and generate most chemical energy via oxidative phosphorylation.';
    const sources = [
      sourceWithUnits('s1', [{ pageNumber: 1, units: [{ type: 'paragraph', text }] }]),
      sourceWithUnits('s2', [{ pageNumber: 3, units: [{ type: 'paragraph', text }] }])
    ];
    const result = await processSources({ sources, embedder: makeLocalEmbedder() });
    const group = result.duplicates.find((d) => d.sourceIds.includes('s1') && d.sourceIds.includes('s2'));
    expect(group).toBeTruthy();
    expect(group.pages).toEqual(expect.arrayContaining([1, 3]));
  });
});