// Home screen: the researcher's coop with one egg per open experiment.

import { html, mount, toast } from '../dom.js';
import { countdown } from '../components.js';
import { chickArt, eggArt, flowerArt, henArt, hillsArt, nestArt } from '../art.js';
import { bindActions, loadDemoData, openDialog, removeDemoData } from '../actions.js';
import { DEFAULT_COOP_ID, batchTotals, eggCounts, formatEggs } from '../../experiment.js';
import { STAGE_LABEL, coopEggs, eggProgress, eggStage, greeting, henMessage, recentlyHatched, shellVariant } from '../../hatchery.js';
import { coopDisplayName } from '../../storage.js';
import { formatDate, formatDateTime, formatTime, zoneAbbreviation } from '../../time.js';

// Text glyph per stage, so stages differ by shape and words, not only colour.
const STAGE_ICON = { planned: '◷', warming: '♨', almost: '◔', due: '!', hatched: '✓', cancelled: '×' };

// Which batch's egg grid is open; survives re-renders while the page is open.
let openUid = null;

function eggCountLine(r) {
  const c = eggCounts(r);
  if (!c.known) return html`<span class="egg-count unknown">Egg count not recorded</span>`;
  if (c.active === c.initial) return html`<span class="egg-count"><strong>${c.initial}</strong> eggs</span>`;
  return html`<span class="egg-count"><strong>${c.active}</strong> of ${c.initial} eggs active</span>`;
}

function batchSlot(r, now, isNew) {
  const stage = eggStage(r, now);
  const t = Date.parse(r.targetAt);
  const pct = Math.round(eggProgress(r, now) * 100);
  const when = `${formatDate(t, r.timeZone)} ${formatTime(t, r.timeZone)} ${zoneAbbreviation(t, r.timeZone)}`;
  const c = eggCounts(r);
  const v = shellVariant(r.uid);
  const open = openUid === r.uid;
  return html`<li class="nest-slot stage-${stage} ${isNew ? 'is-new' : ''} ${open ? 'is-open' : ''}" style="--i:${v}" data-slot="${r.uid}">
    <button type="button" class="egg-link clutch-toggle" data-toggle-clutch="${r.uid}" aria-expanded="${String(open)}" aria-controls="clutch-${r.uid}"
      aria-label="Show the eggs in ${r.experimentId}">
      <span class="egg-art clutch">
        <span class="egg-wrap clutch-back clutch-l">${eggArt({ stage, variant: (v + 1) % 3 })}</span>
        <span class="egg-wrap clutch-back clutch-r">${eggArt({ stage, variant: (v + 2) % 3 })}</span>
        <span class="egg-wrap clutch-front">${eggArt({ stage, variant: v })}</span>
        ${nestArt()}
        <span class="clutch-count" aria-hidden="true">×${c.known ? c.active : '?'}</span>
      </span>
    </button>
    <div class="egg-tag">
      <div class="egg-tag-head">
        <a class="egg-id" href="#/exp/${r.uid}" aria-label="${r.experimentId}: ${STAGE_LABEL[stage]}, ${c.known ? `${c.active} eggs` : 'egg count not recorded'}, target ${when}. Open details">${r.experimentId}</a>
        <span class="stage-pill"><span aria-hidden="true">${STAGE_ICON[stage]}</span> ${STAGE_LABEL[stage]}</span>
      </div>
      <p class="egg-name">${r.name}${r.batchId ? html` · ${r.batchId}` : ''}${r.demo ? html` <span class="badge badge-demo">Demo</span>` : ''}</p>
      ${eggCountLine(r)}
      <div class="egg-when">
        <span class="egg-date">${formatDate(t, r.timeZone)}</span>
        <span class="egg-time">${formatTime(t, r.timeZone)} <small>${zoneAbbreviation(t, r.timeZone)}</small></span>
      </div>
      ${countdown(r, now)}
      <div class="progress" role="progressbar" aria-label="Waiting period elapsed" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"
        data-progress-start="${Date.parse(r.placementAt)}" data-progress-end="${t}">
        <span style="width:${pct}%"></span>
      </div>
    </div>
  </li>`;
}

/** The opened batch: one small egg per egg in the batch, by count (not individual identity). */
function clutchPanel(r, now) {
  const stage = eggStage(r, now);
  const c = eggCounts(r);
  const t = Date.parse(r.targetAt);
  const cells = c.known
    ? [
        ...Array.from({ length: c.active }, (_, i) => html`<li class="mini mini-egg" style="--k:${i}"></li>`),
        ...Array.from({ length: c.completed }, (_, i) => html`<li class="mini mini-done" style="--k:${c.active + i}"><span>✓</span></li>`),
        ...Array.from({ length: c.removed }, (_, i) => html`<li class="mini mini-removed" style="--k:${c.active + c.completed + i}"><span>×</span></li>`),
      ]
    : [];
  return html`<li class="clutch-panel stage-${stage}" id="clutch-${r.uid}" aria-label="Eggs in ${r.experimentId}">
    <div class="clutch-head">
      <h3><span class="mono">${r.experimentId}</span> <span class="muted">· ${r.name}</span></h3>
      <button type="button" class="btn btn-ghost btn-sm" data-toggle-clutch="${r.uid}" aria-label="Close egg view">Close ✕</button>
    </div>
    ${c.known
      ? html`<p class="clutch-counts">
            <span class="key key-egg"></span><strong>${c.active}</strong> active
            <span class="key key-done">✓</span><strong>${c.completed}</strong> completed early
            <span class="key key-removed">×</span><strong>${c.removed}</strong> removed
            <span class="muted">· ${c.initial} placed</span>
          </p>
          <ul class="egg-grid" aria-hidden="true">${cells}</ul>
          <p class="hint">All eggs share this batch's schedule: target ${formatDateTime(t, r.timeZone)}${stage === 'due' ? ' — now overdue' : ''}.
            Eggs are counted, not tracked one by one, so positions in the grid are illustrative.</p>
          <div class="clutch-actions">
            <button type="button" class="btn btn-secondary btn-sm" data-action="eggs-remove" data-uid="${r.uid}" ${c.active ? '' : 'disabled'}>Remove eggs…</button>
            <button type="button" class="btn btn-secondary btn-sm" data-action="eggs-complete" data-uid="${r.uid}" ${c.active ? '' : 'disabled'}>Complete some eggs early…</button>
            <a class="btn btn-ghost btn-sm" href="#/exp/${r.uid}">Open full record →</a>
          </div>`
      : html`<p>This batch was created before egg counts existed, so its number of eggs is not recorded.</p>
          <div class="clutch-actions"><a class="btn btn-secondary btn-sm" href="#/exp/${r.uid}/edit">Add the egg count</a>
            <a class="btn btn-ghost btn-sm" href="#/exp/${r.uid}">Open full record →</a></div>`}
  </li>`;
}

export function renderHatchery(container, ctx, { laid } = {}) {
  const now = ctx.now();
  const tz = ctx.browserTimeZone;
  const all = ctx.experiments;
  const eggs = coopEggs(all);
  const hatched = recentlyHatched(all, now).slice(0, 6);
  const hasDemo = all.some((r) => r.demo);
  // Totals over every batch in this coop (each batch counted once).
  const totals = batchTotals(all.filter((r) => (r.coopId ?? DEFAULT_COOP_ID) === DEFAULT_COOP_ID), now);
  if (openUid && !eggs.some((r) => r.uid === openUid)) openUid = null;
  const msg = henMessage(all, now, { justLaidUid: laid });
  const name = ctx.profile.researcherName;

  const root = mount(
    container,
    html`<div class="hatchery">
      <section class="scene" aria-labelledby="coop-title">
        <div class="sky" aria-hidden="true"><span class="sun"></span><span class="cloud c1"></span><span class="cloud c2"></span><span class="cloud c3"></span></div>

        <header class="scene-head">
          <div>
            <p class="greet">${greeting(now, tz)}${name ? `, ${name}` : ''}</p>
            <h1 class="sr-only">Hatchery</h1>
            <ul class="tally" aria-label="Coop summary">
              <li><strong>${totals.eggsActive}</strong> active eggs</li>
              <li><strong>${totals.activeBatches}</strong> active ${totals.activeBatches === 1 ? 'batch' : 'batches'}</li>
              <li class="${totals.eggsDueToday ? 'tally-hi' : ''}"><strong>${totals.eggsDueToday}</strong> eggs due today</li>
              <li class="${totals.overdueBatches ? 'tally-alert' : ''}">${totals.overdueBatches ? html`<span aria-hidden="true">! </span>` : ''}<strong>${totals.overdueBatches}</strong> overdue ${totals.overdueBatches === 1 ? 'batch' : 'batches'}</li>
              ${totals.plannedBatches ? html`<li><strong>${totals.plannedBatches}</strong> planned (${formatEggs(totals.eggsPlanned)})</li>` : ''}
              <li><strong>${totals.eggsCompleted}</strong> eggs completed</li>
            </ul>
            ${totals.unknownEggBatches
              ? html`<p class="tally-note">Egg totals leave out ${totals.unknownEggBatches} older ${totals.unknownEggBatches === 1 ? 'batch' : 'batches'} without a recorded count.</p>`
              : ''}
          </div>
          <a class="btn btn-egg" href="#/new"><span class="plus" aria-hidden="true">+</span> Add batch</a>
        </header>

        <div class="hen-row">
          <div class="hen mood-${msg.mood}">${henArt()}</div>
          <p class="bubble mood-${msg.mood}" id="hen-bubble" role="status">${msg.text}</p>
        </div>

        <div class="coop">
          <div class="coop-roof" aria-hidden="true"></div>
          <div class="coop-sign">
            <h2 id="coop-title">${coopDisplayName(ctx.profile)}</h2>
            <button type="button" class="sign-edit" data-rename aria-label="Rename coop and set your name">✎</button>
          </div>
          <div class="coop-wall">
            <ul class="nests" aria-label="Batches in this coop (${eggs.length})">
              ${eggs.map((r) => [batchSlot(r, now, r.uid === laid), openUid === r.uid ? clutchPanel(r, now) : ''])}
              <li class="nest-slot slot-add">
                <a class="add-egg" href="#/new">
                  <span class="egg-art"><span class="egg-wrap ghost">${eggArt({ stage: 'ghost' })}</span>${nestArt()}</span>
                  <span class="add-label"><span aria-hidden="true">+</span> Add batch</span>
                </a>
                ${eggs.length === 0 && !hasDemo
                  ? html`<button type="button" class="link small" data-load-demo>or load demo eggs</button>`
                  : ''}
              </li>
            </ul>
          </div>
        </div>

        <div class="ground" aria-hidden="true">
          ${hillsArt()}
          <div class="fence"></div>
          <div class="flowers">${[0, 1, 2, 1, 0, 2].map((k) => html`<span class="flower f${k}">${flowerArt(k)}</span>`)}</div>
        </div>
      </section>

      ${hatched.length
        ? html`<section class="hatched card" aria-labelledby="h-hatched">
            <h2 id="h-hatched">Recently completed <span class="muted small">(last 7 days)</span></h2>
            <ul class="chicks">${hatched.map(
              (r) => html`<li><a href="#/exp/${r.uid}"><span class="chick-wrap">${chickArt()}</span>
                <span class="mono">${r.experimentId}</span>
                ${eggCounts(r).known ? html`<span class="small">${formatEggs(eggCounts(r).completed)}</span>` : ''}
                <span class="muted small">${formatDateTime(Date.parse(r.completedAt), r.timeZone)}</span></a></li>`
            )}</ul>
          </section>`
        : ''}

      ${hasDemo
        ? html`<p class="demo-note">Demo eggs are examples, not real experiments. <button type="button" class="link" data-remove-demo>Remove demo data</button></p>`
        : ''}
      <p class="workspace-link">Need the full table view? <a href="#/workspace">Open the research workspace</a> · <a href="#/history">History &amp; export</a></p>
    </div>`
  );

  if (laid) history.replaceState(null, '', '#/'); // play the arrival only once

  root.querySelector('[data-load-demo]')?.addEventListener('click', () => loadDemoData(ctx));
  root.querySelector('[data-remove-demo]')?.addEventListener('click', () => removeDemoData(ctx));
  root.querySelector('[data-rename]').addEventListener('click', () => openRenameDialog(ctx));
  bindActions(root, ctx);
  root.addEventListener('click', (e) => {
    const toggle = e.target.closest('[data-toggle-clutch]');
    if (!toggle) return;
    const uid = toggle.dataset.toggleClutch;
    openUid = openUid === uid ? null : uid;
    ctx.rerender();
    // Keep keyboard focus on the batch that was toggled.
    container.querySelector(`.clutch-toggle[data-toggle-clutch="${CSS.escape(uid)}"]`)?.focus({ preventScroll: true });
  });

  return {
    tickRerender: true,
    // Refresh the hen's sentence ("in 2 h 5 min") once a minute without re-rendering eggs.
    onMinute() {
      const m = henMessage(ctx.experiments, ctx.now());
      const bubble = root.querySelector('#hen-bubble');
      if (bubble && bubble.textContent !== m.text && !bubble.classList.contains('mood-happy')) bubble.textContent = m.text;
    },
  };
}

function openRenameDialog(ctx) {
  const p = ctx.profile;
  openDialog(
    html`<form class="dialog-form" novalidate>
      <h2>Your coop</h2>
      <label class="field">Your name <input name="researcherName" maxlength="40" value="${p.researcherName}" autocomplete="name"></label>
      <label class="field">Coop name <span class="muted">(optional)</span>
        <input name="coopName" maxlength="40" value="${p.coopName}" placeholder="${p.researcherName ? `${p.researcherName}'s coop` : 'My coop'}"></label>
      <p class="hint">Stored only in this browser.</p>
      <p class="dialog-error field-error" role="alert" hidden></p>
      <div class="dialog-actions">
        <button type="button" class="btn btn-ghost" data-close>Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>`,
    (data) => {
      ctx.saveProfile({ researcherName: data.get('researcherName'), coopName: data.get('coopName') });
      toast('Coop updated.');
      ctx.rerender();
      return null;
    }
  );
}
