# EmbryoTime 2.0 — Chicken Embryo Incubation Scheduler

A small web app for lab researchers to calculate when to return to the lab, track several
incubation experiments at once, and export calendar events and records. The home screen is a
cozy virtual hatchery; the scheduling, records and exports underneath are unchanged.

EmbryoTime is a **scheduling tool**. It does arithmetic on the times you enter; it does not
predict developmental stages or outcomes.

## Run it

Requires Node.js 22 or newer. There are no npm dependencies.

```bash
npm start
```

Then open <http://localhost:5173>. This serves the source files directly, for development.

| Command | What it does |
|---|---|
| `npm test` | Unit tests (calculations, model, exports, backups, release build, contrast) |
| `npm run test:browser` | End-to-end tests in headless Chrome against the **built release** |
| `npm run test:all` | Both |
| `npm run build` | Writes the release into `docs/` (what GitHub Pages serves) |
| `npm run start:release` | Builds into `.release-preview/` and serves it exactly as published |

Browser tests drive an installed Chrome or Chromium through the DevTools protocol, using Node's
built-in WebSocket and no npm packages. If Chrome is not at a standard location, set
`CHROME_PATH`. Without a browser, those tests are reported as **skipped**, never as passed.

## Public preview (GitHub Pages)

- **Live URL:** https://jw238.github.io/embryotime/
- **Access:** the site and repository are **public**. Anyone with the URL can open it. There is
  no login, database, email or data sharing:
  - each visitor's batches live only in their own browser (`localStorage`);
  - nothing is uploaded;
  - a link to a batch only works in the browser that created it.

### Releases and caching

GitHub Pages lets browsers cache each file for up to 10 minutes, independently. To stop an old
`index.html` from loading new JavaScript (or the reverse), `npm run build` writes every release
into an immutable, **content-hashed folder**:

```
docs/index.html            → points only at r/<hash>/…
docs/r/<hash>/styles.css
docs/r/<hash>/src/**.js    (relative imports: a page can only load modules from its own release)
docs/release.json          (current release + the last 5 kept for cached pages)
```

The build fails if any module imports something outside its release folder, imports a missing
file, or uses a non-relative URL. `--seed-legacy <git-ref>` additionally copies an earlier
un-versioned deployment's files into `docs/`, so pages cached from before this scheme still load a
consistent set.

GitHub Pages is configured to serve the `docs/` folder of `main` (Settings → Pages).

### Updating the site

```bash
npm run test:all
```
```bash
npm run build
```
```bash
git add -A && git commit -m "Describe the change"
```
```bash
git push
```

### Taking it down

Disable Pages under **Settings → Pages**, or make the repository private (on a free plan, Pages
needs a public repository).

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

## Adding a batch (stage-based timing)

Nothing is pre-selected. You choose:

1. **Batch name.** Generated from the *placement* date and time (e.g. "October 26, 2026 — 8:15 PM")
   and updated if you change the placement time. Once you type your own name, it is never
   overwritten. A record ID (`EXP-YYYYMMDD-NNN`) is still assigned automatically and shown in
   details, CSV and history. Older records without a name show their ID.
2. **Starting point:**
   - **Freshly set eggs — incubation age 0 h.** A known elapsed time, not an observed HH1 stage.
   - **Current HH stage.** The age is taken as that stage's listed reference range. Ticking
     *I observed this stage* saves a real **setup observation**; otherwise the stage is recorded as
     *selected*.
3. **Target HH stage.** Must be later than the current stage. HH1 cannot be used, because the
   table lists no age for it, so you are pointed to "freshly set eggs" instead.
4. **Planned lab return.** None (track the window only), or the start, middle or end of the
   window. Each option explains its trade-off. The middle is a convention, not an optimum.

Stage wheels have a number box beside them. They work with keyboard, scrolling or tapping, and
nothing is selected until you choose. Calendar alerts are visible and **off unless chosen**.
Temperature is optional and stored with its unit. **Estimates are never adjusted for
temperature**: there is no validated correction model here, and the UNSW page does not state the
conditions behind its ages (`REFERENCE_TEMPERATURE_C` in `src/experiment.js` stays `null`
unless filled from a reliable source).

### Calculation: ranges all the way through

```
starting age  = [0, 0] (fresh) · [cMin, cMax] (current stage) · [x, x] (converted older batch)
window        = placement + [max(0, tMin − startMax), tMax − startMin]
age at time t = starting age + (t − placement)        ← still a range; never a midpoint
estimated stage at t = every HH stage whose listed range overlaps that age range
```

Example: HH10 (33–38 h) → HH12 (45–49 h), placed 20:15. The estimated window is **7–16 h** after
placement, i.e. 03:15–12:15 the next day. Ten hours after placement the age is 43–48 h, so the
estimate is HH11–HH13.

Overlapping ranges (HH13 → HH14) give a window that starts at placement. This is flagged, and
"start of window" is refused because it would mean no wait.

This interval arithmetic only combines the table's listed ranges. It does **not** capture all
biological variation, and the target stage is never guaranteed at an exact time. Each plan stores
its reference version.

### Window states

Stage-based batches show **"Window opens in…" → "In window · closes in…" → "Window passed"** in
every view, rather than a deadline. The calendar shows them on every day the window covers, and
the `.ics` file contains one event spanning the whole window (plus a separate "planned lab
return" event only if one was chosen). Older duration-based batches keep their single target time
and "Overdue".

### Older batches

Duration-based batches are never recalculated. They edit with duration wheels.
**Convert to stage-based timing…** (batch page) asks for confirmation:
- it uses the entered incubation age as an exact start;
- it records the old wait and target in the history and in `stagePlan.convertedFrom`;
- it leaves observations untouched;
- it refuses (with an explanation) when the entered age is already past the chosen target.

## HH stages, observations and the Egg collection

**Reference data.** `src/hh-stages.js` holds Hamburger–Hamilton stages 1–46 with the reference
ages and short identifying features. They come from Hamburger & Hamilton (1951), as tabulated by
[UNSW Embryology](https://embryology.med.unsw.edu.au/embryology/index.php/Hamburger_Hamilton_Stages)
(accessed 26 Oct 2026). Ages are converted to hours. HH1 has no listed age. The **HH stages** page
(`#/stages`) lets you browse them with a wheel or as a full table.

**Estimates use only the listed ages.** Nothing is interpolated or extrapolated.
Incubation age = incubation at placement + time since placement (assuming continuous incubation).

| Situation | Estimate |
|---|---|
| Age inside one or more listed ranges | All of those stages, e.g. 50 h → HH13–HH15 (ranges overlap) |
| Age in a gap between listed ages | The two neighbouring stages, e.g. 39 h → HH10–HH11 |
| Younger than 6 h (first listed age) | HH1–HH2 |
| Older than 21 d | HH46, labelled "beyond the reference ages" |

Estimates are always labelled **estimate** and are never shown as observations.

**Wheels.** Durations use day/hour/minute wheels that write to the same hidden hour/minute fields
as before, so validation and stored data are unchanged. Wheels support arrow keys, Page Up/Down,
Home/End and typing digits, as well as scroll and tap.

**Observations** (Record observation on a batch, or from its egg grid). You'll be asked:
*Does the observed HH stage match the estimated stage?*
- **Yes**: if the estimate is a range, choose which stage within it.
- **No**: choose the observed stage on a wheel. Its reference age and features are shown.
- **Unable to confirm**: no stage is stored, and the estimate stays an estimate.

Each observation is appended to the batch's `observations` list as
`{ id, recordedAt, observedAt, ageMinutes, estimate: { stages, label, method, referenceVersion },
verdict, observedStage, note }`:
- `estimate` is a **snapshot**, so changes to the reference table never rewrite past records.
- Observations are never edited in place and are logged in the change history.
- Recording is never required. After **Mark completed** an optional "Final stage check" appears with
  a Skip button. Viewing a batch never prompts.
- Saving the same batch, minute, answer and stage twice is rejected as a duplicate.

**Retracting.** An incorrect observation can be **retracted with a required reason**. The
original is never altered: the retraction is appended to `record.retractions` and to the history.
Retracted observations are excluded from the chart, conflict checks and badges. They stay in the
observation table (struck through, with reason) and in the observations CSV, marked
`retracted`.

**Chart** (batch details). The x-axis is time since placement (exact) and the y-axis is HH stage; the reference band carries the starting-age range:
- the shaded band is the reference estimate;
- a bracket shows the estimate stored with each observation;
- observations use shapes: ● matches, ◆ different (same colour), and ○ in a separate
  "not confirmed" lane;
- observations are never connected by lines, and periods without data stay empty;
- conflicting observations within an hour are flagged;
- a table lists every observation with its time and note.

With no observations, the details page shows an explanation instead of a chart.

**Egg collection** (`#/collection`, also linked from the hatchery). There are badges at 1, 5, 20
and 50 observations. Thresholds and text are in the `BADGES` list in `src/badges.js`.

Counting rules:
- each observation counts once per batch, never once per egg;
- matches, different and unable-to-confirm answers all count equally, so guessing a stage is never
  rewarded;
- accidental duplicates count once;
- demo batches don't count.

Unlock dates are stored separately under `embryotime.badges.v1`. Badges never change experiment
data, are never revoked, and are never shared or ranked. There are no coins, streaks or
leaderboards.

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

**Backup status.** History (and the hatchery, when needed) shows when a backup **download was
started**. The browser cannot confirm the file was saved, so it never says "backed up". It warns
when there is no backup, when batches changed since the last one, or when the last one is older than
7 days (`BACKUP_MAX_AGE_DAYS`).

**Restore** validates the whole file before touching anything:
- schema and version;
- field types and unique IDs;
- HH stages and reference-age ranges;
- timestamps and time zones;
- egg counts and statuses;
- observations, retractions and stage plans.

Any problem → nothing is changed and every problem is listed. On success, after confirmation, the
current data is first copied to `embryotime.experiments.v1.pre-restore-<time>`. Older backup
formats are migrated explicitly; missing scientific values are never invented.


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
scripts/build.mjs          Content-hashed release build + import checks
tests/browser/             Headless-Chrome end-to-end tests (zero-dependency CDP driver)
src/app.js                 Router, state, 1-second countdown ticker
src/ui/                    DOM helpers, shared components, actions/dialogs, views
tests/                     node:test suites for the logic modules
```

## Known limitations

- Stage windows come only from the reference table's listed ranges. Real embryos can fall outside
  them, and temperature effects are not modelled.
- Retracted observations cannot be "un-retracted"; record the observation again instead.
- Backup status records download *starts*; whether the file was saved cannot be verified.

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
- Stage estimates are only as precise as the reference table's listed ages. Individual embryos
  and incubation conditions vary.
- Observations describe a batch, not individual eggs. They can't be edited or deleted; an incorrect one
  is retracted with a reason and kept in the audit trail.
- The chart is in the batch details only. Observations are exported via History → Export
  observations CSV.
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
