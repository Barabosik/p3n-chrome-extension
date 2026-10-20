# Builds the Chrome Web Store small promo tile (440x280) in store/.   python dev/promo-tile.py
# Segoe UI is the Windows system font; pass another bold TTF as the first argument elsewhere.
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONT = sys.argv[1] if len(sys.argv) > 1 else "C:/Windows/Fonts/segoeuib.ttf"
TEXT = sys.argv[2] if len(sys.argv) > 2 else FONT.replace("segoeuib", "segoeui")
PAPER, INK, ACCENT, MUTED = "#fbfaf7", "#16130f", "#c2410c", "#57534e"
S = 3  # drawn at 3x, then scaled down for smooth edges
W, H = 440 * S, 280 * S

c = Image.new("RGB", (W, H), PAPER)
d = ImageDraw.Draw(c)
logo = Image.open(ROOT / "dev" / "logo-512.png").convert("RGBA").resize((118 * S, 118 * S), Image.LANCZOS)
c.paste(logo, (40 * S, (H - logo.height) // 2 - 6 * S), logo)

big = ImageFont.truetype(FONT, 76 * S)
x, y = 178 * S, 66 * S
for ch, col in (("p", INK), ("3", ACCENT), ("n", INK)):
    d.text((x, y), ch, font=big, fill=col)
    x += d.textlength(ch, font=big)
small = ImageFont.truetype(TEXT, 21 * S)
d.text((181 * S, 168 * S), "Find the AI in any text.", font=small, fill=MUTED)
d.text((181 * S, 198 * S), "Check it. Rewrite it.", font=small, fill=MUTED)

c.resize((440, 280), Image.LANCZOS).save(ROOT / "store" / "promo-440x280.png", optimize=True)
print("store/promo-440x280.png")
