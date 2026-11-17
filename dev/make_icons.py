"""Generate the brand icons (needs Pillow). Run from the repo root.

Same mark as the panel header: a ring stacked on a rounded square.
"""

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path("custom_components/tado_dash/brand")
OUT.mkdir(parents=True, exist_ok=True)
ORANGE = (230, 126, 34, 255)  # Flat UI carrot
WHITE = (255, 255, 255, 255)


def draw(size: int) -> Image.Image:
    scale = 4  # draw big, then downsample for smooth edges
    s = size * scale
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    pad = int(s * 0.04)
    d.rounded_rectangle([pad, pad, s - pad, s - pad], radius=int(s * 0.22), fill=ORANGE)
    c, r, w = s / 2, s * 0.26, int(s * 0.075)
    d.ellipse([c - r, c - r, c + r, c + r], outline=WHITE, width=w)
    return im.resize((size, size), Image.LANCZOS)


draw(256).save(OUT / "icon.png")
draw(512).save(OUT / "icon@2x.png")
draw(256).save(OUT / "logo.png")
