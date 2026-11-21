"""WebSocket API used by the Tado Dash panel."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import floor_registry as fr
from homeassistant.loader import IntegrationNotLoaded, async_get_loaded_integration

from .const import TADO_CE_DOMAIN
from .mapping import build_map


@dataclass(frozen=True)
class _Entry:
    entity_id: str
    unique_id: str | None
    device_id: str | None
    area_id: str | None


@callback
def async_register(hass: HomeAssistant) -> None:
    """Register the panel's WebSocket commands."""
    websocket_api.async_register_command(hass, ws_map)


@websocket_api.websocket_command({vol.Required("type"): "tado_dash/map"})
@callback
def ws_map(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Return which Tado CE entities belong to which room, and which floor that is on."""
    entity_reg = er.async_get(hass)
    device_reg = dr.async_get(hass)
    area_reg = ar.async_get(hass)
    floor_reg = fr.async_get(hass)

    entries = []
    for entry in entity_reg.entities.values():
        if entry.platform != TADO_CE_DOMAIN or entry.disabled_by:
            continue
        area_id = entry.area_id
        if area_id is None and entry.device_id:
            device = device_reg.async_get(entry.device_id)
            area_id = device.area_id if device else None
        entries.append(_Entry(entry.entity_id, entry.unique_id, entry.device_id, area_id))

    result = build_map(entries)
    # Which Tado CE is installed, so the panel can show it and adapt to it.
    try:
        result["tado_ce_version"] = str(async_get_loaded_integration(hass, TADO_CE_DOMAIN).version or "")
    except IntegrationNotLoaded:
        result["tado_ce_version"] = ""
    result["floors"] = [
        {"id": floor.floor_id, "name": floor.name, "level": floor.level}
        for floor in floor_reg.async_list_floors()
    ]
    result["areas"] = {
        area.id: {"name": area.name, "floor_id": area.floor_id}
        for area in area_reg.async_list_areas()
    }
    connection.send_result(msg["id"], result)
