// Short, non-blocking visual responses. Never intercepts clicks, never delays work,
// and with reduced motion it shows a static badge instead of movement.

import { badgeArt, chickArt, eggArt } from './art.js';

const PIECES = 14;

function overlay(className, inner, ms) {
  const el = document.createElement('div');
  el.className = `fx-overlay ${className}`;
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = inner;
  document.body.append(el);
  setTimeout(() => el.remove(), ms);
}

/** A chick pops out of its shell with a few pastel confetti pieces (~1.6 s). */
export function celebrateHatch(label = '') {
  const confetti = Array.from({ length: PIECES }, (_, i) => {
    const angle = (i / PIECES) * 360;
    const dist = 70 + (i % 3) * 22;
    return `<i class="fx-piece fx-c${i % 4}" style="--a:${angle}deg;--d:${dist}px;--delay:${(i % 5) * 30}ms"></i>`;
  }).join('');
  overlay('fx-hatch', `<div class="fx-stage">${confetti}<div class="fx-chick">${chickArt()}</div>${label ? `<div class="fx-label">${escapeText(label)}</div>` : ''}</div>`, 1700);
}

/** A tiny egg drops in — used after saving a new batch. */
export function celebrateSaved(label = '') {
  overlay('fx-saved', `<div class="fx-stage"><div class="fx-egg">${eggArt({ stage: 'warming' })}</div>${label ? `<div class="fx-label">${escapeText(label)}</div>` : ''}</div>`, 1300);
}

/** Badge unlocked: a small medallion pops in. Static with reduced motion. */
export function celebrateBadge(badge) {
  overlay(
    'fx-badge',
    `<div class="fx-stage"><div class="fx-medal">${badgeArt(badge.art)}</div><div class="fx-label">Badge unlocked: ${escapeText(badge.title)}</div></div>`,
    1800
  );
}

function escapeText(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
