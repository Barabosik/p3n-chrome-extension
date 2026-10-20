# p3n browser extension

Select text on any page, right-click, and see whether it reads as AI-written. Or rewrite it so it doesn't, and put the rewrite back where it was. It uses the [p3n API](https://p3n.si/docs) (the same Check and Rewrite skills as p3n.si).

![Check for AI](store/screenshot-check.png)
![Rewrite and replace](store/screenshot-rewrite.png)

Version 0.1.0. Not in any extension store yet.

## Browsers

| Browser | Build | Panel | Tested |
| --- | --- | --- | --- |
| Chrome 116+ | this folder, or `dist/chrome` | side panel | yes, headless, live API and mocked |
| Edge, Brave | the same Chrome build | side panel | yes, headless, mocked API |
| Firefox 140+ (desktop) | `dist/firefox` | sidebar | yes, headless, mocked API, plus a live check |
| Opera, Vivaldi, Arc | the Chrome build | depends on the browser's side panel support | no |
| Firefox for Android | none: it has no sidebar or right-click menu | | |
| Safari | none yet: needs Apple's converter, Xcode and a developer account, and Safari has no side panel | | |

One codebase. `lib/ext.js` picks the API namespace (`browser` in Firefox, `chrome` elsewhere) and opens the panel the browser has: Chrome's side panel or Firefox's sidebar. `node dev/build.mjs` writes `dist/chrome` and `dist/firefox` and a store zip of each. The Firefox build changes only the manifest: background scripts instead of a service worker, `sidebar_action`, the add-on ID `p3n@p3n.si`, and Firefox's data-collection declaration (`websiteContent` for the selected text, `authenticationInfo` for an API key).

## Install (unpacked)

Chrome, Edge, Brave:
1. Open `chrome://extensions` (`edge://extensions` in Edge) and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder.
3. Pin p3n from the extensions menu if you want the icon in the toolbar.

Firefox:
1. `node dev/build.mjs`, then open `about:debugging#/runtime/this-firefox`.
2. **Load Temporary Add-on** and pick `dist/firefox/manifest.json`. It stays until Firefox restarts; a permanent install needs a signed build from addons.mozilla.org.

## Use

- Select text, right-click, **p3n → Check for AI** or **p3n → Rewrite so it doesn't read as AI**. The side panel (the sidebar in Firefox) opens with the result.
- The toolbar icon opens the same panel. Paste text there, or click **Use selected text**.
- After a rewrite, **Replace** puts it back in place of your selection (text fields and rich editors such as webmail). Ctrl+Z (Cmd+Z on a Mac) in the page undoes it. On text you can't edit, use **Copy**.
- Google Docs draws its own right-click menu and its own text, so the p3n menu doesn't show there. Copy the text into the panel instead.

## API key

Without a key, p3n allows 10 calls an hour, up to 5,000 characters each. For more, sign up at [p3n.si](https://p3n.si/register), create a key on the [API keys](https://p3n.si/dashboard/keys) page, and paste it on the extension's options page (right-click the icon → Options). The key is checked with p3n before it's saved, and it's stored in this browser only (extension storage, not synced). No login.

## What it sends

Only the text you select, and only when you choose Check or Rewrite (or click a button in the panel). It goes to `api.p3n.si` and nowhere else. The extension doesn't read pages on its own, keeps no history, and has no analytics.

## Permissions

| Permission | Why |
| --- | --- |
| `contextMenus` | The p3n entry in the right-click menu. |
| `activeTab`, `scripting` | Read the selection, and later replace it, in the tab you right-clicked. Granted for that tab only, on your click. |
| `sidePanel` | Show results next to the page (Chrome family; Firefox uses its `sidebar_action` instead). |
| `storage` | Your API key, and the job handed from the menu to the panel. |
| `https://api.p3n.si/*` | Call the p3n API. No other sites, no `<all_urls>`. |

## How it works

| File | Does |
| --- | --- |
| `background.js` | Creates the menu. On a click, opens the side panel, reads the selection from the page and hands the job to the panel through session storage. |
| `lib/page.js` | The two functions injected into the page: capture the selection, and replace it (`execCommand('insertText')` so undo works, with fallbacks). Replace refuses if the text changed since you selected it. |
| `lib/ext.js` | The browser differences: API namespace, and which panel to open. |
| `lib/api.js` | The API client: `POST /v1/detect` and `/v1/humanize`, polls `/v1/runs/{id}` for long texts, turns API errors into readable ones. |
| `ui/panel.*` | The side panel. It makes the API call itself, because the browser can stop the background script during a minute-long rewrite. Motion is kept to the result: the score counts to its value and changes colour band by band, flagged sentences get a highlighter sweep, a rewrite wipes in. With reduced motion on, the end state shows at once. |
| `ui/options.*` | The API key page. |

Colours are the p3n.si tokens. The icon is the p3n pen from [zdresearch/p3n-web#4](https://github.com/zdresearch/p3n-web/pull/4) (`dev/logo-512.png` is the source).

## Develop and test

`dev/` isn't shipped. `dev/e2e.mjs` loads a copy of the extension into a throwaway headless Chrome, opens local test pages (an article, a textarea, a webmail-style rich editor) and runs Check and Rewrite through the same code the menu uses, including Replace and undoing it. `dev/e2e-firefox.mjs` runs the same checks on the Firefox build in headless Firefox.

```bash
cd dev
npm install
npm run e2e
npm run e2e:firefox
npm run lint:firefox
```

- It calls the live API without a key, which uses 4 of the 10 free calls an hour. `MOCK=1` answers with canned API runs instead.
- `ONLY=email` (comma-separated: `article`, `textarea`, `email`) runs some of the scenarios.
- `CHROME=path/to/chrome` if Chrome isn't in the default Windows location. Point it at `msedge.exe` or `brave.exe` to run the same checks in Edge or Brave. `FIREFOX=path/to/firefox` for the Firefox run.
- `FRAMES=1` also saves frames of each result arriving (`dev/out/frame-*.png`), to look at the motion.
- Captures land in `dev/out/`. `python dev/store-shots.py` builds the 1280x800 store screenshots in `store/` from them (needs Pillow).

A script can't click the browser's own right-click menu or open the side panel, so the tests start jobs by message and show the panel in a tab. The menu is checked to exist, but clicking it, and the panel opening beside the page, are manual checks. In Firefox the mocked run points the add-on at the local test server, since Firefox's automation can't intercept an extension's requests, and it can't screenshot extension pages either. `npm run lint:firefox` runs Mozilla's `web-ext lint`; its one warning is about Firefox for Android, which this add-on doesn't target. `npm audit` flags old dependencies inside web-ext 10.7 (dev tooling only, nothing shipped).

## Package for the stores

```bash
node dev/build.mjs
```

It writes `dist/p3n-chrome-<version>.zip` (Chrome Web Store and Edge Add-ons take the same file) and `dist/p3n-firefox-<version>.zip` (addons.mozilla.org). The zips hold only what the extension needs. They're made with bsdtar (Windows' own `tar.exe`, macOS) or `zip` on Linux, because the stores need forward-slash paths; `Compress-Archive` from Windows PowerShell 5.1 writes backslashes.

Before a Firefox listing: the ID `p3n@p3n.si` is permanent once used on addons.mozilla.org, and Mozilla's reviewers may prefer `authenticationInfo` as an optional data type (asked for when a key is added) rather than required.
