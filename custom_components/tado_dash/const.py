"""Constants for Tado Dash."""

from __future__ import annotations

DOMAIN = "tado_dash"
TADO_CE_DOMAIN = "tado_ce"

PANEL_URL_PATH = "tado"
PANEL_ELEMENT = "tado-dash-panel"
PANEL_STATIC_URL = f"/{DOMAIN}/{PANEL_ELEMENT}.js"

CONF_SIDEBAR_TITLE = "sidebar_title"
CONF_SIDEBAR_ICON = "sidebar_icon"
CONF_REQUIRE_ADMIN = "require_admin"

DEFAULT_SIDEBAR_TITLE = "Tado"
DEFAULT_SIDEBAR_ICON = "mdi:radiator"
DEFAULT_REQUIRE_ADMIN = False
