"""Config flow, panel registration and the WebSocket command."""

from unittest.mock import patch

import pytest
from homeassistant import config_entries
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import floor_registry as fr
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.tado_dash.const import (
    CONF_SIDEBAR_TITLE,
    DOMAIN,
    PANEL_URL_PATH,
)
from custom_components.tado_dash.websocket_api import ws_map, ws_version


@pytest.fixture(autouse=True)
async def _enable(enable_custom_integrations, hass: HomeAssistant):
    # The panel needs HA's http/frontend; the test sandbox can't set them up.
    hass.config.components.update({"http", "frontend"})
    yield


def _tado_ce_entry() -> MockConfigEntry:
    return MockConfigEntry(domain="tado_ce", title="Tado CE", data={})


async def test_flow_needs_tado_ce(hass: HomeAssistant) -> None:
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "tado_ce_missing"


async def test_flow_creates_entry(hass: HomeAssistant) -> None:
    _tado_ce_entry().add_to_hass(hass)
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    assert result["type"] is FlowResultType.FORM
    with patch("custom_components.tado_dash.async_setup_entry", return_value=True):
        result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "Tado Dash"


async def test_flow_single_instance(hass: HomeAssistant) -> None:
    _tado_ce_entry().add_to_hass(hass)
    MockConfigEntry(domain=DOMAIN, data={}).add_to_hass(hass)
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    assert result["type"] is FlowResultType.ABORT


async def test_options_flow(hass: HomeAssistant) -> None:
    entry = MockConfigEntry(domain=DOMAIN, data={})
    entry.add_to_hass(hass)
    result = await hass.config_entries.options.async_init(entry.entry_id)
    assert result["type"] is FlowResultType.FORM
    result = await hass.config_entries.options.async_configure(
        result["flow_id"],
        {CONF_SIDEBAR_TITLE: "Heating", "sidebar_icon": "mdi:fire", "require_admin": True},
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert entry.options[CONF_SIDEBAR_TITLE] == "Heating"


async def test_setup_registers_and_unload_removes_panel(hass: HomeAssistant) -> None:
    entry = MockConfigEntry(domain=DOMAIN, data={}, options={CONF_SIDEBAR_TITLE: "Heating"})
    entry.add_to_hass(hass)
    hass.http = type("H", (), {"async_register_static_paths": lambda self, p: _noop()})()
    with (
        patch("custom_components.tado_dash.async_register_built_in_panel") as register,
        patch("custom_components.tado_dash.async_remove_panel") as remove,
        patch("custom_components.tado_dash.websocket_api.async_register"),
    ):
        from custom_components.tado_dash import async_setup_entry, async_unload_entry

        assert await async_setup_entry(hass, entry)
        kwargs = register.call_args.kwargs
        assert kwargs["frontend_url_path"] == PANEL_URL_PATH
        assert kwargs["sidebar_title"] == "Heating"
        assert kwargs["config"]["_panel_custom"]["name"] == "tado-dash-panel"
        assert await async_unload_entry(hass, entry)
        remove.assert_called_once_with(hass, PANEL_URL_PATH)


async def _noop() -> None:
    return None


async def test_ws_map_returns_rooms(hass: HomeAssistant) -> None:
    registry = er.async_get(hass)
    ce = _tado_ce_entry()
    ce.add_to_hass(hass)
    entity = registry.async_get_or_create(
        "climate", "tado_ce", "tado_ce_123_zone_9_climate",
        suggested_object_id="lounge_2", config_entry=ce,
    )
    floor = fr.async_get(hass).async_create("Downstairs", level=0)
    area = ar.async_get(hass).async_create("Lounge", floor_id=floor.floor_id)
    registry.async_update_entity(entity.entity_id, area_id=area.id)
    sent = {}

    class Conn:
        def send_result(self, msg_id, result):
            sent["id"], sent["result"] = msg_id, result

    ws_map(hass, Conn(), {"id": 7, "type": "tado_dash/map"})
    await hass.async_block_till_done()
    assert sent["id"] == 7
    assert "dash_version" in sent["result"]
    assert "tado_ce_version" in sent["result"]  # empty here: Tado CE isn't installed in the test setup
    (home,) = sent["result"]["homes"]
    assert home["zones"]["9"]["entities"]["climate"] == "climate.lounge_2"
    assert home["zones"]["9"]["area"] == area.id
    assert sent["result"]["areas"][area.id] == {"name": "Lounge", "floor_id": floor.floor_id}
    assert {"id": floor.floor_id, "name": "Downstairs", "level": 0} in sent["result"]["floors"]


async def test_ws_version_reports_the_served_version(hass: HomeAssistant) -> None:
    hass.data.setdefault("tado_dash", {})["version"] = "9.9.9"
    sent = {}

    class Conn:
        def send_result(self, msg_id, result):
            sent["id"], sent["result"] = msg_id, result

    ws_version(hass, Conn(), {"id": 3, "type": "tado_dash/version"})
    assert sent == {"id": 3, "result": {"version": "9.9.9"}}
