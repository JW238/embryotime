# EmbryoTime 2.0 — Chicken Embryo Incubation Scheduler

A small web app for lab researchers to calculate when to return to the lab, track several
incubation experiments at once, and export calendar events and records. The home screen is a
cozy virtual hatchery; the scheduling, records and exports underneath are unchanged.

EmbryoTime is a **scheduling tool**. It does arithmetic on the times you enter; it does not
predict developmental stages or outcomes.

## Run it

Requires Node.js 18 or newer. There are no dependencies to install.

```bash
npm start
```

Then open <http://localhost:5173>. (The app uses ES modules, so it must be served over HTTP — opening
`index.html` directly from disk will not work.) Set `PORT=8080 npm start` to use another port.

Run the tests:

```bash
npm test
```

## Public preview (GitHub Pages)

The app is a static site: `index.html`, `styles.css` and the ES modules in `src/`. It has no
backend. `server.js` is only a local development server, and nothing in the app calls it.

- **Live URL:** https://jw238.github.io/embryotime/
- **Hosting:** GitHub Pages, served directly from the `main` branch (repository root). There's
  no build step. `.nojekyll` tells Pages to serve the files as-is.
- **Routing:** pages use hash URLs (`#/history`, `#/exp/…`), so refreshing and opening links
  directly work with no server rewrite rules.
- **Access:** the site and this repository are **public**. Anyone with the URL can open it.
  There is **no login, no database and no data sharing**:
  - each visitor's experiments live only in that visitor's browser (`localStorage`), per device;
  - nothing is uploaded anywhere, and colleagues cannot see each other's data;
  - a link to a specific experiment (`#/exp/…`) only works in the browser that created it;
  - data saved at `localhost:5173` does not appear on the public site (different origin);
  - a notice at the top of the page explains this to visitors.
- **Security:** a Content-Security-Policy `<meta>` tag allows only the site's own scripts and
  styles (no third-party requests), and `no-referrer` is set. Don't commit secrets or real
  experiment data. `.gitignore` excludes local tooling (`.claude/`), `.env*` and OS files.

### Updating the site

```bash
npm test
```
```bash
git add -A && git commit -m "Describe the change"
```
```bash
git push
```

GitHub Pages republishes automatically within a minute or two of each push. You can follow
progress with `gh run list` or under the repository's **Actions** tab.

### Taking it down

Disable Pages under **Settings → Pages** in the repository, or make the repository private.
Note that on a free GitHub plan, Pages needs a public repository.

## How the calculation works

| Input | Meaning |
|---|---|
| **Incubation at placement** | How long the embryo has *already* been incubated when it goes into the incubator (e.g. 48 h). |
| **Placement date and time** | When it was placed, as wall-clock time in the experiment's **time zone**. |
| **Waiting duration** | How long until you must be back in the lab (e.g. 36 h). |

```
target                     = placement instant + waiting duration
projected total incubation = incubation at placement + waiting duration
```

- The placement time is converted to an absolute instant (UTC) using the chosen IANA time zone,
  then the waiting duration is added as elapsed time. This is correct across midnight, month and
  year ends, leap days, and daylight-saving changes.
- If a DST change happens during the wait, the form says so: e.g. 36 h elapsed may look like 35 h
  on the wall clock.
- A placement time that does not exist (skipped by spring-forward) is rejected. A time that occurs
  twice (fall-back) asks which occurrence you meant.
- The projected total assumes uninterrupted incubation from placement onward.
- The incubation at placement does **not** affect the target time; only the waiting duration does.

## Batches and egg counts

One experiment record is one **incubation batch**. Every egg in a batch shares the same placement
time, target time, reminders and status. Eggs are **counted, not tracked one by one**.

- **Number of eggs** is required when creating or editing a batch. It must be a whole number from
  10 to 50 (default 24), and there are quick-select buttons for 10, 20, 30, 40 and 50.
- The record stores `initialEggCount` (never changed by count adjustments) and `eggAdjustments`, a
  list of `{ at, kind: 'removed' | 'completed', count, reason, activeBefore, activeAfter }`.
- The active, completed, removed and cancelled counts are derived (`eggCounts()` in
  `src/experiment.js`). They always add up to the initial count:
  - **Remove eggs…** takes eggs out of the active count. A reason is required.
  - **Complete some eggs early…** counts eggs completed before the batch target.
  - **Mark completed** counts all remaining active eggs as completed.
  - **Cancel** leaves the remaining eggs counted as "in a cancelled batch".
  - **Reopen** returns them to active.
- Every count change is timestamped and logged in the batch's change history. Editing the egg
  count is logged as a field change. The count can't be lowered below the number of eggs already
  removed or completed.
- **Legacy records** saved before egg counts existed are migrated on load to
  `initialEggCount: null`, shown as "Egg count not recorded". They are **never** given an
  invented default. They're left out of egg totals (with a note saying how many), and the edit
  form asks for the real number.
- Totals (`batchTotals()`) count each batch exactly once. Planned eggs (batch not yet placed)
  are counted separately from active eggs.
- CSV export has columns for initial, active, completed, removed and cancelled eggs. The .ics
  description includes the egg count.

## The hatchery (home screen)

- Each researcher has one **personal coop** (`#/`). The coop holds one **nest per open batch**,
  sorted by target time. Each nest shows a clutch of three eggs with a count badge (e.g. ×24).
- Totals across the coop: active eggs, active batches, eggs due today, overdue batches, planned
  batches (with their egg count), and completed eggs.
- Every batch tag shows its ID, name, egg count, target date and exact time (with zone), a live
  countdown or "Overdue by …", its stage, and a progress bar for the waiting period. You can read
  all of this without clicking.
- Click a clutch to open a compact grid with one small egg per egg in the batch: active eggs, ✓
  for eggs completed early, and a dashed × for removed eggs. The grid also has the count-change
  actions. Grid positions are illustrative, since eggs are tracked by count.
- Click the batch ID (or its tag) to open the full record. **Add batch** opens the creation form.
- Stages are shown by artwork, a text label and an icon, not by colour alone:
  planned (dashed shell, "z z"), incubating (warm glow), due within the hour (cracked, faster
  wobble), and overdue (crack + alarm badge, a dashed and striped tag, and a "! Overdue" label).
- A hen mascot gives one factual status line (next check, heads-up, overdue), naming the
  experiment ID and exact time.
- Saving a new egg plays a short arrival animation. Completing an experiment plays a ~1.6 s chick
  celebration. Neither blocks input or delays saving (`pointer-events: none`, added after the
  save finishes).
- Recently completed experiments (last 7 days) appear as chicks below the coop.
- Click the pencil on the coop sign to set your name and the coop name (stored locally).
- There are no points, coins, streaks or leaderboards.
- Motion: gentle idle wobble, blinking hen, drifting clouds. With `prefers-reduced-motion`, all
  animation is switched off and celebrations show briefly without movement.
- Dark mode turns the hatchery into a night scene.
- All artwork is original inline SVG in `src/ui/art.js`, with no image files or external URLs.

The previous dashboard is now the **Research workspace** (`#/workspace`), a compact card view
with calendar actions on every batch. It shows batch and egg totals (placed, active, planned,
completed, removed). **History** shows the same totals for whichever batches match the current
filters, and has an Eggs column. There is no separate Analytics page yet; these totals are the
analytics for now.

## Features

- **Dashboard**: active / due today / overdue / planned counts; overdue and upcoming experiments
  sorted by target, with live countdowns. Overdue experiments are labelled and never shown as a
  negative countdown.
- **Create / edit / duplicate**: auto-generated, editable experiment IDs (`EXP-YYYYMMDD-NNN`),
  validation with per-field messages and an error summary, live target preview, wait presets,
  reminder offsets, notes and conditions. Warns about missing reminders or batch IDs.
- **Experiment details**: original vs. updated target, live countdown, calculated incubation
  status, completion (actual vs. planned), calendar export status, and full change history
  (with optional reason for each change).
- **Status**: Planned (placement in the future) → Active → Completed or Cancelled. Closed
  experiments can be reopened.
- **Calendar export**: downloads a standard `.ics` file (works with Google Calendar, Apple
  Calendar, Outlook) with the experiment ID, name, target time, notes and one alert per
  reminder offset. Times are written in UTC so every calendar app shows them correctly in its own
  zone. The app records that a file was *downloaded*; it cannot confirm that you imported it, and
  it flags the file as out of date if the schedule changes afterwards.
- **Calendar view**: month grid of targets plus an agenda list.
- **History**: search, filter by status / batch / target date range, CSV export of the filtered
  list (UTF-8 with BOM for Excel; local and UTC times; formula-injection guarded).
- **Backup**: download all records as JSON and restore them later.
- **Demo data**: optional, clearly labelled (`DEMO-…`, `[DEMO]`, "Demo" badge), removable in one click.

## Storage and its limits

Experiments carry a `coopId` (currently always `personal`; older records without one are treated as
personal). The researcher's display name and coop name are stored separately under
`embryotime.profile.v1`.

Records are kept in the browser's `localStorage` (key `embryotime.experiments.v1`).

- Data stays **in this browser on this device only**. It is not shared across devices, browsers,
  or researchers.
- Clearing browser data, or using a private window, loses it. Use **History → Download backup**
  regularly.
- If the stored data is ever unreadable, the app does not overwrite it: it keeps a copy and shows
  a reset option.
- Edits made in another tab are picked up automatically.

`src/storage.js` exposes an async repository (`list`, `save`, `remove`, `replaceAll`). A server
database can replace it without changing the UI. Adding accounts would then be a matter of
scoping that API per user.

## Project layout

```
index.html, styles.css     App shell and styles (light and dark themes, responsive)
server.js                  Tiny static file server (no dependencies)
src/time.js                Time-zone-aware date-time arithmetic and formatting (pure)
src/experiment.js          Validation, create/update/complete/cancel, status, history (pure)
src/ics.js                 .ics generation (RFC 5545: escaping, UTF-8-safe line folding, alarms)
src/csv.js                 CSV export
src/storage.js             localStorage repository + backup validation
src/demo.js                Demo records
src/hatchery.js            Egg stages, progress, hen messages, coop membership (pure)
src/ui/art.js              Inline SVG illustrations (egg, nest, hen, chick, flowers, hills)
src/ui/celebrate.js        Non-blocking save/complete animations
src/app.js                 Router, state, 1-second countdown ticker
src/ui/                    DOM helpers, shared components, actions/dialogs, views
tests/                     node:test suites for the logic modules
```

## Known limitations

- Local, single-user storage only (see above).
- No direct Google/Apple/Outlook calendar sync. The `.ics` file is imported manually, and if the
  schedule changes you must import the updated file and delete the old event yourself. Some apps
  replace the old event automatically because the UID stays the same, but not all do.
- Whether reminder alerts fire depends on the calendar app. Some apps ignore alarms in imported
  files or apply their own defaults.
- There are no in-app or push notifications when the browser tab is closed. The countdown and
  overdue warnings only update while the page is open.
- UI tests are manual (checked in a browser at desktop and phone widths). Automated tests cover the
  logic modules.
- The interface is English-only, and dates use a 24-hour, `en-US`-style format.
- Eggs within a batch have no individual identity or status. Removing or completing eggs
  changes counts only. Tracking individual eggs (e.g. per-egg IDs or outcomes) would need a new
  per-egg record.
- Egg counts are limited to 10–50 per batch in this version.
- Shared laboratory, multiple coops and multi-user features (2.0 spec §4 onward) are not built
  yet. They need a server and accounts. The data model has a `coopId` field ready for them.
- Reduced-motion styling was checked by inspecting the CSS rules, not by running with the OS
  setting turned on.

## Suggested next steps

1. Server-side storage (e.g. SQLite/Postgres behind a small API) implementing the repository
   interface, then authentication and per-lab sharing.
2. Google Calendar / Microsoft Graph integration via OAuth, so events can be created, updated and
   deleted from the app.
3. Browser notifications (Notification API / service worker) as an extra reminder channel.
4. Bulk creation for a batch of eggs that share one placement time.
5. End-to-end UI tests (e.g. Playwright) for the create → edit → complete flow.
