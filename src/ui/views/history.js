// Searchable experiment history, CSV export and JSON backup.

import { html, mount, downloadFile, toast } from '../dom.js';
import { backupStatusPanel, countdown, eggSummary, emptyState, statusBadge, totalsStrip } from '../components.js';
import { STATUS_LABEL, batchTotals, describeDelta, displayName, effectiveStatus, formatWindow, isOverdue, windowOf } from '../../experiment.js';
import { experimentsToCsv, observationsToCsv } from '../../csv.js';
import { createBackupMetaStore, savePreRestoreCopy, validateBackup } from '../../storage.js';
import { downloadBackup } from '../actions.js';
import { formatDateTime, zonedDateKey } from '../../time.js';

// Filters survive navigation within the session.
const filters = { q: '', status: 'all', batch: '', from: '', to: '' };

export function filterExperiments(records, f, nowMs) {
  const q = f.q.trim().toLowerCase();
  return records
    .filter((r) => {
      if (q && ![r.experimentId, displayName(r), r.batchId, r.notes, r.conditions].some((s) => String(s ?? '').toLowerCase().includes(q))) return false;
      if (f.status === 'overdue') {
        if (!isOverdue(r, nowMs)) return false;
      } else if (f.status !== 'all' && effectiveStatus(r, nowMs) !== f.status) return false;
      if (f.batch && r.batchId !== f.batch) return false;
      const day = zonedDateKey(windowOf(r)?.startMs ?? Date.parse(r.targetAt), r.timeZone);
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
        <button type="button" class="btn btn-secondary" data-export-csv>Export batches CSV</button>
        <button type="button" class="btn btn-secondary" data-export-obs>Export observations CSV</button>
      </div>
    </div>
    <form class="card filters" role="search" aria-label="Filter experiments">
      <div class="field grow">
        <label for="h-q">Search</label>
        <input id="h-q" name="q" type="search" value="${filters.q}" placeholder="Batch name, record ID, notes…">
      </div>
      <div class="field">
        <label for="h-status">Status</label>
        <select id="h-status" name="status">
          ${['all', 'planned', 'active', 'overdue', 'completed', 'cancelled'].map(
            (s) => html`<option value="${s}" ${filters.status === s ? 'selected' : ''}>${s === 'all' ? 'All' : s === 'overdue' ? 'Overdue or window passed' : STATUS_LABEL[s]}</option>`
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

    <section class="card backup" aria-labelledby="h-backup">
      <h2 id="h-backup">Data and backup</h2>
      <p>Records are stored only in this browser on this device. They are not synced to other devices or shared with other researchers, and clearing browser data deletes them.</p>
      <div id="backup-status"></div>
      <div class="action-bar">
        <button type="button" class="btn btn-secondary" data-export-json>Download backup (JSON)</button>
        <label class="btn btn-ghost file-btn">Restore from backup… <input type="file" accept="application/json,.json" data-import-json class="sr-only"></label>
      </div>
      <p class="hint">A restore checks the whole file first and changes nothing if any problem is found. Before restoring, a copy of the current data is kept in this browser.</p>
      <div id="restore-result" aria-live="polite"></div>
      <p class="hint">The observations CSV has one row per observation, including retracted ones (marked “retracted” with the time and reason). Estimated stages appear only in “Estimated stage (estimate)” columns.</p>
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
      <thead><tr><th scope="col">Batch</th><th scope="col">Sample</th><th scope="col">Eggs</th><th scope="col">Status</th><th scope="col">Target / estimated window</th><th scope="col">Remaining / outcome</th></tr></thead>
      <tbody>${shown.map(
        (r) => html`<tr>
          <td data-label="Batch"><div><a href="#/exp/${r.uid}"><strong>${displayName(r)}</strong></a><div class="muted small mono">${r.experimentId}</div></div></td>
          <td data-label="Sample">${r.batchId || '—'}</td>
          <td data-label="Eggs">${eggSummary(r)}</td>
          <td data-label="Status"><div class="badges">${statusBadge(r, now)}</div></td>
          <td data-label="Target / window">${windowOf(r)
            ? html`<span class="est-tag">estimate</span> ${formatWindow(windowOf(r), r.timeZone)}`
            : formatDateTime(Date.parse(r.targetAt), r.timeZone)}</td>
          <td data-label="Remaining / outcome">${r.status === 'completed'
            ? windowOf(r)
              ? `Done ${Date.parse(r.completedAt) < windowOf(r).startMs ? 'before' : Date.parse(r.completedAt) > windowOf(r).endMs ? 'after' : 'inside'} the window`
              : `Done, ${describeDelta(Date.parse(r.completedAt) - Date.parse(r.targetAt))}`
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
    toast(`Exported ${shown.length} batch${shown.length === 1 ? '' : 'es'} to CSV.`);
  });

  root.querySelector('[data-export-obs]').addEventListener('click', () => {
    const n = shown.reduce((k, r) => k + (r.observations?.length ?? 0), 0);
    if (!n) {
      toast('No observations in the batches shown.', 'warn');
      return;
    }
    const stamp = new Date(ctx.now()).toISOString().slice(0, 10);
    downloadFile(`embryotime-observations-${stamp}.csv`, observationsToCsv(shown), 'text/csv;charset=utf-8');
    toast(`Exported ${n} observation${n === 1 ? '' : 's'} (retracted ones included and marked).`);
  });

  const backupMeta = createBackupMetaStore();
  const renderBackupStatus = () => {
    root.querySelector('#backup-status').innerHTML = String(backupStatusPanel(ctx, { withButton: false }));
  };

  root.querySelector('[data-export-json]').addEventListener('click', () => downloadBackup(ctx, renderBackupStatus));

  root.querySelector('[data-import-json]').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const out = root.querySelector('#restore-result');
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      out.innerHTML = String(html`<div class="alert alert-error" role="alert"><strong>Not restored.</strong> “${file.name}” is not valid JSON. Nothing was changed.</div>`);
      return;
    }
    const v = validateBackup(data, { existing: ctx.experiments });
    if (!v.ok) {
      out.innerHTML = String(html`<div class="alert alert-error" role="alert"><strong>Not restored — nothing was changed.</strong> “${file.name}” has ${v.errors.length === 1 ? 'a problem' : 'problems'}:
        <ul>${v.errors.map((e) => html`<li>${e}</li>`)}</ul></div>`);
      return;
    }
    const byUid = new Map(ctx.experiments.map((r) => [r.uid, r]));
    const replacing = v.records.filter((r) => byUid.has(r.uid)).length;
    const obs = v.records.reduce((k, r) => k + r.observations.length, 0);
    const msg = `Restore ${v.records.length} batch(es) with ${obs} observation(s) from "${file.name}" (format ${v.format})?${
      replacing ? ` ${replacing} batch(es) already in this browser will be replaced by the file's version.` : ''
    } A copy of your current data is kept first.`;
    if (!window.confirm(msg)) return;
    try {
      const key = savePreRestoreCopy(ctx.experiments, ctx.now());
      for (const r of v.records) byUid.set(r.uid, r);
      await ctx.replaceAll([...byUid.values()]);
      toast(`Restored ${v.records.length} batch(es).`);
      ctx.rerender();
      document.querySelector('#restore-result')?.insertAdjacentHTML(
        'beforeend',
        String(html`<div class="alert alert-info">Restored ${v.records.length} batch(es). Your previous data was copied to browser storage key <code>${key}</code>.</div>`)
      );
    } catch (err) {
      out.innerHTML = String(html`<div class="alert alert-error" role="alert"><strong>Restore failed:</strong> ${err.message}. Your data was not replaced.</div>`);
    }
  });

  renderResults();
  renderBackupStatus();
  void backupMeta;
  return { tickRerender: false, onFlip: renderResults };
}
