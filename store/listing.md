# Store listings

What goes into the Chrome Web Store and addons.mozilla.org forms. The zips come from `node dev/build.mjs`, and the images are in this folder.

Listings: Chrome Web Store item `bingopgkcgafmnpkoeckijkcbnfmchnh` (chromewebstore.google.com/detail/bingopgkcgafmnpkoeckijkcbnfmchnh once live), Firefox slug `p3n` (addons.mozilla.org/firefox/addon/p3n). Both submitted for review on 2026-10-20 as 0.1.0.

## Description (both stores)

```
Select text on any page, right-click, and pick p3n. It tells you whether the text reads as AI-written and which sentences give it away. Or it rewrites the text so it reads as human, and puts the new version back in the page.

Check for AI: a score, a short reason, and the sentences that read as AI.

Rewrite: a new version that keeps your facts and drops the filler. Replace puts it where your selection was, in text boxes and in editors like webmail, and Ctrl+Z undoes it.

Results open in the side panel, next to the page.

Free to try: without an account you get 10 checks or rewrites an hour, up to 5,000 characters each. For more, add an API key from p3n.si.

Privacy: p3n sends only the text you selected, only when you click, and only to api.p3n.si. It keeps no history and has no analytics.

Google Docs replaces the browser's right-click menu, so p3n doesn't show up there. Paste the text into the panel instead.

Open source: https://github.com/Barabosik/p3n-chrome-extension
```

## Chrome Web Store

| Field | Value |
| --- | --- |
| Summary | From the manifest's `description`. |
| Category | Productivity › Tools |
| Language | English |
| Store icon | `icons/128.png` |
| Screenshots | `screenshot-check.png`, `screenshot-rewrite.png` (1280×800) |
| Small promo tile | `promo-440x280.png` |
| Homepage | https://p3n.si |
| Support | https://github.com/Barabosik/p3n-chrome-extension/issues |
| Privacy policy | https://github.com/Barabosik/p3n-chrome-extension/blob/main/PRIVACY.md |
| Visibility | Public, all regions |

Privacy practices tab:
- **Single purpose:** Check selected text for signs of AI writing, and rewrite it so it reads as human-written.
- **contextMenus:** Adds the p3n item to the right-click menu when text is selected.
- **activeTab:** Lets the extension read the selected text in the tab where the user picked a p3n menu item, only after that click.
- **scripting:** Runs one small function in that tab to read the selection, and another to put the rewrite in its place when the user clicks Replace.
- **sidePanel:** Shows the result in the side panel next to the page.
- **storage:** Keeps the user's optional API key and light/dark choice (local storage) and passes the selected text from the menu to the side panel (session storage).
- **Host permission `https://api.p3n.si/*`:** The p3n API that checks and rewrites the text. It is the only host the extension contacts.
- **Remote code:** No. All code ships in the package.
- **Data collected:** Website content (the selected text, sent when the user clicks) and Authentication information (the optional API key). Not sold or transferred to third parties outside the approved use, not used for anything unrelated to the single purpose, not used for credit decisions.

## addons.mozilla.org

| Field | Value |
| --- | --- |
| Name | From the manifest. |
| URL slug | `p3n` |
| Summary | From the manifest's `description`. |
| Categories | Language Support |
| Licence | MIT |
| Homepage | https://p3n.si |
| Support site | https://github.com/Barabosik/p3n-chrome-extension/issues |
| Privacy policy | The text of `PRIVACY.md` |
| Source code | Not needed: no build step, minifier or bundler. The zip is the repo's files as they are. |

Notes for the reviewer:

```
No build step: the package is the source at https://github.com/Barabosik/p3n-chrome-extension, copied as is by dev/build.mjs, which only rewrites the manifest for Firefox (background scripts, sidebar_action, gecko ID, data collection).

To test without an account: select text on any page, right-click, p3n > Check for AI. The sidebar opens with the result. Calls without an API key are free, 10 an hour per IP, up to 5,000 characters.

The add-on contacts only https://api.p3n.si, and only when the user clicks. Data collection: websiteContent (the selected text) and authenticationInfo (the optional API key).
```
