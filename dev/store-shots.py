# Builds the 1280x800 Chrome Web Store screenshots from the e2e run's captures (dev/out/):
# the test page on the left, the side panel on the right.   python dev/store-shots.py
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "dev" / "out"
W, H, SPLIT = 1280, 800, 900

def shot(page, panel, name):
    c = Image.new("RGB", (W, H), "#ffffff")
    c.paste(Image.open(OUT / page).convert("RGB").crop((0, 0, SPLIT, H)), (0, 0))
    c.paste(Image.open(OUT / panel).convert("RGB").crop((0, 0, W - SPLIT, H)), (SPLIT, 0))
    c.paste(Image.new("RGB", (1, H), "#e6e1d8"), (SPLIT - 1, 0))
    c.save(ROOT / "store" / name, optimize=True)
    print(name, c.size)

shot("page-article.png", "panel-article.png", "screenshot-check.png")
shot("page-email-after.png", "panel-email.png", "screenshot-rewrite.png")
