import { html, mount } from '../dom.js';
import { emptyState, experimentCard, totalsStrip } from '../components.js';
import { bindActions, loadDemoData, removeDemoData } from '../actions.js';
import { STATUS, batchTotals, byTarget, effectiveStatus, formatEggs, isDueToday, isOpen, isOverdue } from '../../experiment.js';

export function renderDashboard(container, ctx) {
  const now = ctx.now();
  const all = ctx.experiments;
  const open = all.filter(isOpen).sort(byTarget);
  const overdue = open.filter((r) => isOverdue(r, now));
  const upcoming = open.filter((r) => !isOverdue(r, now));
  const active = open.filter((r) => effectiveStatus(r, now) === STATUS.ACTIVE);
  const planned = open.filter((r) => effectiveStatus(r, now) === STATUS.PLANNED);
  const dueToday = open.filter((r) => isDueToday(r, now));
  const hasDemo = all.some((r) => r.demo);

  const totals = batchTotals(all, now);
  const stat = (label, value, kind = '', sub = '') =>
    html`<div class="stat ${kind}"><div class="stat-value">${value}</div><div class="stat-label">${label}</div>${sub ? html`<div class="stat-sub">${sub}</div>` : ''}</div>`;

  const root = mount(
    container,
    html`<div class="page-head">
      <div>
        <h1>Research workspace</h1>
        <p class="subtitle">Every open experiment as a compact card, earliest target first.</p>
      </div>
      <a class="btn btn-primary" href="#/new">+ New batch</a>
    </div>
    ${hasDemo
      ? html`<div class="alert alert-info">Demo data is loaded — records marked <span class="badge badge-demo">Demo</span> are examples, not real experiments.
          <button type="button" class="link" data-remove-demo>Remove demo data</button></div>`
      : ''}
    <section class="stats" aria-label="Summary">
      ${stat('Active batches', active.length, '', formatEggs(totals.eggsActive))}
      ${stat('Due today', dueToday.length, dueToday.length ? 'stat-accent' : '', formatEggs(totals.eggsDueToday))}
      ${stat('Overdue batches', overdue.length, overdue.length ? 'stat-danger' : '')}
      ${stat('Planned batches', planned.length, '', formatEggs(totals.eggsPlanned))}
    </section>
    ${all.length ? totalsStrip(totals, { label: 'All batches' }) : ''}
    ${all.length === 0
      ? emptyState(
          'No experiments yet',
          'Create an experiment to calculate when you need to be back in the lab. You can also load clearly labelled demo data to explore the app.',
          html`<a class="btn btn-primary" href="#/new">Create experiment</a> <button type="button" class="btn btn-secondary" data-load-demo>Load demo data</button>`
        )
      : html`
        ${overdue.length
          ? html`<section aria-labelledby="h-overdue">
              <h2 id="h-overdue" class="section-title danger">Overdue or window passed (${overdue.length})</h2>
              <div class="card-grid">${overdue.map((r) => experimentCard(r, now))}</div>
            </section>`
          : ''}
        <section aria-labelledby="h-upcoming">
          <h2 id="h-upcoming" class="section-title">Upcoming (${upcoming.length})</h2>
          ${upcoming.length
            ? html`<div class="card-grid">${upcoming.map((r) => experimentCard(r, now))}</div>`
            : html`<p class="muted empty-inline">No upcoming experiments. <a href="#/history">View history</a></p>`}
        </section>`}`
  );

  bindActions(root, ctx);
  root.querySelector('[data-load-demo]')?.addEventListener('click', () => loadDemoData(ctx));
  root.querySelector('[data-remove-demo]')?.addEventListener('click', () => removeDemoData(ctx));
  return { tickRerender: true };
}
