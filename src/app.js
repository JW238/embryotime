// App shell: routing, state, persistence wiring and the 1-second countdown ticker.

import { html, mount, toast } from './ui/dom.js';
import { countdownText, errorPanel, formatLongDuration } from './ui/components.js';
import { createLocalRepository, createProfileStore, PROFILE_KEY, STORAGE_KEY } from './storage.js';
import { getSystemTimeZone, zonedDateKey } from './time.js';
import { renderHatchery } from './ui/views/hatchery.js';
import { renderDashboard } from './ui/views/dashboard.js';
import { renderForm } from './ui/views/form.js';
import { renderDetails } from './ui/views/details.js';
import { renderHistory } from './ui/views/history.js';
import { renderCalendar } from './ui/views/calendar.js';

const main = document.getElementById('main');

const profileStore = createProfileStore();

const state = {
  experiments: [],
  profile: profileStore.load(),
  repo: null,
  loadError: null,
  view: null, // what the current view returned: { tickRerender, onFlip }
  route: null,
};

const ctx = {
  now: () => Date.now(),
  browserTimeZone: getSystemTimeZone(),
  get experiments() {
    return state.experiments;
  },
  get profile() {
    return state.profile;
  },
  saveProfile(profile) {
    state.profile = profileStore.save(profile);
  },
  find: (uid) => state.experiments.find((r) => r.uid === uid) ?? null,
  async save(record) {
    requireRepo();
    await state.repo.save(record);
    const i = state.experiments.findIndex((r) => r.uid === record.uid);
    if (i >= 0) state.experiments[i] = record;
    else state.experiments.push(record);
  },
  async remove(uid) {
    requireRepo();
    await state.repo.remove(uid);
    state.experiments = state.experiments.filter((r) => r.uid !== uid);
  },
  async replaceAll(list) {
    requireRepo();
    await state.repo.replaceAll(list);
    state.experiments = list;
  },
  navigate(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  },
  rerender: () => render({ keepScroll: true }),
};

function requireRepo() {
  if (!state.repo || state.loadError) throw new Error('Saving is disabled because stored data could not be loaded.');
}

function parseRoute() {
  const hash = location.hash || '#/';
  const [path, query = ''] = hash.slice(1).split('?');
  const params = Object.fromEntries(new URLSearchParams(query));
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return { name: 'hatchery', laid: params.laid };
  if (parts[0] === 'workspace') return { name: 'dashboard' };
  if (parts[0] === 'new') return { name: 'form', mode: 'create', from: params.from };
  if (parts[0] === 'exp' && parts[1] && parts[2] === 'edit') return { name: 'form', mode: 'edit', uid: parts[1] };
  if (parts[0] === 'exp' && parts[1]) return { name: 'details', uid: parts[1] };
  if (parts[0] === 'history') return { name: 'history' };
  if (parts[0] === 'calendar') return { name: 'calendar' };
  return { name: 'notfound' };
}

const NAV_FOR = { hatchery: 'hatchery', dashboard: 'workspace', details: 'hatchery', form: 'new', history: 'history', calendar: 'calendar' };

function render({ keepScroll = false } = {}) {
  const route = parseRoute();
  const routeChanged = JSON.stringify(route) !== JSON.stringify(state.route);
  state.route = route;

  document.querySelectorAll('[data-nav]').forEach((a) => {
    if (a.dataset.nav === NAV_FOR[route.name]) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });

  try {
    if (state.loadError) {
      mount(
        main,
        html`<h1>EmbryoTime</h1>${errorPanel(
          state.loadError,
          html`<p>Your previous data has not been deleted. You can reset storage to start over (a copy of the unreadable data stays in browser storage).</p>
            <button type="button" class="btn btn-danger" id="reset-storage">Reset storage</button>`
        )}`
      );
      main.querySelector('#reset-storage').addEventListener('click', async () => {
        if (!window.confirm('Start with empty storage? The unreadable data is kept as a separate backup key.')) return;
        await state.repo?.reset();
        location.reload();
      });
      state.view = null;
      return;
    }
    const views = {
      hatchery: () => renderHatchery(main, ctx, route),
      dashboard: () => renderDashboard(main, ctx),
      form: () => renderForm(main, ctx, route),
      details: () => renderDetails(main, ctx, route),
      history: () => renderHistory(main, ctx),
      calendar: () => renderCalendar(main, ctx),
      notfound: () => {
        mount(main, html`<div class="empty"><h1>Page not found</h1><a class="btn btn-primary" href="#/">Go to the hatchery</a></div>`);
        return null;
      },
    };
    state.view = views[route.name]() ?? null;
  } catch (err) {
    console.error(err);
    mount(main, errorPanel(`This page could not be displayed: ${err.message}`, html`<a href="#/">Back to dashboard</a>`));
    state.view = null;
  }

  if (routeChanged && !keepScroll) {
    window.scrollTo(0, 0);
    main.focus({ preventScroll: true });
  }
  document.title = `${main.querySelector('h1')?.textContent.trim() || 'EmbryoTime'} · EmbryoTime`;
}

// ---------- ticker ----------

let lastDayKey = zonedDateKey(Date.now(), ctx.browserTimeZone);
let lastMinute = Math.floor(Date.now() / 60_000);

function tick() {
  const now = ctx.now();
  let flipped = false;
  for (const el of main.querySelectorAll('[data-countdown]')) {
    const target = Number(el.dataset.countdown);
    const overdue = target <= now;
    if (String(overdue) !== el.dataset.overdue) {
      flipped = true;
      el.dataset.overdue = String(overdue);
      el.classList.toggle('is-overdue', overdue);
    }
    el.textContent = countdownText(target, now);
  }
  for (const el of main.querySelectorAll('[data-progress-start]')) {
    const start = Number(el.dataset.progressStart);
    const end = Number(el.dataset.progressEnd);
    const pct = end > start ? Math.round(Math.min(1, Math.max(0, (now - start) / (end - start))) * 1000) / 10 : 100;
    el.firstElementChild.style.width = `${pct}%`;
    el.setAttribute('aria-valuenow', String(Math.round(pct)));
  }
  for (const el of main.querySelectorAll('[data-elapsed-since]')) {
    const minutes = Number(el.dataset.base) + Math.max(0, Math.floor((now - Number(el.dataset.elapsedSince)) / 60_000));
    el.textContent = formatLongDuration(minutes);
  }
  const minute = Math.floor(now / 60_000);
  if (minute !== lastMinute) {
    lastMinute = minute;
    state.view?.onMinute?.();
  }
  const dayKey = zonedDateKey(now, ctx.browserTimeZone);
  const dayChanged = dayKey !== lastDayKey;
  lastDayKey = dayKey;
  if (!flipped && !dayChanged) return;
  if (document.getElementById('dialog').open) return;
  if (state.view?.tickRerender) ctx.rerender();
  else state.view?.onFlip?.();
  if (flipped && state.route?.name !== 'form') toast('An experiment has reached its target time.', 'warn');
}

// ---------- start ----------

const PREVIEW_NOTICE_KEY = 'embryotime.previewNoticeDismissed';

/** Explains that data is per-browser. Dismissal is a per-viewer convenience only. */
function setUpPreviewNotice() {
  const banner = document.getElementById('preview-banner');
  if (!banner) return;
  let dismissed = false;
  try {
    dismissed = localStorage.getItem(PREVIEW_NOTICE_KEY) === '1';
  } catch {
    // storage unavailable: just show the notice
  }
  banner.hidden = dismissed;
  document.getElementById('preview-dismiss').addEventListener('click', () => {
    banner.hidden = true;
    try {
      localStorage.setItem(PREVIEW_NOTICE_KEY, '1');
    } catch {
      // ignore
    }
  });
}

async function init() {
  try {
    state.repo = createLocalRepository();
    state.experiments = await state.repo.list();
  } catch (err) {
    state.loadError = err.message;
  }
  // Ignore in-page anchors such as the skip link ("#main").
  window.addEventListener('hashchange', () => {
    if (location.hash === '' || location.hash.startsWith('#/')) render();
  });
  // Another tab changed the data: reload it, but never wipe out a form being edited.
  window.addEventListener('storage', async (e) => {
    if (e.key === PROFILE_KEY) {
      state.profile = profileStore.load();
      if (state.route?.name !== 'form') ctx.rerender();
      return;
    }
    if (e.key !== STORAGE_KEY || !state.repo) return;
    try {
      state.experiments = await state.repo.list();
      if (state.route?.name === 'form') toast('Experiments were changed in another tab. Saving here keeps your edits.', 'warn');
      else ctx.rerender();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  document.getElementById('footer-tz').textContent = ctx.browserTimeZone;
  setUpPreviewNotice();
  render();
  setInterval(tick, 1000);
}

init();
