import { ext, openPanel } from './lib/ext.js';
import { captureSelection } from './lib/page.js';

const MENU = { 'p3n-detect': 'detect', 'p3n-humanize': 'humanize' };

ext.runtime.onInstalled.addListener(async () => {
  await ext.contextMenus.removeAll();
  ext.contextMenus.create({ id: 'p3n', title: 'p3n', contexts: ['selection'] });
  ext.contextMenus.create({ id: 'p3n-detect', parentId: 'p3n', title: 'Check for AI', contexts: ['selection'] });
  ext.contextMenus.create({ id: 'p3n-humanize', parentId: 'p3n', title: "Rewrite so it doesn't read as AI", contexts: ['selection'] });
});

// The toolbar button opens the panel too (paste text there, or pull in the page's selection).
if (ext.sidePanel) ext.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
else ext.action.onClicked.addListener(() => ext.sidebarAction.toggle());

ext.contextMenus.onClicked.addListener((info, tab) => {
  const skill = MENU[info.menuItemId];
  if (!skill || !tab) return;
  openPanel(tab.windowId); // inside the click, before any await, or the browser refuses it
  startJob(skill, info, tab);
});

// The panel does the API call (a long rewrite can outlive a service worker); this only hands it the text.
async function startJob(skill, info, tab) {
  let text = info.selectionText || '';
  let editable = false;
  try {
    // The menu click gives one-time access to this tab (activeTab), enough to read the selection
    // with its line breaks and remember where it was for Replace.
    const [res] = await ext.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [info.frameId ?? 0] },
      func: captureSelection,
    });
    if (res?.result?.text) ({ text, editable } = res.result);
  } catch {
    // Browser pages, the extension stores and PDFs don't allow scripts: keep the menu's copy of the text, no Replace.
  }
  await ext.storage.session.set({
    job: { id: crypto.randomUUID(), skill, text, editable, tabId: tab.id, frameId: info.frameId ?? 0, windowId: tab.windowId, at: Date.now() },
  });
}
