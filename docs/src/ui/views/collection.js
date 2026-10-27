// Egg Collection: badges for recording stage observations. Reads observations only; the
// unlock dates live in their own local store and never touch experiment records.

import { html, mount } from '../dom.js';
import { badgeArt } from '../art.js';
import { BADGES, COUNTING_RULES, badgeProgress, countObservations, createBadgeStore } from '../../badges.js';
import { formatDate } from '../../time.js';

export function badgeProgressBar(p) {
  const pct = Math.round(p.fraction * 100);
  return html`<div class="badge-progress">
    <div class="progress" role="progressbar" aria-label="Progress toward the next badge" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}">
      <span style="width:${pct}%"></span>
    </div>
    <p class="hint">${p.next
      ? `${p.count} observation${p.count === 1 ? '' : 's'} recorded · ${p.remaining} more to “${p.next.title}”`
      : `${p.count} observations recorded · all badges collected`}</p>
  </div>`;
}

export function renderCollection(container, ctx) {
  const count = countObservations(ctx.experiments);
  const p = badgeProgress(count);
  const { unlocked } = createBadgeStore().load();

  mount(
    container,
    html`<div class="page-head">
      <div>
        <h1>Egg collection</h1>
        <p class="subtitle">Badges for recording HH stage observations. Every recorded observation counts the same, whatever the answer.</p>
      </div>
    </div>
    <section class="card">
      <h2>Next badge</h2>
      ${badgeProgressBar(p)}
    </section>
    <ul class="badge-grid" aria-label="Badges">
      ${BADGES.map((b) => {
        const got = unlocked[b.id] || count >= b.threshold;
        return html`<li class="badge-card ${got ? 'is-unlocked' : 'is-locked'}">
          <div class="badge-medal">${badgeArt(b.art)}</div>
          <h3>${b.title}</h3>
          <p class="badge-how">${b.unlock}</p>
          <p class="badge-state">${got
            ? html`<span class="badge-ok">✓ Unlocked</span>${unlocked[b.id] ? html` <span class="muted small">${formatDate(Date.parse(unlocked[b.id]), ctx.browserTimeZone)}</span>` : ''}`
            : html`<span class="muted">Locked · ${b.threshold - Math.min(count, b.threshold)} to go</span>`}</p>
        </li>`;
      })}
    </ul>
    <section class="card">
      <h2>How observations are counted</h2>
      <ul class="rules">${COUNTING_RULES.map((r) => html`<li>${r}</li>`)}</ul>
      <p class="hint">Badges are stored only in this browser, separately from your experiment records. They never change scientific data and are not shared or ranked.</p>
    </section>`
  );
  return null;
}
