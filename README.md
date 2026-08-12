# Explr Fshng — v1 web prototype

**Explore · Protect · Share · Repeat**

A working first slice of Explr: plan a fishing trip, get a recommended time
window with an explanation, and log what actually happened afterward.

## What it does

1. **Plan a Trip** — pick your exact spot by clicking (or dragging the pin)
   on the map; the search box is just there to help you jump the map to the
   right area, since a lot of fishing spots aren't in any place-name
   database. Pick a target species, then either lock in a **specific date**
   (e.g. "I'm only free Sunday") or let it find the **best day this week**.
   It pulls a real hourly weather forecast (pressure, wind, cloud cover,
   rain) and scores every 3-hour block using simple, explainable fishing
   heuristics (pressure trend, wind, light levels, dawn/dusk, rain). You get
   the best window plus a few runner-ups spread across the day/week, each
   with plain-language reasons. Pick **how you're fishing** (shore, wading,
   kayak, boat) — it shifts the wind tolerance in the scoring (small craft
   and wading are more wind-sensitive; a boat handles more wind but still
   gets a safety warning past ~32 km/h). Pick **Boat** and a button appears
   to find real slipways, marinas and harbours near your map view, pulled
   live from OpenStreetMap.
2. **Save this plan to My Trips** — stores it as a planned trip.
3. **My Trips** — after your trip, click **Log result** to record whether you
   went, what you caught, and rate how accurate the recommendation was. This
   is your data collection loop — it builds a history you can look back on,
   and later this is the kind of data that could power smarter, personalized
   recommendations.

No backend, no signup, no API keys. Weather and place search come from the
free [Open-Meteo](https://open-meteo.com) API. Your trips are stored only in
your browser (`localStorage`) — nothing is sent anywhere or shared.

## How to run it

You have Python installed, so from this folder run:

```bash
py -m http.server 8642
```

Then open **http://localhost:8642** in your browser. That's it — no install
step, no build.

(Opening `index.html` directly by double-clicking also mostly works, except
"Use my location" needs a real server/localhost to be allowed by the
browser — that's why the command above is the reliable way to run it.)

## What's next

This is deliberately small: one feature, done for real, instead of the
sprawling multi-service architecture from the earlier planning docs. Once
this feels right, natural next steps are: a map view of saved spots, moving
storage from the browser to a real account so trips sync across devices, and
using the logged catch data to personalize future recommendations per
species/region.
