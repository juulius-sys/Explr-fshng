// Explr Fshng — v1 web prototype
// Weather/location come from Open-Meteo's free public API (no key needed).
// Trips are stored in localStorage when logged out, or in Supabase (with crew sharing) when logged in.

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const STORAGE_KEY = "explr_trips_v1";

const SPECIES_PROFILES = {
  pike: { label: "Pike (Haug)", dawnDusk: 14, cloud: 10, wind: { idealMin: 5, idealMax: 18, penalty: 8 }, pressureFalling: 12, pressureRising: -10 },
  perch: { label: "Perch (Ahven)", dawnDusk: 6, cloud: 4, wind: { idealMin: 3, idealMax: 15, penalty: 5 }, pressureFalling: 6, pressureRising: -4 },
  zander: { label: "Zander / Pikeperch (Koha)", dawnDusk: 18, cloud: 14, wind: { idealMin: 4, idealMax: 16, penalty: 8 }, pressureFalling: 10, pressureRising: -8, nightBonus: 10 },
  trout: { label: "Trout (Forell)", dawnDusk: 16, cloud: 10, wind: { idealMin: 2, idealMax: 12, penalty: 10 }, pressureFalling: 8, pressureRising: -6 },
  salmon: { label: "Salmon (Lõhe)", dawnDusk: 12, cloud: 8, wind: { idealMin: 3, idealMax: 14, penalty: 8 }, pressureFalling: 8, pressureRising: -6 },
  other: { label: "Other", dawnDusk: 8, cloud: 6, wind: { idealMin: 3, idealMax: 18, penalty: 6 }, pressureFalling: 8, pressureRising: -6 },
};

// Realistic bycatch — species commonly caught in the same waters/structure
// while targeting the key species, based on shared habitat overlap.
const SIDECATCHES = {
  pike: ["perch", "zander"],
  zander: ["perch", "pike"],
  perch: ["zander", "pike"],
  trout: ["salmon"],
  salmon: ["trout"],
  other: [],
};

const FAVORITE_SPECIES_KEY = "explr_favorite_species";

const METHOD_LABELS = { shore: "Shore", wading: "Wading", kayak: "Kayak", boat: "Boat" };
const METHOD_PHRASE = { shore: "from shore", wading: "while wading", kayak: "by kayak", boat: "by boat" };

// Wind tolerance shifts by method: small craft/wading are more wind-sensitive than shore,
// a boat can handle more wind for casting but still hits a hard safety ceiling.
const METHOD_ADJUSTMENTS = {
  shore: { idealMaxDelta: 0, penaltyMultiplier: 1, safetyLimit: null },
  wading: { idealMaxDelta: -4, penaltyMultiplier: 1.3, safetyLimit: 25 },
  kayak: { idealMaxDelta: -3, penaltyMultiplier: 1.4, safetyLimit: 22 },
  boat: { idealMaxDelta: 6, penaltyMultiplier: 0.8, safetyLimit: 32 },
};

// Researched tackle recommendations (not a live forum search — curated from
// fishing guides/forums, refreshed occasionally by hand). Color tip is
// derived from the actual computed conditions for the picked window, not
// hardcoded, so it's not purely static.
const TACKLE_RECOMMENDATIONS = {
  pike: {
    lures: [
      "Spinnerbaits (white/chartreuse, willow or Colorado blades) around weed edges and submerged wood",
      "Rapala Husky Jerk / X-Rap jerkbaits",
      "Large soft plastic shads on a jig head",
      "Red-and-white spoons (classic Daredevil-style)",
      "Inline spinners (Mepps Aglia) for shallow water/rivers",
    ],
    tip: "Pike ambush from cover — work spinnerbaits and jerkbaits right along weed lines and fallen timber rather than open water.",
    source: "https://www.wired2fish.com/musky-pike/best-pike-lures",
  },
  zander: {
    lures: [
      "Soft plastic / finesse shads on a light jig head",
      "Drop-shot rigged finesse lures",
      "Rubber shads — cheap and effective",
      "Slow-sinking jerkbaits at dusk/night",
    ],
    tip: "Keep the retrieve slow and close to the bottom — zander feed by ambush in low light, not by chasing fast-moving lures.",
    source: "https://rodmaps.com/en/2025-pike-perch-finesse-lure/",
  },
  perch: {
    lures: ["Small soft plastics (2-3\") on light jig heads", "Small spinners (Mepps-style)", "Drop-shot rigs", "Worms/maggots on light float tackle"],
    tip: "Perch hunt in packs — once you find one, stay put and keep casting the same spot instead of moving on.",
    source: "https://www.thelureforum.com/threads/best-colours-for-perch-pike-and-zander.27980/",
  },
  trout: {
    lures: ["Rapala Countdown / X-Rap minnows", "Small spinners", "Garden worms or red wigglers on light tackle", "Nymph or egg flies if fly fishing"],
    tip: "Present naturally with the current — trout key on drift and hesitate at anything that looks unnatural.",
    source: "https://www.wired2fish.com/trout/best-trout-lures",
  },
  salmon: {
    lures: ["Spoons (hammered green/gold or blue/silver finishes)", "Spawn bags / trout beads", "Egg flies or nymphs", "Plastic worms"],
    tip: "Match spoon size to water clarity — smaller and duller in clear water, bigger and flashier when it's coloured.",
    source: "https://troutandsteelhead.net/salmon-lures/",
  },
  other: {
    lures: ["Soft plastics in natural colors", "Small spinners", "Live or cut bait on a simple rig"],
    tip: "When in doubt, downsize your presentation and slow down your retrieve.",
    source: null,
  },
};

function tackleColorTip(reasons) {
  const lowLight = reasons.some((r) => /Dawn|Dusk|Night hours|Cloud cover/.test(r));
  return lowLight
    ? "Conditions favor low light — go bright/high-contrast (chartreuse, white, orange) so fish can find it."
    : "Bright, clear conditions — go natural and translucent (silver, brown, green) so it doesn't look out of place.";
}

// ---------- map pins ----------
const PIN_CATEGORIES = {
  fishing_spot: { label: "Fishing spot", icon: "🎣" },
  boat_launch: { label: "Boat launch / slip", icon: "🛥️" },
  closed_road: { label: "Closed road", icon: "🚧" },
  bait_shop: { label: "Bait shop", icon: "🏪" },
  hazard: { label: "Hazard", icon: "⚠️" },
  catch: { label: "Catch", icon: "🐟" },
  pollution: { label: "Pollution report", icon: "🛢️" },
  environment_change: { label: "Environment change", icon: "🌱" },
  other: { label: "Other", icon: "📍" },
};
const PIN_STORAGE_KEY = "explr_pins_v1";

// Estonian fishing regulations — researched from the Estonian Environmental
// Board (Keskkonnaamet), the official source. Rules are complex and change,
// so this is a starting point, not a substitute for checking the source
// yourself before fishing — always shown with a link and a clear caveat.
const REGULATIONS_SOURCE = "https://keskkonnaamet.ee/en/wildlife-nature-protection/fishing/closed-periods-and-locations-fishing-minimum-sizes";
// Re-verified automatically on the 1st of each month against the source above.
const REGULATIONS_LAST_CHECKED = "2026-08-16";
const REGULATIONS = {
  pike: {
    minSize: "50 cm",
    dailyLimit: "5 fish/day",
    closedSeason: "Closed 1 May – 28 Feb at sea; 1 May – 14 Mar in lakes; 6 May – 31 Mar in Lake Peipsi/Lämmijärv/Pihkva",
  },
  perch: {
    minSize: "21 cm at sea (no general inland minimum)",
    dailyLimit: "15 kg/day (10 kg in the Pärnu area)",
    closedSeason: "No general closed season",
  },
  zander: {
    minSize: "51 cm in Lake Võrtsjärv; 46 cm elsewhere",
    dailyLimit: "5 fish/day (3 in the Pärnu River area)",
    closedSeason: "Closed 5 May – 10 Jun inland; 15 May – 15 Jul at sea",
  },
  trout: {
    minSize: "50 cm (sea trout)",
    dailyLimit: "2 fish/day combined with salmon",
    closedSeason: "Closed 1 Jan – 1 Sep inland (some rivers have December exceptions)",
  },
  salmon: {
    minSize: "60 cm",
    dailyLimit: "2 fish/day combined with trout",
    closedSeason: "Closed 1 Jan – 1 Sep inland (some rivers have December exceptions)",
  },
  other: {
    minSize: null,
    dailyLimit: null,
    closedSeason: "Rules vary a lot by species — check the official source below.",
  },
};

// Researched, real Estonian fishing spots (not a live search — a small curated
// set compiled from public fishing guides, refreshed occasionally by hand).
// Coordinates are general area centers, not exact honey-holes.
const RESEARCHED_SPOTS = [
  {
    name: "Lake Peipus — northern shore (Mustvee / Kallaste area)",
    lat: 58.75,
    lon: 27.15,
    species: ["zander", "perch", "pike"],
    methods: ["boat", "shore"],
    note: "Estonia's premier zander water — the sandier northern bottom holds strong pike-perch and bream, and the fishery is certified sustainably managed.",
    source: "https://kalavork.ee/en/blog/best-fishing-spots-in-estonia",
  },
  {
    name: "Lake Võrtsjärv — southern basin",
    lat: 58.15,
    lon: 25.95,
    species: ["pike", "zander", "perch"],
    methods: ["boat", "shore", "kayak"],
    note: "Shallow, weedy southern end is a well-known pike ambush ground; the lake overall is also strong for zander and eel.",
    source: "https://kalavork.ee/en/blog/best-fishing-spots-in-estonia",
  },
  {
    name: "Matsalu Bay, Western Estonia",
    lat: 58.75,
    lon: 23.62,
    species: ["pike", "perch"],
    methods: ["boat", "kayak", "wading"],
    note: "Shallow, fast-warming coastal bay known for large pike thanks to favorable spawning and growing conditions.",
    source: "https://www.fishingworldguide.com/en/blog/fishing-in-estonia",
  },
  {
    name: "Keila River",
    lat: 59.3,
    lon: 24.41,
    species: ["trout", "salmon"],
    methods: ["shore", "wading"],
    note: "One of Estonia's recognized Atlantic salmon and sea trout rivers, within easy reach of Tallinn.",
    source: "http://www.salmonatlas.com/the-atlantic-salmon-rivers-of-estonia",
  },
  {
    name: "Kunda River",
    lat: 59.5,
    lon: 26.54,
    species: ["trout", "salmon"],
    methods: ["shore", "wading"],
    note: "A stocked Atlantic salmon river in northeastern Estonia; the local hatchery's broodstock originates from Kunda-caught salmon.",
    source: "https://news.err.ee/115996/estonian-rivers-stocked-with-young-salmon-and-sea-trout",
  },
  {
    name: "Pärnu River mouth",
    lat: 58.39,
    lon: 24.5,
    species: ["salmon", "trout", "pike", "zander"],
    methods: ["shore", "boat", "wading"],
    note: "Major west-coast river system, popular for both migratory salmonids upstream and coarse fishing near the river mouth.",
    source: "https://visitestonia.com/en/fly-fishing-on-the-best-trout-rivers-in-estonia",
  },
];

function getSuggestedSpots(speciesList, method) {
  return RESEARCHED_SPOTS.map((spot) => {
    const speciesMatch = speciesList.some((sp) => spot.species.includes(sp));
    let score = speciesMatch ? 2 : speciesList.includes("other") ? 1 : 0;
    if (spot.methods.includes(method)) score += 1;
    return { spot, score };
  })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((s) => s.spot);
}

// ---------- state ----------
let selectedLocation = null; // { name, lat, lon }
let lastRecommendation = null; // { top, others, species, location }
let currentUser = null; // Supabase auth user, or null when logged out
let currentCrew = null; // { id, name, inviteCode }, or null

// ---------- utils ----------
function parseISOLocal(str) {
  const [datePart, timePart] = str.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm] = timePart.split(":").map(Number);
  return { y, m, d, hh, mm, dayKey: datePart };
}

function formatWindowLabel(startStr, endStr) {
  const s = parseISOLocal(startStr);
  const e = parseISOLocal(endStr);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayName = days[new Date(s.y, s.m - 1, s.d).getDay()];
  const pad = (n) => String(n).padStart(2, "0");
  return `${dayName} ${pad(s.d)}.${pad(s.m)} · ${pad(s.hh)}:00–${pad(e.hh)}:00`;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

// ---------- lunar (real astronomy, no API — moon phase from a known reference new moon) ----------
const SYNODIC_MONTH = 29.53058867;

function moonAge(y, m, d, hh) {
  const knownNewMoon = Date.UTC(2000, 0, 6, 18, 14, 0);
  const t = Date.UTC(y, m - 1, d, hh);
  const diffDays = (t - knownNewMoon) / 86400000;
  return ((diffDays % SYNODIC_MONTH) + SYNODIC_MONTH) % SYNODIC_MONTH;
}

function moonBonus(age) {
  const distToNew = Math.min(age, SYNODIC_MONTH - age);
  const distToFull = Math.abs(age - SYNODIC_MONTH / 2);
  const nearNew = distToNew <= distToFull;
  const dist = Math.min(distToNew, distToFull);
  if (dist < 1.5) return { bonus: 8, label: nearNew ? "new moon" : "full moon" };
  if (dist < 3) return { bonus: 4, label: nearNew ? "waning toward new moon" : "waxing toward full moon" };
  return { bonus: 0, label: null };
}

// ---------- geocoding ----------
async function searchLocations(query) {
  const url = `${GEOCODE_URL}?name=${encodeURIComponent(query)}&count=6&language=en&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Location search failed");
  const data = await res.json();
  return data.results || [];
}

// ---------- forecast + scoring ----------
async function fetchForecast(lat, lon, days) {
  const url = `${FORECAST_URL}?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,surface_pressure,wind_speed_10m,cloud_cover,precipitation&forecast_days=${days}&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Forecast fetch failed");
  const data = await res.json();
  return data.hourly;
}

function scoreHour(idx, hourly, profile, method) {
  let score = 50;
  const reasons = [];
  const methodAdj = METHOD_ADJUSTMENTS[method] || METHOD_ADJUSTMENTS.shore;

  const pressure = hourly.surface_pressure[idx];
  const prevIdx = Math.max(0, idx - 3);
  const span = idx - prevIdx;
  if (span >= 2) {
    const delta = pressure - hourly.surface_pressure[prevIdx];
    if (delta <= -1.0 && delta > -6) {
      score += profile.pressureFalling;
      reasons.push(`Pressure easing (${delta.toFixed(1)} hPa over ${span}h) — a classic pre-front feeding trigger.`);
    } else if (delta <= -6) {
      score -= 6;
      reasons.push(`Pressure dropping fast (${delta.toFixed(1)} hPa) — a front may be close; fish sometimes go quiet right before it hits.`);
    } else if (delta >= 2) {
      score += profile.pressureRising;
      reasons.push(`Pressure rising (+${delta.toFixed(1)} hPa) — typically a slower, tougher bite.`);
    } else {
      score += 4;
      reasons.push(`Stable pressure — steady, comfortable conditions.`);
    }
  }

  const wind = hourly.wind_speed_10m[idx];
  const windIdealMax = profile.wind.idealMax + methodAdj.idealMaxDelta;
  if (wind >= profile.wind.idealMin && wind <= windIdealMax) {
    score += 10;
    reasons.push(`Wind ${wind.toFixed(0)} km/h — enough ripple to mask your presence without ruining casting.`);
  } else if (wind < profile.wind.idealMin) {
    score -= 3;
    reasons.push(`Wind only ${wind.toFixed(0)} km/h — very calm, flat water can make fish more line-shy.`);
  } else {
    score -= Math.round(profile.wind.penalty * methodAdj.penaltyMultiplier);
    reasons.push(`Wind ${wind.toFixed(0)} km/h — tough going ${METHOD_PHRASE[method] || "out there"}.`);
    if (methodAdj.safetyLimit && wind >= methodAdj.safetyLimit) {
      score -= 15;
      reasons.push(`⚠️ ${wind.toFixed(0)} km/h is past a sensible safety margin ${METHOD_PHRASE[method]} — have a backup plan.`);
    }
  }

  const cloud = hourly.cloud_cover[idx];
  if (cloud >= 50) {
    score += profile.cloud;
    reasons.push(`Cloud cover ${cloud.toFixed(0)}% — low light favors ambush predators.`);
  } else {
    score -= 3;
  }

  const when = parseISOLocal(hourly.time[idx]);
  const hour = when.hh;

  const age = moonAge(when.y, when.m, when.d, when.hh);
  const moon = moonBonus(age);
  if (moon.bonus > 0) {
    score += moon.bonus;
    reasons.push(`Moon is near ${moon.label} — historically a stronger feeding trigger.`);
  }

  const isDawn = hour >= 5 && hour <= 8;
  const isDusk = hour >= 18 && hour <= 21;
  const isNight = hour >= 22 || hour <= 4;
  if (isDawn || isDusk) {
    score += profile.dawnDusk;
    reasons.push(`${isDawn ? "Dawn" : "Dusk"} hours — historically one of the strongest bite windows.`);
  } else if (isNight && profile.nightBonus) {
    score += profile.nightBonus;
    reasons.push("Night hours — low light suits ambush feeders.");
  } else if (hour >= 11 && hour <= 15) {
    score -= 4;
  }

  const precip = hourly.precipitation[idx];
  if (precip > 4) {
    score -= 10;
    reasons.push(`Heavy rain expected (${precip.toFixed(1)} mm/h) — likely hurts comfort and water clarity.`);
  } else if (precip > 0.1) {
    score += 3;
    reasons.push(`Light rain (${precip.toFixed(1)} mm/h) — often keeps fish feeding actively.`);
  }

  return { score: clamp(Math.round(score), 0, 100), reasons };
}

function scoreHourForSpeciesList(idx, hourly, speciesList, method) {
  const perSpecies = speciesList.map((key) => ({ key, ...scoreHour(idx, hourly, SPECIES_PROFILES[key], method) }));
  const avgScore = Math.round(perSpecies.reduce((sum, p) => sum + p.score, 0) / perSpecies.length);
  const best = perSpecies.reduce((a, b) => (b.score > a.score ? b : a));
  const reasons = [...best.reasons];
  if (speciesList.length > 1) {
    reasons.push(`Best fit for ${SPECIES_PROFILES[best.key].label} among your picks this hour.`);
  }
  return { score: avgScore, reasons };
}

function buildWindows(hourly, speciesList, method) {
  const n = hourly.time.length;
  const hourScores = [];
  for (let i = 0; i < n; i++) hourScores.push(scoreHourForSpeciesList(i, hourly, speciesList, method));

  const windows = [];
  for (let i = 0; i + 2 < n; i++) {
    const trio = [hourScores[i], hourScores[i + 1], hourScores[i + 2]];
    const avg = Math.round((trio[0].score + trio[1].score + trio[2].score) / 3);
    const reasonSet = [];
    for (const h of trio) {
      for (const r of h.reasons) {
        if (!reasonSet.includes(r)) reasonSet.push(r);
      }
    }
    windows.push({
      startIdx: i,
      startTime: hourly.time[i],
      endTime: hourly.time[i + 3] || hourly.time[i + 2],
      score: avg,
      reasons: reasonSet.slice(0, 5),
      dayKey: parseISOLocal(hourly.time[i]).dayKey,
    });
  }
  return windows;
}

function pickRecommendations(windows) {
  const sorted = [...windows].sort((a, b) => b.score - a.score);
  const top = sorted[0];

  const byDay = new Map();
  for (const w of sorted) {
    if (w.dayKey === top.dayKey) continue;
    if (!byDay.has(w.dayKey)) byDay.set(w.dayKey, w);
  }
  const others = Array.from(byDay.values())
    .sort((a, b) => (a.dayKey < b.dayKey ? -1 : 1))
    .slice(0, 4);

  return { top, others };
}

function pickRecommendationsForDay(windows, dayKey) {
  const dayWindows = windows.filter((w) => w.dayKey === dayKey).sort((a, b) => b.score - a.score);
  if (dayWindows.length === 0) return null;
  const top = dayWindows[0];

  const others = [];
  for (const w of dayWindows.slice(1)) {
    if (others.length >= 4) break;
    const farEnough = Math.abs(w.startIdx - top.startIdx) >= 3 && others.every((o) => Math.abs(w.startIdx - o.startIdx) >= 3);
    if (farEnough) others.push(w);
  }
  others.sort((a, b) => a.startIdx - b.startIdx);

  return { top, others };
}

function daysFromToday(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const target = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

function addDaysStr(baseStr, days) {
  const [y, m, d] = baseStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  const pad = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ---------- rendering: plan tab ----------
const locationInput = document.getElementById("locationInput");
const searchBtn = document.getElementById("searchBtn");
const geoBtn = document.getElementById("geoBtn");
const locationResults = document.getElementById("locationResults");
const selectedLocationEl = document.getElementById("selectedLocation");
const selectedLocationTextEl = document.getElementById("selectedLocationText");
const wazeLinkEl = document.getElementById("wazeLink");
const methodSelect = document.getElementById("methodSelect");
const boatLaunchTools = document.getElementById("boatLaunchTools");
const findLaunchesBtn = document.getElementById("findLaunchesBtn");
const launchHint = document.getElementById("launchHint");
const speciesPicker = document.getElementById("speciesPicker");
const sidecatchNote = document.getElementById("sidecatchNote");
const daysSelect = document.getElementById("daysSelect");
const dateInput = document.getElementById("dateInput");
const modeBtns = document.querySelectorAll(".mode-btn");
const forecastNote = document.getElementById("forecastNote");
const findBtn = document.getElementById("findBtn");
const planHint = document.getElementById("planHint");
const resultsArea = document.getElementById("resultsArea");
const topWindowHeadingEl = document.getElementById("topWindowHeading");
const otherWindowsHeadingEl = document.getElementById("otherWindowsHeading");
const topWindowEl = document.getElementById("topWindow");
const otherWindowsEl = document.getElementById("otherWindows");
const tackleCard = document.getElementById("tackleCard");
const respondByRow = document.getElementById("respondByRow");
const respondByInput = document.getElementById("respondByInput");
const saveTripBtn = document.getElementById("saveTripBtn");

let planMode = "date";

// ---------- species picker (multi-select + favorites) ----------
let selectedSpecies = ["pike"];

function loadFavoriteSpecies() {
  try {
    return JSON.parse(localStorage.getItem(FAVORITE_SPECIES_KEY)) || [];
  } catch {
    return [];
  }
}

function saveFavoriteSpecies(favs) {
  localStorage.setItem(FAVORITE_SPECIES_KEY, JSON.stringify(favs));
}

function renderSpeciesPicker() {
  const favorites = loadFavoriteSpecies();
  const keys = Object.keys(SPECIES_PROFILES);
  const sorted = [...keys].sort((a, b) => {
    const favA = favorites.includes(a) ? 0 : 1;
    const favB = favorites.includes(b) ? 0 : 1;
    if (favA !== favB) return favA - favB;
    return keys.indexOf(a) - keys.indexOf(b);
  });
  speciesPicker.innerHTML = sorted
    .map((key) => {
      const isFav = favorites.includes(key);
      const isSelected = selectedSpecies.includes(key);
      return `
      <div class="species-row ${isSelected ? "selected" : ""}" data-key="${key}">
        <button type="button" class="species-star ${isFav ? "favorited" : ""}" data-key="${key}">${isFav ? "★" : "☆"}</button>
        <input type="checkbox" class="species-check" data-key="${key}" ${isSelected ? "checked" : ""} />
        <span class="species-label">${SPECIES_PROFILES[key].label}</span>
      </div>`;
    })
    .join("");

  speciesPicker.querySelectorAll(".species-star").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const key = btn.dataset.key;
      const favs = loadFavoriteSpecies();
      const idx = favs.indexOf(key);
      if (idx === -1) favs.push(key);
      else favs.splice(idx, 1);
      saveFavoriteSpecies(favs);
      renderSpeciesPicker();
    });
  });

  speciesPicker.querySelectorAll(".species-row").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.classList.contains("species-star")) return;
      toggleSpecies(row.dataset.key);
    });
  });
}

function toggleSpecies(key) {
  const idx = selectedSpecies.indexOf(key);
  if (idx === -1) {
    selectedSpecies.push(key);
  } else {
    if (selectedSpecies.length === 1) return;
    selectedSpecies.splice(idx, 1);
  }
  renderSpeciesPicker();
  onSpeciesChange();
}

function renderSidecatchNote() {
  const sideSet = new Set();
  selectedSpecies.forEach((key) => {
    (SIDECATCHES[key] || []).forEach((s) => {
      if (!selectedSpecies.includes(s)) sideSet.add(s);
    });
  });
  sidecatchNote.textContent = sideSet.size ? `Possible sidecatches: ${[...sideSet].map((s) => SPECIES_PROFILES[s].label).join(", ")}` : "";
}

function onSpeciesChange() {
  renderSidecatchNote();
  renderSuggestedSpots();
  renderRegulations();
}

renderSpeciesPicker();
renderSidecatchNote();

// ---------- date mode setup ----------
const todayKey = todayStr();
dateInput.min = todayKey;
dateInput.max = addDaysStr(todayKey, 15);
dateInput.value = todayKey;

modeBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    modeBtns.forEach((b) => b.classList.toggle("active", b === btn));
    planMode = btn.dataset.mode;
    dateInput.hidden = planMode !== "date";
    daysSelect.hidden = planMode !== "range";
    forecastNote.hidden = true;
  });
});

dateInput.addEventListener("change", () => {
  const diff = daysFromToday(dateInput.value);
  forecastNote.hidden = diff <= 7;
  forecastNote.textContent = diff > 7 ? "Heads up: forecasts this far out are less reliable — treat it as a rough guide." : "";
});

// ---------- map ----------
let leafletMap = null;
let marker = null;

function initMap() {
  leafletMap = L.map("mapPicker").setView([58.6, 25.0], 7);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(leafletMap);
  leafletMap.on("click", (e) => {
    if (pinMode) {
      startPinAt(e.latlng.lat, e.latlng.lng);
      return;
    }
    placeMarker(e.latlng.lat, e.latlng.lng);
    setSelectedLocation({ name: "Pinned location", lat: e.latlng.lat, lon: e.latlng.lng });
  });
}
initMap();

function placeMarker(lat, lon) {
  if (marker) {
    marker.setLatLng([lat, lon]);
  } else {
    marker = L.marker([lat, lon], { draggable: true }).addTo(leafletMap);
    marker.on("dragend", () => {
      const pos = marker.getLatLng();
      setSelectedLocation({ name: "Pinned location", lat: pos.lat, lon: pos.lng });
    });
  }
}

// ---------- community pins (fishing spots, boat launches, closed roads, bait shops...) ----------
const pinModeBtn = document.getElementById("pinModeBtn");
const pinForm = document.getElementById("pinForm");
const pinCategorySelect = document.getElementById("pinCategorySelect");
const pinLabelInput = document.getElementById("pinLabelInput");
const pinNotesInput = document.getElementById("pinNotesInput");
const pinPhotoInput = document.getElementById("pinPhotoInput");
const savePinBtn = document.getElementById("savePinBtn");
const cancelPinBtn = document.getElementById("cancelPinBtn");
const pinFormHint = document.getElementById("pinFormHint");
const mapHintEl = document.getElementById("mapHint");

let pinMode = false;
let pendingPinLatLng = null;
let pinsLayer = L.layerGroup().addTo(leafletMap);

pinModeBtn.addEventListener("click", () => {
  pinMode = !pinMode;
  pinModeBtn.classList.toggle("active", pinMode);
  mapHintEl.textContent = pinMode
    ? "Pin mode is on — click the map where you want to drop a pin."
    : "Click the map to drop a pin, or drag the pin to fine-tune. Search above just helps you get to the right area — the pin is what counts.";
  if (!pinMode) pinForm.hidden = true;
});

function startPinAt(lat, lon) {
  pendingPinLatLng = { lat, lon };
  pinForm.hidden = false;
  pinLabelInput.value = "";
  pinNotesInput.value = "";
  pinPhotoInput.value = "";
  pinFormHint.textContent = "";
  pinPhotoInput.disabled = !currentUser;
}

cancelPinBtn.addEventListener("click", () => {
  pinForm.hidden = true;
  pendingPinLatLng = null;
});

savePinBtn.addEventListener("click", async () => {
  const label = pinLabelInput.value.trim();
  if (!label || !pendingPinLatLng) {
    pinFormHint.textContent = "Give the pin a label first.";
    return;
  }
  savePinBtn.disabled = true;
  pinFormHint.textContent = pinPhotoInput.files[0] ? "Saving pin and uploading photo…" : "Saving pin…";
  const pin = {
    category: pinCategorySelect.value,
    label,
    notes: pinNotesInput.value.trim(),
    lat: pendingPinLatLng.lat,
    lon: pendingPinLatLng.lon,
  };
  const errorMessage = await persistNewPin(pin, pinPhotoInput.files[0] || null);
  savePinBtn.disabled = false;
  if (errorMessage) {
    pinFormHint.textContent = `Couldn't save: ${errorMessage}`;
    return;
  }
  pinForm.hidden = true;
  pendingPinLatLng = null;
  pinMode = false;
  pinModeBtn.classList.remove("active");
  mapHintEl.textContent = "Click the map to drop a pin, or drag the pin to fine-tune. Search above just helps you get to the right area — the pin is what counts.";
  await loadAndRenderPins();
});

function loadLocalPins() {
  try {
    return JSON.parse(localStorage.getItem(PIN_STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveLocalPins(pins) {
  localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(pins));
}

async function uploadPinPhoto(file) {
  const path = `${currentCrew.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const { error } = await supabaseClient.storage.from("pin-photos").upload(path, file);
  if (error) throw error;
  const { data } = supabaseClient.storage.from("pin-photos").getPublicUrl(path);
  return data.publicUrl;
}

async function persistNewPin(pin, photoFile) {
  if (currentUser && currentCrew) {
    let photoUrl = null;
    if (photoFile) {
      try {
        photoUrl = await uploadPinPhoto(photoFile);
      } catch (err) {
        return `photo upload failed (${err.message})`;
      }
    }
    const { error } = await supabaseClient.from("map_pins").insert({
      crew_id: currentCrew.id,
      created_by: currentUser.id,
      category: pin.category,
      label: pin.label,
      notes: pin.notes || null,
      lat: pin.lat,
      lon: pin.lon,
      photo_url: photoUrl,
    });
    return error ? error.message : null;
  }
  const pins = loadLocalPins();
  pins.push({ ...pin, id: `pin_${Date.now()}`, createdAt: new Date().toISOString() });
  saveLocalPins(pins);
  return null;
}

async function fetchRemotePins() {
  if (!currentCrew) return [];
  const { data, error } = await supabaseClient.from("map_pins").select("*").eq("crew_id", currentCrew.id);
  if (error) {
    console.error("fetchRemotePins", error);
    return [];
  }
  const rows = data || [];
  const creatorIds = [...new Set(rows.map((r) => r.created_by))];
  let namesById = {};
  if (creatorIds.length) {
    const { data: profs } = await supabaseClient.from("profiles").select("id, display_name").in("id", creatorIds);
    (profs || []).forEach((p) => {
      namesById[p.id] = p.display_name;
    });
  }
  return rows.map((row) => ({
    id: row.id,
    category: row.category,
    label: row.label,
    notes: row.notes,
    lat: row.lat,
    lon: row.lon,
    photoUrl: row.photo_url,
    createdAt: row.created_at,
    isMine: row.created_by === currentUser.id,
    createdByName: namesById[row.created_by],
  }));
}

async function deletePin(pinId) {
  if (currentUser && currentCrew) {
    await supabaseClient.from("map_pins").delete().eq("id", pinId);
  } else {
    saveLocalPins(loadLocalPins().filter((p) => p.id !== pinId));
  }
  await loadAndRenderPins();
}

async function loadAndRenderPins() {
  pinsLayer.clearLayers();
  const pins = currentUser ? await fetchRemotePins() : loadLocalPins();
  for (const pin of pins) {
    const cat = PIN_CATEGORIES[pin.category] || PIN_CATEGORIES.other;
    const icon = L.divIcon({ className: "pin-marker", html: cat.icon, iconSize: [22, 22] });
    const marker = L.marker([pin.lat, pin.lon], { icon }).addTo(pinsLayer);
    const mine = pin.isMine !== false;
    const byLine = pin.createdByName ? `Added by ${escapeHtml(pin.createdByName)}` : "Added by you";
    marker.bindPopup(`
      <div class="pin-popup">
        <strong>${cat.icon} ${escapeHtml(pin.label)}</strong><br>
        ${cat.label}
        ${pin.notes ? `<br>${escapeHtml(pin.notes)}` : ""}
        ${pin.photoUrl ? `<img class="pin-photo-thumb" src="${pin.photoUrl}" alt="${escapeHtml(pin.label)}" />` : ""}
        <div class="pin-popup-meta">${byLine}</div>
        ${mine ? `<button type="button" class="pin-delete-btn" data-id="${pin.id}">Remove</button>` : ""}
      </div>
    `);
    marker.on("popupopen", () => {
      const btn = document.querySelector(`.pin-delete-btn[data-id="${pin.id}"]`);
      if (btn) btn.addEventListener("click", () => deletePin(pin.id));
    });
  }
}
loadAndRenderPins();

// ---------- boat launches (OpenStreetMap Overpass, no key needed) ----------
let launchLayer = null;

methodSelect.addEventListener("change", () => {
  boatLaunchTools.hidden = methodSelect.value !== "boat";
});

findLaunchesBtn.addEventListener("click", async () => {
  findLaunchesBtn.disabled = true;
  launchHint.textContent = "Searching OpenStreetMap for slipways, marinas and harbours in this view…";
  try {
    const b = leafletMap.getBounds();
    const bbox = `${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`;
    const query = `[out:json][timeout:25];(node["leisure"="slipway"](${bbox});way["leisure"="slipway"](${bbox});node["leisure"="marina"](${bbox});way["leisure"="marina"](${bbox});node["seamark:type"="harbour"](${bbox});way["seamark:type"="harbour"](${bbox}););out center;`;
    const res = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", body: query });
    if (!res.ok) throw new Error("Overpass query failed");
    const data = await res.json();
    renderLaunchPoints(data.elements || []);
  } catch (err) {
    launchHint.textContent = `Couldn't load launch points: ${err.message}`;
  } finally {
    findLaunchesBtn.disabled = false;
  }
});

function renderLaunchPoints(elements) {
  if (launchLayer) leafletMap.removeLayer(launchLayer);
  launchLayer = L.layerGroup();
  let count = 0;
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) continue;
    const tags = el.tags || {};
    const kind = tags.leisure === "marina" ? "Marina" : tags["seamark:type"] === "harbour" ? "Harbour" : "Slipway / boat launch";
    const name = tags.name || kind;
    const icon = L.divIcon({ className: "launch-marker", html: "⚓", iconSize: [20, 20] });
    L.marker([lat, lon], { icon }).addTo(launchLayer).bindPopup(`<strong>${escapeHtml(name)}</strong><br>${kind}`);
    count++;
  }
  launchLayer.addTo(leafletMap);
  launchHint.textContent =
    count > 0
      ? `Found ${count} launch point${count === 1 ? "" : "s"} in this view (from OpenStreetMap).`
      : "No mapped launch points in this view — try zooming out or panning, or check locally for informal put-ins.";
}

const suggestedSpotsEl = document.getElementById("suggestedSpots");

function renderSuggestedSpots() {
  const method = methodSelect.value;
  const spots = getSuggestedSpots(selectedSpecies, method);
  if (spots.length === 0) {
    suggestedSpotsEl.innerHTML = "";
    return;
  }
  const speciesLabels = selectedSpecies.map((s) => SPECIES_PROFILES[s].label).join(" / ");
  suggestedSpotsEl.innerHTML = `
    <div class="card suggested-card">
      <h3>Worth trying: ${speciesLabels} · ${METHOD_LABELS[method]}</h3>
      ${spots
        .map(
          (spot) => `
        <div class="spot-block">
          <strong>${escapeHtml(spot.name)}</strong>
          <p>${escapeHtml(spot.note)}</p>
          <div class="spot-actions">
            <button type="button" class="btn btn-secondary use-spot-btn" data-lat="${spot.lat}" data-lon="${spot.lon}" data-name="${escapeHtml(spot.name)}">Use this spot</button>
            <a class="spot-source" href="${spot.source}" target="_blank" rel="noopener">source</a>
          </div>
        </div>`
        )
        .join("")}
    </div>
  `;
  suggestedSpotsEl.querySelectorAll(".use-spot-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const lat = Number(btn.dataset.lat);
      const lon = Number(btn.dataset.lon);
      placeMarker(lat, lon);
      leafletMap.flyTo([lat, lon], 11);
      setSelectedLocation({ name: btn.dataset.name, lat, lon });
    });
  });
}

methodSelect.addEventListener("change", renderSuggestedSpots);
renderSuggestedSpots();

const regulationsCard = document.getElementById("regulationsCard");

function formatDateNice(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${months[m - 1]} ${y}`;
}

function renderRegulations() {
  const blocks = selectedSpecies
    .map((species) => {
      const reg = REGULATIONS[species];
      const speciesLabel = SPECIES_PROFILES[species].label;
      return `
      <div class="reg-species-block">
        <h4>${speciesLabel}</h4>
        ${reg.minSize ? `<div class="reg-row"><span class="reg-label">Minimum size</span><strong>${escapeHtml(reg.minSize)}</strong></div>` : ""}
        ${reg.dailyLimit ? `<div class="reg-row"><span class="reg-label">Daily limit</span><strong>${escapeHtml(reg.dailyLimit)}</strong></div>` : ""}
        <div class="reg-row"><span class="reg-label">Closed season</span><strong>${escapeHtml(reg.closedSeason)}</strong></div>
      </div>`;
    })
    .join("");
  regulationsCard.innerHTML = `
    <h3>⚖️ Rules (Estonia)</h3>
    ${blocks}
    <p class="hint">Rules last checked: ${formatDateNice(REGULATIONS_LAST_CHECKED)} · rechecked automatically on the 1st of each month.</p>
    <p class="reg-caveat">Water body and seasonal exceptions apply — this is a starting point, not legal advice.</p>
    <a class="btn btn-secondary reg-official-link" href="${REGULATIONS_SOURCE}" target="_blank" rel="noopener">📖 Check official rules for your exact spot on Keskkonnaamet →</a>
    <a class="btn btn-secondary reg-official-link" href="https://kalaluba.ee" target="_blank" rel="noopener">🎫 Buy your fishing card at kalaluba.ee →</a>
  `;
}

renderRegulations();

function setSelectedLocation(loc) {
  selectedLocation = loc;
  selectedLocationEl.hidden = false;
  const region = [loc.admin1, loc.country].filter(Boolean).join(", ");
  selectedLocationTextEl.textContent = `📍 ${loc.name}${region ? " — " + region : ""} (${loc.lat.toFixed(3)}, ${loc.lon.toFixed(3)})`;
  wazeLinkEl.href = `https://waze.com/ul?ll=${loc.lat},${loc.lon}&navigate=yes`;
  findBtn.disabled = false;
  planHint.textContent = "Ready — pick a species and find your window.";
}

searchBtn.addEventListener("click", async () => {
  const q = locationInput.value.trim();
  if (!q) return;
  locationResults.innerHTML = "<li>Searching…</li>";
  try {
    const results = await searchLocations(q);
    locationResults.innerHTML = "";
    if (results.length === 0) {
      locationResults.innerHTML = "<li>No matches found — try zooming/clicking the map instead.</li>";
      return;
    }
    for (const r of results) {
      const li = document.createElement("li");
      const region = [r.admin1, r.country].filter(Boolean).join(", ");
      li.textContent = `${r.name}${region ? " — " + region : ""}`;
      li.addEventListener("click", () => {
        placeMarker(r.latitude, r.longitude);
        leafletMap.flyTo([r.latitude, r.longitude], Math.max(leafletMap.getZoom(), 11));
        setSelectedLocation({ name: r.name, lat: r.latitude, lon: r.longitude, admin1: r.admin1, country: r.country });
        locationResults.innerHTML = "";
      });
      locationResults.appendChild(li);
    }
  } catch (err) {
    locationResults.innerHTML = `<li>Search failed: ${err.message}</li>`;
  }
});

locationInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    searchBtn.click();
  }
});

geoBtn.addEventListener("click", () => {
  if (!navigator.geolocation) {
    planHint.textContent = "Geolocation is not available in this browser.";
    return;
  }
  planHint.textContent = "Locating…";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      placeMarker(latitude, longitude);
      leafletMap.flyTo([latitude, longitude], Math.max(leafletMap.getZoom(), 12));
      setSelectedLocation({ name: "My location", lat: latitude, lon: longitude });
    },
    (err) => {
      planHint.textContent = `Could not get your location: ${err.message}`;
    }
  );
});

findBtn.addEventListener("click", async () => {
  if (!selectedLocation) return;
  findBtn.disabled = true;
  resultsArea.hidden = true;
  try {
    const species = selectedSpecies;
    const method = methodSelect.value;
    let picked;

    if (planMode === "date") {
      if (!dateInput.value) {
        planHint.textContent = "Pick a date first.";
        return;
      }
      const diff = daysFromToday(dateInput.value);
      if (diff < 0) {
        planHint.textContent = "That date has already passed — pick today or later.";
        return;
      }
      planHint.textContent = "Fetching forecast and scoring your day…";
      const days = clamp(diff + 1, 1, 16);
      const hourly = await fetchForecast(selectedLocation.lat, selectedLocation.lon, days);
      const windows = buildWindows(hourly, species, method);
      picked = pickRecommendationsForDay(windows, dateInput.value);
      if (!picked) {
        planHint.textContent = "Couldn't find forecast data for that date — try a closer date.";
        return;
      }
      topWindowHeadingEl.textContent = "Best window that day";
      otherWindowsHeadingEl.textContent = "Other good times that day";
    } else {
      planHint.textContent = "Fetching forecast and scoring windows…";
      const days = Number(daysSelect.value);
      const hourly = await fetchForecast(selectedLocation.lat, selectedLocation.lon, days);
      const windows = buildWindows(hourly, species, method);
      picked = pickRecommendations(windows);
      topWindowHeadingEl.textContent = "Best window";
      otherWindowsHeadingEl.textContent = "Other good days";
    }

    lastRecommendation = { ...picked, species, method, location: selectedLocation };
    renderRecommendation(lastRecommendation);
    planHint.textContent = "Done. Save the plan below to add it to My Trips.";
  } catch (err) {
    planHint.textContent = `Something went wrong: ${err.message}`;
  } finally {
    findBtn.disabled = false;
  }
});

function renderRecommendation(rec) {
  const { top, others, species, method } = rec;
  const speciesLabel = species.map((s) => SPECIES_PROFILES[s].label).join(" / ");
  const methodLabel = METHOD_LABELS[method];

  topWindowEl.innerHTML = `
    <div class="window-block">
      <div class="window-score">${top.score}<span style="font-size:14px;color:var(--text-dim)">/100</span></div>
      <div class="window-time">${formatWindowLabel(top.startTime, top.endTime)} — ${speciesLabel} · ${methodLabel}</div>
      <ul class="window-reasons">${top.reasons.map((r) => `<li>${r}</li>`).join("")}</ul>
    </div>
  `;

  otherWindowsEl.innerHTML = others
    .map(
      (w) => `
      <div class="window-block">
        <div class="window-score">${w.score}</div>
        <div class="window-time">${formatWindowLabel(w.startTime, w.endTime)}</div>
      </div>`
    )
    .join("");

  renderTackle(species, top.reasons);

  resultsArea.hidden = false;
}

function renderTackle(speciesList, reasons) {
  const blocks = speciesList
    .map((species) => {
      const rec = TACKLE_RECOMMENDATIONS[species];
      return `
      <div class="tackle-block">
        <h4>${SPECIES_PROFILES[species].label}</h4>
        <ul>${rec.lures.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>
        <p class="hint">${escapeHtml(rec.tip)}</p>
        ${rec.source ? `<a class="spot-source" href="${rec.source}" target="_blank" rel="noopener">source</a>` : ""}
      </div>`;
    })
    .join("");
  tackleCard.innerHTML = `
    <h3>Tackle</h3>
    ${blocks}
    <p class="tackle-tip">${escapeHtml(tackleColorTip(reasons))}</p>
  `;
}

saveTripBtn.addEventListener("click", async () => {
  if (!lastRecommendation) return;
  const { top, species, method, location } = lastRecommendation;
  const trip = {
    location,
    species,
    method,
    window: { start: top.startTime, end: top.endTime, score: top.score },
    reasons: top.reasons,
    status: "planned",
    log: null,
  };
  saveTripBtn.disabled = true;
  const errorMessage = await persistNewTrip(trip, shareWithCrewCheck.checked, respondByInput.value || null);
  saveTripBtn.disabled = false;
  if (errorMessage) {
    planHint.textContent = `Couldn't save: ${errorMessage}`;
    return;
  }
  await renderTrips();
  planHint.textContent = "Saved to My Trips.";
  switchTab("trips");
});

// ---------- trips storage (local) ----------
function loadLocalTrips() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveLocalTrips(trips) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trips));
}

function updateLocalTrip(id, patch) {
  const trips = loadLocalTrips();
  const idx = trips.findIndex((t) => t.id === id);
  if (idx === -1) return;
  trips[idx] = { ...trips[idx], ...patch };
  saveLocalTrips(trips);
}

function deleteLocalTrip(id) {
  const trips = loadLocalTrips().filter((t) => t.id !== id);
  saveLocalTrips(trips);
}

function withLocalTrip(tripId, mutate) {
  const trips = loadLocalTrips();
  const trip = trips.find((t) => t.id === tripId);
  if (!trip) return;
  mutate(trip);
  saveLocalTrips(trips);
}

function addLocalShoppingItem(tripId, label) {
  withLocalTrip(tripId, (trip) => {
    trip.shoppingList = trip.shoppingList || [];
    trip.shoppingList.push({ id: `item_${Date.now()}`, label, done: false });
  });
}

function toggleLocalShoppingItem(tripId, itemId) {
  withLocalTrip(tripId, (trip) => {
    const item = (trip.shoppingList || []).find((i) => i.id === itemId);
    if (item) item.done = !item.done;
  });
}

function removeLocalShoppingItem(tripId, itemId) {
  withLocalTrip(tripId, (trip) => {
    trip.shoppingList = (trip.shoppingList || []).filter((i) => i.id !== itemId);
  });
}

function addLocalExpense(tripId, label, amount) {
  withLocalTrip(tripId, (trip) => {
    trip.expenses = trip.expenses || [];
    trip.expenses.push({ id: `exp_${Date.now()}`, label, amount });
  });
}

function removeLocalExpense(tripId, expenseId) {
  withLocalTrip(tripId, (trip) => {
    trip.expenses = (trip.expenses || []).filter((e) => e.id !== expenseId);
  });
}

function getLocalTrip(tripId) {
  return loadLocalTrips().find((t) => t.id === tripId);
}

// ---------- trips storage (Supabase, used once logged in) ----------
async function fetchRemoteTrips() {
  const { data, error } = await supabaseClient.from("trips").select("*").order("created_at", { ascending: false });
  if (error) {
    console.error("fetchRemoteTrips", error);
    return [];
  }
  const rows = data || [];
  const ownerIds = [...new Set(rows.map((r) => r.user_id))];
  let namesById = {};
  if (ownerIds.length) {
    const { data: profs } = await supabaseClient.from("profiles").select("id, display_name").in("id", ownerIds);
    (profs || []).forEach((p) => {
      namesById[p.id] = p.display_name;
    });
  }
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    location: row.location,
    species: row.species,
    method: row.method,
    window: row.time_window,
    reasons: row.reasons,
    status: row.status,
    log: row.log,
    isMine: row.user_id === currentUser.id,
    ownerName: namesById[row.user_id],
    shared: row.shared,
    crewId: row.crew_id,
    respondBy: row.respond_by,
    isActive: row.is_active,
    shareToken: row.share_token,
  }));
}

async function getAllTrips() {
  if (currentUser) return fetchRemoteTrips();
  return loadLocalTrips();
}

async function persistNewTrip(trip, shareWithCrew, respondBy) {
  if (currentUser) {
    const { error } = await supabaseClient.from("trips").insert({
      user_id: currentUser.id,
      crew_id: currentCrew ? currentCrew.id : null,
      shared: !!shareWithCrew && !!currentCrew,
      respond_by: shareWithCrew && respondBy ? respondBy : null,
      location: trip.location,
      species: trip.species,
      method: trip.method,
      time_window: trip.window,
      reasons: trip.reasons,
      status: trip.status,
      log: trip.log,
    });
    return error ? error.message : null;
  }
  const trips = loadLocalTrips();
  trips.unshift({ ...trip, id: `trip_${Date.now()}`, createdAt: new Date().toISOString(), shoppingList: [], expenses: [] });
  saveLocalTrips(trips);
  return null;
}

async function persistTripLog(tripId, log) {
  if (currentUser) {
    const { error } = await supabaseClient.from("trips").update({ status: "logged", log }).eq("id", tripId);
    return error ? error.message : null;
  }
  updateLocalTrip(tripId, { status: "logged", log });
  return null;
}

async function persistDeleteTrip(tripId) {
  if (currentUser) {
    const { error } = await supabaseClient.from("trips").delete().eq("id", tripId);
    return error ? error.message : null;
  }
  deleteLocalTrip(tripId);
  return null;
}

// ---------- rendering: trips tab ----------
const tripsList = document.getElementById("tripsList");
const tripsEmpty = document.getElementById("tripsEmpty");
const tripCountEl = document.getElementById("tripCount");
const statsCard = document.getElementById("statsCard");
const tripCardTemplate = document.getElementById("tripCardTemplate");

function renderStats(trips) {
  const total = trips.length;
  const logged = trips.filter((t) => t.status === "logged").length;
  const went = trips.filter((t) => t.log && t.log.went).length;
  const caught = trips.filter((t) => t.log && t.log.caught).length;
  const catchRate = went > 0 ? Math.round((caught / went) * 100) : null;

  statsCard.innerHTML = `
    <div class="stat"><div class="stat-value">${total}</div><div class="stat-label">Trips planned</div></div>
    <div class="stat"><div class="stat-value">${logged}</div><div class="stat-label">Logged</div></div>
    <div class="stat"><div class="stat-value">${catchRate === null ? "—" : catchRate + "%"}</div><div class="stat-label">Catch rate</div></div>
  `;
}

async function renderTrips() {
  const trips = await getAllTrips();
  tripCountEl.textContent = trips.length;
  renderStats(trips);
  tripsList.innerHTML = "";
  tripsEmpty.hidden = trips.length !== 0;

  const myActiveTrip = trips.find((t) => t.isMine !== false && t.isActive);
  if (myActiveTrip) startLiveTracking(myActiveTrip.id);
  else stopLiveTracking();

  for (const trip of trips) {
    const mine = trip.isMine !== false;
    const node = tripCardTemplate.content.cloneNode(true);
    const card = node.querySelector(".trip-card");
    const region = [trip.location.admin1, trip.location.country].filter(Boolean).join(", ");
    node.querySelector(".trip-location").textContent = `${trip.location.name}${region ? " — " + region : ""}`;
    const tripSpeciesList = Array.isArray(trip.species) ? trip.species : [trip.species];
    node.querySelector(".trip-species").textContent = tripSpeciesList.map((s) => SPECIES_PROFILES[s].label).join(" / ");
    node.querySelector(".trip-method").textContent = trip.method ? ` · ${METHOD_LABELS[trip.method]}` : "";
    node.querySelector(".trip-owner").textContent = mine ? "" : ` · shared by ${trip.ownerName || "a crewmate"}`;
    node.querySelector(".trip-window").textContent = `${formatWindowLabel(trip.window.start, trip.window.end)} · predicted score ${trip.window.score}/100`;
    node.querySelector(".trip-explanation").textContent = trip.reasons.slice(0, 2).join(" ");

    const badge = node.querySelector(".status-badge");
    badge.textContent = trip.status === "logged" ? "Logged" : "Planned";
    if (trip.status === "logged") badge.classList.add("logged");

    const logBtn = node.querySelector(".log-btn");
    const logFormWrap = node.querySelector(".log-form");
    const logSummaryWrap = node.querySelector(".log-summary");
    const deleteBtn = node.querySelector(".delete-btn");

    if (trip.status === "logged") {
      logBtn.textContent = "Edit log";
      logSummaryWrap.hidden = false;
      logSummaryWrap.innerHTML = renderLogSummary(trip.log);
    }

    if (!mine) {
      logBtn.hidden = true;
      deleteBtn.hidden = true;
    }

    logBtn.addEventListener("click", () => {
      const isOpen = !logFormWrap.hidden;
      logFormWrap.hidden = isOpen;
      if (!isOpen) {
        logFormWrap.innerHTML = renderLogForm(trip);
        wireLogForm(logFormWrap, trip.id);
      }
    });

    deleteBtn.addEventListener("click", async () => {
      if (confirm("Delete this trip?")) {
        await persistDeleteTrip(trip.id);
        await renderTrips();
      }
    });

    const detailsBtn = node.querySelector(".details-btn");
    const detailsWrap = node.querySelector(".trip-details");
    let detailsLoaded = false;
    detailsBtn.addEventListener("click", async () => {
      const isOpen = !detailsWrap.hidden;
      detailsWrap.hidden = isOpen;
      if (!isOpen && !detailsLoaded) {
        detailsLoaded = true;
        if (currentUser) {
          await renderRemoteDetails(detailsWrap, trip);
        } else {
          renderLocalDetails(detailsWrap, trip);
        }
      }
    });

    tripsList.appendChild(node);
  }
}

const tripDetailsTemplate = document.getElementById("tripDetailsTemplate");

// ---------- trip details: local (solo, browser-only trips) ----------
function renderLocalDetails(container, trip) {
  const node = tripDetailsTemplate.content.cloneNode(true);
  node.querySelector(".rsvp-section").remove(); // RSVP needs a crew, which requires login

  const shoppingListEl = node.querySelector(".shopping-list");
  const shoppingInput = node.querySelector(".shopping-input");
  const shoppingAddBtn = node.querySelector(".shopping-add-btn");
  const expenseListEl = node.querySelector(".expense-list");
  const expenseLabelInput = node.querySelector(".expense-label");
  const expenseAmountInput = node.querySelector(".expense-amount");
  const expenseAddBtn = node.querySelector(".expense-add-btn");
  const expenseSummaryEl = node.querySelector(".expense-summary");

  function repaint() {
    const fresh = getLocalTrip(trip.id) || trip;
    const shoppingList = fresh.shoppingList || [];
    const expenses = fresh.expenses || [];

    shoppingListEl.innerHTML =
      shoppingList
        .map(
          (item) => `
      <li class="${item.done ? "done" : ""}" data-id="${item.id}">
        <input type="checkbox" class="shopping-check" ${item.done ? "checked" : ""} />
        <span>${escapeHtml(item.label)}</span>
        <button type="button" class="remove-item-btn shopping-remove" data-id="${item.id}">✕</button>
      </li>`
        )
        .join("") || `<li class="hint">Nothing added yet.</li>`;

    expenseListEl.innerHTML =
      expenses
        .map(
          (exp) => `
      <li data-id="${exp.id}">
        <span class="exp-label">${escapeHtml(exp.label)}</span>
        <span class="exp-amount">€${exp.amount.toFixed(2)}</span>
        <button type="button" class="remove-item-btn expense-remove" data-id="${exp.id}">✕</button>
      </li>`
        )
        .join("") || `<li class="hint">No costs logged yet.</li>`;

    const total = expenses.reduce((sum, e) => sum + e.amount, 0);
    expenseSummaryEl.textContent = total > 0 ? `Total: €${total.toFixed(2)}` : "";

    shoppingListEl.querySelectorAll(".shopping-check").forEach((cb) => {
      cb.addEventListener("change", () => {
        toggleLocalShoppingItem(trip.id, cb.closest("li").dataset.id);
        repaint();
      });
    });
    shoppingListEl.querySelectorAll(".shopping-remove").forEach((btn) => {
      btn.addEventListener("click", () => {
        removeLocalShoppingItem(trip.id, btn.dataset.id);
        repaint();
      });
    });
    expenseListEl.querySelectorAll(".expense-remove").forEach((btn) => {
      btn.addEventListener("click", () => {
        removeLocalExpense(trip.id, btn.dataset.id);
        repaint();
      });
    });
  }

  shoppingAddBtn.addEventListener("click", () => {
    const label = shoppingInput.value.trim();
    if (!label) return;
    addLocalShoppingItem(trip.id, label);
    shoppingInput.value = "";
    repaint();
  });

  expenseAddBtn.addEventListener("click", () => {
    const label = expenseLabelInput.value.trim();
    const amount = Number(expenseAmountInput.value);
    if (!label || !amount || amount <= 0) return;
    addLocalExpense(trip.id, label, amount);
    expenseLabelInput.value = "";
    expenseAmountInput.value = "";
    repaint();
  });

  container.innerHTML = "";
  container.appendChild(node);
  repaint();
}

// ---------- trip details: remote (Supabase-backed, shareable with crew) ----------
async function loadAndRenderRsvp(trip, deadlineEl, tallyEl, buttons) {
  deadlineEl.textContent = trip.respondBy ? `Respond by ${trip.respondBy}` : "";
  const { data } = await supabaseClient.from("trip_responses").select("user_id, response").eq("trip_id", trip.id);
  const responses = data || [];
  const counts = { accept: 0, maybe: 0, decline: 0 };
  responses.forEach((r) => {
    if (counts[r.response] !== undefined) counts[r.response]++;
  });
  tallyEl.textContent = `✅ ${counts.accept} · ❔ ${counts.maybe} · ❌ ${counts.decline}`;
  const mine = responses.find((r) => r.user_id === currentUser.id);
  buttons.forEach((btn) => {
    btn.classList.toggle("active", !!mine && mine.response === btn.dataset.response);
  });
}

// ---------- active trip: live location sharing (safety) ----------
let activeWatchId = null;
let activeTripId = null;
let lastLiveWriteAt = 0;

function shareUrl(token) {
  return `${window.location.origin}${window.location.pathname}?share=${token}`;
}

function startLiveTracking(tripId) {
  if (activeTripId === tripId && activeWatchId !== null) return;
  stopLiveTracking();
  if (!navigator.geolocation) return;
  activeTripId = tripId;
  activeWatchId = navigator.geolocation.watchPosition(
    async (pos) => {
      const now = Date.now();
      if (now - lastLiveWriteAt < 20000) return;
      lastLiveWriteAt = now;
      await supabaseClient
        .from("trips")
        .update({ live_lat: pos.coords.latitude, live_lon: pos.coords.longitude, live_updated_at: new Date().toISOString() })
        .eq("id", tripId);
    },
    (err) => console.error("watchPosition error", err),
    { enableHighAccuracy: false, maximumAge: 15000, timeout: 20000 }
  );
}

function stopLiveTracking() {
  if (activeWatchId !== null) navigator.geolocation.clearWatch(activeWatchId);
  activeWatchId = null;
  activeTripId = null;
}

function renderLiveSection(container, trip) {
  const section = document.createElement("div");
  section.className = "details-section live-section";
  if (trip.isActive) {
    section.innerHTML = `
      <h4>Live sharing (safety)</h4>
      <p class="hint">Trip is active — sharing your live location with anyone who has this link. Treat it like a password; anyone with it can see where you are.</p>
      <div class="share-link-row">
        <input type="text" class="share-link-input" readonly value="${shareUrl(trip.shareToken)}" />
        <button type="button" class="btn btn-secondary copy-share-btn">Copy link</button>
      </div>
      <button type="button" class="btn btn-secondary quick-report-btn">📸 Quick report from here</button>
      <button type="button" class="btn btn-danger end-trip-btn">⏹ End Trip</button>
    `;
    container.appendChild(section);
    section.querySelector(".copy-share-btn").addEventListener("click", () => {
      navigator.clipboard.writeText(shareUrl(trip.shareToken)).then(() => {
        section.querySelector(".copy-share-btn").textContent = "Copied!";
      });
    });
    section.querySelector(".quick-report-btn").addEventListener("click", () => {
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          switchTab("plan");
          pinMode = true;
          pinModeBtn.classList.add("active");
          startPinAt(pos.coords.latitude, pos.coords.longitude);
        },
        (err) => {
          pinFormHint.textContent = "";
          alert(`Could not get your location: ${err.message}`);
        }
      );
    });
    section.querySelector(".end-trip-btn").addEventListener("click", async () => {
      stopLiveTracking();
      await supabaseClient.from("trips").update({ is_active: false }).eq("id", trip.id);
      await renderTrips();
    });
  } else {
    section.innerHTML = `
      <h4>Live sharing (safety)</h4>
      <p class="hint">Starting shares a private link with whoever you send it to — they see your live location with no account needed. Anyone with the link can view it, so only send it to people you trust.</p>
      <button type="button" class="btn btn-primary start-trip-btn">▶️ Start Trip</button>
    `;
    container.appendChild(section);
    section.querySelector(".start-trip-btn").addEventListener("click", async () => {
      const token = crypto.randomUUID();
      await supabaseClient.from("trips").update({ is_active: true, share_token: token }).eq("id", trip.id);
      startLiveTracking(trip.id);
      await renderTrips();
    });
  }
}

async function renderRemoteDetails(container, trip) {
  const node = tripDetailsTemplate.content.cloneNode(true);
  const rsvpSection = node.querySelector(".rsvp-section");
  const rsvpDeadline = node.querySelector(".rsvp-deadline");
  const rsvpTally = node.querySelector(".rsvp-tally");
  const rsvpButtons = node.querySelectorAll(".rsvp-btn");
  const shoppingListEl = node.querySelector(".shopping-list");
  const shoppingInput = node.querySelector(".shopping-input");
  const shoppingAddBtn = node.querySelector(".shopping-add-btn");
  const expenseListEl = node.querySelector(".expense-list");
  const expenseLabelInput = node.querySelector(".expense-label");
  const expenseAmountInput = node.querySelector(".expense-amount");
  const expenseAddBtn = node.querySelector(".expense-add-btn");
  const expenseSummaryEl = node.querySelector(".expense-summary");

  container.innerHTML = "";
  container.appendChild(node);

  if (trip.isMine !== false) {
    renderLiveSection(container, trip);
  }

  if (trip.shared) {
    rsvpSection.hidden = false;
    await loadAndRenderRsvp(trip, rsvpDeadline, rsvpTally, rsvpButtons);
    rsvpButtons.forEach((btn) => {
      btn.addEventListener("click", async () => {
        await supabaseClient.from("trip_responses").upsert({ trip_id: trip.id, user_id: currentUser.id, response: btn.dataset.response });
        await loadAndRenderRsvp(trip, rsvpDeadline, rsvpTally, rsvpButtons);
      });
    });
  }

  async function repaintShopping() {
    const { data } = await supabaseClient.from("trip_shopping_items").select("*").eq("trip_id", trip.id).order("created_at");
    const items = data || [];
    shoppingListEl.innerHTML =
      items
        .map(
          (item) => `
      <li class="${item.done ? "done" : ""}" data-id="${item.id}">
        <input type="checkbox" class="shopping-check" ${item.done ? "checked" : ""} />
        <span>${escapeHtml(item.label)}</span>
        <button type="button" class="remove-item-btn shopping-remove" data-id="${item.id}">✕</button>
      </li>`
        )
        .join("") || `<li class="hint">Nothing added yet.</li>`;

    shoppingListEl.querySelectorAll(".shopping-check").forEach((cb) => {
      cb.addEventListener("change", async () => {
        await supabaseClient.from("trip_shopping_items").update({ done: cb.checked }).eq("id", cb.closest("li").dataset.id);
        await repaintShopping();
      });
    });
    shoppingListEl.querySelectorAll(".shopping-remove").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await supabaseClient.from("trip_shopping_items").delete().eq("id", btn.dataset.id);
        await repaintShopping();
      });
    });
  }

  shoppingAddBtn.addEventListener("click", async () => {
    const label = shoppingInput.value.trim();
    if (!label) return;
    await supabaseClient.from("trip_shopping_items").insert({ trip_id: trip.id, label, added_by: currentUser.id });
    shoppingInput.value = "";
    await repaintShopping();
  });

  async function repaintExpenses() {
    const { data } = await supabaseClient.from("trip_expenses").select("*").eq("trip_id", trip.id).order("created_at");
    const expenses = data || [];
    const payerIds = [...new Set(expenses.map((e) => e.paid_by))];
    let namesById = {};
    if (payerIds.length) {
      const { data: profs } = await supabaseClient.from("profiles").select("id, display_name").in("id", payerIds);
      (profs || []).forEach((p) => {
        namesById[p.id] = p.display_name;
      });
    }

    expenseListEl.innerHTML =
      expenses
        .map(
          (exp) => `
      <li data-id="${exp.id}">
        <span class="exp-label">${escapeHtml(exp.label)}<span class="exp-payer"> — paid by ${escapeHtml(namesById[exp.paid_by] || "someone")}</span></span>
        <span class="exp-amount">€${Number(exp.amount).toFixed(2)}</span>
        ${exp.paid_by === currentUser.id ? `<button type="button" class="remove-item-btn expense-remove" data-id="${exp.id}">✕</button>` : ""}
      </li>`
        )
        .join("") || `<li class="hint">No costs logged yet.</li>`;

    expenseListEl.querySelectorAll(".expense-remove").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await supabaseClient.from("trip_expenses").delete().eq("id", btn.dataset.id);
        await repaintExpenses();
      });
    });

    const total = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
    if (total === 0) {
      expenseSummaryEl.textContent = "";
      return;
    }

    const { data: responses } = await supabaseClient.from("trip_responses").select("user_id, response").eq("trip_id", trip.id);
    let participantIds = (responses || []).filter((r) => r.response === "accept").map((r) => r.user_id);
    if (participantIds.length === 0) participantIds = [...new Set([currentUser.id, ...payerIds])];
    const share = total / participantIds.length;

    const paidByUser = {};
    expenses.forEach((e) => {
      paidByUser[e.paid_by] = (paidByUser[e.paid_by] || 0) + Number(e.amount);
    });

    const allIds = [...new Set([...participantIds, ...Object.keys(paidByUser)])];
    const missing = allIds.filter((id) => !namesById[id]);
    if (missing.length) {
      const { data: profs2 } = await supabaseClient.from("profiles").select("id, display_name").in("id", missing);
      (profs2 || []).forEach((p) => {
        namesById[p.id] = p.display_name;
      });
    }

    const lines = allIds.map((id) => {
      const paid = paidByUser[id] || 0;
      const owedShare = participantIds.includes(id) ? share : 0;
      const net = paid - owedShare;
      const who = id === currentUser.id ? "You" : namesById[id] || "Someone";
      if (Math.abs(net) < 0.01) return `${who}: settled up`;
      return net > 0 ? `${who}: is owed €${net.toFixed(2)}` : `${who}: owes €${Math.abs(net).toFixed(2)}`;
    });
    expenseSummaryEl.innerHTML = `Total €${total.toFixed(2)}, split ${participantIds.length} ways (€${share.toFixed(2)} each)<br>${lines.join("<br>")}`;
  }

  expenseAddBtn.addEventListener("click", async () => {
    const label = expenseLabelInput.value.trim();
    const amount = Number(expenseAmountInput.value);
    if (!label || !amount || amount <= 0) return;
    await supabaseClient.from("trip_expenses").insert({ trip_id: trip.id, label, amount, paid_by: currentUser.id });
    expenseLabelInput.value = "";
    expenseAmountInput.value = "";
    await repaintExpenses();
  });

  await repaintShopping();
  await repaintExpenses();
}

function renderLogSummary(log) {
  if (!log.went) {
    return `<strong>Didn't make it out.</strong> ${log.notes ? escapeHtml(log.notes) : ""}`;
  }
  const catchLine = log.caught
    ? `Caught ${log.count || "some"} ${log.caughtSpecies ? SPECIES_PROFILES[log.caughtSpecies]?.label || log.caughtSpecies : "fish"}${log.size ? `, biggest ${log.size} cm` : ""}.`
    : "No catch this time.";
  const stars = "★".repeat(log.rating || 0) + "☆".repeat(5 - (log.rating || 0));
  return `<strong>Went fishing.</strong> ${catchLine} Accuracy rating: ${stars}${log.notes ? `<br>${escapeHtml(log.notes)}` : ""}`;
}

function renderLogForm(trip) {
  const existing = trip.log || {};
  const speciesOptions = Object.entries(SPECIES_PROFILES)
    .map(([key, p]) => `<option value="${key}" ${existing.caughtSpecies === key ? "selected" : ""}>${p.label}</option>`)
    .join("");

  return `
    <label>Did you go?</label>
    <select class="f-went">
      <option value="yes" ${existing.went ? "selected" : ""}>Yes</option>
      <option value="no" ${existing.went === false ? "selected" : ""}>No</option>
    </select>

    <div class="went-fields" ${existing.went === false ? "hidden" : ""}>
      <label>Did you catch anything?</label>
      <select class="f-caught">
        <option value="yes" ${existing.caught ? "selected" : ""}>Yes</option>
        <option value="no" ${existing.caught === false ? "selected" : ""}>No</option>
      </select>
      <div class="row2">
        <div>
          <label>Species caught</label>
          <select class="f-caught-species">${speciesOptions}</select>
        </div>
        <div>
          <label>Count</label>
          <input type="text" class="f-count" value="${existing.count || ""}" placeholder="e.g. 3" />
        </div>
        <div>
          <label>Biggest (cm)</label>
          <input type="text" class="f-size" value="${existing.size || ""}" placeholder="e.g. 62" />
        </div>
      </div>
      <label>How accurate was the recommendation?</label>
      <div class="star-rating" data-rating="${existing.rating || 0}">
        ${[1, 2, 3, 4, 5].map((n) => `<span data-n="${n}">${n <= (existing.rating || 0) ? "★" : "☆"}</span>`).join("")}
      </div>
    </div>

    <label>Notes</label>
    <textarea class="f-notes" placeholder="Conditions, what worked, what to try next time...">${existing.notes ? escapeHtml(existing.notes) : ""}</textarea>
    <button class="btn btn-primary f-save">Save log</button>
  `;
}

function wireLogForm(container, tripId) {
  const wentSelect = container.querySelector(".f-went");
  const wentFields = container.querySelector(".went-fields");
  wentSelect.addEventListener("change", () => {
    wentFields.hidden = wentSelect.value === "no";
  });

  const stars = container.querySelector(".star-rating");
  let rating = Number(stars.dataset.rating) || 0;
  stars.querySelectorAll("span").forEach((span) => {
    span.addEventListener("click", () => {
      rating = Number(span.dataset.n);
      stars.dataset.rating = rating;
      stars.querySelectorAll("span").forEach((s) => {
        s.textContent = Number(s.dataset.n) <= rating ? "★" : "☆";
      });
    });
  });

  container.querySelector(".f-save").addEventListener("click", async () => {
    const went = wentSelect.value === "yes";
    const log = {
      went,
      caught: went ? container.querySelector(".f-caught").value === "yes" : false,
      caughtSpecies: went ? container.querySelector(".f-caught-species").value : null,
      count: went ? container.querySelector(".f-count").value : "",
      size: went ? container.querySelector(".f-size").value : "",
      rating: went ? Number(stars.dataset.rating) || 0 : 0,
      notes: container.querySelector(".f-notes").value,
    };
    await persistTripLog(tripId, log);
    await renderTrips();
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------- account: auth ----------
const loggedOutView = document.getElementById("loggedOutView");
const loggedInView = document.getElementById("loggedInView");
const crewSection = document.getElementById("crewSection");
const authFormTitle = document.getElementById("authFormTitle");
const displayNameField = document.getElementById("displayNameField");
const displayNameInput = document.getElementById("displayNameInput");
const emailInput = document.getElementById("emailInput");
const passwordInput = document.getElementById("passwordInput");
const authSubmitBtn = document.getElementById("authSubmitBtn");
const authHint = document.getElementById("authHint");
const authToggleBtn = document.getElementById("authToggleBtn");
const accountEmail = document.getElementById("accountEmail");
const logoutBtn = document.getElementById("logoutBtn");
const shareWithCrewRow = document.getElementById("shareWithCrewRow");
const shareWithCrewCheck = document.getElementById("shareWithCrewCheck");

shareWithCrewCheck.addEventListener("change", () => {
  respondByRow.hidden = !shareWithCrewCheck.checked;
});

let authMode = "login";
let pendingDisplayName = "";

authToggleBtn.addEventListener("click", () => {
  authMode = authMode === "login" ? "signup" : "login";
  displayNameField.hidden = authMode !== "signup";
  authFormTitle.textContent = authMode === "login" ? "Log in" : "Sign up";
  authSubmitBtn.textContent = authMode === "login" ? "Log in" : "Sign up";
  authToggleBtn.textContent = authMode === "login" ? "Need an account? Sign up" : "Already have an account? Log in";
  authHint.textContent = "";
});

authSubmitBtn.addEventListener("click", async () => {
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  if (!email || !password) {
    authHint.textContent = "Enter an email and password.";
    return;
  }
  authSubmitBtn.disabled = true;
  authHint.textContent = authMode === "login" ? "Logging in…" : "Signing up…";
  try {
    if (authMode === "signup") {
      // Stashed for ensureProfile() — signUp usually has no session yet (email confirmation
      // pending), and RLS requires a real session before a profile row can be inserted.
      pendingDisplayName = displayNameInput.value.trim() || email.split("@")[0];
      const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.href },
      });
      if (error) throw error;
      authHint.textContent = data.session ? "" : "Check your email to confirm your account, then log in.";
    } else {
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      authHint.textContent = "";
    }
  } catch (err) {
    authHint.textContent = err.message;
  } finally {
    authSubmitBtn.disabled = false;
  }
});

logoutBtn.addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
});

function updateAuthUI() {
  loggedOutView.hidden = !!currentUser;
  loggedInView.hidden = !currentUser;
  crewSection.hidden = !currentUser;
  if (currentUser) accountEmail.textContent = currentUser.email;
  shareWithCrewRow.hidden = !(currentUser && currentCrew);
}

// ---------- account: crew ----------
const noCrewView = document.getElementById("noCrewView");
const hasCrewView = document.getElementById("hasCrewView");
const crewNameInput = document.getElementById("crewNameInput");
const createCrewBtn = document.getElementById("createCrewBtn");
const joinCodeInput = document.getElementById("joinCodeInput");
const joinCrewBtn = document.getElementById("joinCrewBtn");
const crewHint = document.getElementById("crewHint");
const crewNameDisplay = document.getElementById("crewNameDisplay");
const crewInviteCode = document.getElementById("crewInviteCode");

createCrewBtn.addEventListener("click", async () => {
  const name = crewNameInput.value.trim();
  if (!name) {
    crewHint.textContent = "Enter a crew name.";
    return;
  }
  createCrewBtn.disabled = true;
  crewHint.textContent = "Creating…";
  try {
    const { error } = await supabaseClient.rpc("create_crew", { crew_name: name });
    if (error) throw error;
    await refreshCrew();
    crewHint.textContent = "";
  } catch (err) {
    crewHint.textContent = err.message;
  } finally {
    createCrewBtn.disabled = false;
  }
});

joinCrewBtn.addEventListener("click", async () => {
  const code = joinCodeInput.value.trim();
  if (!code) {
    crewHint.textContent = "Enter an invite code.";
    return;
  }
  joinCrewBtn.disabled = true;
  crewHint.textContent = "Joining…";
  try {
    const { error } = await supabaseClient.rpc("join_crew_by_code", { code });
    if (error) throw error;
    await refreshCrew();
    crewHint.textContent = "";
  } catch (err) {
    crewHint.textContent = err.message;
  } finally {
    joinCrewBtn.disabled = false;
  }
});

async function refreshCrew() {
  currentCrew = null;
  if (currentUser) {
    const { data: memberships } = await supabaseClient.from("crew_members").select("crew_id").eq("user_id", currentUser.id).limit(1);
    if (memberships && memberships.length > 0) {
      const { data: crew } = await supabaseClient.from("crews").select("id, name, invite_code").eq("id", memberships[0].crew_id).single();
      if (crew) currentCrew = { id: crew.id, name: crew.name, inviteCode: crew.invite_code };
    }
  }
  updateCrewUI();
}

function updateCrewUI() {
  noCrewView.hidden = !!currentCrew;
  hasCrewView.hidden = !currentCrew;
  if (currentCrew) {
    crewNameDisplay.textContent = currentCrew.name;
    crewInviteCode.textContent = currentCrew.inviteCode;
  }
  shareWithCrewRow.hidden = !(currentUser && currentCrew);
}

async function ensureProfile() {
  if (!currentUser) return;
  const { data } = await supabaseClient.from("profiles").select("id").eq("id", currentUser.id).maybeSingle();
  if (!data) {
    const displayName = pendingDisplayName || currentUser.email.split("@")[0];
    await supabaseClient.from("profiles").insert({ id: currentUser.id, display_name: displayName });
    pendingDisplayName = "";
  }
}

supabaseClient.auth.onAuthStateChange((event, session) => {
  currentUser = session ? session.user : null;
  updateAuthUI();
  ensureProfile()
    .then(refreshCrew)
    .then(() => renderTrips())
    .then(() => loadAndRenderPins());
});

// ---------- tabs ----------
function switchTab(name) {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === name);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `tab-${name}`);
  });
  if (name === "plan" && leafletMap) {
    setTimeout(() => leafletMap.invalidateSize(), 50);
  }
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

// ---------- public share view (opened via ?share=TOKEN, no login) ----------
function formatMinsAgo(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1 minute ago";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
}

function initShareView(token) {
  document.getElementById("shareView").hidden = false;
  const shareMap = L.map("shareMap").setView([58.6, 25.0], 7);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(shareMap);
  let shareMarker = null;
  const labelEl = document.getElementById("shareTripLabel");
  const statusEl = document.getElementById("shareStatus");
  const updatedEl = document.getElementById("shareUpdated");

  async function refresh() {
    const { data, error } = await supabaseClient.rpc("get_shared_trip_location", { token });
    const row = data && data[0];
    if (error || !row) {
      updatedEl.textContent = "This link isn't valid.";
      return;
    }
    labelEl.textContent = row.label || "Live location";
    statusEl.textContent = row.is_active ? "Active" : "Trip ended";
    statusEl.classList.toggle("logged", row.is_active);
    if (row.lat == null || row.lon == null) {
      updatedEl.textContent = "No location shared yet.";
      return;
    }
    if (shareMarker) shareMarker.setLatLng([row.lat, row.lon]);
    else {
      shareMarker = L.marker([row.lat, row.lon]).addTo(shareMap);
      shareMap.setView([row.lat, row.lon], 13);
    }
    updatedEl.textContent = `Last updated ${formatMinsAgo(row.updated_at)}`;
  }

  refresh();
  setInterval(refresh, 20000);
}

// ---------- init ----------
const shareToken = new URLSearchParams(window.location.search).get("share");
if (shareToken) {
  initShareView(shareToken);
} else {
  renderTrips();
}
