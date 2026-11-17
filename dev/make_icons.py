"""Generate the brand icons (needs Pillow). Run from the repo root."""

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path("custom_components/tado_dash/brand")
OUT.mkdir(parents=True, exist_ok=True)

for size, name in ((256, "icon.png"), (512, "icon@2x.png")):
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    s = size / 256
    d.rounded_rectangle([8 * s, 8 * s, 248 * s, 248 * s], radius=56 * s, fill=(255, 112, 67, 255))
    for i in range(5):
        x = (58 + i * 30) * s
        d.rounded_rectangle([x, 64 * s, x + 18 * s, 192 * s], radius=9 * s, fill=(255, 255, 255, 255))
    d.rounded_rectangle([46 * s, 52 * s, 210 * s, 64 * s], radius=6 * s, fill=(255, 255, 255, 255))
    d.rounded_rectangle([46 * s, 192 * s, 210 * s, 204 * s], radius=6 * s, fill=(255, 255, 255, 255))
    im.save(OUT / name)

logo = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
logo.paste(Image.open(OUT / "icon.png"), (0, 0))
logo.save(OUT / "logo.png")
