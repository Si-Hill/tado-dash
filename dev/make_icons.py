"""Generate the brand images (needs Pillow). Run from the repo root.

icon.png, icon@2x.png   the mark: a ring stacked on a rounded square
logo.png                the mark with "Tado Dash" beside it, dark text (for light backgrounds)
dark_logo.png           the same with light text (for dark backgrounds)
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path("custom_components/tado_dash/brand")
OUT.mkdir(parents=True, exist_ok=True)
ORANGE = (230, 126, 34, 255)  # Flat UI carrot
WHITE = (255, 255, 255, 255)
TEXT_ON_LIGHT = (44, 62, 80, 255)  # Flat UI midnight blue
TEXT_ON_DARK = (236, 240, 241, 255)  # Flat UI clouds
CE_ON_LIGHT = (169, 177, 181, 255)  # light grey, a touch darker so it stays readable on white
CE_ON_DARK = (189, 195, 199, 255)  # Flat UI silver
# First one found is used; any bold sans-serif will do.
FONTS = [
    "C:/Windows/Fonts/bahnschrift.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
]


def mark(size: int) -> Image.Image:
    scale = 4  # draw big, then downsample for smooth edges
    s = size * scale
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    pad = int(s * 0.04)
    d.rounded_rectangle([pad, pad, s - pad, s - pad], radius=int(s * 0.22), fill=ORANGE)
    c, r, w = s / 2, s * 0.26, int(s * 0.075)
    d.ellipse([c - r, c - r, c + r, c + r], outline=WHITE, width=w)
    return im.resize((size, size), Image.LANCZOS)


def font(px: int) -> ImageFont.FreeTypeFont:
    for path in FONTS:
        if Path(path).exists():
            return ImageFont.truetype(path, px)
    return ImageFont.load_default(px)


def logo(text_colour, ce_colour) -> Image.Image:
    """The mark and the name side by side: "Tado", a small "CE" in light grey on the same baseline, "Dash"."""
    icon_size, gap, pad, space_before_ce, space_after_ce = 256, 36, 16, 26, 22
    big, small = font(150), font(72)
    w_tado, w_ce, w_dash = big.getlength("Tado"), small.getlength("CE"), big.getlength("Dash")
    w = int(pad + icon_size + gap + w_tado + space_before_ce + w_ce + space_after_ce + w_dash + pad)
    h = icon_size + 2 * pad
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    m = mark(icon_size)
    im.paste(m, (pad, pad), m)
    d = ImageDraw.Draw(im)
    cap = big.getbbox("T")
    cap_h = cap[3] - cap[1]
    baseline = h / 2 + cap_h / 2  # puts the capitals on the mark's centre line
    x = pad + icon_size + gap
    d.text((x, baseline), "Tado", font=big, fill=text_colour, anchor="ls")
    x += w_tado + space_before_ce
    d.text((x, baseline), "CE", font=small, fill=ce_colour, anchor="ls")  # same baseline as the words
    x += w_ce + space_after_ce
    d.text((x, baseline), "Dash", font=big, fill=text_colour, anchor="ls")
    return im


mark(256).save(OUT / "icon.png")
mark(512).save(OUT / "icon@2x.png")
logo(TEXT_ON_LIGHT, CE_ON_LIGHT).save(OUT / "logo.png")
logo(TEXT_ON_DARK, CE_ON_DARK).save(OUT / "dark_logo.png")
