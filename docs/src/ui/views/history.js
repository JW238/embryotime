// Searchable experiment history, CSV export and JSON backup.

import { html, mount, downloadFile, toast } from '../dom.js';
import { countdown, eggSummary, emptyState, statusBadge, totalsStrip } from '../components.js';
import { STATUS_LABEL, batchTotals, describeDelta, effectiveStatus, isOverdue } from '../../experiment.js';
import { experimentsToCsv } from '../../csv.js';
import { validateImportedRecords } from '../../storage.js';
import { formatDateTime, zonedDateKey } from '../../time.js';

// Filters survive navigation within the session.
const filters = { q: '', status: 'all', batch: '', from: '', to: '' };

export function filterExperiments(records, f, nowMs) {
  const q = f.q.trim().toLowerCase();
  return records
    .filter((r) => {
      if (q && ![r.experimentId, r.name, r.batchId, r.notes, r.conditions].some((s) => String(s ?? '').toLowerCase().includes(q))) return false;
      if (f.status === 'overdue') {
        if (!isOverdue(r, nowMs)) return false;
      } else if (f.status !== 'all' && effectiveStatus(r, nowMs) !== f.status) return false;
      if (f.batch && r.batchId !== f.batch) return false;
      const day = zonedDateKey(Date.parse(r.targetAt), r.timeZone);
      if (f.from && day < f.from) return false;
      if (f.to && day > f.to) return false;
      return true;
    })
    .sort((a, b) => Date.parse(b.targetAt) - Date.parse(a.targetAt));
}

export function renderHistory(container, ctx) {
  const all = ctx.experiments;
  const batches = [...new Set(all.map((r) => r.batchId).filter(Boolean))].sort();

  const root = mount(
    container,
    html`<div class="page-head">
      <h1>History</h1>
      <div class="action-bar">
        <button type="button" class="btn btn-secondary" data-export-csv>Export CSV</button>
      </div>
    </div>
    <form class="card filters" role="search" aria-label="Filter experiments">
      <div class="field grow">
        <label for="h-q">Search</label>
        <input id="h-q" name="q" type="search" value="${filters.q}" placeholder="ID, name, batch, notes…">
      </div>
      <div class="field">
        <label for="h-status">Status</label>
        <select id="h-status" name="status">
          ${['all', 'planned', 'active', 'overdue', 'completed', 'cancelled'].map(
            (s) => html`<option value="${s}" ${filters.status === s ? 'selected' : ''}>${s === 'all' ? 'All' : s === 'overdue' ? 'Overdue' : STATUS_LABEL[s]}</option>`
          )}
        </select>
      </div>
      <div class="field">
        <label for="h-batch">Batch / sample</label>
        <select id="h-batch" name="batch">
          <option value="">All</option>
          ${batches.map((b) => html`<option value="${b}" ${filters.batch === b ? 'selected' : ''}>${b}</option>`)}
        </select>
      </div>
      <div class="field">
        <label for="h-from">Target from</label>
        <input id="h-from" name="from" type="date" value="${filters.from}">
      </div>
      <div class="field">
        <label for="h-to">Target to</label>
        <input id="h-to" name="to" type="date" value="${filters.to}">
      </div>
      <div class="field">
        <button type="reset" class="btn btn-ghost">Clear</button>
      </div>
    </form>
    <p class="muted" id="h-count" aria-live="polite"></p>
    <div id="h-totals"></div>
    <div id="h-results"></div>

    <section class="card backup">
      <h2>Data and backup</h2>
      <p>Records are stored only in this browser on this device. They are not synced to other devices or shared with other researchers, and clearing browser data deletes them. Download a backup regularly.</p>
      <div class="action-bar">
        <button type="button" class="btn btn-secondary" data-export-json>Download backup (JSON)</button>
        <label class="btn btn-ghost file-btn">Restore from backup… <input type="file" accept="application/json,.json" data-import-json class="sr-only"></label>
      </div>
    </section>`
  );

  const form = root.querySelector('form.filters');
  let shown = [];

  function renderResults() {
    const now = ctx.now();
    shown = filterExperiments(ctx.experiments, filters, now);
    root.querySelector('#h-count').textContent = `${shown.length} of ${ctx.experiments.length} batches match — totals below cover the matching batches.`;
    root.querySelector('#h-totals').innerHTML = shown.length ? String(totalsStrip(batchTotals(shown, now), { label: 'Totals for matching batches' })) : '';
    const results = root.querySelector('#h-results');
    if (!ctx.experiments.length) {
      results.innerHTML = String(emptyState('No experiments yet', 'Experiments you create will appear here.', html`<a class="btn btn-primary" href="#/new">Create experiment</a>`));
      return;
    }
    if (!shown.length) {
      results.innerHTML = String(html`<p class="empty-inline muted">No experiments match these filters.</p>`);
      return;
    }
    results.innerHTML = String(html`<div class="table-wrap"><table class="table">
      <thead><tr><th scope="col">Experiment</th><th scope="col">Batch</th><th scope="col">Eggs</th><th scope="col">Status</th><th scope="col">Target</th><th scope="col">Remaining / outcome</th></tr></thead>
      <tbody>${shown.map(
        (r) => html`<tr>
          <td data-label="Experiment"><div><a class="mono" href="#/exp/${r.uid}">${r.experimentId}</a><div class="muted small">${r.name}</div></div></td>
          <td data-label="Batch">${r.batchId || '—'}</td>
          <td data-label="Eggs">${eggSummary(r)}</td>
          <td data-label="Status"><div class="badges">${statusBadge(r, now)}</div></td>
          <td data-label="Target">${formatDateTime(Date.parse(r.targetAt), r.timeZone)}</td>
          <td data-label="Remaining / outcome">${r.status === 'completed'
            ? `Done, ${describeDelta(Date.parse(r.completedAt) - Date.parse(r.targetAt))}`
            : countdown(r, now)}</td>
        </tr>`
      )}</tbody></table></div>`);
  }

  form.addEventListener('input', () => {
    Object.assign(filters, Object.fromEntries(new FormData(form)));
    renderResults();
  });
  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('reset', () => {
    setTimeout(() => {
      Object.assign(filters, { q: '', status: 'all', batch: '', from: '', to: '' });
      renderResults();
    });
  });

  root.querySelector('[data-export-csv]').addEventListener('click', () => {
    if (!shown.length) {
      toast('Nothing to export with the current filters.', 'warn');
      return;
    }
    const stamp = new Date(ctx.now()).toISOString().slice(0, 10);
    downloadFile(`embryotime-experiments-${stamp}.csv`, experimentsToCsv(shown, ctx.now()), 'text/csv;charset=utf-8');
    toast(`Exported ${shown.length} experiment${shown.length === 1 ? '' : 's'} to CSV.`);
  });

  root.querySelector('[data-export-json]').addEventListener('click', () => {
    const stamp = new Date(ctx.now()).toISOString().slice(0, 10);
    const payload = JSON.stringify({ app: 'EmbryoTime', exportedAt: new Date(ctx.now()).toISOString(), experiments: ctx.experiments }, null, 2);
    downloadFile(`embryotime-backup-${stamp}.json`, payload, 'application/json');
  });

  root.querySelector('[data-import-json]').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const imported = validateImportedRecords(JSON.parse(await file.text()));
      const byUid = new Map(ctx.experiments.map((r) => [r.uid, r]));
      const replacing = imported.filter((r) => byUid.has(r.uid)).length;
      const msg = `Restore ${imported.length} experiment(s) from "${file.name}"?${replacing ? ` ${replacing} existing record(s) with the same internal ID will be replaced.` : ''}`;
      if (!window.confirm(msg)) return;
      for (const r of imported) byUid.set(r.uid, r);
      await ctx.replaceAll([...byUid.values()]);
      toast(`Restored ${imported.length} experiment(s).`);
      ctx.rerender();
    } catch (err) {
      toast(err instanceof SyntaxError ? 'That file is not valid JSON.' : err.message, 'error');
    }
  });

  renderResults();
  return { tickRerender: false, onFlip: renderResults };
}
