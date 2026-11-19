"""Tado Dash: a sidebar dashboard for rooms managed by Tado CE.

Tado Dash has no devices or entities of its own. It registers a sidebar panel
that reads the entities Tado CE already creates and calls Tado CE's services.
"""

from __future__ import annotations

import json
from pathlib import Path

from homeassistant.components.frontend import (
    async_register_built_in_panel,
    async_remove_panel,
)
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from . import websocket_api
from .const import (
    BRAND_STATIC_URL,
    CONF_REQUIRE_ADMIN,
    CONF_SIDEBAR_ICON,
    CONF_SIDEBAR_TITLE,
    DEFAULT_REQUIRE_ADMIN,
    DEFAULT_SIDEBAR_ICON,
    DEFAULT_SIDEBAR_TITLE,
    DOMAIN,
    PANEL_ELEMENT,
    PANEL_STATIC_URL,
    PANEL_URL_PATH,
)


_PANEL_JS = Path(__file__).parent / "frontend" / f"{PANEL_ELEMENT}.js"
_BRAND_DIR = Path(__file__).parent / "brand"
_MANIFEST = Path(__file__).parent / "manifest.json"


def _read_version() -> str:
    return json.loads(_MANIFEST.read_text(encoding="utf-8")).get("version", "0")


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Register the sidebar panel."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    if not domain_data.get("static_registered"):
        await hass.http.async_register_static_paths(
            [
                StaticPathConfig(PANEL_STATIC_URL, str(_PANEL_JS), False),
                # The panel header shows the same logo as the brand images, light or dark to suit the theme.
                StaticPathConfig(f"{BRAND_STATIC_URL}/logo.png", str(_BRAND_DIR / "logo.png"), True),
                StaticPathConfig(f"{BRAND_STATIC_URL}/dark_logo.png", str(_BRAND_DIR / "dark_logo.png"), True),
            ]
        )
        websocket_api.async_register(hass)
        domain_data["static_registered"] = True
        domain_data["version"] = await hass.async_add_executor_job(_read_version)

    _register_panel(hass, entry, domain_data["version"])
    entry.async_on_unload(entry.add_update_listener(_async_options_updated))
    return True


def _register_panel(hass: HomeAssistant, entry: ConfigEntry, version: str) -> None:
    async_register_built_in_panel(
        hass,
        component_name="custom",
        sidebar_title=entry.options.get(CONF_SIDEBAR_TITLE, DEFAULT_SIDEBAR_TITLE),
        sidebar_icon=entry.options.get(CONF_SIDEBAR_ICON, DEFAULT_SIDEBAR_ICON),
        frontend_url_path=PANEL_URL_PATH,
        config={
            "_panel_custom": {
                "name": PANEL_ELEMENT,
                "embed_iframe": False,
                "trust_external": False,
                # The version query makes browsers fetch the new file after an update.
                "js_url": f"{PANEL_STATIC_URL}?v={version}",
            }
        },
        require_admin=entry.options.get(CONF_REQUIRE_ADMIN, DEFAULT_REQUIRE_ADMIN),
        update=True,
    )


async def _async_options_updated(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Remove the sidebar panel."""
    async_remove_panel(hass, PANEL_URL_PATH)
    return True
