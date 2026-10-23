// Finds the sentences a Check lists in the text that was checked, compared the way p3n's other apps compare them:
// curly quotes as straight, whitespace runs as one space, any case, punctuation at either end left out. A repeated
// sentence goes to its next occurrence, and one that isn't in the text is skipped (it stays in the panel's list).
// Returns the items found, each with its { start, end } in the text, in text order and never overlapping.

const QUOTES = { '\u2018': "'", '\u2019': "'", '\u201a': "'", '\u201b': "'", '\u201c': '"', '\u201d': '"', '\u201e': '"', '\u201f': '"' };
// A sentence as compared: its punctuation at either end (lead, tail) apart from the words (core).
const PARTS = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/su;

// The text as compared, and where each of its characters came from in the original.
function fold(s) {
  let str = '';
  const from = [];
  const to = [];
  for (let i = 0; i < s.length;) {
    const ch = String.fromCodePoint(s.codePointAt(i));
    if (/\s/.test(ch)) {
      if (str.at(-1) !== ' ') { str += ' '; from.push(i); to.push(i + ch.length); }
    } else {
      const f = (QUOTES[ch] ?? ch).toLowerCase();
      for (let k = 0; k < f.length; k++) { from.push(i); to.push(i + ch.length); }
      str += f;
    }
    i += ch.length;
  }
  return { str, from, to };
}

export function locate(text, items) {
  const t = fold(text);
  const next = new Map(); // where to look for a sentence's next occurrence
  const found = [];
  for (const item of items) {
    const [, lead, core, tail] = fold(String(item.text ?? '')).str.trim().match(PARTS);
    if (!core) continue;
    const i = t.str.indexOf(core, next.get(core) ?? 0);
    if (i < 0) continue;
    next.set(core, i + core.length);
    // Take in the sentence's own end punctuation (a full stop, a closing quote) where the text has it too.
    const a = lead && t.str.slice(i - lead.length, i) === lead ? i - lead.length : i;
    const b = tail && t.str.startsWith(tail, i + core.length) ? i + core.length + tail.length : i + core.length;
    const start = t.from[a];
    const end = t.to[b - 1];
    if (found.some((f) => start < f.end && f.start < end)) continue;
    found.push({ ...item, start, end });
  }
  return found.sort((x, y) => x.start - y.start);
}
