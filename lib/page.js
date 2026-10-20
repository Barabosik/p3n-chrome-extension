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
  // sel.toString() keeps line breaks between blocks (what we send); range.toString() is what we compare later.
  globalThis.__p3n = { kind: editable ? 'rich' : 'static', range, rangeText: range.toString() };
  return { text: sel.toString(), editable };
}

// Puts `text` where the captured selection was. Refuses if that text has changed since, so it
// never overwrites something the user didn't select.
export function replaceSelection(text) {
  const s = globalThis.__p3n;
  if (!s || s.kind === 'static') return { ok: false, reason: 'not_editable' };

  if (s.kind === 'field') {
    const el = s.el;
    if (!el.isConnected) return { ok: false, reason: 'gone' };
    if (el.value.slice(s.start, s.end) !== s.text) return { ok: false, reason: 'changed' };
    el.focus();
    el.setSelectionRange(s.start, s.end);
    // execCommand keeps the page's undo history and fires the events frameworks listen to.
    const done = document.execCommand('insertText', false, text);
    if (!done || el.value.slice(s.start, s.start + text.length) !== text) {
      el.setRangeText(text, s.start, s.end, 'end');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    globalThis.__p3n = { ...s, end: s.start + text.length, text };
    return { ok: true };
  }

  const r = s.range;
  if (!r.startContainer.isConnected || r.toString() !== s.rangeText) return { ok: false, reason: 'changed' };
  const node = r.commonAncestorContainer;
  const host = (node.nodeType === 1 ? node : node.parentElement).closest('[contenteditable]:not([contenteditable="false"])');
  host?.focus({ preventScroll: true });
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  if (!document.execCommand('insertText', false, text)) {
    r.deleteContents();
    r.insertNode(document.createTextNode(text));
    host?.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  }
  globalThis.__p3n = null; // the range is gone now; select again to replace again
  return { ok: true };
}
