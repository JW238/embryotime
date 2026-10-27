// Reusable wheel selector (scroll-snap column) with keyboard support and an optional
// synchronized number input. Each wheel is one focusable role="spinbutton": Arrow keys ±1,
// PageUp/PageDown ±5, Home/End. Scrolling, clicking or tapping an item also selects it.
// There is no timing-sensitive type-ahead: exact values go into the number input.
// A wheel created with value null starts in an explicit "not selected" state.

import { html } from './dom.js';
import { HH_MAX, HH_MIN, formatReferenceAge, getStage } from '../hh-stages.js';
import { splitMinutes } from '../time.js';

const ITEM = 36; // px; must match .wheel-list li height in styles.css

/** options: [{ value: number, label: string }]; value null = nothing selected yet. */
export function wheel({ id, label, options, value, unit = '', errorKey = '', describedBy = '', numberInput = false, emptyText = 'Not selected' }) {
  const empty = value === null || value === undefined || value === '';
  const idx = empty ? 0 : Math.max(0, options.findIndex((o) => o.value === value));
  const current = options[idx];
  const numberId = `${id}-num`;
  return html`<div class="wheel-wrap">
    <div class="wheel ${empty ? 'is-empty' : ''}" id="${id}" data-wheel role="spinbutton" tabindex="0" aria-label="${label}"
      aria-valuemin="${options[0].value}" aria-valuemax="${options.at(-1).value}"
      ${empty ? html`aria-valuetext="${emptyText}"` : html`aria-valuenow="${current.value}" aria-valuetext="${current.label}"`}
      data-value="${empty ? '' : current.value}" data-start-index="${idx}" ${errorKey ? html`data-error-key="${errorKey}"` : ''}
      ${describedBy ? html`aria-describedby="${describedBy}"` : ''} ${numberInput ? html`data-number="${numberId}"` : ''}>
      <div class="wheel-viewport">
        <ul class="wheel-list" aria-hidden="true">
          ${options.map((o) => html`<li data-v="${o.value}" class="${!empty && o.value === current.value ? 'is-selected' : ''}">${o.label}</li>`)}
        </ul>
      </div>
      ${unit ? html`<span class="wheel-unit" aria-hidden="true">${unit}</span>` : ''}
      <span class="wheel-empty" aria-hidden="true">${emptyText}</span>
    </div>
    ${numberInput
      ? html`<label class="wheel-number"><span class="sr-only">${label} (type a number)</span>
          <input type="number" id="${numberId}" inputmode="numeric" min="${options[0].value}" max="${options.at(-1).value}" step="1"
            value="${empty ? '' : current.value}" placeholder="—" ${errorKey ? html`data-error-key="${errorKey}"` : ''}></label>`
      : ''}
  </div>`;
}

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const numberOptions = (from, to) => range(from, to).map((v) => ({ value: v, label: String(v) }));

/**
 * Day/hour/minute wheels that write a total duration into two hidden inputs
 * (`<name>Hours`, `<name>Minutes`) — the same fields the form validated before.
 */
export function durationWheels({ name, label, totalMinutes = 0, maxDays = 30, errorKey, describedBy }) {
  const { hours, minutes } = splitMinutes(Math.max(0, totalMinutes));
  const days = Math.floor(hours / 24);
  const dayMax = Math.max(maxDays, days);
  return html`<div class="duration-wheels" data-duration="${name}" role="group" aria-label="${label}">
    ${wheel({ id: `f-${name}-d`, label: `${label}: days`, options: numberOptions(0, dayMax), value: days, unit: 'd', errorKey, describedBy, numberInput: true })}
    ${wheel({ id: `f-${name}-h`, label: `${label}: hours`, options: numberOptions(0, 23), value: hours % 24, unit: 'h', errorKey, describedBy, numberInput: true })}
    ${wheel({ id: `f-${name}-m`, label: `${label}: minutes`, options: numberOptions(0, 59), value: minutes, unit: 'min', errorKey, describedBy, numberInput: true })}
    <input type="hidden" name="${name}Hours" value="${hours}">
    <input type="hidden" name="${name}Minutes" value="${minutes}">
    <output class="duration-total" aria-live="polite"></output>
  </div>`;
}

export function stageWheel({ id, label = 'HH stage', value = 10, from = HH_MIN, to = HH_MAX, describedBy = '', numberInput = false, errorKey = '' }) {
  const v = value === null || value === undefined || value === '' ? null : Math.min(to, Math.max(from, Number(value)));
  return wheel({
    id,
    label,
    options: range(from, to).map((s) => ({ value: s, label: `HH${s}` })),
    value: v,
    describedBy,
    numberInput,
    errorKey,
    emptyText: 'Choose a stage',
  });
}

/** Reference card for one stage: listed age and identifying features (with source). */
export function stageReference(stage) {
  const s = getStage(Number(stage));
  if (!s) return html`<div class="stage-ref stage-ref-empty"><p class="muted">No stage selected yet.</p></div>`;
  return html`<div class="stage-ref">
    <div class="stage-ref-head"><span class="stage-ref-num">HH${s.stage}</span>
      <span class="stage-ref-age">Reference age: <strong>${formatReferenceAge(s)}</strong></span></div>
    <p class="stage-ref-features">${s.features}</p>
  </div>`;
}

// ---------- behaviour ----------

/** Selected value, or null when nothing has been chosen yet. */
export function getWheelValue(el) {
  return el.dataset.value === '' ? null : Number(el.dataset.value);
}

function items(el) {
  return [...el.querySelectorAll('.wheel-list li')];
}

function numberFor(el) {
  return el.dataset.number ? document.getElementById(el.dataset.number) ?? el.parentElement.querySelector('input[type=number]') : null;
}

export function setWheelValue(el, value, { smooth = false, silent = false, fromNumber = false } = {}) {
  const list = items(el);
  const idx = list.findIndex((li) => Number(li.dataset.v) === value);
  if (idx < 0) return;
  const changed = getWheelValue(el) !== value;
  el.dataset.value = String(value);
  el.classList.remove('is-empty');
  el.setAttribute('aria-valuenow', String(value));
  el.setAttribute('aria-valuetext', list[idx].textContent);
  list.forEach((li, i) => li.classList.toggle('is-selected', i === idx));
  scrollToIndex(el, idx, smooth);
  const num = numberFor(el);
  if (num && !fromNumber) num.value = String(value);
  if (changed && !silent) el.dispatchEvent(new CustomEvent('wheelchange', { bubbles: true, detail: { value } }));
}

function scrollToIndex(el, idx, smooth) {
  const vp = el.querySelector('.wheel-viewport');
  el._programmatic = true;
  vp.scrollTo({ top: idx * ITEM, behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' });
  clearTimeout(el._progTimer);
  el._progTimer = setTimeout(() => (el._programmatic = false), smooth ? 400 : 60);
}

function reducedMotion() {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Wire up every wheel inside root. Safe to call again on re-rendered content. */
export function attachWheels(root) {
  for (const el of root.querySelectorAll('[data-wheel]')) {
    if (el._wheelReady) continue;
    el._wheelReady = true;
    const vp = el.querySelector('.wheel-viewport');
    const list = items(el);
    const values = list.map((li) => Number(li.dataset.v));
    const v0 = getWheelValue(el);
    if (v0 === null) scrollToIndex(el, Number(el.dataset.startIndex) || 0, false);
    else setWheelValue(el, v0, { silent: true });

    // Only scrolling the user actually does selects a value (never layout or programmatic scroll).
    const markUser = () => (el._userUntil = performance.now() + 1500);
    for (const ev of ['wheel', 'touchstart', 'touchmove', 'pointerdown']) vp.addEventListener(ev, markUser, { passive: true });
    vp.addEventListener('scroll', () => {
      if (el._programmatic || !(performance.now() < (el._userUntil ?? 0))) return;
      clearTimeout(el._scrollTimer);
      el._scrollTimer = setTimeout(() => {
        const idx = Math.max(0, Math.min(list.length - 1, Math.round(vp.scrollTop / ITEM)));
        setWheelValue(el, values[idx]);
      }, 120);
    });
    el.querySelector('.wheel-list').addEventListener('click', (e) => {
      const li = e.target.closest('li');
      if (li) {
        setWheelValue(el, Number(li.dataset.v), { smooth: true });
        el.focus({ preventScroll: true });
      }
    });
    el.addEventListener('keydown', (e) => {
      const cur = getWheelValue(el);
      const i = cur === null ? -1 : values.indexOf(cur);
      const go = (j) => {
        e.preventDefault();
        setWheelValue(el, values[Math.max(0, Math.min(values.length - 1, j))], { smooth: true });
      };
      if (e.key === 'ArrowDown') go(i + 1);
      else if (e.key === 'ArrowUp') go(i < 0 ? 0 : i - 1);
      else if (e.key === 'PageDown') go(i + 5);
      else if (e.key === 'PageUp') go(i < 0 ? 0 : i - 5);
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(values.length - 1);
    });

    // Number input ⇄ wheel. Invalid or out-of-range numbers are flagged, not clamped silently.
    const num = numberFor(el);
    if (num) {
      num.addEventListener('input', () => {
        const raw = num.value.trim();
        const n = Number(raw);
        const ok = raw !== '' && Number.isInteger(n) && values.includes(n);
        num.setAttribute('aria-invalid', raw === '' || ok ? 'false' : 'true');
        if (ok) setWheelValue(el, n, { smooth: true, fromNumber: true });
      });
      num.addEventListener('change', () => {
        if (num.getAttribute('aria-invalid') === 'true' && getWheelValue(el) !== null) num.value = String(getWheelValue(el));
      });
    }
  }

  // Duration groups: keep hidden total-hours/minutes inputs in sync with their wheels.
  for (const group of root.querySelectorAll('[data-duration]')) {
    if (group._durationReady) continue;
    group._durationReady = true;
    const name = group.dataset.duration;
    const [dW, hW, mW] = group.querySelectorAll('[data-wheel]');
    const hoursIn = group.querySelector(`[name="${name}Hours"]`);
    const minutesIn = group.querySelector(`[name="${name}Minutes"]`);
    const total = group.querySelector('.duration-total');
    const sync = (emit) => {
      const hours = getWheelValue(dW) * 24 + getWheelValue(hW);
      hoursIn.value = String(hours);
      minutesIn.value = String(getWheelValue(mW));
      total.textContent = `= ${hours} h${getWheelValue(mW) ? ` ${getWheelValue(mW)} min` : ''}`;
      if (emit) group.dispatchEvent(new Event('input', { bubbles: true }));
    };
    group.addEventListener('wheelchange', () => sync(true));
    sync(false);
    group._setTotalMinutes = (totalMinutes) => {
      const { hours, minutes } = splitMinutes(totalMinutes);
      setWheelValue(dW, Math.floor(hours / 24), { smooth: true, silent: true });
      setWheelValue(hW, hours % 24, { smooth: true, silent: true });
      setWheelValue(mW, minutes, { smooth: true, silent: true });
      sync(true);
    };
  }
}
