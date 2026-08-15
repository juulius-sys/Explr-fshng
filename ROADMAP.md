# Explr Fshng — backlog / next up

## In progress discussion (2026-08-13)

- **More language options** — UI currently English-only (with Estonian species
  names in parens). Need to decide: full i18n (EN/ET toggle, maybe more) vs.
  just expanding the existing bilingual labels.

- **Cost calculator rework, Splitwise-style.** Current version (see
  `renderRemoteDetails` in `app.js`) auto-splits every expense evenly across
  everyone who RSVP'd "accept." User wants something closer to real Splitwise
  logic instead:
  - Whoever adds a cost item should specify *who it's split between*
    (not just an even split across all "accepted" people).
  - The people included in that split should each get to **confirm** the
    charge applies to them (not silently included).
  - Likely needs: a `trip_expense_shares` table (expense_id, user_id,
    confirmed boolean) instead of computing the split purely client-side from
    RSVP status. Net balance calculation should sum confirmed shares only,
    with a "pending confirmation" state shown for shares not yet confirmed.

## Already shipped (context for next session)

- Web app at `D:\Explr\apps\web`, deployed to
  https://juulius-sys.github.io/Explr-fshng/ (separate git repo at that path,
  pushed to github.com/juulius-sys/Explr-fshng).
- Supabase backend (juulius-sys's project, URL/key in `supabase-config.js`)
  handles auth, crews (invite-code based), trips, RSVP, shopping list, and
  the current (to-be-reworked) cost split.
- Three SQL files must be run in order on any fresh Supabase project:
  `supabase-setup.sql` → `supabase-fix-rls.sql` → `supabase-trip-extras.sql`.
- Local dev: `py -m http.server 8642` from `apps/web`, or use the
  `.claude/launch.json` "explr-web" preview config.
