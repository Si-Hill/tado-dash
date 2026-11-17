"""The room/entity mapping, using unique IDs shaped like a real Tado CE install."""

from types import SimpleNamespace

from custom_components.tado_dash.mapping import build_map

HOME = "1837208"


def entry(entity_id, unique_id, device_id=None):
    return SimpleNamespace(entity_id=entity_id, unique_id=unique_id, device_id=device_id)


ENTRIES = [
    entry("climate.lounge_2", f"tado_ce_{HOME}_zone_9_climate", "dev-lounge"),
    entry("sensor.lounge_temp", f"tado_ce_{HOME}_zone_9_temp", "dev-lounge"),
    entry("sensor.lounge_confidence", f"tado_ce_{HOME}_zone_9_confidence", "dev-lounge"),
    entry("calendar.heating_schedule_schedule", f"tado_ce_{HOME}_zone_9_schedule", "dev-calendar"),
    entry("sensor.lounge_battery_va02", f"tado_ce_{HOME}_device_VA2924042496_battery", "dev-lounge"),
    entry("binary_sensor.lounge_connection_va02", f"tado_ce_{HOME}_device_VA2924042496_connection", "dev-lounge"),
    entry("climate.office_2", f"tado_ce_{HOME}_zone_3_climate", "dev-office"),
    entry("sensor.tado_ce_hub_home_insights", f"tado_ce_{HOME}_home_insights", "dev-hub"),
    entry("select.tado_ce_hub_presence_mode", f"tado_ce_{HOME}_presence_mode", "dev-hub"),
    entry("device_tracker.tado", f"tado_ce_{HOME}_device_abc123", "dev-hub"),
    entry("sensor.other", "something_else_entirely", "dev-x"),
    entry("sensor.no_unique_id", None),
]


def test_groups_zone_entities_by_room() -> None:
    (home,) = build_map(ENTRIES)["homes"]
    assert home["id"] == HOME
    assert set(home["zones"]) == {"9", "3"}
    lounge = home["zones"]["9"]["entities"]
    assert lounge["climate"] == "climate.lounge_2"
    assert lounge["temp"] == "sensor.lounge_temp"
    assert lounge["confidence"] == "sensor.lounge_confidence"
    assert lounge["schedule"] == "calendar.heating_schedule_schedule"


def test_hub_entities_are_separate_from_rooms() -> None:
    (home,) = build_map(ENTRIES)["homes"]
    assert home["hub"] == {
        "home_insights": "sensor.tado_ce_hub_home_insights",
        "presence_mode": "select.tado_ce_hub_presence_mode",
    }


def test_devices_attach_to_the_room_they_share_a_device_with() -> None:
    (home,) = build_map(ENTRIES)["homes"]
    trv = home["devices"]["VA2924042496"]
    assert trv["zone"] == "9"
    assert trv["entities"] == {
        "battery": "sensor.lounge_battery_va02",
        "connection": "binary_sensor.lounge_connection_va02",
    }


def test_calendar_device_does_not_claim_the_room() -> None:
    entries = [
        entry("calendar.sched", f"tado_ce_{HOME}_zone_9_schedule", "dev-calendar"),
        entry("sensor.stray_battery", f"tado_ce_{HOME}_device_VA1_battery", "dev-calendar"),
    ]
    (home,) = build_map(entries)["homes"]
    assert "zone" not in home["devices"]["VA1"]


def test_mobile_trackers_are_listed_not_treated_as_hub_sensors() -> None:
    (home,) = build_map(ENTRIES)["homes"]
    assert "device_tracker.tado" not in home["hub"].values()


def test_ignores_foreign_and_missing_unique_ids() -> None:
    (home,) = build_map(ENTRIES)["homes"]
    everything = {v for z in home["zones"].values() for v in z["entities"].values()}
    assert "sensor.other" not in everything
    assert "sensor.no_unique_id" not in everything


def test_older_installs_without_a_home_id() -> None:
    (home,) = build_map([entry("climate.x", "tado_ce_zone_1_climate", "d")])["homes"]
    assert home["id"] == "unknown"
    assert home["zones"]["1"]["entities"]["climate"] == "climate.x"


def test_no_entries_gives_no_homes() -> None:
    assert build_map([]) == {"homes": []}
