<p align="center">
  <img src="icons/logo.png" width="88" alt="">
</p>

<h1 align="center">p3n for Chrome and Firefox</h1>

<p align="center">
  Select text on any page. See if it reads as AI-written, or rewrite it in place where you're typing.
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/bingopgkcgafmnpkoeckijkcbnfmchnh">Chrome Web Store</a> · <a href="https://addons.mozilla.org/firefox/addon/p3n/">Firefox Add-ons</a> · <a href="https://p3n.si">p3n.si</a> · <a href="https://nikita-andreiev.com/p3n/">All p3n apps</a>
</p>

<p align="center">
  <a href="https://github.com/Barabosik/p3n-chrome-extension/actions/workflows/ci.yml"><img src="https://github.com/Barabosik/p3n-chrome-extension/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://chromewebstore.google.com/detail/bingopgkcgafmnpkoeckijkcbnfmchnh"><img src="https://img.shields.io/chrome-web-store/v/bingopgkcgafmnpkoeckijkcbnfmchnh?label=Chrome%20Web%20Store" alt="Chrome Web Store version"></a>
  <a href="https://addons.mozilla.org/firefox/addon/p3n/"><img src="https://img.shields.io/amo/v/p3n?label=Firefox%20Add-ons" alt="Firefox Add-ons version"></a>
</p>

![Check for AI](store/screenshot-check.png)

## What it does

- **Check for AI.** A score, a one-line reason, and the sentences that give it away.
- **Rewrite.** A version that keeps your facts and drops the filler. **Replace** puts it where your selection was, in text boxes and webmail editors, and Ctrl+Z undoes it.
- Results open in the side panel, next to the page.
- Works in Chrome, Edge, Brave and Firefox.

![Rewrite and replace](store/screenshot-rewrite.png)

## Free, or with a key

You get 10 checks or rewrites an hour without an account, up to 5,000 characters each. For more, [sign up at p3n.si](https://p3n.si/register) (you get free credit), make a key on the [API keys](https://p3n.si/dashboard/keys) page, and add it with **Add API key** at the top of the p3n panel.

## Privacy

The extension sends the text you selected to `api.p3n.si`, and only when you click. The extension keeps no history and has no analytics, and your API key stays in this browser. p3n.si keeps the text for up to 7 days. The details are in [PRIVACY.md](PRIVACY.md).

<details>
<summary>What each permission is for</summary>

| Permission | For |
| --- | --- |
| `contextMenus` | The p3n item in the right-click menu. |
| `activeTab`, `scripting` | Reading your selection, and replacing it, in the tab you right-clicked. Only after your click. |
| `sidePanel` | Showing results next to the page. Firefox uses its sidebar. |
| `storage` | Your API key and light or dark choice, and passing the selection to the panel. |
| `https://api.p3n.si/*` | The p3n API. No other site. |

</details>

## Install from the store

- Chrome, Edge or Brave: [Chrome Web Store](https://chromewebstore.google.com/detail/bingopgkcgafmnpkoeckijkcbnfmchnh)
- Firefox 140 or later: [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/p3n/)

Store installs update themselves.

## Install from source

1. Download this repo (Code, then Download ZIP) and unzip it.
2. Chrome, Edge or Brave: open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and pick the folder.
3. Firefox: run `node dev/build.mjs`, open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on** and pick `dist/firefox/manifest.json`. Firefox drops it on restart.

Installs from source don't update themselves.

## Known gaps

Google Docs replaces the browser's right-click menu, so p3n isn't in it there. Paste the text into the panel instead. There's no Safari or Firefox for Android version yet.

## Other p3n apps

p3n also works in [Word and Excel](https://nikita-andreiev.com/p3n/#office), [Google Docs](https://nikita-andreiev.com/p3n/#docs), [VS Code](https://nikita-andreiev.com/p3n/#vscode), [Obsidian](https://nikita-andreiev.com/p3n/#obsidian) and [Sublime Text](https://nikita-andreiev.com/p3n/#sublime). Install steps for each are on [nikita-andreiev.com/p3n](https://nikita-andreiev.com/p3n/).

## Develop

Tests, builds and packaging are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

MIT
