const fs = require('fs');
const pdf = require('pdf-parse');

async function extractPages(filePath) {
  const buffer = fs.readFileSync(filePath);
  const data = await pdf(buffer, { pagerender: renderPageText });
  return data;
}

function renderPageText(pageData) {
  let lastY;
  let text = '';
  return pageData.getTextContent().then((content) => {
    for (const item of content.items) {
      if (lastY === item.transform[5] || lastY === undefined) {
        text += item.str;
      } else {
        text += '\n' + item.str;
      }
      lastY = item.transform[5];
    }
    return text;
  });
}

module.exports = { extractPages };
