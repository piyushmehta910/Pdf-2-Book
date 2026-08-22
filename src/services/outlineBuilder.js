const { id } = require('./storage');

const SECTION_ORDER = [
  'introduction', 'foundations', 'definition', 'background', 'history',
  'mechanism', 'method', 'methodology', 'evidence', 'results', 'analysis',
  'application', 'treatment', 'practice', 'discussion',
  'limitation', 'risk', 'future'
];

function sectionRank(topicName) {
  const lower = topicName.toLowerCase();
  for (let i = 0; i < SECTION_ORDER.length; i++) {
    if (lower.includes(SECTION_ORDER[i])) return i;
  }
  return SECTION_ORDER.length;
}

function buildOutline(topics) {
  const sorted = [...topics].sort(
    (a, b) => sectionRank(a.name) - sectionRank(b.name)
  );

  const chapters = [];
  let currentChapter = null;

  for (let i = 0; i < sorted.length; i++) {
    const topic = sorted[i];
    if (!currentChapter || currentChapter.topics.length >= 4) {
      currentChapter = {
        id: id('ch'),
        title: topic.name,
        topics: [topic],
        sections: []
      };
      chapters.push(currentChapter);
    } else {
      currentChapter.topics.push(topic);
    }
    currentChapter.sections.push({
      topicId: topic.id,
      heading: topic.name
    });
  }

  return {
    id: id('out'),
    preface: true,
    chapters: chapters.map((chapter, index) => ({
      ...chapter,
      number: index + 1,
      title: `Chapter ${index + 1} — ${chapter.title}`
    }))
  };
}

module.exports = { buildOutline };
