import { runSkill, me, ApiError, LINKS, SITE, MAX_CHARS, MIN_DETECT_CHARS, MIN_REWRITE_WORDS, rewriteWords } from '../lib/api.js';
import { captureSelection, replaceSelection } from '../lib/page.js';
import { ext } from '../lib/ext.js';

const $ = (s) => document.querySelector(s);
const els = {
  text: $('#text'), count: $('#count'), check: $('#check'), rewrite: $('#rewrite'), grab: $('#grab'), hint: $('#hint'),
  busy: $('#busy'), busyText: $('#busy-text'), cancel: $('#cancel'), result: $('#result'), quota: $('#quota'), account: $('#account'),
};
const state = { key: '', windowId: null, source: null, controller: null, timer: null, free: null, last: null, taking: null };

// Tiny DOM builder. Strings become text nodes, so API text is never parsed as HTML.
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));
  return el;
}

const pct = (x) => Math.round((x || 0) * 100);
const tone = (x) => (x >= 0.7 ? 'ai' : x >= 0.4 ? 'mid' : 'human');
const LABELS = { human: 'Likely human-written', ai: 'Likely AI-written', ai_edited: 'AI-written, then edited', humanized: 'AI-written, then humanized', mixed: 'Mixed: part human, part AI' };
const words = (t) => (t || '').trim().split(/\s+/).filter(Boolean).length;
const clip = (t, n = 220) => (t && t.length > n ? t.slice(0, n - 1) + '…' : t);
const limit = () => (state.key ? MAX_CHARS.key : MAX_CHARS.free);
const calm = matchMedia('(prefers-reduced-motion: reduce)');

// ---- motion ------------------------------------------------------------------------------

// The one moment that moves: the score runs from where the text was to where it is now (0 for a check, the
// score before for a rewrite), and the number and the bar take the colour of each band they pass through.
// The markup already holds the end state, so reduced motion or a failed frame shows the right result.
function runScore(root) {
  const score = root.querySelector('[data-to]');
  const num = score?.querySelector('.num');
  if (!num) return;
  const pctEl = score.querySelector('.pct');
  const bar = root.querySelector('.meter i');
  const from = Number(score.dataset.from);
  const to = Number(score.dataset.to);
  if (calm.matches || from === to) return;
  const draw = (v, t = tone(v / 100)) => {
    num.textContent = `${Math.round(v)}%`;
    pctEl.classList.remove('t-ai', 't-mid', 't-human');
    pctEl.classList.add(`t-${t}`);
    if (bar) bar.className = `b-${t}`;
  };
  const scale = (v) => { if (bar) bar.style.transform = `scaleX(${Math.max(3, v) / Math.max(3, to)})`; };
  const t0 = performance.now() + 120;
  const ms = 800;
  draw(from);
  scale(from);
  const step = (now) => {
    if (!num.isConnected) return;
    const p = Math.min(1, Math.max(0, (now - t0) / ms));
    const v = from + (to - from) * (1 - (1 - p) ** 4);
    if (p < 1) {
      draw(v);
      scale(v);
      requestAnimationFrame(step);
    } else {
      draw(to, score.dataset.tone);
      if (bar) bar.style.transform = '';
    }
  };
  requestAnimationFrame(step);
}

// Result parts arrive in reading order.
function stagger(box) {
  [...box.children].forEach((c, i) => c.style.setProperty('--i', i));
  return box;
}

// Text arriving from the page lands in the box with a brief highlight.
function arrived() {
  els.text.classList.remove('arrived');
  void els.text.offsetWidth; // restart the animation
  els.text.classList.add('arrived');
}

// A check mark that draws itself, for Copied and Replaced.
function checkMark() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  const path = document.createElementNS(ns, 'path');
  for (const [k, v] of Object.entries({ viewBox: '0 0 16 16', class: 'tick', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
  for (const [k, v] of Object.entries({ d: 'M3 8.5l3.2 3L13 4.5', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) path.setAttribute(k, v);
  svg.append(path);
  return svg;
}

// ---- input -------------------------------------------------------------------------------

function refreshInput() {
  const n = els.text.value.trim().length;
  els.count.textContent = n ? `${n.toLocaleString()} / ${limit().toLocaleString()} characters` : '';
  els.count.classList.toggle('t-ai', n > limit());
  const off = !n || !!state.controller;
  els.check.disabled = off;
  els.rewrite.disabled = off;
}

function hint(msg) {
  els.hint.textContent = msg || '';
  els.hint.hidden = !msg;
}

els.text.addEventListener('input', refreshInput);
els.check.addEventListener('click', () => start('detect', els.text.value));
els.rewrite.addEventListener('click', () => start('humanize', els.text.value));
els.cancel.addEventListener('click', () => state.controller?.abort());
els.grab.addEventListener('click', grabSelection);
els.account.addEventListener('click', () => ext.runtime.openOptionsPage());

// Pulls the selection from the active tab. Works after the toolbar button or the right-click menu
// opened the panel (both give one-time access to that tab).
async function grabSelection() {
  hint('');
  const [tab] = await ext.tabs.query({ active: true, windowId: state.windowId });
  if (!tab) return;
  try {
    const results = await ext.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: captureSelection });
    const hit = results.find((r) => r.result?.text?.trim());
    if (!hit) return hint('Nothing is selected on the page. Select some text first.');
    state.source = { tabId: tab.id, frameId: hit.frameId, editable: hit.result.editable, text: hit.result.text };
    els.text.value = hit.result.text;
    arrived();
    refreshInput();
  } catch {
    hint('p3n can\'t read this page from here. Select the text, right-click it and choose p3n, or paste it in the box.');
  }
}

// ---- jobs from the right-click menu ------------------------------------------------------

async function takeJob(job) {
  if (!job || job.windowId !== state.windowId || state.taking === job.id) return;
  // Boot and the change listener can both see a job that lands while the panel opens; claim it before
  // any await, or both start it and the first call is still sent (and counted) before it's aborted.
  state.taking = job.id;
  const { handled } = await ext.storage.session.get('handled');
  if (handled === job.id || Date.now() - job.at > 120_000) return;
  await ext.storage.session.set({ handled: job.id });
  state.source = { tabId: job.tabId, frameId: job.frameId, editable: job.editable, text: job.text };
  els.text.value = job.text;
  arrived();
  refreshInput();
  start(job.skill, job.text);
}

ext.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.job?.newValue) takeJob(changes.job.newValue);
  if (area === 'local' && 'apiKey' in changes) { state.key = changes.apiKey.newValue || ''; refreshInput(); refreshAccount(); }
});

// ---- running a skill ---------------------------------------------------------------------

async function start(skill, text, options) {
  text = (text || '').trim();
  if (!text) return;
  state.controller?.abort();
  if (text.length > limit()) {
    return showError(new ApiError(422, 'too_long', state.key
      ? `That's ${text.length.toLocaleString()} characters; the API takes up to ${MAX_CHARS.key.toLocaleString()}. Select less.`
      : `That's ${text.length.toLocaleString()} characters. Without an API key p3n takes up to ${MAX_CHARS.free.toLocaleString()}. Select less, or add a key.`));
  }
  if (skill === 'detect' && [...text].length < MIN_DETECT_CHARS) {
    return showError(new ApiError(422, 'too_short', `Check needs at least ${MIN_DETECT_CHARS} characters, a sentence or two. Select more.`));
  }
  if (skill === 'humanize' && rewriteWords(text) < MIN_REWRITE_WORDS) {
    return showError(new ApiError(422, 'too_short', 'Rewrite needs at least a sentence of eight words. Select more.'));
  }
  const controller = new AbortController();
  state.controller = controller;
  // Try another rewrite is inside the result: clearing it drops keyboard focus, so bring it back after.
  const refocus = els.result.contains(document.activeElement);
  els.result.replaceChildren();
  setBusy(skill);
  try {
    const { run, free } = await runSkill(skill, text, { key: state.key, options, signal: controller.signal });
    if (free !== null) { state.free = free; ext.storage.session.set({ free }); }
    state.last = { skill, text, run };
    render(run, text);
  } catch (e) {
    if (e.name !== 'AbortError') showError(e);
    if (e.free != null) { state.free = e.free; ext.storage.session.set({ free: e.free }); }
  } finally {
    if (state.controller === controller) state.controller = null;
    setBusy(null);
    refreshInput();
    refreshAccount();
    if (refocus) focusOn(els.result.firstElementChild);
  }
}

// Moves keyboard focus to something that isn't focusable by itself (a result, a status line).
function focusOn(el) {
  if (!el) return;
  el.tabIndex = -1;
  el.focus({ preventScroll: true });
}

function setBusy(skill) {
  clearInterval(state.timer);
  els.busy.hidden = !skill;
  if (!skill) return;
  const t0 = Date.now();
  const what = skill === 'detect' ? 'Checking' : 'Rewriting';
  const tick = () => {
    const s = Math.round((Date.now() - t0) / 1000);
    els.busyText.textContent = `${what}… ${s} s` + (skill === 'humanize' && s > 8 ? ' (a rewrite takes up to a minute)' : '');
  };
  tick();
  state.timer = setInterval(tick, 1000);
}

// ---- results -----------------------------------------------------------------------------

function render(run, text) {
  // Without the fields this version reads, say so: don't show 0% or a script error.
  const o = run.output;
  if ((run.skill === 'detect' && typeof o?.ai !== 'number')
    || (run.skill === 'humanize' && (typeof o?.text !== 'string' || typeof o?.ai_after !== 'number'))) {
    return showError(new ApiError(502, 'bad_output', 'p3n answered without a result. Try again. If it keeps happening, update the extension.'));
  }
  const body = run.skill === 'detect' ? renderDetect(run.output) : run.skill === 'humanize' ? renderHumanize(run.output, text) : [h('div', { class: 'rewrite' }, run.output?.text ?? '')];
  const meta = h('p', { class: 'small muted' }, `${run.output?.version ?? run.skill}${run.cached ? ' · from cache' : ''}${state.key && run.charged_usd ? ` · $${Number(run.charged_usd).toFixed(4)}` : ''}`);
  const box = stagger(h('div', { class: 'result-in', style: 'display:flex;flex-direction:column;gap:14px' }, body, meta));
  els.result.replaceChildren(box);
  runScore(box);
}

// The big number: animated for the eye, stated once for screen readers (the result is a live region).
const scoreNum = (p) => [h('span', { class: 'num', 'aria-hidden': 'true' }, `${p}%`), h('span', { class: 'sr' }, `${p}%`)];
const meter = (x, t) => h('div', { class: 'meter' }, h('i', { class: `b-${t}`, style: `width:${Math.max(3, pct(x))}%` }));

function renderDetect(o) {
  const t = tone(o.ai);
  const parts = [
    h('div', { class: 'score', 'data-from': 0, 'data-to': pct(o.ai), 'data-tone': t },
      h('p', { class: 'label' }, LABELS[o.label] ?? 'Unknown'),
      h('p', { class: `pct t-${t}` }, scoreNum(pct(o.ai)), h('small', {}, 'likely AI'))),
    meter(o.ai, t),
  ];
  if (o.verdict) parts.push(h('p', {}, o.verdict));
  if (o.confidence?.level) parts.push(h('p', { class: 'small muted' }, `Confidence ${o.confidence.level}: ${o.confidence.reason ?? ''}`));
  // The panel is narrow: the sentences come first, and a pattern hit is listed only if its sentence isn't already there.
  const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
  const shown = new Set((o.sentences ?? []).slice(0, 5).map((s) => norm(s.text)));
  if (shown.size) {
    parts.push(h('div', {}, h('h3', {}, 'Sentences that read as AI'),
      h('ul', { class: 'quotes' }, o.sentences.slice(0, 5).map((s, j) => h('li', { class: 'hit', style: `--j:${j}` }, s.why ? h('span', { class: 'why' }, s.why) : null, h('q', {}, clip(s.text)))))));
  }
  const hits = (o.examples ?? []).filter((e) => !shown.has(norm(e.sentence))).slice(0, 6);
  if (hits.length) {
    parts.push(h('div', {}, h('h3', {}, 'Pattern hits'),
      h('ul', { class: 'quotes' }, hits.map((e) => h('li', {},
        h('span', { class: 'why' }, (e.rules ?? []).map((r) => String(r.name ?? '').replace(/\s*\(LLM\)$/, '')).join(' · ')),
        h('q', {}, clip(e.sentence)))))));
  }
  parts.push(h('p', { class: 'small muted' }, 'A score is a probability, not proof. Read the sentences yourself before deciding anything about a person.'));
  return parts;
}

function renderHumanize(o, sent) {
  const t = tone(o.ai_after);
  // The rewrite ends with a line break; keep only the whitespace the selection itself had at each end, so
  // Replace doesn't join it to the line or word before or after.
  const src = state.source?.text ?? '';
  const rewrite = src.match(/^\s*/)[0] + o.text.trim() + src.match(/\s*$/)[0];
  // Only offer Replace when what was rewritten is still the page's selection, not text edited in the panel.
  const replaceable = state.source?.editable && state.source.tabId != null && state.source.text.trim() === sent;
  const status = h('p', { class: 'small', hidden: true });
  const copyBtn = h('button', { type: 'button', class: replaceable ? 'btn ghost' : 'btn accent' }, 'Copy');
  copyBtn.addEventListener('click', async () => {
    await navigator.clipboard.writeText(rewrite.trim());
    copyBtn.replaceChildren(checkMark(), 'Copied');
    clearTimeout(copyBtn.reset);
    copyBtn.reset = setTimeout(() => copyBtn.replaceChildren('Copy'), 1500);
  });
  const buttons = [];
  if (replaceable) {
    const rep = h('button', { type: 'button', class: 'btn accent' }, 'Replace on the page');
    rep.addEventListener('click', () => replaceOnPage(rewrite, rep, status));
    buttons.push(rep);
  }
  buttons.push(copyBtn, h('button', { type: 'button', class: 'link small push', onclick: () => start('humanize', sent, { fresh: true }) }, 'Try another rewrite'));

  // "No longer" and "Still" only when the detector model put the text sent in the AI class: it can score
  // text at 0% that Check called likely AI, and "No longer reads as AI, 0% → 2%" reads wrong.
  const before = o.ai_before != null ? pct(o.ai_before) : pct(o.ai_after);
  const wasAI = o.ai_before != null && o.ai_before >= 0.5;
  const headline = o.passes ? (wasAI ? 'No longer reads as AI' : "Doesn't read as AI") : (wasAI ? 'Still reads as AI' : 'Reads as AI');
  const parts = [
    h('div', { class: 'score', 'data-from': before, 'data-to': pct(o.ai_after), 'data-tone': t },
      h('div', {}, h('p', { class: 'label' }, headline),
        h('p', { class: 'small muted' }, `Detector model: ${LABELS[o.label_after] ?? 'unknown'}`)),
      h('p', { class: `pct t-${t}`, title: 'Detector model, AI class' },
        o.ai_before != null ? h('span', { class: 'from' }, `${before}% → `) : null,
        scoreNum(pct(o.ai_after)), h('small', {}, 'AI class'))),
    meter(o.ai_after, t),
    h('div', { class: 'rewrite' }, rewrite.trim()),
    h('div', { class: 'row' }, buttons),
    status,
  ];
  if (words(o.text) / Math.max(1, words(sent)) < 0.6) {
    parts.push(h('p', { class: 'note warn small' }, `Kept ${words(o.text)} of ${words(sent)} words. Most of this text was general statements with no facts in them, and those are what reads as AI. Add the specifics you meant (who, what, numbers) and run it again.`));
  }
  if (o.invented_blocked?.length) {
    parts.push(h('p', { class: 'small muted' }, `Kept as sent where a rewrite added ${o.invented_blocked.join(', ')}, which the text does not have.`));
  }
  parts.push(h('p', { class: 'small muted' }, 'The rewrite drops filler and general statements that carry no fact. Check that every claim you need is still there.'));
  return parts;
}

async function replaceOnPage(text, button, status) {
  const s = state.source;
  const say = (msg, kind) => { status.textContent = msg; status.className = `note small ${kind}`; status.hidden = false; };
  try {
    const [res] = await ext.scripting.executeScript({ target: { tabId: s.tabId, frameIds: [s.frameId ?? 0] }, func: replaceSelection, args: [text] });
    const r = res?.result;
    if (r?.ok) {
      const hadFocus = document.activeElement === button;
      button.replaceChildren(checkMark(), 'Replaced');
      button.className = 'btn ok';
      button.disabled = true; // a disabled button loses focus: keep it on the status that says what happened
      // Ctrl+Z only when the page's undo history has the edit (lib/page.js).
      say(r.undo ? 'Replaced on the page. Ctrl+Z (Cmd+Z on a Mac) in the page undoes it.'
        : 'Replaced on the page. This editor can\'t undo it; your original is still in the Text box above.', 'ok');
      if (hadFocus) focusOn(status);
      return;
    }
    const why = { changed: 'The text on the page changed since you selected it.', gone: 'That text box is gone from the page.', not_editable: 'That text isn\'t in a box you can type in.', replaced: 'p3n already replaced that selection.' }[r?.reason] ?? 'p3n couldn\'t put the text back.';
    say(`${why} Copy the rewrite and paste it instead.`, 'warn');
  } catch {
    say('The page was reloaded or changed, so p3n can\'t edit it any more. Copy the rewrite and paste it instead.', 'warn');
  }
}

function showError(e) {
  const kids = [];
  const keyBtn = (label) => h('button', { type: 'button', class: 'btn ghost', onclick: () => ext.runtime.openOptionsPage() }, label);
  switch (e.type) {
    case 'free_limit': {
      const mins = e.retryAfter ? Math.max(1, Math.ceil(e.retryAfter / 60)) : null;
      // The link comes from the API's answer: follow it only to p3n's own site.
      const signup = e.signupUrl?.startsWith(`${SITE}/`) ? e.signupUrl : LINKS.signup;
      kids.push(h('p', {}, `The free calls for this hour are used up${mins ? `; more in about ${mins} min` : ''}.`),
        h('p', { class: 'small' }, 'Sign up at p3n.si for free credit, then create an API key and add it here to keep going.'),
        h('div', { class: 'row' }, h('a', { class: 'btn accent', href: signup, target: '_blank', rel: 'noopener', style: 'text-decoration:none' }, 'Sign up'), keyBtn('Add an API key')));
      break;
    }
    case 'insufficient_credit':
      kids.push(h('p', {}, 'Your p3n balance is too low for this.'),
        h('div', { class: 'row' }, h('a', { class: 'btn accent', href: LINKS.billing, target: '_blank', rel: 'noopener', style: 'text-decoration:none' }, 'Top up')));
      break;
    case 'unauthorized':
      kids.push(h('p', {}, 'p3n didn\'t accept your API key. It may have been revoked.'), h('div', { class: 'row' }, keyBtn('Change the key')));
      break;
    case 'rate_limited':
      kids.push(h('p', {}, 'Too many requests at once. Wait a minute and try again.'));
      break;
    default:
      kids.push(h('p', {}, e.message || 'Something went wrong.'));
  }
  els.result.replaceChildren(stagger(h('div', { class: 'note error result-in', style: 'display:flex;flex-direction:column;gap:8px' }, kids)));
}

// ---- account / quota ---------------------------------------------------------------------

async function refreshAccount() {
  els.account.textContent = state.key ? 'API key' : 'Add API key';
  if (!state.key) {
    els.quota.textContent = state.free != null
      ? `${state.free} free ${state.free === 1 ? 'call' : 'calls'} left this hour without a key.`
      : 'Free without a key: 10 calls an hour, up to 5,000 characters each.';
    return;
  }
  try {
    const m = await me(state.key);
    els.quota.textContent = `Balance $${Number(m.balance_usd).toFixed(2)} · key ${m.key?.name ?? m.key?.prefix ?? ''}`;
  } catch (e) {
    els.quota.textContent = e.type === 'unauthorized' ? 'Your API key wasn\'t accepted. Change it in the settings.' : '';
  }
}

// ---- boot --------------------------------------------------------------------------------

(async () => {
  state.windowId = (await ext.windows.getCurrent()).id;
  const [{ apiKey }, { job, free }] = await Promise.all([ext.storage.local.get('apiKey'), ext.storage.session.get(['job', 'free'])]);
  state.key = apiKey || '';
  state.free = free ?? null;
  refreshInput();
  refreshAccount();
  takeJob(job);
})();
