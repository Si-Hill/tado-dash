"""WebSocket API used by the Tado Dash panel."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er

from .const import TADO_CE_DOMAIN
from .mapping import build_map


@callback
def async_register(hass: HomeAssistant) -> None:
    """Register the panel's WebSocket commands."""
    websocket_api.async_register_command(hass, ws_map)


@websocket_api.websocket_command({vol.Required("type"): "tado_dash/map"})
@callback
def ws_map(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Return which Tado CE entities belong to which room."""
    registry = er.async_get(hass)
    entries = [
        entry
        for entry in registry.entities.values()
        if entry.platform == TADO_CE_DOMAIN and not entry.disabled_by
    ]
    connection.send_result(msg["id"], build_map(entries))
