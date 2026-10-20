// One name for the extension APIs: Firefox's `browser`, else `chrome` (Chrome, Edge, Brave). Both return
// promises in Manifest V3.
export const ext = globalThis.browser ?? globalThis.chrome;

// Chrome, Edge and Brave have a side panel; Firefox has a sidebar. Either one opens only inside the user's
// click, so call this before any await in the handler.
export function openPanel(windowId) {
  const opening = ext.sidePanel ? ext.sidePanel.open({ windowId }) : ext.sidebarAction?.open();
  opening?.catch(() => {});
}
