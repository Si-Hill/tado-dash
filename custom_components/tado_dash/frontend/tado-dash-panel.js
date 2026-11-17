/* Tado Dash: sidebar panel for rooms managed by Tado CE.
 *
 * Plain web component, no build step. It reads the entities Tado CE creates
 * (resolved through the tado_dash/map WebSocket command) and calls the
 * standard climate services plus Tado CE's own services.
 */

const TCE = "tado_ce";
const HEAT = "#ff7043";
const MIN = 60000;
const HOUR = 3600000;

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};
const f1 = (v) => (v == null ? "–" : Number(v).toFixed(1));
const f0 = (v) => (v == null ? "–" : Math.round(Number(v)).toString());
const icon = (n) => `<ha-icon icon="mdi:${n}"></ha-icon>`;
const pad = (n) => String(n).padStart(2, "0");
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function ago(iso) {
  const t = Date.parse(iso);
  if (!t) return "–";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 0) {
    const m = Math.round(-s / 60);
    return m < 90 ? `in ${m} min` : `in ${Math.round(m / 60)} h`;
  }
  if (s < 90) return "just now";
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

/* ---------- chart helpers ---------- */

function valueAt(pts, t) {
  let lo = 0, hi = pts.length - 1, ans = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid][0] <= t) { ans = pts[mid][1]; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

function pathOf(pts, X, Y, step, x1) {
  let d = "";
  pts.forEach((p, i) => {
    const x = X(p[0]).toFixed(1), y = Y(p[1]).toFixed(1);
    d += i === 0 ? `M${x},${y}` : step ? `H${x}V${y}` : `L${x},${y}`;
  });
  if (step && pts.length) d += `H${X(x1).toFixed(1)}`;
  return d;
}

function extent(seriesList, pad2 = 0.5) {
  let lo = Infinity, hi = -Infinity;
  for (const s of seriesList) for (const p of s) { if (p[1] < lo) lo = p[1]; if (p[1] > hi) hi = p[1]; }
  if (!Number.isFinite(lo)) return [0, 1];
  if (hi - lo < 2) { const m = (hi + lo) / 2; lo = m - 1; hi = m + 1; }
  return [lo - pad2, hi + pad2];
}

function sparkline(temp, target, heating) {
  if (!temp.length) return `<div class="spark empty"></div>`;
  const now = Date.now(), t0 = now - 6 * HOUR;
  const [lo, hi] = extent([temp, target]);
  const W = 300, H = 70;
  const X = (t) => ((t - t0) / (now - t0)) * W;
  const Y = (v) => H - 6 - ((v - lo) / (hi - lo)) * (H - 14);
  const color = heating ? HEAT : "var(--secondary-text-color)";
  const line = pathOf(temp, X, Y, false, now);
  const last = temp[temp.length - 1];
  const area = `${line}L${X(last[0]).toFixed(1)},${H}L${X(temp[0][0]).toFixed(1)},${H}Z`;
  const tgt = target.length ? pathOf(target, X, Y, true, now) : "";
  const id = "g" + Math.random().toString(36).slice(2, 7);
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${color}" stop-opacity=".45"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <path d="${area}" fill="url(#${id})"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke"/>
    ${tgt ? `<path d="${tgt}" fill="none" stroke="var(--secondary-text-color)" stroke-width="1" stroke-dasharray="4 3" vector-effect="non-scaling-stroke" opacity=".7"/>` : ""}
  </svg>`;
}

/* ---------- the panel ---------- */

class TadoDashPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._tab = "rooms";
    this._zone = null; // open room
    this._sel = null; // selected room for analytics / schedules
    this._range = 24;
    this._map = null;
    this._mapError = null;
    this._hist = {};
    this._cal = {};
    this._pending = {};
    this._charts = {};
    this._sig = "";
    this._narrow = false;
    this.shadowRoot.addEventListener("click", (e) => this._onClick(e));
    this.shadowRoot.addEventListener("change", (e) => this._onChange(e));
  }

  set hass(h) {
    const first = !this._hass;
    this._hass = h;
    if (first) this._init();
    else this._maybeRender();
  }
  get hass() { return this._hass; }
  set narrow(v) { if (this._narrow !== v) { this._narrow = v; if (this._map) this._render(); } }
  set route(_) {}
  set panel(_) {}

  connectedCallback() {
    this._timer = setInterval(() => this._refreshHistory(), 5 * MIN);
  }
  disconnectedCallback() { clearInterval(this._timer); }

  async _init() {
    this._render();
    try {
      this._map = await this._hass.callWS({ type: "tado_dash/map" });
    } catch (err) {
      this._mapError = err?.message || String(err);
    }
    const home = this._map?.homes?.[0];
    this._home = home || null;
    this._render();
    if (home) this._refreshHistory();
  }

  /* ----- model ----- */

  _st(id) { return id ? this._hass.states[id] : undefined; }
  _val(id) { const s = this._st(id); return s && !["unknown", "unavailable"].includes(s.state) ? s.state : null; }
  _n(id) { return num(this._val(id)); }

  get _zones() {
    if (!this._home) return [];
    return Object.values(this._home.zones)
      .map((z) => this._zoneVM(z))
      .filter((z) => z.main)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  _zoneVM(z) {
    const e = z.entities;
    const mainId = e.climate || e.ac_climate || e.water_heater;
    const main = this._st(mainId);
    const a = main?.attributes || {};
    const type = e.water_heater ? "hot_water" : e.ac_climate ? "ac" : "heating";
    const temp = num(a.current_temperature) ?? this._n(e.temp);
    const target = num(a.temperature) ?? this._n(e.target);
    const pend = this._pending[z.id];
    const power = num(a.heating_power) ?? this._n(e.heating) ?? this._n(e.ac);
    const overlayType = a.overlay_type && a.overlay_type !== "None" ? a.overlay_type : null;
    const off = main?.state === "off";
    const unavailable = !main || main.state === "unavailable";
    const window = this._st(e.open_window)?.state === "on";
    const preheat = this._st(e.preheat_now)?.state === "on";
    const heating = a.hvac_action === "heating" || (power ?? 0) > 0 || this._st(e.power)?.state === "on";
    let status = "idle", label = "Standby";
    if (unavailable) { status = "off"; label = "Unavailable"; }
    else if (off) { status = "off"; label = "Off"; }
    else if (window) { status = "window"; label = "Window open"; }
    else if (heating) { status = "heating"; label = type === "ac" ? "Cooling/AC" : "Heating"; }
    else if (preheat) { status = "preheat"; label = "Preheat due"; }
    return {
      id: z.id, ents: e, name: a.friendly_name || `Zone ${z.id}`, main: mainId, mainState: main, attrs: a, type,
      temp, target, shownTarget: pend ? pend.t : target, humidity: num(a.current_humidity) ?? this._n(e.humidity),
      power, overlayType, off, unavailable, window, preheat, heating, status, label,
      step: num(a.target_temp_step) || 0.5, min: num(a.min_temp) ?? 5, max: num(a.max_temp) ?? 25,
      confidence: this._n(e.confidence), confAttrs: this._st(e.confidence)?.attributes || {},
      devices: Object.values(this._home.devices || {}).filter((d) => d.zone === z.id),
    };
  }

  get _hub() {
    const h = this._home?.hub || {};
    const get = (k) => this._st(h[k]);
    return { ids: h, get, val: (k) => this._val(h[k]), n: (k) => this._n(h[k]) };
  }

  _trackedIds() {
    if (!this._home) return [];
    const ids = [];
    for (const z of Object.values(this._home.zones)) ids.push(...Object.values(z.entities));
    ids.push(...Object.values(this._home.hub));
    for (const d of Object.values(this._home.devices || {})) ids.push(...Object.values(d.entities));
    return ids;
  }

  _maybeRender() {
    if (!this._map) return;
    const sig = this._trackedIds().map((id) => this._hass.states[id]?.last_updated).join("|");
    if (sig === this._sig) return;
    this._sig = sig;
    this._render();
  }

  /* ----- history ----- */

  async _history(ids, hours) {
    ids = ids.filter(Boolean);
    if (!ids.length) return {};
    const key = `${hours}:${ids.join(",")}`;
    const hit = this._hist[key];
    if (hit && Date.now() - hit.at < 4 * MIN) return hit.data;
    const end = new Date(), start = new Date(end - hours * HOUR);
    let res = {};
    try {
      res = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: start.toISOString(), end_time: end.toISOString(), entity_ids: ids,
        minimal_response: true, no_attributes: true, significant_changes_only: false,
      });
    } catch (e) { /* history is optional */ }
    const data = {};
    for (const id of ids) {
      data[id] = (res[id] || []).map((r) => {
        const lu = r.lu ?? r.last_updated ?? r.lc;
        const t = typeof lu === "number" ? lu * 1000 : Date.parse(lu);
        return [t, num(r.s ?? r.state)];
      }).filter((p) => Number.isFinite(p[0]) && p[1] != null);
    }
    this._hist[key] = { at: Date.now(), data };
    return data;
  }

  async _refreshHistory() {
    if (!this._home) return;
    const zones = this._zones;
    const ids = zones.flatMap((z) => [z.ents.temp, z.ents.target]);
    this._spark = await this._history(ids, 6);
    this._render();
  }

  /* ----- actions ----- */

  _call(domain, service, data) {
    return this._hass.callService(domain, service, data).catch((err) => {
      this._toast(err?.message || `${domain}.${service} failed`);
    });
  }

  _toast(message) {
    this.dispatchEvent(new CustomEvent("hass-notification", { detail: { message }, bubbles: true, composed: true }));
  }

  _zoneById(id) { return this._zones.find((z) => z.id === id); }

  _setTarget(z, t) {
    t = Math.min(z.max, Math.max(z.min, Math.round(t / z.step) * z.step));
    const p = this._pending[z.id] || {};
    clearTimeout(p.timer);
    p.t = t;
    p.timer = setTimeout(async () => {
      await this._call("climate", "set_temperature", { entity_id: z.main, temperature: t });
      delete this._pending[z.id];
      this._render();
    }, 900);
    this._pending[z.id] = p;
    this._render();
  }

  _hold(z, mode) {
    const t = z.target ?? z.temp ?? 20;
    if (mode === "schedule") return this._call(TCE, "resume_schedule", { entity_id: z.main });
    if (mode === "off") return this._call("climate", "turn_off", { entity_id: z.main });
    if (mode === "block") return this._call(TCE, "set_climate_timer", { entity_id: z.main, temperature: t, overlay: "next_time_block" });
    if (mode === "manual") return this._call(TCE, "set_climate_timer", { entity_id: z.main, temperature: t, overlay: "manual" });
    const mins = { "30": "00:30:00", "60": "01:00:00", "120": "02:00:00" }[mode];
    if (mins) return this._call(TCE, "set_climate_timer", { entity_id: z.main, temperature: t, time_period: mins });
  }

  _onClick(e) {
    const el = e.target.closest("[data-a]");
    if (!el) return;
    const { a, z, v } = el.dataset;
    const zone = z ? this._zoneById(z) : null;
    switch (a) {
      case "tab": this._tab = v; this._zone = null; if (z) this._sel = z; if (v === "analytics" || v === "schedules") this._ensureSel(); break;
      case "open": this._zone = z; this._sel = z; break;
      case "back": this._zone = null; break;
      case "menu": this.dispatchEvent(new CustomEvent("hass-toggle-menu", { bubbles: true, composed: true })); return;
      case "step": if (zone) this._setTarget(zone, (zone.shownTarget ?? zone.temp ?? 20) + parseFloat(v) * zone.step); return;
      case "hold": if (zone) this._hold(zone, v); return;
      case "boost": if (zone?.ents.boost) this._call("button", "press", { entity_id: zone.ents.boost }); return;
      case "press": this._call("button", "press", { entity_id: v }); return;
      case "toggle": this._call("homeassistant", "toggle", { entity_id: v }); return;
      case "range": this._range = parseInt(v, 10); break;
      case "pick": this._sel = z; break;
      case "refresh-sched": this._cal = {}; break;
      default: return;
    }
    this._render();
  }

  _onChange(e) {
    const el = e.target.closest("[data-c]");
    if (!el) return;
    if (el.dataset.c === "select") this._call("select", "select_option", { entity_id: el.dataset.id, option: el.value });
    if (el.dataset.c === "sel") { this._sel = el.value; this._render(); }
  }

  _ensureSel() { if (!this._sel) this._sel = this._zones[0]?.id || null; }

  /* ----- rendering ----- */

  _render() {
    if (!this._hass) return;
    const scroller = this.shadowRoot.querySelector(".content");
    const top = scroller ? scroller.scrollTop : 0;
    const prevTab = this._renderedKey;
    this._charts = {};
    let body;
    if (this._mapError) body = this._empty("alert-circle-outline", "Couldn't read Tado CE", esc(this._mapError));
    else if (!this._map) body = this._empty("timer-sand", "Loading…", "");
    else if (!this._zones.length) body = this._empty("radiator-off", "No Tado CE rooms found",
      "Tado Dash reads the entities Tado CE creates. Make sure Tado CE is set up and has finished its first sync.");
    else if (this._zone && this._zoneById(this._zone)) body = this._viewRoom(this._zoneById(this._zone));
    else body = { rooms: () => this._viewRooms(), analytics: () => this._viewAnalytics(),
      schedules: () => this._viewSchedules(), learning: () => this._viewLearning(), system: () => this._viewSystem() }[this._tab]();

    const inRoom = this._zone && this._zoneById(this._zone);
    const title = inRoom ? this._zoneById(this._zone).name : "Tado";
    const tabs = [["rooms", "Rooms"], ["analytics", "Analytics"], ["schedules", "Schedules"], ["learning", "Learning"], ["system", "System"]];
    this.shadowRoot.innerHTML = `<style>${STYLE}</style>
      <div class="page">
        <header>
          ${inRoom ? `<button class="icon-btn" data-a="back" title="Back">${icon("arrow-left")}</button>`
            : this._narrow ? `<button class="icon-btn" data-a="menu" title="Menu">${icon("menu")}</button>` : ""}
          <h1>${esc(title)}</h1>
        </header>
        ${inRoom ? "" : `<nav>${tabs.map(([k, l]) => `<button class="${this._tab === k ? "on" : ""}" data-a="tab" data-v="${k}">${l}</button>`).join("")}</nav>`}
        <div class="content"><div class="wrap">${body}</div></div>
      </div>`;
    const sc = this.shadowRoot.querySelector(".content");
    const key = `${this._tab}:${this._zone}`;
    if (sc) sc.scrollTop = prevTab === key ? top : 0;
    this._renderedKey = key;
    this._bindCharts();
    this._afterRender();
  }

  _afterRender() {
    // Pull in data the visible tab needs, then re-render once it lands.
    if (this._zone || !this._home) return;
    if (this._tab === "analytics" && this._sel) this._loadAnalytics();
    if (this._tab === "schedules") this._loadCalendars();
  }

  _empty(ic, title, text) {
    return `<div class="empty">${icon(ic)}<h2>${title}</h2><p>${text}</p></div>`;
  }

  /* ----- rooms ----- */

  _viewRooms() {
    const zones = this._zones, hub = this._hub;
    const heating = zones.filter((z) => z.heating).length;
    const outside = hub.n("outside_temp");
    const away = hub.get("home")?.state === "off";
    const alerts = hub.n("home_insights");
    const chips = [
      chip("home-outline", "Rooms", zones.length),
      chip("fire", "Heating", heating, heating ? "heat" : ""),
      outside != null ? chip("thermometer", "Outside", `${f1(outside)} °C`) : "",
      hub.get("home") ? chip(away ? "home-export-outline" : "home-account", "Home", away ? "Away" : "Home") : "",
      alerts ? chip("lightbulb-alert-outline", "Insights", alerts, alerts > 0 ? "warn" : "", "learning") : "",
    ].join("");
    return `<div class="chips">${chips}</div><div class="grid">${zones.map((z) => this._roomCard(z)).join("")}</div>`;
  }

  _roomCard(z) {
    const t = this._spark?.[z.ents.temp] || [], g = this._spark?.[z.ents.target] || [];
    const sched = !z.overlayType && !z.off;
    const hasTemp = z.type !== "hot_water";
    return `<div class="card room ${z.status}" data-a="open" data-z="${z.id}">
      <div class="row top"><span class="name">${icon(z.type === "hot_water" ? "water-boiler" : z.type === "ac" ? "air-conditioner" : "radiator")}${esc(z.name)}</span>
        <span class="pill ${z.status}">${z.status === "heating" ? icon("fire") : ""}${esc(z.label)}</span></div>
      <div class="row mid">
        <div class="temp">${hasTemp ? f1(z.temp) : esc(z.mainState?.state || "–")}${hasTemp ? `<small>°C</small>` : ""}
          ${z.humidity != null ? `<span class="hum">${icon("water-percent")}${f0(z.humidity)}%</span>` : ""}</div>
        ${hasTemp ? `<div class="tgt"><span>Target</span><b>${z.shownTarget != null ? f1(z.shownTarget) + " °C" : "–"}</b></div>` : ""}
      </div>
      ${hasTemp ? sparkline(t, g, z.heating) : `<div class="spark empty"></div>`}
      ${z.overlayType ? `<div class="note">${icon("hand-back-right-outline")}Manual override · ${esc(z.overlayType)}</div>` : z.preheat ? `<div class="note">${icon("clock-fast")}Preheat due</div>` : `<div class="note faint">${z.confidence != null ? `${icon("brain")}Learning ${f0(z.confidence)}%` : "&nbsp;"}</div>`}
      <div class="seg" role="group">
        <button class="${sched ? "on" : ""}" data-a="hold" data-z="${z.id}" data-v="schedule">${icon("calendar-clock")}Schedule</button>
        ${z.ents.boost ? `<button data-a="boost" data-z="${z.id}">${icon("rocket-launch-outline")}Boost</button>` : ""}
        <button class="${z.off ? "on" : ""}" data-a="hold" data-z="${z.id}" data-v="off">${icon("power")}Off</button>
      </div></div>`;
  }

  /* ----- room detail ----- */

  _viewRoom(z) {
    const e = z.ents, hub = this._hub, st = (k) => this._st(e[k]);
    const sp = this._spark || {};
    const hasTemp = z.type !== "hot_water";
    const timeline = this._holdBar(z);
    const outside = hub.n("outside_temp");
    const surface = this._n(e.surface_temp);
    const adv = st("preheat_advisor")?.attributes || {};
    const ov = st("overlay")?.attributes || {};
    const insightsList = st("insights")?.attributes?.recommendations || [];

    const hero = `<div class="card hero">
      <div class="row top"><span class="pill ${z.status}">${z.status === "heating" ? icon("fire") : ""}${esc(z.label)}</span>
        ${z.overlayType ? `<span class="pill over">${icon("hand-back-right-outline")}${esc(z.overlayType)}</span>` : ""}</div>
      <div class="bigtemp">${hasTemp ? f1(z.temp) : esc(z.mainState?.state || "–")}${hasTemp ? `<small>°C</small>` : ""}</div>
      ${hasTemp ? sparkline(sp[e.temp] || [], sp[e.target] || [], z.heating) : ""}
      <div class="facts">
        ${z.humidity != null ? `<span>${icon("water-percent")}${f0(z.humidity)}% humidity</span>` : ""}
        ${outside != null ? `<span>${icon("thermometer")}${f1(outside)} °C outside</span>` : ""}
        ${surface != null ? `<span>${icon("wall")}wall ${f1(surface)} °C</span>` : ""}
        ${z.power != null ? `<span>${icon("fire")}${f0(z.power)}% heating</span>` : ""}
      </div>
      ${hasTemp ? `<div class="divider"></div>
      <div class="targetrow"><div><span class="lbl">Target</span><div class="stepper">
        <button class="round" data-a="step" data-z="${z.id}" data-v="-1">${icon("minus")}</button>
        <b>${z.shownTarget != null ? f1(z.shownTarget) : "–"}<small> °C</small></b>
        <button class="round" data-a="step" data-z="${z.id}" data-v="1">${icon("plus")}</button></div></div>
        <div class="sub">${this._scheduleLine(z, ov)}</div></div>` : ""}
      <span class="lbl">Change the temperature for a while</span>${timeline}
    </div>`;

    const learn = this._learnPanel(z, adv);
    const air = this._airPanel(z);
    const devs = this._devicePanel(z);
    const ins = insightsList.length ? `<div class="card"><h3>Insights for this room</h3><ul class="ins">${insightsList.map((i) => `<li>${icon("lightbulb-on-outline")}${esc(i)}</li>`).join("")}</ul></div>` : "";
    const ctrl = [["early_start", "Early start", "Let Tado start heating ahead of the schedule", "clock-start"]]
      .filter(([k]) => e[k]).map(([k, l, d, ic]) => `<div class="line"><span class="ic">${icon(ic)}</span><div class="tx"><b>${l}</b><small>${d}</small></div>
        <button class="sw ${st(k)?.state === "on" ? "on" : ""}" data-a="toggle" data-v="${e[k]}" aria-label="${l}"></button></div>`).join("");

    const chartId = "room-chart";
    return `<div class="cols"><div class="col">${hero}${learn}</div>
      <div class="col">
        ${hasTemp ? `<div class="card"><div class="cardhead"><h3>Last 24 hours</h3><button class="link" data-a="tab" data-v="analytics" data-z="${z.id}">Full analytics</button></div>
          <div class="chart" id="${chartId}"></div></div>` : ""}
        ${ins}${air}${devs}${ctrl ? `<div class="card"><h3>Room settings</h3>${ctrl}</div>` : ""}
      </div></div>${hasTemp ? this._deferRoomChart(z, chartId) : ""}`;
  }

  _scheduleLine(z, ov) {
    const e = z.ents;
    const next = ov.next_change ? new Date(ov.next_change) : null;
    const nt = ov.next_temperature ?? this._n(e.next_sched_temp);
    const sched = z.attrs.scheduled_target_temperature;
    const bits = [];
    if (!z.overlayType && sched != null) bits.push(`Schedule: ${f1(sched)} °C`);
    if (z.overlayType) bits.push(`Schedule would be ${sched != null ? f1(sched) + " °C" : "set by Tado"}`);
    if (next && nt != null) bits.push(`Next: ${f1(nt)} °C at ${hhmm(next)}`);
    return bits.map(esc).join("<br>");
  }

  _holdBar(z) {
    const cur = z.off ? "off" : !z.overlayType ? "schedule" : "";
    const b = (v, label, ic) => `<button class="${cur === v ? "on" : ""}" data-a="hold" data-z="${z.id}" data-v="${v}">${icon(ic)}${label}</button>`;
    if (z.type === "hot_water") return `<div class="seg wrap2">${b("schedule", "Schedule", "calendar-clock")}${b("off", "Off", "power")}</div>`;
    return `<div class="seg wrap2">${b("schedule", "Schedule", "calendar-clock")}${b("block", "Until next block", "calendar-arrow-right")}
      ${b("30", "30 min", "timer-outline")}${b("60", "1 hour", "timer-outline")}${b("120", "2 hours", "timer-outline")}${b("manual", "Until changed", "infinity")}${b("off", "Off", "power")}</div>
      ${z.ents.boost || z.ents.smart_boost ? `<div class="seg wrap2 second">${z.ents.boost ? `<button data-a="boost" data-z="${z.id}">${icon("rocket-launch-outline")}Boost</button>` : ""}
        ${z.ents.smart_boost ? `<button data-a="press" data-v="${z.ents.smart_boost}">${icon("brain")}Smart boost</button>` : ""}</div>` : ""}`;
  }

  _learnPanel(z, adv) {
    const e = z.ents;
    if (z.type === "hot_water") return "";
    const c = z.confidence;
    const rate = this._n(e.heating_rate), inertia = this._n(e.thermal_inertia), pre = this._n(e.preheat_time);
    const cycles = z.confAttrs.cycle_count;
    const col = c == null ? "var(--secondary-text-color)" : c >= 70 ? "var(--success-color, #43a047)" : c >= 40 ? "var(--warning-color, #ffa726)" : "var(--error-color, #ef5350)";
    const ring = ringSVG(c, col);
    const rows = [
      ["Heating rate", rate != null ? `${f1(rate)} °C/h` : "–", "How fast this room warms while heating"],
      ["Thermal inertia", inertia != null ? `${f0(inertia)} min` : "–", "Delay before the room responds to heat"],
      ["Preheat time", pre != null ? `${f0(pre)} min` : "–", "Learned lead time for the next target"],
    ].map(([l, v, d]) => `<div class="kv"><span>${l}<small>${d}</small></span><b>${v}</b></div>`).join("");
    return `<div class="card"><div class="cardhead"><h3>What Tado has learned</h3><button class="link" data-a="tab" data-v="learning">How it works</button></div>
      <div class="learn">${ring}<div class="lt"><b>${c == null ? "Not available" : `${f0(c)}% confidence`}</b>
        <small>${cycles != null ? `${cycles} heating cycle${cycles === 1 ? "" : "s"} analysed` : "Enable the Confidence sensor in Tado CE to see this"}</small></div></div>
      ${rows}${adv.summary ? `<div class="note adv">${icon("clock-check-outline")}${esc(adv.summary)}</div>` : ""}</div>`;
  }

  _airPanel(z) {
    const e = z.ents, v = (k) => this._val(e[k]);
    const items = [["Comfort", v("comfort_level"), "emoticon-outline"], ["Mold risk", v("mold_risk"), "mushroom-outline"],
      ["Condensation", v("condensation"), "water-alert-outline"], ["Dew point", v("dew_point") != null ? `${f1(v("dew_point"))} °C` : null, "water-thermometer-outline"],
      ["Wall surface", v("surface_temp") != null ? `${f1(v("surface_temp"))} °C` : null, "wall"],
      ["Absolute humidity", v("absolute_humidity") != null ? `${f1(v("absolute_humidity"))} g/m³` : null, "water-outline"]]
      .filter(([, val]) => val != null);
    if (!items.length) return "";
    const risk = (s) => ({ low: "ok", none: "ok", medium: "warn", high: "bad", critical: "bad" })[String(s).toLowerCase()] || "";
    return `<div class="card"><h3>Comfort &amp; air</h3><div class="stats">${items.map(([l, val, ic]) =>
      `<div class="stat ${risk(val)}">${icon(ic)}<span>${l}</span><b>${esc(val)}</b></div>`).join("")}</div></div>`;
  }

  _devicePanel(z) {
    if (!z.devices.length) return "";
    const rows = z.devices.map((d) => {
      const bat = this._val(d.entities.battery), conn = this._st(d.entities.connection)?.state;
      const kind = d.serial.slice(0, 2) === "VA" || d.serial.slice(0, 2) === "RU" ? "radiator-disabled" : "thermostat";
      const batIc = !bat ? "battery-unknown" : /low|crit/i.test(bat) ? "battery-alert" : "battery";
      return `<div class="line"><span class="ic">${icon(kind === "thermostat" ? "thermostat" : "radiator")}</span><div class="tx"><b>${esc(d.serial)}</b>
        <small>${conn === "on" ? "Connected" : conn === "off" ? "Disconnected" : "Unknown connection"}</small></div>
        <span class="val ${bat && /low|crit/i.test(bat) ? "bad" : ""}">${icon(batIc)}${esc(bat || "–")}</span></div>`;
    }).join("");
    return `<div class="card"><div class="cardhead"><h3>Devices</h3><small>${z.devices.length} device${z.devices.length === 1 ? "" : "s"}</small></div>${rows}</div>`;
  }

  _deferRoomChart(z, id) {
    this._history([z.ents.temp, z.ents.target, z.ents.heating, z.ents.humidity], 24).then((d) => {
      if (this._zone !== z.id) return;
      const host = this.shadowRoot.getElementById(id);
      if (host) { host.innerHTML = this._chartSVG(id, { hours: 24, panels: [this._tempPanel(z, d)] }); this._bindCharts(); }
    });
    return "";
  }

  /* ----- analytics ----- */

  _tempPanel(z, d) {
    const e = z.ents;
    return {
      title: "Temperature (°C)", height: 200, unit: "°C",
      series: [
        { name: "Temperature", pts: d[e.temp] || [], color: "var(--primary-text-color)", w: 1.8 },
        { name: "Target", pts: d[e.target] || [], color: "var(--success-color, #43a047)", step: true, dash: "5 3", w: 1.4 },
      ],
      band: { name: "Heating", pts: d[e.heating] || [], color: HEAT },
    };
  }

  async _loadAnalytics() {
    const z = this._zoneById(this._sel);
    if (!z) return;
    const outId = this._hub.ids.outside_temp;
    const key = `${z.id}:${this._range}`;
    if (this._analyticsKey === key && this._analytics) return;
    this._analyticsKey = key;
    const d = await this._history([z.ents.temp, z.ents.target, z.ents.heating, z.ents.humidity, outId], this._range);
    if (this._analyticsKey !== key) return;
    this._analytics = d;
    this._render();
  }

  _viewAnalytics() {
    const z = this._zoneById(this._sel) || this._zones[0];
    if (!z) return "";
    const d = this._analytics && this._analyticsKey === `${z.id}:${this._range}` ? this._analytics : null;
    const picker = this._picker(z.id);
    const ranges = [[6, "6 h"], [24, "24 h"], [72, "3 days"], [168, "7 days"]]
      .map(([h, l]) => `<button class="${this._range === h ? "on" : ""}" data-a="range" data-v="${h}">${l}</button>`).join("");
    if (!d) return `<div class="toolbar">${picker}<div class="seg small">${ranges}</div></div><div class="card">${this._empty("timer-sand", "Loading history…", "")}</div>`;

    const outId = this._hub.ids.outside_temp;
    const panels = [this._tempPanel(z, d)];
    if (outId && d[outId]?.length) panels.push({ title: "Outside temperature (°C)", height: 100, unit: "°C",
      series: [{ name: "Outside", pts: d[outId], color: "#90a4ae", w: 1.5 }] });
    if (d[z.ents.humidity]?.length) panels.push({ title: "Humidity (%)", height: 110, unit: "%", fixed: [20, 80], band2: [40, 60],
      series: [{ name: "Humidity", pts: d[z.ents.humidity], color: "#4fc3f7", w: 1.5 }] });
    const stats = this._stats(z, d);
    const legend = [["var(--primary-text-color)", "Temperature"], ["var(--success-color, #43a047)", "Target"], [HEAT, "Heating"], ["#90a4ae", "Outside"], ["#4fc3f7", "Humidity"]]
      .map(([c, l]) => `<span><i style="background:${c}"></i>${l}</span>`).join("");
    return `<div class="toolbar">${picker}<div class="seg small">${ranges}</div></div>
      <div class="card"><h3>History</h3><div class="chart" id="an">${this._chartSVG("an", { hours: this._range, panels })}</div>
        <div class="legend">${legend}</div><p class="hint">Hover or touch the chart to read values.</p></div>
      <div class="stats big">${stats}</div>`;
  }

  _stats(z, d) {
    const t = d[z.ents.temp] || [], tg = d[z.ents.target] || [], pw = d[z.ents.heating] || [];
    if (!t.length) return "";
    const vals = t.map((p) => p[1]);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const from = Date.now() - this._range * HOUR;
    let heatMs = 0, onTarget = 0, covered = 0;
    for (let i = 0; i < pw.length; i++) {
      const end = i + 1 < pw.length ? pw[i + 1][0] : Date.now();
      if (pw[i][1] > 0) heatMs += end - Math.max(pw[i][0], from);
    }
    for (let i = 0; i < t.length; i++) {
      const end = i + 1 < t.length ? t[i + 1][0] : Date.now();
      const target = valueAt(tg, t[i][0]);
      if (target == null) continue;
      const span = end - Math.max(t[i][0], from);
      covered += span;
      if (Math.abs(t[i][1] - target) <= 0.5) onTarget += span;
    }
    const s = (ic, l, v) => `<div class="stat">${icon(ic)}<span>${l}</span><b>${v}</b></div>`;
    return s("thermometer", "Average", `${f1(avg)} °C`) + s("thermometer-low", "Lowest", `${f1(Math.min(...vals))} °C`) +
      s("thermometer-high", "Highest", `${f1(Math.max(...vals))} °C`) +
      s("fire", "Heating on", `${(heatMs / HOUR).toFixed(1)} h`) +
      (covered ? s("bullseye-arrow", "Within 0.5° of target", `${Math.round((onTarget / covered) * 100)}%`) : "");
  }

  _picker(sel) {
    return `<select class="pick" data-c="sel">${this._zones.map((z) => `<option value="${z.id}" ${z.id === sel ? "selected" : ""}>${esc(z.name)}</option>`).join("")}</select>`;
  }

  /* chart builder: returns SVG markup, registers hover metadata */
  _chartSVG(id, { hours, panels }) {
    const W = 900, L = 42, R = 8;
    const now = Date.now(), t0 = now - hours * HOUR;
    const X = (t) => L + ((Math.max(t, t0) - t0) / (now - t0)) * (W - L - R);
    let y = 6, out = "";
    const meta = { L, R, W, t0, now, panels: [] };
    panels.forEach((p, i) => {
      const H = p.height, top = y, bot = y + H - 8;
      const [lo, hi] = p.fixed || extent(p.series.map((s) => s.pts));
      const Y = (v) => bot - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (bot - top - 4);
      const ticks = 4;
      for (let k = 0; k <= ticks; k++) {
        const v = lo + ((hi - lo) * k) / ticks, yy = Y(v);
        out += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" class="grid"/><text x="${L - 6}" y="${yy + 3.5}" text-anchor="end" class="axis">${p.fixed ? Math.round(v) : v.toFixed(1)}</text>`;
      }
      if (p.band2) out += `<rect x="${L}" width="${W - L - R}" y="${Y(p.band2[1])}" height="${Y(p.band2[0]) - Y(p.band2[1])}" fill="var(--success-color, #43a047)" opacity=".12"/>`;
      if (p.band?.pts?.length) {
        const bh = (bot - top) * 0.16;
        const BY = (v) => bot - (Math.min(100, v) / 100) * bh;
        const d = pathOf(p.band.pts, X, BY, true, now);
        out += `<path d="${d}V${bot}H${X(p.band.pts[0][0])}Z" fill="${p.band.color}" opacity=".55"/>`;
      }
      for (const s of p.series) {
        if (!s.pts.length) continue;
        out += `<path d="${pathOf(s.pts, X, Y, s.step, now)}" fill="none" stroke="${s.color}" stroke-width="${s.w || 1.5}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ""} stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
      }
      out += `<text x="${L}" y="${top + 11}" class="ptitle">${esc(p.title)}</text>`;
      meta.panels.push({ ...p, top, bot });
      y += H + 14;
      if (i === panels.length - 1) {
        const step = hours <= 6 ? 1 : hours <= 24 ? 4 : hours <= 72 ? 12 : 24;
        const first = new Date(t0); first.setMinutes(0, 0, 0);
        for (let t = first.getTime(); t <= now; t += HOUR) {
          const dt = new Date(t);
          if (t < t0 || dt.getHours() % step !== 0) continue;
          const day = hours > 24 && dt.getHours() === 0;
          out += `<line x1="${X(t)}" x2="${X(t)}" y1="6" y2="${bot}" class="vgrid"/><text x="${X(t)}" y="${bot + 14}" text-anchor="middle" class="axis">${day ? DAYS[(dt.getDay() + 6) % 7] : hhmm(dt)}</text>`;
        }
        y += 14;
      }
    });
    meta.H = y;
    meta.x = X;
    this._charts[id] = meta;
    return `<svg viewBox="0 0 ${W} ${y}" class="chartsvg">${out}<line class="cross" x1="0" x2="0" y1="6" y2="${y - 22}" style="display:none"/></svg><div class="tip" style="display:none"></div>`;
  }

  _bindCharts() {
    for (const [id, m] of Object.entries(this._charts)) {
      const host = this.shadowRoot.getElementById(id);
      if (!host || host._bound === m) continue;
      host._bound = m;
      const svg = host.querySelector("svg"), cross = host.querySelector(".cross"), tip = host.querySelector(".tip");
      if (!svg) continue;
      const move = (ev) => {
        const r = svg.getBoundingClientRect();
        const px = ((ev.clientX - r.left) / r.width) * m.W;
        if (px < m.L || px > m.W - m.R) { cross.style.display = tip.style.display = "none"; return; }
        const t = m.t0 + ((px - m.L) / (m.W - m.L - m.R)) * (m.now - m.t0);
        cross.setAttribute("x1", px); cross.setAttribute("x2", px); cross.style.display = "";
        const lines = [`<b>${new Date(t).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}</b>`];
        for (const p of m.panels) {
          for (const s of p.series) { const v = valueAt(s.pts, t); if (v != null) lines.push(`<span><i style="background:${s.color}"></i>${s.name} ${v.toFixed(1)} ${p.unit}</span>`); }
          if (p.band?.pts?.length) { const v = valueAt(p.band.pts, t); if (v != null) lines.push(`<span><i style="background:${p.band.color}"></i>Heating ${Math.round(v)}%</span>`); }
        }
        tip.innerHTML = lines.join("");
        tip.style.display = "";
        const hr = host.getBoundingClientRect();
        const left = ev.clientX - hr.left, w = tip.offsetWidth;
        tip.style.left = `${left + w + 16 > hr.width ? left - w - 10 : left + 12}px`;
        tip.style.top = `${Math.max(0, ev.clientY - hr.top - 20)}px`;
      };
      svg.addEventListener("pointermove", move);
      svg.addEventListener("pointerdown", move);
      svg.addEventListener("pointerleave", () => { cross.style.display = tip.style.display = "none"; });
    }
  }

  /* ----- schedules ----- */

  async _loadCalendars() {
    if (this._calLoading) return;
    const zones = this._zones.filter((z) => z.ents.schedule);
    if (!zones.length || (this._cal.at && Date.now() - this._cal.at < 10 * MIN)) return;
    this._calLoading = true;
    const monday = new Date(); monday.setHours(0, 0, 0, 0); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const end = new Date(monday.getTime() + 7 * 86400000);
    const data = {};
    await Promise.all(zones.map(async (z) => {
      try {
        const evs = await this._hass.callApi("GET", `calendars/${z.ents.schedule}?start=${encodeURIComponent(monday.toISOString())}&end=${encodeURIComponent(end.toISOString())}`);
        data[z.id] = evs.map((ev) => {
          const g = (v) => Date.parse(typeof v === "string" ? v : v?.dateTime || v?.date);
          const m = /(-?\d+(?:\.\d+)?)\s*°/.exec(ev.summary || "");
          return { s: g(ev.start), e: g(ev.end), temp: m ? parseFloat(m[1]) : null };
        }).filter((x) => Number.isFinite(x.s) && Number.isFinite(x.e));
      } catch (err) { data[z.id] = []; }
    }));
    this._cal = { at: Date.now(), monday: monday.getTime(), data };
    this._calLoading = false;
    this._render();
  }

  _viewSchedules() {
    const zones = this._zones.filter((z) => z.ents.schedule);
    if (!zones.length) return `<div class="card">${this._empty("calendar-remove-outline", "No schedule calendars", "Tado CE creates one calendar per heating room. None were found.")}</div>`;
    if (!this._cal.data) return `<div class="card">${this._empty("timer-sand", "Loading schedules…", "")}</div>`;
    const z = zones.find((x) => x.id === this._sel) || zones[0];
    const monday = this._cal.monday, now = new Date();
    const todayIdx = (now.getDay() + 6) % 7;
    const temps = Object.values(this._cal.data).flat().map((b) => b.temp).filter((t) => t != null);
    const lo = Math.min(...temps, 15), hi = Math.max(...temps, 22);
    const color = (t) => { const k = t == null ? 0.5 : (t - lo) / (hi - lo || 1); return `hsl(${Math.round(30 - 22 * k)} ${55 + 25 * k}% ${28 + 10 * k}%)`; };
    const blocksFor = (zid, day) => {
      const d0 = monday + day * 86400000, d1 = d0 + 86400000;
      return (this._cal.data[zid] || []).filter((b) => b.e > d0 && b.s < d1).map((b) => {
        const s = Math.max(b.s, d0), e = Math.min(b.e, d1);
        const l = ((s - d0) / 86400000) * 100, w = ((e - s) / 86400000) * 100;
        const lab = w > 9 ? `${b.temp != null ? f1(b.temp) + "°" : ""}` : "";
        return `<div class="blk" style="left:${l}%;width:${w}%;background:${color(b.temp)}" title="${hhmm(new Date(s))}–${hhmm(new Date(e))} · ${b.temp != null ? b.temp + " °C" : ""}">${lab}</div>`;
      }).join("");
    };
    const nowPct = ((now - new Date(now).setHours(0, 0, 0, 0)) / 86400000) * 100;
    const hours = [0, 3, 6, 9, 12, 15, 18, 21, 24];
    const axis = `<div class="axisrow"><span></span><div class="hours">${hours.map((h) => `<i style="left:${(h / 24) * 100}%">${h}</i>`).join("")}</div></div>`;
    const week = DAYS.map((dn, i) => `<div class="drow"><span class="dn ${i === todayIdx ? "today" : ""}">${dn}${i === todayIdx ? "<small>today</small>" : ""}</span>
      <div class="track">${blocksFor(z.id, i)}${i === todayIdx ? `<div class="nowline" style="left:${nowPct}%"></div>` : ""}</div></div>`).join("");
    const all = zones.map((zz) => `<div class="drow"><span class="dn small">${esc(zz.name)}</span><div class="track thin">${blocksFor(zz.id, todayIdx)}<div class="nowline" style="left:${nowPct}%"></div></div></div>`).join("");
    const legend = `<div class="legend grad"><span>${f1(lo)}°</span><i style="background:linear-gradient(90deg,${color(lo)},${color(hi)})"></i><span>${f1(hi)}°</span><em>Blocks are periods Tado CE reports in the room's schedule calendar</em></div>`;
    return `<div class="card"><h3>Today across rooms</h3>${axis}${all}</div>
      <div class="toolbar">${this._picker(z.id)}<button class="link" data-a="refresh-sched">${icon("refresh")} Reload</button></div>
      <div class="card"><h3>${esc(z.name)} · week</h3>${axis}${week}${legend}
        <p class="hint">Read-only view of the Tado schedule. Edit schedules in the Tado app; Tado CE picks changes up on its next sync.</p></div>`;
  }

  /* ----- learning ----- */

  _viewLearning() {
    const zones = this._zones.filter((z) => z.type !== "hot_water");
    const hub = this._hub, ha = hub.get("home_insights")?.attributes || {};
    const rows = zones.map((z) => {
      const e = z.ents, c = z.confidence;
      const col = c == null ? "var(--secondary-text-color)" : c >= 70 ? "var(--success-color, #43a047)" : c >= 40 ? "var(--warning-color, #ffa726)" : "var(--error-color, #ef5350)";
      const m = (k, u = "", d = 1) => { const v = this._n(e[k]); return v == null ? "–" : v.toFixed(d) + u; };
      return `<div class="card lrow" data-a="open" data-z="${z.id}">
        ${ringSVG(c, col, 56)}
        <div class="lname"><b>${esc(z.name)}</b><small>${z.confAttrs.cycle_count != null ? `${z.confAttrs.cycle_count} cycles` : "no cycle data"}</small></div>
        <div class="lm"><span>Heating rate</span><b>${m("heating_rate", " °C/h")}</b></div>
        <div class="lm"><span>Inertia</span><b>${m("thermal_inertia", " min", 0)}</b></div>
        <div class="lm"><span>Preheat</span><b>${m("preheat_time", " min", 0)}</b></div>
        <div class="lm"><span>Schedule dev.</span><b>${m("schedule_deviation", " °C")}</b></div></div>`;
    }).join("");
    const lists = [["actions_needed", "Actions needed", "clipboard-check-outline"], ["persistent_insights", "Ongoing", "history"], ["cross_zone_insights", "Whole house", "home-analytics"]]
      .filter(([k]) => Array.isArray(ha[k]) && ha[k].length)
      .map(([k, l, ic]) => `<div class="card"><h3>${icon(ic)} ${l}</h3><ul class="ins">${ha[k].map((i) => `<li>${esc(i)}</li>`).join("")}</ul></div>`).join("");
    return `<div class="card explain"><h3>How the confidence score works</h3>
      <p>Tado CE watches every heating cycle in each room: how long the room takes to start responding, and how quickly it then warms. The confidence score says how far those learned numbers can be trusted for preheat estimates.</p>
      <div class="two"><div><b>Up to 60% from experience</b><small>10% for each completed heating cycle, reaching the cap at 6 cycles.</small></div>
      <div><b>Up to 40% from consistency</b><small>Awarded when cycles give similar heating-rate and inertia results. Very uneven cycles score nothing here.</small></div></div>
      <p class="hint">A room stuck at 60% has plenty of cycles but inconsistent ones, often from open doors or windows, a changing outside temperature, or interrupted heating. Tado CE's docs suggest waiting for 70%+ before trusting preheat times.</p></div>
      <div class="lgrid">${rows}</div>
      ${hub.val("home_insights") != null ? `<h2 class="sect">Home insights${ha.top_priority ? ` <span class="pill ${/crit|high/i.test(ha.top_priority) ? "heating" : "preheat"}">${esc(ha.top_priority)}</span>` : ""}</h2>
        ${ha.summary ? `<div class="card"><p class="sumtxt">${esc(ha.summary)}</p></div>` : ""}${lists}` : ""}`;
  }

  /* ----- system ----- */

  _viewSystem() {
    const h = this._hub, ids = h.ids;
    const usage = h.n("api_usage"), limit = h.n("api_limit");
    const pctUsed = usage != null && limit ? Math.min(100, (usage / limit) * 100) : null;
    const state = (k) => h.val(k);
    const tile = (ic, l, v, cls = "") => v == null ? "" : `<div class="stat ${cls}">${icon(ic)}<span>${l}</span><b>${esc(v)}</b></div>`;
    const okCls = (v) => (/^(ok|valid|on)$/i.test(v) ? "ok" : "bad");
    const apiStatus = state("api_status"), token = state("token_status");
    const bin = (k) => { const s = h.get(k)?.state; return s == null ? null : s === "on" ? "Connected" : "Off"; };
    const when = (k) => { const v = state(k); return v ? ago(v) : null; };
    const selects = ["presence_mode", "overlay_mode", "overlay_timer"].filter((k) => ids[k]).map((k) => {
      const s = h.get(k), opts = s?.attributes?.options || [];
      const label = { presence_mode: "Presence mode", overlay_mode: "Override duration", overlay_timer: "Override timer" }[k];
      return `<div class="line"><div class="tx"><b>${label}</b></div><select class="pick" data-c="select" data-id="${ids[k]}">${opts.map((o) => `<option ${o === s.state ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></div>`;
    }).join("");
    const quota = ids.quota_reserve_enabled ? `<div class="line"><div class="tx"><b>Quota reserve</b><small>Keep some API calls back for manual actions</small></div>
      <button class="sw ${h.get("quota_reserve_enabled")?.state === "on" ? "on" : ""}" data-a="toggle" data-v="${ids.quota_reserve_enabled}" aria-label="Quota reserve"></button></div>` : "";
    const resume = ids.resume_all ? `<div class="line"><div class="tx"><b>Resume all schedules</b><small>Cancel every manual override in the house</small></div>
      <button class="btn" data-a="press" data-v="${ids.resume_all}">Resume all</button></div>` : "";
    const bridge = [["bridge_boiler_output_temperature", "Boiler output"], ["boiler_flow_temp", "Boiler flow"], ["wc_target_flow_temp", "Weather comp. target"]]
      .map(([k, l]) => { const v = h.n(k); return v == null ? "" : tile("water-boiler", l, `${f1(v)} °C`); }).join("");
    const known = new Set(["api_usage", "api_limit", "api_reset", "api_status", "token_status", "last_sync", "next_sync", "polling_interval", "bridge_connected", "homekit_connected", "home"]);
    return `<div class="card"><h3>Tado cloud</h3>
        ${pctUsed != null ? `<div class="meter"><div class="mhead"><span>API calls today</span><b>${f0(usage)} / ${f0(limit)}</b></div><div class="bar"><i style="width:${pctUsed}%" class="${pctUsed > 85 ? "bad" : pctUsed > 60 ? "warn" : ""}"></i></div>
          ${state("api_reset") ? `<small>Resets ${ago(state("api_reset"))}</small>` : ""}</div>` : ""}
        <div class="stats">${tile("cloud-check-outline", "API status", apiStatus, apiStatus ? okCls(apiStatus) : "")}${tile("key-outline", "Token", token, token ? okCls(token) : "")}
          ${tile("sync", "Last sync", when("last_sync"))}${tile("sync-circle", "Next sync", when("next_sync"))}${tile("timer-cog-outline", "Polling", state("polling_interval") ? `${state("polling_interval")} min` : null)}
          ${tile("router-wireless", "Internet bridge", bin("bridge_connected"))}${tile("apple", "HomeKit", bin("homekit_connected"))}${tile("home-map-marker", "Geofencing", bin("home"))}${bridge}</div></div>
      <div class="card"><h3>Controls</h3>${resume}${selects}${quota}</div>
      <div class="card"><h3>All Tado CE hub entities</h3><div class="ents">${Object.entries(ids).filter(([k]) => !known.has(k)).map(([k, id]) => {
        const s = this._st(id); return `<div class="kv"><span>${esc(s?.attributes?.friendly_name || k)}<small>${esc(id)}</small></span><b>${esc(s ? s.state : "–")}${s?.attributes?.unit_of_measurement ? " " + esc(s.attributes.unit_of_measurement) : ""}</b></div>`;
      }).join("")}</div></div>
      <p class="hint center">Tado Dash is a viewer for Tado CE. All data, learning and control comes from Tado CE.</p>`;
  }
}

function chip(ic, label, value, cls = "", tab = "") {
  return `<span class="chip ${cls}" ${tab ? `data-a="tab" data-v="${tab}"` : ""}>${icon(ic)}${label} <b>${esc(value)}</b></span>`;
}

function ringSVG(pct, color, size = 72) {
  const r = 30, c = 2 * Math.PI * r, v = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 72 72"><circle cx="36" cy="36" r="${r}" fill="none" stroke="var(--divider-color)" stroke-width="7"/>
    <circle cx="36" cy="36" r="${r}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(c * v) / 100} ${c}" transform="rotate(-90 36 36)"/>
    <text x="36" y="41" text-anchor="middle" class="rt">${pct == null ? "–" : Math.round(pct)}</text></svg>`;
}

const STYLE = `
:host{display:block;height:100%;background:var(--primary-background-color);color:var(--primary-text-color);font-family:var(--paper-font-body1_-_font-family,Roboto,sans-serif);
  --heat:${HEAT};--card:var(--card-background-color,#1c1c1c);--line:var(--divider-color,#3a3a3a);--mut:var(--secondary-text-color,#9a9a9a);--ok:var(--success-color,#43a047);--warn:var(--warning-color,#ffa726);--bad:var(--error-color,#ef5350)}
*{box-sizing:border-box}
.page{display:flex;flex-direction:column;height:100%}
header{display:flex;align-items:center;gap:8px;height:56px;padding:0 16px;background:var(--app-header-background-color,var(--card));border-bottom:1px solid var(--line);flex:none}
h1{font-size:20px;font-weight:400;margin:0}
nav{display:flex;gap:4px;padding:0 12px;background:var(--app-header-background-color,var(--card));border-bottom:1px solid var(--line);overflow-x:auto;flex:none}
nav button{background:none;border:0;border-bottom:2px solid transparent;color:var(--mut);font:inherit;font-size:14px;font-weight:500;padding:14px 14px 12px;cursor:pointer;white-space:nowrap}
nav button.on{color:var(--primary-color);border-bottom-color:var(--primary-color)}
.content{flex:1;overflow:auto}
.wrap{max-width:1280px;margin:0 auto;padding:20px 16px 48px}
button{font:inherit;color:inherit}
.icon-btn{background:none;border:0;cursor:pointer;padding:8px;border-radius:50%;display:flex;color:var(--primary-text-color)}
ha-icon{--mdc-icon-size:18px;display:inline-flex;vertical-align:middle}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}
.chip{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border:1px solid var(--line);border-radius:999px;background:var(--card);font-size:13px;color:var(--mut)}
.chip b{color:var(--primary-text-color)} .chip.heat ha-icon{color:var(--heat)} .chip.warn ha-icon{color:var(--warn)} .chip[data-a]{cursor:pointer}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--ha-card-border-radius,12px);padding:16px;margin-bottom:14px}
.grid .card{margin:0}
.card h3{margin:0 0 12px;font-size:16px;font-weight:500}
.cardhead{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px}.cardhead h3{margin:0}
.room{cursor:pointer;display:flex;flex-direction:column;gap:6px;transition:border-color .15s}.room:hover{border-color:var(--mut)}
.row{display:flex;justify-content:space-between;align-items:center;gap:8px}
.name{font-weight:500;display:flex;align-items:center;gap:8px}.name ha-icon{color:var(--mut)}
.pill{display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--mut);padding:2px 8px;border-radius:999px}
.pill.heating{color:var(--heat);background:color-mix(in srgb,var(--heat) 14%,transparent)}
.pill.preheat{color:var(--warn);background:color-mix(in srgb,var(--warn) 14%,transparent)}
.pill.window{color:#4fc3f7;background:rgba(79,195,247,.14)}.pill.over{color:#ba68c8;background:rgba(186,104,200,.14)}
.pill.off{color:var(--mut)}
.mid{align-items:flex-end}
.temp{font-size:46px;font-weight:300;line-height:1.1}.temp small{font-size:18px;color:var(--mut);margin-left:2px;vertical-align:top}
.hum{font-size:13px;color:var(--mut);margin-left:10px;vertical-align:middle}
.tgt{text-align:right;display:flex;flex-direction:column;font-size:12px;color:var(--mut)}.tgt b{font-size:17px;color:var(--primary-text-color);font-weight:500}
.spark{width:calc(100% + 32px);height:64px;margin:0 -16px;display:block}.spark.empty{height:24px}
.note{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--primary-text-color);background:color-mix(in srgb,var(--mut) 14%,transparent);padding:4px 10px;border-radius:999px;align-self:flex-start}
.note.faint{background:none;color:var(--mut);padding-left:0}.note.adv{margin-top:12px;border-radius:8px;align-self:stretch;padding:8px 10px}
.seg{display:flex;gap:4px;background:color-mix(in srgb,var(--mut) 10%,transparent);padding:4px;border-radius:12px;margin-top:6px}
.seg button{flex:1;display:flex;align-items:center;justify-content:center;gap:5px;background:none;border:1px solid transparent;border-radius:8px;padding:8px 4px;color:var(--mut);font-size:13px;font-weight:500;cursor:pointer}
.seg button:hover{color:var(--primary-text-color)}
.seg button.on{background:color-mix(in srgb,var(--primary-color) 16%,transparent);border-color:var(--primary-color);color:var(--primary-text-color)}
.seg.wrap2{flex-wrap:wrap}.seg.wrap2 button{flex:1 1 30%}.seg.second{margin-top:4px}.seg.small button{padding:6px 12px}
.cols{display:grid;grid-template-columns:minmax(300px,2fr) 3fr;gap:16px;align-items:start}
.hero .bigtemp{font-size:72px;font-weight:300;line-height:1.1;margin:8px 0 0}.bigtemp small{font-size:26px;color:var(--mut);vertical-align:top}
.hero .spark{height:70px}
.facts{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:13px;color:var(--mut);margin:8px 0}.facts span{display:inline-flex;align-items:center;gap:4px}
.divider{border-top:1px solid var(--line);margin:12px 0}
.lbl{font-size:12px;color:var(--mut);display:block;margin-top:4px}
.targetrow{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px}
.stepper{display:flex;align-items:center;gap:12px;margin-top:4px}.stepper b{font-size:30px;font-weight:400;min-width:86px;text-align:center}.stepper small{font-size:14px;color:var(--mut)}
.round{width:40px;height:40px;border-radius:50%;border:1px solid var(--line);background:none;cursor:pointer;display:flex;align-items:center;justify-content:center}.round:hover{border-color:var(--primary-color);color:var(--primary-color)}
.sub{font-size:12px;color:var(--mut);text-align:right;line-height:1.6}
.learn{display:flex;align-items:center;gap:14px;margin:6px 0 10px}.lt b{display:block;font-size:17px;font-weight:500}.lt small{color:var(--mut);font-size:12px}
.ring .rt{fill:var(--primary-text-color);font-size:20px;font-weight:500}
.kv{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-top:1px solid var(--line);font-size:14px}
.kv span small{display:block;color:var(--mut);font-size:12px;word-break:break-all}.kv b{font-weight:500;white-space:nowrap}
.stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px}
.stat{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:color-mix(in srgb,var(--mut) 5%,transparent);font-size:12px;color:var(--mut)}
.stat ha-icon{color:var(--mut)}.stat b{font-size:15px;color:var(--primary-text-color);font-weight:500}
.stat.ok ha-icon{color:var(--ok)}.stat.warn ha-icon,.stat.warn b{color:var(--warn)}.stat.bad ha-icon,.stat.bad b{color:var(--bad)}
.stats.big{margin-bottom:14px;grid-template-columns:repeat(auto-fill,minmax(160px,1fr))}
.line{display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid var(--line)}
.line:first-of-type{border-top:0}.line .ic{width:36px;height:36px;border-radius:50%;background:color-mix(in srgb,var(--mut) 14%,transparent);display:flex;align-items:center;justify-content:center;color:var(--mut)}
.tx{flex:1;min-width:0}.tx b{font-weight:500;font-size:14px;display:block}.tx small{font-size:12px;color:var(--mut)}
.val{display:inline-flex;align-items:center;gap:4px;font-size:13px;color:var(--mut)}.val.bad{color:var(--bad)}
.sw{width:42px;height:24px;border-radius:12px;border:0;background:var(--mut);position:relative;cursor:pointer;flex:none;opacity:.7}
.sw::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:left .15s}
.sw.on{background:var(--primary-color);opacity:1}.sw.on::after{left:21px}
.btn,.link{background:none;border:0;color:var(--primary-color);cursor:pointer;font-weight:500;font-size:14px}.btn{border:1px solid var(--primary-color);border-radius:8px;padding:6px 14px}
.link{padding:0;font-size:13px}
.toolbar{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:14px}
.pick{font:inherit;color:var(--primary-text-color);background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px 10px}
.chart{position:relative}.chartsvg{width:100%;height:auto;display:block;touch-action:pan-y}
.grid{}.chartsvg .grid{stroke:var(--line);stroke-width:1}.chartsvg .vgrid{stroke:var(--line);stroke-width:1;opacity:.45}
.axis{fill:var(--mut);font-size:11px}.ptitle{fill:var(--mut);font-size:11px}.cross{stroke:var(--primary-text-color);stroke-width:1;opacity:.5}
.tip{position:absolute;pointer-events:none;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:12px;display:flex;flex-direction:column;gap:3px;box-shadow:0 4px 16px rgba(0,0,0,.35);z-index:2;white-space:nowrap}
.tip i,.legend i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px}
.legend{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12px;color:var(--mut);margin-top:6px}
.hint{font-size:12px;color:var(--mut);margin:10px 0 0}.center{text-align:center}
.empty{text-align:center;padding:48px 16px;color:var(--mut)}.empty ha-icon{--mdc-icon-size:48px}.empty h2{color:var(--primary-text-color);font-weight:400;margin:12px 0 6px}
.ins{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px;font-size:14px}.ins li{display:flex;gap:8px;line-height:1.4}.ins ha-icon{color:var(--warn);flex:none;margin-top:1px}
.axisrow,.drow{display:grid;grid-template-columns:64px 1fr;gap:10px;align-items:center}.drow{margin:6px 0}
.hours{position:relative;height:14px}.hours i{position:absolute;transform:translateX(-50%);font-size:11px;color:var(--mut);font-style:normal}
.track{position:relative;height:34px;background:color-mix(in srgb,var(--mut) 10%,transparent);border-radius:8px;overflow:hidden;background-image:linear-gradient(90deg,var(--line) 1px,transparent 1px);background-size:12.5% 100%}
.track.thin{height:20px;border-radius:6px}
.blk{position:absolute;top:2px;bottom:2px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:12px;color:#fff;border:1px solid rgba(255,255,255,.18);overflow:hidden}
.nowline{position:absolute;top:0;bottom:0;width:2px;background:#fff;opacity:.85}
.dn{font-size:13px;font-weight:500}.dn.today{color:var(--primary-color)}.dn small{display:block;font-size:10px;font-weight:400}.dn.small{font-weight:400;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.legend.grad{align-items:center;margin-top:14px}.legend.grad i{width:120px;height:10px;border-radius:5px;margin:0}.legend.grad em{flex-basis:100%;font-style:normal}
.explain p{font-size:14px;line-height:1.5;margin:0 0 10px;color:var(--primary-text-color)}
.two{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0}.two div{border:1px solid var(--line);border-radius:10px;padding:10px 12px}.two b{display:block;font-weight:500}.two small{color:var(--mut)}
.lgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:12px;margin-bottom:6px}
.lrow{display:grid;grid-template-columns:56px 1.3fr repeat(4,1fr);gap:10px;align-items:center;margin:0;cursor:pointer;padding:12px}.lrow:hover{border-color:var(--mut)}
.lname small,.lm span{display:block;font-size:11px;color:var(--mut)}.lm b{font-size:13px;font-weight:500}
.sect{font-size:18px;font-weight:400;margin:22px 0 12px}.sumtxt{margin:0;font-size:14px;line-height:1.5}
.meter{margin-bottom:14px}.mhead{display:flex;justify-content:space-between;font-size:14px;margin-bottom:6px}
.bar{height:8px;border-radius:4px;background:color-mix(in srgb,var(--mut) 20%,transparent);overflow:hidden}.bar i{display:block;height:100%;background:var(--ok)}.bar i.warn{background:var(--warn)}.bar i.bad{background:var(--bad)}
.meter small{color:var(--mut);font-size:12px}
@media(max-width:860px){.cols{grid-template-columns:1fr}.lgrid{grid-template-columns:1fr}.lrow{grid-template-columns:56px 1fr 1fr}.lrow .lname{grid-column:2/4}.two{grid-template-columns:1fr}.temp{font-size:40px}}
`;

customElements.define("tado-dash-panel", TadoDashPanel);
