// Run inside the page through chrome.scripting.executeScript (isolated world), so each function
// must be self-contained: no imports, no outer variables. The isolated world lives as long as the
// page, so the selection is kept on globalThis between capture and replace.

// Reads what the user selected and remembers where it was, so Replace can put a rewrite back.
export function captureSelection() {
  const el = document.activeElement;
  const isField = el && (el.tagName === 'TEXTAREA'
    || (el.tagName === 'INPUT' && /^(text|search|email|url|)$/i.test(el.getAttribute('type') || '')));
  if (isField && el.selectionStart !== el.selectionEnd) {
    const text = el.value.slice(el.selectionStart, el.selectionEnd);
    globalThis.__p3n = { kind: 'field', el, start: el.selectionStart, end: el.selectionEnd, text };
    return { text, editable: !el.readOnly && !el.disabled };
  }
  const sel = getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
    globalThis.__p3n = null;
    return { text: '', editable: false };
  }
  const range = sel.getRangeAt(0).cloneRange();
  const node = range.commonAncestorContainer;
  const host = node.nodeType === 1 ? node : node.parentElement;
  const editable = !!host && host.isContentEditable;
  // sel.toString() keeps line breaks between blocks (what we send); range.toString() is what we compare later, and
  // where the panel finds the sentences a Check lists, to mark them (markSelection).
  globalThis.__p3n = { kind: editable ? 'rich' : 'static', range, rangeText: range.toString() };
  return { text: sel.toString(), editable, rangeText: globalThis.__p3n.rangeText };
}

// Marks sentences in the captured selection with CSS Custom Highlights, which paint over the page's text without
// changing its DOM (their colours come from the panel, with scripting.insertCSS). `marks` are [start, end, kind]
// in `rangeText`, as the panel found them. They go when that text changes (and the panel hears of it, with `id`),
// with the next capture's marks, or with unmarkSelection.
export function markSelection(rangeText, marks, id) {
  globalThis.__p3nMarks?.clear();
  const s = globalThis.__p3n;
  const r = s?.range;
  if (!r || s.rangeText !== rangeText || !r.startContainer.isConnected || r.toString() !== rangeText) return { ok: false, reason: 'changed' };
  if (!globalThis.CSS?.highlights || typeof Highlight !== 'function') return { ok: false, reason: 'unsupported' };
  // The selection's text nodes and where each starts in rangeText, joined as Range.toString() joins them.
  const root = r.commonAncestorContainer;
  const nodes = [];
  if (root.nodeType === Node.TEXT_NODE) nodes.push(root);
  else for (const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); w.nextNode();) if (r.intersectsNode(w.currentNode)) nodes.push(w.currentNode);
  let at = 0;
  const parts = nodes.map((n) => {
    const from = n === r.startContainer ? r.startOffset : 0;
    const part = { n, from, at };
    at += (n === r.endContainer ? r.endOffset : n.length) - from;
    return part;
  });
  if (at !== rangeText.length) return { ok: false, reason: 'unsupported' };
  const point = (i, end) => { const p = parts.findLast((x) => (end ? x.at < i : x.at <= i)); return [p.n, p.from + i - p.at]; };
  const sets = { ai: new Highlight(), hit: new Highlight() };
  for (const [start, end, kind] of marks) {
    const m = document.createRange();
    m.setStart(...point(start, false));
    m.setEnd(...point(end, true));
    sets[kind]?.add(m);
  }
  CSS.highlights.set('p3n-ai', sets.ai);
  CSS.highlights.set('p3n-hit', sets.hit);

  const watch = new MutationObserver(() => {
    if (r.toString() === rangeText) return;
    clear();
    (globalThis.browser ?? globalThis.chrome).runtime.sendMessage({ p3nMarks: 'cleared', id }).catch(() => {});
  });
  const clear = () => {
    watch.disconnect();
    CSS.highlights.delete('p3n-ai');
    CSS.highlights.delete('p3n-hit');
    globalThis.__p3nMarks = null;
  };
  watch.observe(root.nodeType === Node.TEXT_NODE ? root.parentNode : root, { subtree: true, childList: true, characterData: true });
  globalThis.__p3nMarks = { clear };
  // The page's own selection paints over the marks: let it go if it's still the one p3n read.
  const sel = getSelection();
  const now = sel.rangeCount ? sel.getRangeAt(0) : null;
  if (now && now.compareBoundaryPoints(Range.START_TO_START, r) === 0 && now.compareBoundaryPoints(Range.END_TO_END, r) === 0) sel.collapseToEnd();
  return { ok: true, count: sets.ai.size + sets.hit.size };
}

export function unmarkSelection() {
  globalThis.__p3nMarks?.clear();
}

// Puts `text` where the captured selection was. Refuses if that text has changed since, so it
// never overwrites something the user didn't select. `undo` is false when the editor refused the
// browser's own edit and the text went in directly: the page's undo history doesn't have it then.
export function replaceSelection(text) {
  const s = globalThis.__p3n;
  if (s?.kind === 'replaced') return { ok: false, reason: 'replaced' };
  if (!s || s.kind === 'static') return { ok: false, reason: 'not_editable' };

  if (s.kind === 'field') {
    const el = s.el;
    if (!el.isConnected) return { ok: false, reason: 'gone' };
    if (el.value.slice(s.start, s.end) !== s.text) return { ok: false, reason: 'changed' };
    el.focus();
    el.setSelectionRange(s.start, s.end);
    // execCommand keeps the page's undo history and fires the events frameworks listen to.
    let undo = document.execCommand('insertText', false, text);
    if (!undo || el.value.slice(s.start, s.start + text.length) !== text) {
      el.setRangeText(text, s.start, s.end, 'end');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      undo = false;
    }
    globalThis.__p3n = { ...s, end: s.start + text.length, text };
    return { ok: true, undo };
  }

  const r = s.range;
  if (!r.startContainer.isConnected || r.toString() !== s.rangeText) return { ok: false, reason: 'changed' };
  const node = r.commonAncestorContainer;
  const host = (node.nodeType === 1 ? node : node.parentElement).closest('[contenteditable]:not([contenteditable="false"])');
  host?.focus({ preventScroll: true });
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  const undo = document.execCommand('insertText', false, text);
  if (!undo) {
    r.deleteContents();
    r.insertNode(document.createTextNode(text));
    host?.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  }
  globalThis.__p3n = { kind: 'replaced' }; // the range is gone now; select again to replace again
  return { ok: true, undo };
}
