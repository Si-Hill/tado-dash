<p align="center">
  <img src="https://raw.githubusercontent.com/Si-Hill/tado-dash/main/custom_components/tado_dash/brand/icon@2x.png" alt="Tado Dash" width="120">
</p>

# Tado Dash

<p align="center">
  <img src="https://img.shields.io/badge/HOME%20ASSISTANT-2025.3%2B-41BDF5?style=for-the-badge&logo=homeassistant&logoColor=white" alt="Home Assistant 2025.3+">
  <img src="https://img.shields.io/badge/HACS-CUSTOM-orange?style=for-the-badge" alt="HACS Custom">
  <a href="https://github.com/Si-Hill/tado-dash/releases/latest"><img src="https://img.shields.io/github/v/release/Si-Hill/tado-dash?style=for-the-badge&label=STABLE&color=4c1" alt="Latest release"></a>
  <img src="https://img.shields.io/github/license/Si-Hill/tado-dash?style=for-the-badge&label=LICENSE" alt="License">
</p>

A **Tado** item in the Home Assistant sidebar: a room-by-room dashboard for heating that [Tado CE](https://github.com/hiall-fyi/tado_ce) already controls.

Tado Dash has no account, no entities and no polling of its own. It reads the entities Tado CE creates and calls Tado CE's services, so if Tado CE works for you, Tado Dash works the moment you add it. Not affiliated with Tado or the Tado CE project. The layout is inspired by [RoomMind](https://github.com/snazzybean/roommind), but shares no code with it.

## What you get

| Tab | What it shows |
| --- | --- |
| **Rooms** | One card per room: temperature, humidity, target, 6-hour trend, heating state, and one-tap Schedule / Boost / Off. The Rooms and Heating chips filter the cards; further chips show outside temperature, open insights and (with more than one Tado home) home/away. |
| **Room page** | Large temperature and trend, target stepper, hold for 30 min / 1 h / 2 h / until next block / until changed, Boost and Smart boost, what Tado has learned, comfort and air (mold, condensation, dew point), devices with battery and connection, room insights, early start. |
| **Analytics** | Pick a room and 6 h to 7 days: temperature, target, heating power, outside temperature and humidity on shared-time charts with hover read-out, plus average, range, heating hours and time on target. |
| **Schedules** | Today across every room, plus a week grid for one room, from Tado CE's schedule calendars. Read-only: edit schedules in the Tado app. |
| **Learning** | Confidence, cycle count, heating rate, thermal inertia and preheat time for every room, an explanation of how confidence is scored, and Tado CE's home-wide insights. |
| **System** | API usage against the daily limit, token and sync status, bridge, HomeKit and geofencing, presence mode and override settings, resume-all, and every hub entity. |

### About the confidence score

Tado CE learns from completed heating cycles. Per its source, the score is up to 60% from the number of cycles (10% each, capped at 6) plus up to 40% from how consistent the heating-rate and thermal-inertia results are between cycles. A room parked at exactly 60% has enough cycles but inconsistent ones, usually draughts, open windows, or interrupted heating.

## Prerequisites

- Home Assistant 2025.3 or newer
- [Tado CE](https://github.com/hiall-fyi/tado_ce) installed and set up
- For the Learning tab: enable Tado CE's *Confidence*, *Heating Rate*, *Thermal Inertia* and *Preheat Time* sensors (disabled by default). Missing sensors are simply left out. Outside temperature likewise needs Tado CE's *Outside Temp* sensor.

## 1. Install via HACS

Tado Dash is not in the HACS default store, so add it as a custom repository first.

1. Open HACS, then **⋮ → Custom repositories**.
2. Add `https://github.com/Si-Hill/tado-dash` as type **Integration**.
3. Search for **Tado Dash**, and click **Download**.
4. Restart Home Assistant.

[![Open your Home Assistant instance and open this repository in HACS.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=Si-Hill&repository=tado-dash&category=integration)

## 2. Add it

**Settings → Devices & Services → Add Integration → Tado Dash**, then confirm. A **Tado** item appears in the sidebar. Use the cog on the integration to change the sidebar title or icon, or to limit it to administrators.

## How it finds your rooms

Tado CE entity IDs vary between installs (`climate.lounge_2`, `sensor.lounge_temp`), so Tado Dash doesn't guess them. It reads Tado CE's stable unique IDs from the entity registry and groups them into rooms, so renaming entities doesn't break it. It's exposed to the panel as the `tado_dash/map` WebSocket command.

## Status

Early version. Not yet reviewed against a live Home Assistant instance, so expect rough edges and please open an issue.

## Licence

MIT
