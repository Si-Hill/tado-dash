"""Config flow for Tado Dash."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
)
from homeassistant.core import callback
from homeassistant.helpers.selector import (
    BooleanSelector,
    IconSelector,
    TextSelector,
)

from .const import (
    CONF_REQUIRE_ADMIN,
    CONF_SIDEBAR_ICON,
    CONF_SIDEBAR_TITLE,
    DEFAULT_REQUIRE_ADMIN,
    DEFAULT_SIDEBAR_ICON,
    DEFAULT_SIDEBAR_TITLE,
    DOMAIN,
    TADO_CE_DOMAIN,
)


class TadoDashConfigFlow(ConfigFlow, domain=DOMAIN):
    """Confirm, once Tado CE is set up."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")
        if not self.hass.config_entries.async_entries(TADO_CE_DOMAIN):
            return self.async_abort(reason="tado_ce_missing")
        if user_input is not None:
            return self.async_create_entry(title="Tado Dash", data={})
        return self.async_show_form(step_id="user")

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return TadoDashOptionsFlow()


class TadoDashOptionsFlow(OptionsFlow):
    """Sidebar appearance."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(data=user_input)
        opts = self.config_entry.options
        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_SIDEBAR_TITLE,
                        default=opts.get(CONF_SIDEBAR_TITLE, DEFAULT_SIDEBAR_TITLE),
                    ): TextSelector(),
                    vol.Required(
                        CONF_SIDEBAR_ICON,
                        default=opts.get(CONF_SIDEBAR_ICON, DEFAULT_SIDEBAR_ICON),
                    ): IconSelector(),
                    vol.Required(
                        CONF_REQUIRE_ADMIN,
                        default=opts.get(CONF_REQUIRE_ADMIN, DEFAULT_REQUIRE_ADMIN),
                    ): BooleanSelector(),
                }
            ),
        )
