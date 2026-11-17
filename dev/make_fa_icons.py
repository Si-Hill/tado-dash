"""Embed Font Awesome Free (solid) icons into the panel.

Usage (from the repo root):
    python -I dev/make_fa_icons.py <dir with fontawesome-free svgs/solid/*.svg>

Icons: Font Awesome Free 6.7.2, CC BY 4.0, https://fontawesome.com/license/free
The panel calls icon("<name>") with the names on the left below; the right-hand
side is the Font Awesome icon that is drawn.
"""

import re
import sys
from pathlib import Path

PANEL = Path("custom_components/tado_dash/frontend/tado-dash-panel.js")

ALIAS = {
    "fire": "fire", "timer-sand": "hourglass-half", "water-percent": "droplet",
    "rocket-launch-outline": "rocket", "hand-back-right-outline": "hand", "brain": "brain",
    "calendar-clock": "calendar-days", "power": "power-off", "radiator-off": "temperature-empty",
    "water-boiler": "faucet-drip", "fire-burner": "fire-burner", "timer-cog-outline": "clock-rotate-left",
    "sync-circle": "rotate", "sync": "arrows-rotate", "router-wireless": "wifi", "key-outline": "key",
    "home-map-marker": "location-dot", "cloud-check-outline": "cloud", "apple": "house-signal",
    "thermometer-low": "temperature-low", "thermometer-high": "temperature-high",
    "thermometer": "temperature-half", "bullseye-arrow": "bullseye", "wall": "border-all",
    "refresh": "arrows-rotate", "plus": "plus", "minus": "minus", "menu": "bars", "arrow-left": "arrow-left",
    "lightbulb-on-outline": "lightbulb", "clock-fast": "clock", "clock-check-outline": "clock",
    "calendar-arrow-right": "calendar-check", "infinity": "infinity", "timer-outline": "stopwatch",
    "home-outline": "house", "lightbulb-alert-outline": "lightbulb", "home-analytics": "house-circle-check",
    "history": "clock-rotate-left", "clipboard-check-outline": "clipboard-check",
    "calendar-remove-outline": "calendar-xmark", "alert-circle-outline": "circle-exclamation",
    "emoticon-outline": "face-smile", "mushroom-outline": "bacteria", "water-alert-outline": "droplet",
    "water-thermometer-outline": "temperature-arrow-down", "water-outline": "water", "clock-start": "clock",
    "radiator": "temperature-half", "thermostat": "temperature-half", "battery": "battery-full",
    "battery-alert": "battery-quarter", "battery-unknown": "battery-half", "air-conditioner": "snowflake",
    "home-export-outline": "house", "home-account": "house", "circle-question": "circle-question",
}


def main(svg_dir: str) -> None:
    src = Path(svg_dir)
    icons = {}
    for name in sorted(set(ALIAS.values())):
        svg = (src / f"{name}.svg").read_text(encoding="utf-8")
        view = re.search(r'viewBox="0 0 (\d+) 512"', svg)
        path = re.findall(r'<path d="([^"]+)"', svg)
        if not view or len(path) != 1:
            raise SystemExit(f"unexpected svg shape: {name}")
        icons[name] = (int(view[1]), path[0])

    body = ["const FA_ALIAS = {"]
    body += [f'  "{k}": "{v}",' for k, v in ALIAS.items()]
    body += ["};", "const FA = {"]
    body += [f'  "{n}": [{w}, "{d}"],' for n, (w, d) in icons.items()]
    body += ["};"]
    block = "\n".join(body)

    text = PANEL.read_text(encoding="utf-8")
    new, n = re.subn(
        r"(/\* FA-ICONS-START \*/\n).*?(/\* FA-ICONS-END \*/)",
        lambda m: m[1] + block + "\n" + m[2],
        text,
        flags=re.S,
    )
    if n != 1:
        raise SystemExit("markers not found in panel")
    PANEL.write_text(new, encoding="utf-8", newline="\n")
    print(f"embedded {len(icons)} icons")


if __name__ == "__main__":
    main(sys.argv[1])
