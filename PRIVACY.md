# Privacy

The p3n extension sends text to p3n only when you ask it to.

- **What it sends.** The text you selected, or typed into the panel, when you click Check for AI or Rewrite. If you added an API key, the key goes with it so p3n can bill your account. Each call also names the extension and its version (for example `p3n-chrome/0.1.1`), so your usage page can show which tool made it.
- **Where it goes.** Only to `api.p3n.si`, over HTTPS.
- **What it doesn't do.** It reads nothing until you click, and doesn't see the sites you visit. It keeps no history, and has no analytics or ads.
- **What stays in your browser.** Your API key and your light or dark choice, in the extension's local storage. They aren't synced, and removing the extension deletes them.

What p3n does with the text it receives:
- It keeps the text for up to 7 days, to return results and debug failures, then deletes it.
- It sends the text through OpenRouter to the AI model providers that run the check or rewrite.
- It logs the time and IP address of each call. That's how the free limit works.
- It doesn't sell data or use your text to train models.

The full policy is at [p3n.si/privacy](https://p3n.si/privacy). Questions go to [p3n.si/contact](https://p3n.si/contact).
