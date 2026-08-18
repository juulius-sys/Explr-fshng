# Explr Fshng — backlog / next up

## Open items

- **More language options** — UI currently English-only (with Estonian species
  names in parens). Need to decide: full i18n (EN/ET toggle, maybe more) vs.
  just expanding the existing bilingual labels.

- **Cost calculator rework, Splitwise-style.** Current version auto-splits
  every expense evenly across everyone who RSVP'd "accept." Wanted instead:
  - Whoever adds a cost item specifies *who it's split between* (not just
    an even split across all "accepted" people).
  - Each included person **confirms** the charge applies to them, rather
    than being silently included.
  - Likely needs: a `trip_expense_shares` table (expense_id, user_id,
    confirmed boolean) instead of computing the split purely client-side.
    Net balance should sum confirmed shares only, with a visible "pending
    confirmation" state for shares not yet confirmed.

- **Photo-GPS-mined spots / live forum-scraped tackle** — explicitly decided
  NOT to build (no accessible API for either without a much bigger backend +
  AI investment). Keep extending the curated, sourced datasets instead
  (`RESEARCHED_SPOTS`, `TACKLE_RECOMMENDATIONS` in `app.js`) if more
  coverage is wanted.

## Already shipped

- **Core planner**: map-based location picking (click/drag pin, search just
  jumps the map), fishing method (shore/wading/kayak/boat) with method-aware
  wind scoring, specific-date or best-day-this-week planning, weather-based
  recommendation engine with real explained reasons (pressure trend, wind,
  cloud cover, dawn/dusk, rain, **lunar phase** — new/full moon bonus,
  verified accurate to <2h against a real sourced full moon date).
- **Boat launches**: live OpenStreetMap Overpass lookup for slipways/
  marinas/harbours in the current map view.
- **Suggested spots**: curated, sourced Estonian fishing locations, filtered
  by species + method.
- **Tackle recommendations**: curated, sourced lure suggestions per species,
  plus a condition-aware color tip derived from the actual computed window.
- **Fishing regulations**: per-species min size / daily limit / closed
  season, sourced from Estonia's Environmental Board (Keskkonnaamet), with
  a "last checked" date and links to the official source + kalaluba.ee.
  **Kept fresh automatically** — a monthly cloud routine (1st of each
  month) re-checks the source and updates only what's genuinely changed.
  Routine: https://claude.ai/code/routines/trig_015HpeMUBCoouLBeU191mbX1
- **Map pins**: shared crew layer — fishing spots, boat launches, closed
  roads, bait shops, hazards, other. Local-only when not logged in.
- **Accounts + crews**: Supabase auth (email/password), invite-code crews,
  trips sync to Supabase and can be shared with your crew.
- **Trip collaboration**: RSVP (accept/decline/maybe) with an optional
  deadline, shared shopping list, cost split (see rework item above).
- **Multi-species targeting**: pick more than one target species at once,
  with a ⭐ favorites system (favorited species sort to the top). Scoring
  blends per-hour scores across all picked species; tackle and regulations
  render one block per species. Sidecatch note shows likely bycatch based
  on real habitat overlap (`SIDECATCHES` in `app.js`).
- **Plan form reorder**: method → species → location (with a Waze
  deep-link to start driving there) → rules → when → find. "Worth trying"
  spots moved to the bottom.
- **Active Trip mode**: "Start Trip" begins live location tracking and
  generates a secret share link — family/friends open it and see a live
  map, no account needed. Access is controlled by the link being an
  unguessable token, not a login (deliberate tradeoff, confirmed with the
  user). "Quick report" grabs live GPS and opens the pin form for
  in-the-field reports (closed road, catch, pollution, environment
  change), reusing the map-pin system rather than a parallel one. Pins
  can now carry an optional photo (Supabase Storage, public bucket).

## Reference

- Web app at `D:\Explr\apps\web`, deployed to
  https://juulius-sys.github.io/Explr-fshng/ (separate git repo at that
  path, pushed to github.com/juulius-sys/Explr-fshng).
- Supabase backend (juulius-sys's project, URL/key in `supabase-config.js`)
  handles auth, crews, trips, RSVP, shopping list, cost split, map pins,
  live location sharing, and pin photo storage.
- SQL files must be run in order on any fresh Supabase project:
  `supabase-setup.sql` → `supabase-fix-rls.sql` → `supabase-trip-extras.sql`
  → `supabase-map-pins.sql` → `supabase-multi-species.sql` →
  `supabase-active-trip.sql`.
- `index.html` script/style tags carry a `?v=YYYYMMDDx` cache-busting
  query string — bump it whenever `app.js`/`style.css` change, or
  browsers can silently keep serving stale code after a deploy (this bit
  us once already this session).
- Local dev: `py -m http.server 8642` from `apps/web`, or use the
  `.claude/launch.json` "explr-web" preview config.
