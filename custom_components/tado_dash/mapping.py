"""Work out which Tado CE entity belongs to which room.

Tado CE entity IDs are not predictable (``climate.lounge_2``, ``sensor.lounge_temp``
and so on), but its unique IDs are::

    tado_ce_<home>_zone_<zone>_<key>        per-room entities
    tado_ce_<home>_device_<serial>_<key>    per-device (TRV, sensor) entities
    tado_ce_<home>_<key>                    hub-wide entities

The panel resolves everything through these keys, so it keeps working whatever
the entity IDs have been renamed to.
"""

from __future__ import annotations

from collections.abc import Iterable
import re
from typing import Any, Protocol

_ZONE_RE = re.compile(r"^tado_ce_(?:(?P<home>\d+)_)?zone_(?P<zone>\d+)_(?P<key>.+)$")
_DEVICE_RE = re.compile(
    r"^tado_ce_(?:(?P<home>\d+)_)?device_(?P<serial>[^_]+)_(?P<key>.+)$"
)
_HUB_RE = re.compile(r"^tado_ce_(?P<home>\d+)_(?P<key>.+)$")

NO_HOME = "unknown"


class _Entry(Protocol):
    entity_id: str
    unique_id: str | None
    device_id: str | None
    # Optional: the area the entity (or, failing that, its device) is in.
    # area_id: str | None


# The entity whose area says which room (and so which floor) a zone is in.
_MAIN_KEYS = ("climate", "ac_climate", "water_heater")


def build_map(entries: Iterable[_Entry]) -> dict[str, Any]:
    """Group Tado CE registry entries by home, room and device."""
    homes: dict[str, dict[str, Any]] = {}
    device_to_zone: dict[tuple[str, str], str] = {}
    pending_devices: list[tuple[str, str, str, str, str | None]] = []

    def home(home_id: str) -> dict[str, Any]:
        return homes.setdefault(
            home_id, {"id": home_id, "zones": {}, "hub": {}, "devices": {}, "trackers": []}
        )

    for entry in entries:
        uid = entry.unique_id
        if not uid or not uid.startswith("tado_ce_"):
            continue
        if match := _ZONE_RE.match(uid):
            h = home(match["home"] or NO_HOME)
            zone = h["zones"].setdefault(
                match["zone"], {"id": match["zone"], "entities": {}}
            )
            zone["entities"][match["key"]] = entry.entity_id
            if match["key"] in _MAIN_KEYS and (area := getattr(entry, "area_id", None)):
                zone["area"] = area
            # The calendar lives on its own device, so it can't identify the room's.
            if entry.device_id and match["key"] != "schedule":
                device_to_zone[(h["id"], entry.device_id)] = match["zone"]
        elif match := _DEVICE_RE.match(uid):
            pending_devices.append(
                (
                    match["home"] or NO_HOME,
                    match["serial"],
                    match["key"],
                    entry.entity_id,
                    entry.device_id,
                )
            )
        elif match := _HUB_RE.match(uid):
            h = home(match["home"])
            if match["key"].startswith("device_"):
                h["trackers"].append(entry.entity_id)
            else:
                h["hub"][match["key"]] = entry.entity_id

    for home_id, serial, key, entity_id, device_id in pending_devices:
        h = home(home_id)
        device = h["devices"].setdefault(serial, {"serial": serial, "entities": {}})
        # Battery and connection entities report which room's device they sit on.
        zone_id = device_to_zone.get((home_id, device_id or ""))
        if zone_id is not None:
            device["zone"] = zone_id
        device["entities"][key] = entity_id

    return {"homes": list(homes.values())}
