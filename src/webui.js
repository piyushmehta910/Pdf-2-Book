const fs = require('fs');
const path = require('path');

const HTML_PATH = path.join(__dirname, '..', 'public', 'index.html');
let cached = null;
let cachedMtime = 0;

module.exports = function webui() {
  try {
    const mtime = fs.statSync(HTML_PATH).mtimeMs;
    if (cached === null || mtime !== cachedMtime) {
      cached = fs.readFileSync(HTML_PATH, 'utf8');
      cachedMtime = mtime;
    }
    return cached;
  } catch (_err) {
    return cached || '<h1>pdf2book</h1><p>UI bundle missing (public/index.html not found).</p>';
  }
};
