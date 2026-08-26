/** Shared JSON helpers for AI response validation. */

function parseJsonLoose(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch (_err) { /* fall through */ }
  const unfenced = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/,'')
    .trim();
  try { return JSON.parse(unfenced); } catch (_err2) { /* fall through */ }
  const firstBrace = unfenced.search(/[[{]/);
  if (firstBrace === -1) return null;
  const opener = unfenced[firstBrace];
  const closer = opener === '{' ? '}' : ']';
  const last = unfenced.lastIndexOf(closer);
  if (last <= firstBrace) return null;
  const slice = unfenced.slice(firstBrace, last + 1);
  try { return JSON.parse(slice); } catch (_err3) { /* fall through */ }
  // repair common LLM issues: trailing commas before } or ]
  try {
    return JSON.parse(slice.replace(/,\s*([}\]])/g, '$1'));
  } catch (_err4) {
    return null;
  }
}

const isStr = (v) => typeof v === 'string' && Boolean(v.trim());
const isArr = (v) => Array.isArray(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Ensure an array of strings (accepts comma-separated string fallback). */
function strArray(v, max = 40) {
  if (isArr(v)) return v.filter(isStr).map((s) => s.trim()).slice(0, max);
  if (isStr(v)) return v.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean).slice(0, max);
  return [];
}

module.exports = { parseJsonLoose, isStr, isArr, isObj, strArray };
