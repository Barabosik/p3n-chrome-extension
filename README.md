# p3n for Chrome

Select text on any page, right-click, and see whether it reads as AI-written. Or rewrite it so it doesn't, and put the rewrite back where it was. It uses the [p3n API](https://p3n.si/docs) (the same Check and Rewrite skills as p3n.si).

![Check for AI](store/screenshot-check.png)
![Rewrite and replace](store/screenshot-rewrite.png)

Version 0.1.0. Not on the Chrome Web Store yet.

## Install (unpacked)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder.
3. Pin p3n from the puzzle-piece menu if you want the icon in the toolbar.

Needs Chrome 116 or later (side panel API).

## Use

- Select text, right-click, **p3n → Check for AI** or **p3n → Rewrite so it doesn't read as AI**. The side panel opens with the result.
- The toolbar icon opens the same panel. Paste text there, or click **Use selected text**.
- After a rewrite, **Replace** puts it back in place of your selection (text fields and rich editors such as webmail). Ctrl+Z (Cmd+Z on a Mac) in the page undoes it. On text you can't edit, use **Copy**.
- Google Docs draws its own right-click menu and its own text, so the p3n menu doesn't show there. Copy the text into the panel instead.

## API key

Without a key, p3n allows 10 calls an hour, up to 5,000 characters each. For more, sign up at [p3n.si](https://p3n.si/register), create a key on the [API keys](https://p3n.si/dashboard/keys) page, and paste it on the extension's options page (right-click the icon → Options). The key is checked with p3n before it's saved, and it's stored in this browser only (`chrome.storage.local`). No login.

## What it sends

Only the text you select, and only when you choose Check or Rewrite (or click a button in the panel). It goes to `api.p3n.si` and nowhere else. The extension doesn't read pages on its own, keeps no history, and has no analytics.

## Permissions

| Permission | Why |
| --- | --- |
| `contextMenus` | The p3n entry in the right-click menu. |
| `activeTab`, `scripting` | Read the selection, and later replace it, in the tab you right-clicked. Granted for that tab only, on your click. |
| `sidePanel` | Show results next to the page. |
| `storage` | Your API key, and the job handed from the menu to the panel. |
| `https://api.p3n.si/*` | Call the p3n API. No other sites, no `<all_urls>`. |

## How it works

| File | Does |
| --- | --- |
| `background.js` | Creates the menu. On a click, opens the side panel, reads the selection from the page and hands the job to the panel through `chrome.storage.session`. |
| `lib/page.js` | The two functions injected into the page: capture the selection, and replace it (`execCommand('insertText')` so undo works, with fallbacks). Replace refuses if the text changed since you selected it. |
| `lib/api.js` | The API client: `POST /v1/detect` and `/v1/humanize`, polls `/v1/runs/{id}` for long texts, turns API errors into readable ones. |
| `ui/panel.*` | The side panel. It makes the API call itself, because Chrome can stop a service worker during a minute-long rewrite. |
| `ui/options.*` | The API key page. |

Colours are the p3n.si tokens. The icon is the p3n pen from [zdresearch/p3n-web#4](https://github.com/zdresearch/p3n-web/pull/4) (`dev/logo-512.png` is the source).

## Develop and test

`dev/` isn't shipped. `dev/e2e.mjs` loads a copy of the extension into a throwaway headless Chrome, opens local test pages (an article, a textarea, a webmail-style rich editor) and runs Check and Rewrite through the same code the menu uses, including Replace.

```bash
cd dev
npm install
npm run e2e
```

- It calls the live API without a key, which uses 4 of the 10 free calls an hour. `MOCK=1` answers with canned API runs instead.
- `ONLY=email` (comma-separated: `article`, `textarea`, `email`) runs some of the scenarios.
- `CHROME=path/to/chrome` if Chrome isn't in the default Windows location.
- Captures land in `dev/out/`. `python dev/store-shots.py` builds the 1280x800 store screenshots in `store/` from them (needs Pillow).

A script can't click Chrome's own right-click menu, so the test starts jobs by message instead. The menu itself is checked to exist, but clicking it is a manual check.

## Package for the Web Store

Zip only what the extension needs. On Windows 10 and later or macOS:

```bash
tar -a -cf p3n-0.1.0.zip manifest.json background.js lib ui icons
```

On Linux, `zip -r p3n-0.1.0.zip manifest.json background.js lib ui icons`. Not `Compress-Archive` from Windows PowerShell 5.1: it writes `lib\api.js` with backslashes, which the Web Store can't unpack.
