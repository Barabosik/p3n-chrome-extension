// What the Chrome and Firefox end-to-end checks share: test texts, canned API runs, the local test server.
import http from 'node:http';

export const AI_TEXT = "In today's fast-paced world, it's worth noting that effective communication is more important than ever. Moreover, leveraging the right tools can help teams unlock their full potential and navigate the complexities of modern work.";
export const SHORT = 'Moreover, this seamless solution unlocks a rich tapestry of possibilities for teams of all sizes.';

// MOCK=1 answers the panel's API calls with these canned runs instead (no keyless calls used).
export const FIXTURES = {
  detect: { id: 'mock-detect', skill: 'detect', status: 'succeeded', cached: false, error: null, charged_usd: '0',
    output: { version: 'detect-v1.2', ai: 0.96, label: 'ai', verdict: 'Generic filler phrases with no specific claim or example.', confidence: { level: 'medium', reason: 'Two short sentences.' },
      sentences: [{ text: AI_TEXT.split('. ')[0] + '.', why: 'A stock opening with a vague claim.' }], examples: [] } },
  humanize: { id: 'mock-humanize', skill: 'humanize', status: 'succeeded', cached: false, error: null, charged_usd: '0',
    // The live API ends the rewrite with a line break; the panel must not carry it into the page.
    output: { version: 'humanize-v1.1', model: 'haiku', text: 'It works for teams of all sizes.\n', ai_before: 0.08, ai_after: 0.02, label_after: 'human', passes: true, invented_blocked: [] } },
  // /v1/me with any key (the options page's wrong-key check), sent with a 401.
  me: { error: { type: 'unauthorized', message: 'Invalid API key.' } },
};

// Scores laid over the humanize fixture while set, for the headline cases below.
export const mock = { humanizeScores: null };
export const answer = (skill) => (skill === 'humanize' && mock.humanizeScores
  ? { ...FIXTURES.humanize, output: { ...FIXTURES.humanize.output, ...mock.humanizeScores } }
  : FIXTURES[skill]);

// The rewrite headline says "No longer" or "Still" only when the detector model put the text sent in the AI
// class (ai_before >= 0.5). It can score text at 0% that Check called likely AI.
export const HEADLINES = [
  [{ ai_before: 0.95, ai_after: 0.01, passes: true }, 'No longer reads as AI'],
  [{ ai_before: 0.08, ai_after: 0.02, passes: true }, "Doesn't read as AI"],
  [{ ai_before: 0.88, ai_after: 0.71, passes: false, label_after: 'ai' }, 'Still reads as AI'],
  [{ ai_before: 0.3, ai_after: 0.62, passes: false, label_after: 'ai' }, 'Reads as AI'],
  [{ ai_before: null, ai_after: 0.04, passes: true }, "Doesn't read as AI"],
];

const page = (body) => `<!doctype html><meta charset="utf-8"><title>p3n test</title>
<style>body{font:16px/1.6 system-ui;max-width:640px;margin:40px auto;padding:0 20px;color:#222}textarea,[contenteditable]{width:100%;min-height:140px;font:inherit;padding:10px;border:1px solid #bbb;border-radius:6px}</style>${body}`;
export const PAGES = {
  '/textarea': page(`<h1>Compose</h1><textarea id="box">${SHORT}</textarea>`),
  '/rich': page(`<h1>Email</h1><div id="box" contenteditable="true"><div>Hi team,</div><div>${SHORT}</div><div>Thanks</div></div>`),
  '/static': page(`<h1>Blog post</h1><article><p id="box">${AI_TEXT}</p></article>`),
};

// Serves the test pages, and with `api: true` also a stand-in for api.p3n.si: the canned runs, and a 401
// for any key on /v1/me (the options page's wrong-key check).
export async function startServer({ api = false } = {}) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Expose-Headers': 'X-Free-Remaining' };
  const server = http.createServer((req, res) => {
    const skill = api && req.method === 'POST' && req.url.match(/^\/v1\/(detect|humanize)$/)?.[1];
    if (api && req.method === 'OPTIONS') return res.writeHead(204, cors).end();
    if (skill) return res.writeHead(200, { ...cors, 'Content-Type': 'application/json', 'X-Free-Remaining': '9' }).end(JSON.stringify(answer(skill)));
    if (api && req.url === '/v1/me') return res.writeHead(401, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify(FIXTURES.me));
    res.writeHead(PAGES[req.url] ? 200 : 404, { 'Content-Type': 'text/html' }).end(PAGES[req.url] ?? 'not found');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

export const selectField = () => { const b = document.querySelector('#box'); b.focus(); b.setSelectionRange(0, b.value.length); return b.value; };
export const selectNode = (sel) => new Function(`const n = document.querySelector(${JSON.stringify(sel)}); const r = document.createRange(); r.selectNodeContents(n); const s = getSelection(); s.removeAllRanges(); s.addRange(r); n.closest('[contenteditable]')?.focus(); return s.toString();`);

// The score counts to its value: true once the number on screen is the stated one and the bar is at rest.
export const scoreSettled = () => {
  const n = document.querySelector('.score .num');
  const sr = document.querySelector('.score .sr');
  return !!n && n.textContent === sr.textContent && !document.querySelector('.meter i')?.style.transform;
};
