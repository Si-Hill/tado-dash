// Mock Home Assistant connection, shaped like a real Tado CE install (invented values).
(() => {
  const HOME = "1837208";
  const now = new Date().toISOString();
  const zonesDef = [
    { id: "9", name: "Lounge", slug: "lounge_2", ext: 17.9, off: -0.4, temp: 17.8, target: 19, hum: 62, power: 100, conf: 60, cycles: 6, rate: 0.51, inertia: 25, pre: 248, mold: "Medium", over: "None" },
    { id: "3", name: "Office", slug: "office_2", ext: 20.4, off: 0, temp: 20.6, target: 20.5, hum: 48, power: 0, conf: 82, cycles: 9, rate: 1.4, inertia: 14, pre: 62, mold: "Low", over: "None" },
    { id: "5", name: "Master", slug: "master_bedroom_2", ext: 15.6, off: 1.2, temp: 16.2, target: 17, hum: 71, power: 40, conf: 40, cycles: 4, rate: 0.7, inertia: 31, pre: 180, mold: "Critical", over: "Timer" },
    { id: "6", name: "Dining", slug: "dining_room_2", temp: 18.9, target: 19, hum: 58, power: 0, conf: 60, cycles: 7, rate: 0.9, inertia: 20, pre: 110, mold: "High", over: "None" },
  ];
  const states = {}, registry = { homes: [{ id: HOME, zones: {}, hub: {}, devices: {}, trackers: [] }],
    floors: [{ id: "down", name: "Downstairs", level: 0 }, { id: "up", name: "Upstairs", level: 1 }],
    areas: { lounge: { name: "Lounge", floor_id: "down" }, dining: { name: "Dining", floor_id: "down" }, master: { name: "Master", floor_id: "up" }, office: { name: "Office", floor_id: "up" } } };
  const home = registry.homes[0];
  const put = (id, state, attributes = {}) => (states[id] = { entity_id: id, state: String(state), attributes, last_updated: now, last_changed: now });

  zonesDef.forEach((z, i) => {
    const e = {};
    const climate = `climate.${z.slug}`;
    e.climate = climate;
    put(climate, z.over === "Timer" ? "heat" : "auto", {
      friendly_name: z.name, current_temperature: z.temp, temperature: z.target, current_humidity: z.hum,
      hvac_action: z.power > 0 ? "heating" : "idle", overlay_type: z.over, heating_power: z.power, zone_id: z.id,
      min_temp: 5, max_temp: 25, target_temp_step: 0.5, scheduled_target_temperature: 19,
      ...(z.ext != null ? { external_temp_sensor: `sensor.ext_${z.id}`, offset_celsius: z.off, temperature_source: "external" } : {}),
    });
    if (z.ext != null) put(`sensor.ext_${z.id}`, z.ext, { friendly_name: `${z.name} room sensor`, unit_of_measurement: "°C" });
    const sensor = (key, val, attrs = {}, name = key) => { const id = `sensor.${z.name.toLowerCase()}_${key}`; e[key] = id; put(id, val, { friendly_name: `${z.name} ${name}`, ...attrs }); };
    sensor("temp", z.temp); sensor("target", z.target); sensor("heating", z.power); sensor("humidity", z.hum);
    sensor("confidence", z.conf, { cycle_count: z.cycles, unit_of_measurement: "%" });
    sensor("heating_rate", z.rate); sensor("thermal_inertia", z.inertia); sensor("preheat_time", z.pre);
    sensor("schedule_deviation", -0.9); sensor("next_sched_temp", 20);
    sensor("mold_risk", z.mold); sensor("condensation", "Low"); sensor("dew_point", 10.4); sensor("surface_temp", 15.6);
    sensor("comfort_level", "Cool"); sensor("absolute_humidity", 9.4);
    sensor("preheat_advisor", "15:00", { summary: `Start at 15:00 (${z.pre} min to reach ${z.target.toFixed(1)}°C)` });
    sensor("overlay", z.over === "None" ? "Schedule" : "Timer", { next_change: new Date(Date.now() + 3 * 3600e3).toISOString(), next_temperature: 20 });
    sensor("insights", 2, { recommendations: ["Room too cold — increase heating setpoint by 2°C", "Preheat takes ~173 min. Start heating 173 min before the next schedule change."] });
    e.boost = `button.${z.name.toLowerCase()}_boost`; put(e.boost, "unknown");
    e.refresh_schedule = `button.${z.name.toLowerCase()}_refresh_schedule`; put(e.refresh_schedule, new Date(Date.now() - 3 * 86400e3).toISOString());
    e.early_start = `switch.${z.name.toLowerCase()}_early_start`; put(e.early_start, "on", { friendly_name: "Early start" });
    e.schedule = `calendar.sched_${z.id}`; put(e.schedule, "off");
    e.open_window = `binary_sensor.${z.name.toLowerCase()}_window`; put(e.open_window, i === 3 ? "on" : "off");
    home.zones[z.id] = { id: z.id, entities: e, area: { Lounge: "lounge", Dining: "dining", Master: "master", Office: "office" }[z.name] };
    const serial = `VA${z.id}000`;
    const bat = `sensor.${z.name.toLowerCase()}_battery`, con = `binary_sensor.${z.name.toLowerCase()}_connection`;
    put(bat, i === 2 ? "Low" : "Normal"); put(con, "on");
    home.devices[serial] = { serial, zone: z.id, entities: { battery: bat, connection: con } };
  });

  // A hot water zone (no area, like many real installs)
  {
    const e = { water_heater: "water_heater.hot_water", power: "binary_sensor.hot_water_power" };
    put(e.water_heater, "heat", { friendly_name: "Hot Water", zone_id: "1" });
    put(e.power, "off");
    home.zones["1"] = { id: "1", entities: e };
  }

  const hub = (key, id, state, attrs = {}) => { home.hub[key] = id; put(id, state, { friendly_name: key, ...attrs }); };
  hub("outside_temp", "sensor.tado_ce_hub_outside_temp", 6.1, { unit_of_measurement: "°C" });
  hub("api_usage", "sensor.tado_ce_hub_api_usage", 124); hub("api_limit", "sensor.tado_ce_hub_api_limit", 1000);
  hub("api_reset", "sensor.tado_ce_hub_api_reset", new Date(Date.now() + 20 * 3600e3).toISOString());
  hub("api_status", "sensor.tado_ce_hub_api_status", "OK"); hub("token_status", "sensor.tado_ce_hub_token_status", "valid");
  hub("last_sync", "sensor.tado_ce_hub_last_sync", new Date(Date.now() - 4 * 60e3).toISOString());
  hub("next_sync", "sensor.tado_ce_hub_next_sync", new Date(Date.now() + 1 * 60e3).toISOString());
  hub("polling_interval", "sensor.tado_ce_hub_polling_interval", 5, { source: "Adaptive (Day)", day_interval: 30, night_interval: 120, is_night_mode: false });
  hub("bridge_connected", "binary_sensor.tado_ce_hub_bridge_connected", "on"); hub("homekit_connected", "binary_sensor.tado_ce_hub_homekit", "on");
  hub("home", "binary_sensor.tado_ce_hub_home", "on");
  hub("boiler_flow_temp", "sensor.boiler_flow", 60.3); hub("boiler_output_temperature", "sensor.tado_ce_hub_bridge_boiler_output_temperature", 58.4); hub("zone_count", "sensor.tado_ce_hub_zone_count", 4);
  hub("resume_all", "button.tado_ce_hub_resume_all", "unknown");
  // The rest of Tado CE's hub entities, named the way Tado CE names them
  const hubx = (key, id, state, name, attrs = {}) => hub(key, id, state, { friendly_name: name, ...attrs });
  hubx("api_breakdown", "sensor.tado_ce_hub_api_breakdown", "zoneStates", "Tado CE Hub API Breakdown");
  hubx("boiler_output_temperature_time", "sensor.tado_ce_hub_bridge_boiler_output_temperature_time", new Date(Date.now() - 2 * 60e3).toISOString(), "Internet Bridge Boiler Output Temperature Time");
  hubx("bridge_capabilities", "sensor.tado_ce_hub_bridge_capabilities", "OpenTherm", "Internet Bridge Bridge Capabilities");
  hubx("bridge_schema_version", "sensor.tado_ce_hub_bridge_schema_version", 10, "Internet Bridge Bridge Schema Version");
  hubx("boiler_wiring_state", "sensor.tado_ce_hub_bridge_wiring_state", "Ready", "Internet Bridge Boiler Wiring State");
  hubx("call_history", "sensor.tado_ce_hub_call_history", 2261, "Tado CE Hub Call History");
  hubx("home_id", "sensor.tado_ce_hub_home_id", 1234567, "Tado CE Hub Home ID");
  hubx("homekit_reads_saved", "sensor.tado_ce_hub_homekit_reads_saved", 22, "Tado CE Hub HomeKit Reads Saved");
  hubx("homekit_writes_saved", "sensor.tado_ce_hub_homekit_writes_saved", 0, "Tado CE Hub HomeKit Writes Saved");
  hubx("wc_status", "sensor.tado_ce_hub_weather_compensation_status", "active", "Tado CE Hub Weather Compensation Status");
  hubx("wc_target_flow_temp", "sensor.tado_ce_hub_weather_compensation_target", 53.0, "Tado CE Hub Weather Compensation Target", { unit_of_measurement: "°C" });
  hubx("overlay_timer", "select.tado_ce_hub_overlay_timer", "60", "Tado CE Hub Overlay Timer", { options: ["30", "60", "90", "120"] });
  hubx("quota_reserve_enabled", "switch.tado_ce_hub_quota_reserve", "off", "Tado CE Hub Quota Reserve");

  hub("presence_mode", "select.tado_ce_hub_presence_mode", "auto", { options: ["auto", "home", "away"] });
  hub("overlay_mode", "select.tado_ce_hub_overlay_mode", "tado_mode", { options: ["tado_mode", "next_time_block", "timer", "manual"] });
  hub("home_insights", "sensor.tado_ce_hub_home_insights", 4, {
    top_priority: "Critical", summary: "Address humidity problem in Master Bedroom and Dining Room.",
    actions_needed: ["Address humidity problem in Master Bedroom and Dining Room", "Adjust preheat timing in Lounge and Office"],
    persistent_insights: ["🔴 Critical: Mold Risk in Master Bedroom (57d 19h)", "🟡 Medium: Condensation in Dining Room (1d 22h)"],
    cross_zone_insights: ["Whole-house condensation risk: 2 zones affected — consider a dehumidifier"],
  });

  // Synthetic history
  const series = (id) => {
    const s = states[id]; if (!s) return [];
    const base = parseFloat(s.state), out = [], n = 200, span = 7 * 24 * 3600e3;
    const isHeat = /_heating$/.test(id), isTarget = /_target$/.test(id), isHum = /_humidity$/.test(id), isOut = /outside/.test(id);
    for (let k = 0; k <= n; k++) {
      const t = Date.now() - span + (k / n) * span, h = new Date(t).getHours() + new Date(t).getMinutes() / 60;
      let v;
      if (isTarget) v = Date.now() - t > 30 * 36e5 && Date.now() - t < 38 * 36e5 ? 5 : h > 6.5 && h < 8.5 ? base + 1 : h > 17 && h < 22 ? base + 1.5 : base - 1.5; // 5 C = a room switched off for a while
      else if (isHeat) v = (h > 5 && h < 8.5) || (h > 15 && h < 22) ? 60 + 40 * Math.sin(k) ** 2 : 0;
      else if (isHum) v = base + 6 * Math.sin(t / 4e6);
      else if (isOut) v = base + 3 * Math.sin((t / 864e5) * 2 * Math.PI - 2);
      else v = base - 1.5 + 2.2 * Math.sin((t / 864e5) * 2 * Math.PI - 3) + 0.3 * Math.sin(k);
      out.push({ s: v.toFixed(2), lu: t / 1000 });
    }
    return out;
  };

  window.mockHass = {
    themes: { darkMode: !new URLSearchParams(location.search).has("light") },
    states,
    callWS: async (msg) => {
      if (msg.type === "tado_dash/map") return registry;
      if (msg.type === "frontend/get_user_data") return { value: window.__userData?.[msg.key] ?? null };
      if (msg.type === "frontend/set_user_data") { (window.__userData ||= {})[msg.key] = msg.value; return null; }
      if (msg.type === "history/history_during_period") {
        const from = new Date(msg.start_time).getTime(), out = {};
        msg.entity_ids.forEach((id) => (out[id] = series(id).filter((p) => p.lu * 1000 >= from)));
        return out;
      }
      throw new Error("unmocked " + msg.type);
    },
    callApi: async (method, path) => {
      const monday = new Date(); monday.setHours(0, 0, 0, 0); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
      const evs = [];
      for (let d = 0; d < 7; d++) {
        const day = monday.getTime() + d * 864e5, hr = (h) => new Date(day + h * 36e5).toISOString();
        evs.push({ start: { dateTime: hr(6.5) }, end: { dateTime: hr(8.5) }, summary: "Zone 20.5°C" });
        evs.push({ start: { dateTime: hr(17) }, end: { dateTime: hr(d > 4 ? 18.5 : 22) }, summary: "Zone 21.0°C" });
        if (d > 4) evs.push({ start: { dateTime: hr(18.5) }, end: { dateTime: hr(22.5) }, summary: "Zone 22.5°C" });
      }
      return evs;
    },
    callService: async (domain, service, data) => { console.log("service", domain, service, data); },
  };
})();
