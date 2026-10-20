import { captureSelection } from './lib/page.js';

const MENU = { 'p3n-detect': 'detect', 'p3n-humanize': 'humanize' };

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'p3n', title: 'p3n', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'p3n-detect', parentId: 'p3n', title: 'Check for AI', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'p3n-humanize', parentId: 'p3n', title: "Rewrite so it doesn't read as AI", contexts: ['selection'] });
  });
});

// The toolbar button opens the panel too (paste text there, or pull in the page's selection).
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const skill = MENU[info.menuItemId];
  if (!skill || !tab) return;
  // Must happen inside the click, before any await, or Chrome refuses it (no user gesture).
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  startJob(skill, info, tab);
});

// The panel does the API call (a long rewrite can outlive a service worker); this only hands it the text.
async function startJob(skill, info, tab) {
  let text = info.selectionText || '';
  let editable = false;
  try {
    // The menu click gives one-time access to this tab (activeTab), enough to read the selection
    // with its line breaks and remember where it was for Replace.
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [info.frameId ?? 0] },
      func: captureSelection,
    });
    if (res?.result?.text) ({ text, editable } = res.result);
  } catch {
    // Chrome pages, the Web Store and PDFs don't allow scripts: keep Chrome's copy of the text, no Replace.
  }
  await chrome.storage.session.set({
    job: { id: crypto.randomUUID(), skill, text, editable, tabId: tab.id, frameId: info.frameId ?? 0, windowId: tab.windowId, at: Date.now() },
  });
}
