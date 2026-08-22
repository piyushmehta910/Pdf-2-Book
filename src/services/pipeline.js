const storage = require('./storage');
const { extractPages } = require('./pdfExtractor');
const { documentToMarkdown } = require('./markdownConverter');
const { chunkDocument } = require('./chunker');
const { detectTopics, mergeSimilarTopics } = require('./topicDetector');
const { detectDuplicates } = require('./duplicateDetector');
const { detectConflicts } = require('./conflictDetector');
const { buildOutline } = require('./outlineBuilder');
const { computeCoverage } = require('./coverageChecker');

async function processSource(projectId, source) {
  let pages;
  if (source.type === 'pdf') {
    const data = await extractPages(source.filePath);
    pages = splitRawPages(data).map((text, index) => ({ pageNumber: index + 1, text }));
  } else {
    const fs = require('fs');
    const text = fs.readFileSync(source.filePath, 'utf8');
    pages = [{ pageNumber: 1, text }];
  }

  const markdown = documentToMarkdown(pages);
  const chunks = chunkDocument(source.id, pages.map((p) => ({ ...p, markdown: null })));

  storage.updateById(projectId, 'sources', source.id, {
    status: 'processed',
    pageCount: pages.length,
    markdown,
    processedAt: new Date().toISOString()
  });

  for (const chunk of chunks) {
    chunk.sourceTitle = source.title;
  }

  for (const chunk of chunks) {
    await storage.insert(projectId, 'chunks', chunk);
  }
  return { pages: pages.length, chunks: chunks.length };
}

function splitRawPages(data) {
  if (!data || !data.text) return [];
  if (data.numpages && typeof data.text === 'string') {
    return data.text.split(/\f/).filter((t) => t !== undefined);
  }
  return [data.text];
}

async function analyzeProject(projectId) {
  const chunks = storage.readCollection(projectId, 'chunks');

  const detected = detectTopics(chunks);
  const topics = mergeSimilarTopics(detected.topics);
  const duplicates = detectDuplicates(chunks);
  const conflicts = detectConflicts(chunks, duplicates);
  const outline = buildOutline(topics);
  const coverage = computeCoverage(topics, chunks);

  storage.replaceAll(projectId, 'topics', topics);
  storage.replaceAll(projectId, 'duplicates', duplicates);
  storage.replaceAll(projectId, 'conflicts', conflicts);
  storage.writeCollection(projectId, 'outline', [outline]);
  storage.writeCollection(projectId, 'coverage', coverage);

  return {
    topicCount: topics.length,
    duplicateGroups: duplicates.length,
    conflictCount: conflicts.length,
    chapterCount: outline.chapters.length,
    coverage
  };
}

module.exports = { processSource, analyzeProject };
