// End-to-end tests of the real UI in headless Chrome, against the BUILT release (what GitHub
// Pages serves). Run with: npm run test:browser
// If no Chrome/Chromium is installed, every test is reported as SKIPPED (never as passed).

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, startSite } from './cdp.mjs';

let site;
let browser;
const H = 3_600_000;

before(async () => {
  site = await startSite();
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
  site?.stop();
});

/** Each test gets a fresh browser context (empty localStorage) and must end with no JS errors. */
function uiTest(name, fn, opts = {}) {
  test(name, async (t) => {
    if (!browser) {
      t.skip('Chrome/Chromium not found — set CHROME_PATH to run browser tests');
      return;
    }
    const page = await browser.newPage(opts);
    try {
      await page.goto(site.url + (opts.hash ?? '#/'));
      await fn(page);
      const csp = await page.eval('return window.__csp;');
      assert.deepEqual(csp, [], 'Content-Security-Policy violations');
      assert.deepEqual(page.errors, [], 'JavaScript errors in the page');
    } finally {
      await page.close();
    }
  });
}

// In-page helpers (string so they run inside the page).
const HELPERS = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s) => document.querySelector(s);
  const radio = (name, value) => { const el = document.querySelector('[name="' + name + '"][value="' + value + '"]'); el.click(); el.dispatchEvent(new Event('change', { bubbles: true })); };
  const num = async (id, v) => { const el = document.getElementById(id); el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); await wait(450); };
  const go = async (hash) => { location.hash = hash; await wait(250); };
  const records = () => JSON.parse(localStorage.getItem('embryotime.experiments.v1') || '{"experiments":[]}').experiments;
`;
const inPage = (page, body) => page.eval(HELPERS + body);

async function createStageBatch(page, { start = 'stage', current = 10, target = 12, ret = 'none', observed = false, name } = {}) {
  await inPage(
    page,
    `await go('#/new');
     radio('start', '${start}');
     ${start === 'stage' ? `await num('f-current-stage-num', ${current});` : ''}
     await num('f-target-stage-num', ${target});
     radio('plannedReturn', '${ret}');
     ${observed ? `document.querySelector('[name=stageObserved]').click();` : ''}
     ${name ? `const n = $('#f-name'); n.value = ${JSON.stringify(name)}; n.dispatchEvent(new Event('input', { bubbles: true }));` : ''}
     $('#exp-form').requestSubmit(); await wait(500);`
  );
  return inPage(page, 'return records().at(-1);');
}

// ---------- release ----------

uiTest('the page loads only modules from its own content-hashed release folder', async (page) => {
  const res = await inPage(
    page,
    `const rel = document.querySelector('meta[name="embryotime-release"]').content;
     const srcs = performance.getEntriesByType('resource').map((e) => new URL(e.name).pathname).filter((p) => /\\.(js|css)$/.test(p));
     return { rel, srcs };`
  );
  assert.match(res.rel, /^[0-9a-f]{10}$/);
  assert.ok(res.srcs.length > 10);
  for (const p of res.srcs) assert.ok(p.startsWith(`/r/${res.rel}/`), `${p} is outside release ${res.rel}`);
});

// ---------- creating batches ----------

uiTest('create a batch from freshly set eggs (known age 0 h)', async (page) => {
  const empty = await inPage(page, `await go('#/new'); return $('#preview-body').innerText;`);
  assert.match(empty, /No estimate yet/);
  const r = await createStageBatch(page, { start: 'fresh', target: 12 });
  assert.equal(r.stagePlan.start, 'fresh');
  assert.deepEqual(r.stagePlan.baselineAgeHours, [0, 0]);
  assert.deepEqual(r.stagePlan.windowHours, [45, 49]);
  assert.equal(r.stagePlan.currentStage, null);
  assert.deepEqual(r.observations, []); // 0 h is not an HH1 observation
  const tag = await inPage(page, `await go('#/'); return $('.nest-slot .egg-tag').innerText;`);
  assert.match(tag, /HH12 window/);
  assert.match(tag, /Window opens in/);
});

uiTest('create a batch with explicit HH stages; "observed" creates a setup observation', async (page) => {
  const r = await createStageBatch(page, { current: 10, target: 12, ret: 'middle', observed: true });
  assert.deepEqual(r.stagePlan.baselineAgeHours, [33, 38]);
  assert.deepEqual(r.stagePlan.windowHours, [7, 16]);
  assert.equal(r.stagePlan.plannedReturn, 'middle');
  assert.equal(r.observations.length, 1);
  assert.equal(r.observations[0].verdict, 'baseline');
  const details = await inPage(page, `await go('#/exp/${r.uid}'); return { table: $('.obs-table').innerText, chart: !!$('.stage-chart-svg'), planned: $('.target-card').innerText };`);
  assert.match(details.table, /At setup/);
  assert.match(details.table, /HH10/);
  assert.ok(details.chart);
  assert.match(details.planned, /Planned return \(middle of window\)/);
});

uiTest('missing and invalid stage selections are explained and nothing is saved', async (page) => {
  const res = await inPage(
    page,
    `await go('#/new');
     $('#exp-form').requestSubmit(); await wait(200);
     const first = $('#error-summary').innerText;
     radio('start', 'stage'); await wait(100);
     $('#exp-form').requestSubmit(); await wait(200);
     const noCurrent = $('#err-stages').textContent;
     await num('f-current-stage-num', 12); await num('f-target-stage-num', 10);
     const order = $('#err-stages').textContent;
     await num('f-current-stage-num', 1); await num('f-target-stage-num', 12);
     const hh1 = $('#err-stages').textContent;
     return { first, noCurrent, order, hh1, saved: records().length };`
  );
  assert.match(res.first, /starting point/);
  assert.match(res.first, /planned return|specific return/i);
  assert.match(res.noCurrent, /Choose the current HH stage/);
  assert.match(res.order, /later than the current stage/);
  assert.match(res.hh1, /no reference age/);
  assert.equal(res.saved, 0);
});

// ---------- wheel ----------

uiTest('wheel and number input stay in sync; keyboard works; invalid numbers are flagged', async (page) => {
  const res = await inPage(
    page,
    `await go('#/new');
     const w = $('#f-target-stage');
     const before = [w.dataset.value, w.getAttribute('aria-valuetext'), $('[name=targetStage]').value];
     await num('f-target-stage-num', 14);
     const afterNum = [w.getAttribute('aria-valuenow'), $('[name=targetStage]').value, $('#ref-target').innerText];
     w.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); await wait(500);
     const afterKey = [w.dataset.value, $('#f-target-stage-num').value];
     await num('f-target-stage-num', 99);
     const invalid = [$('#f-target-stage-num').getAttribute('aria-invalid'), w.dataset.value];
     return { before, afterNum, afterKey, invalid };`
  );
  assert.deepEqual(res.before, ['', 'Choose a stage', '']); // nothing pre-selected
  assert.equal(res.afterNum[0], '14');
  assert.equal(res.afterNum[1], '14');
  assert.match(res.afterNum[2], /HH14[\s\S]*50–53 h/);
  assert.deepEqual(res.afterKey, ['15', '15']);
  assert.deepEqual(res.invalid, ['true', '15']);
});

// ---------- window display and transitions ----------

uiTest('estimated window display and live state transitions', async (page) => {
  const r = await createStageBatch(page, { current: 10, target: 12 });
  const show = `await go('#/exp/${r.uid}'); await wait(300); return $('.target-card .window-state').textContent;`;
  assert.match(await inPage(page, show), /^Window opens in/);
  const card = await inPage(page, `return $('.target-card').innerText;`);
  assert.match(card, /Estimated HH12 window/i);
  assert.match(card, /No planned return time/i);
  await page.shiftClock(8 * H);
  await inPage(page, 'await wait(1300);');
  assert.match(await inPage(page, `return $('.target-card .window-state').textContent;`), /^In window · closes in/);
  await page.shiftClock(17 * H);
  await inPage(page, 'await wait(1300);');
  const after = await inPage(page, `return [$('.target-card .window-state').textContent, $('h1').innerText];`);
  assert.equal(after[0], 'Window passed');
  assert.match(after[1], /Window passed/i);
  // ICS export covers the whole window.
  await inPage(page, `$('[data-action=ics]').click(); await wait(300);`);
  const [ics] = await page.takeDownloads();
  const text = ics.text.replace(/\r\n /g, '');
  const z = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const placement = Date.parse(r.placementAt);
  assert.match(text, new RegExp(`DTSTART:${z(placement + 7 * H)}`));
  assert.match(text, new RegExp(`DTEND:${z(placement + 16 * H)}`));
});

// ---------- save / reopen / names ----------

uiTest('save and reopen a batch; edits are logged; name follows placement until edited', async (page) => {
  const names = await inPage(
    page,
    `await go('#/new');
     const auto1 = $('#f-name').value;
     $('#f-placementTime').value = '06:05'; $('#f-placementTime').dispatchEvent(new Event('input', { bubbles: true })); await wait(50);
     const auto2 = $('#f-name').value;
     $('#f-name').value = 'Somite series A'; $('#f-name').dispatchEvent(new Event('input', { bubbles: true }));
     $('#f-placementTime').value = '07:10'; $('#f-placementTime').dispatchEvent(new Event('input', { bubbles: true })); await wait(50);
     return { auto1, auto2, custom: $('#f-name').value };`
  );
  assert.match(names.auto1, /^[A-Z][a-z]+ \d{1,2}, \d{4} — \d{1,2}:\d{2} (AM|PM)$/);
  assert.match(names.auto2, /— 6:05 AM$/);
  assert.equal(names.custom, 'Somite series A');

  const r = await createStageBatch(page, { name: 'Somite series A' });
  await page.reload(); // data must survive a reload
  const reopen = await inPage(
    page,
    `await go('#/exp/${r.uid}/edit');
     const vals = [$('#f-name').value, $('#f-current-stage').dataset.value, $('#f-target-stage').dataset.value, document.querySelector('[name=plannedReturn]:checked')?.value];
     await num('f-target-stage-num', 13);
     $('#exp-form').requestSubmit(); await wait(500);
     return { vals, history: records()[0].history.at(-1), h1: $('h1').innerText };`
  );
  assert.deepEqual(reopen.vals, ['Somite series A', '10', '12', 'none']);
  assert.ok(reopen.history.changes.some((c) => c.field === 'stagePlan'));
  assert.match(reopen.h1, /Somite series A/);
});

uiTest('the batch name is the visible title everywhere; IDs stay available', async (page) => {
  const r = await createStageBatch(page, { name: 'Neural tube group' });
  const seen = await inPage(
    page,
    `const out = {};
     for (const h of ['#/', '#/workspace', '#/calendar', '#/history', '#/exp/${r.uid}']) { await go(h); out[h] = $('main').innerText; }
     return out;`
  );
  for (const [h, text] of Object.entries(seen)) assert.match(text, /Neural tube group/, `name missing on ${h}`);
  assert.match(seen['#/exp/' + r.uid], new RegExp(r.experimentId));
});

uiTest('calendar shows the estimated window and navigates to the batch', async (page) => {
  const r = await createStageBatch(page, { start: 'fresh', target: 20, name: 'Long window batch' });
  const res = await inPage(
    page,
    `await go('#/calendar');
     const items = [...document.querySelectorAll('.cal-item.cal-window')].map((a) => a.textContent.trim());
     document.querySelector('.cal-item.cal-window').click(); await wait(300);
     return { items, hash: location.hash, h1: $('h1').innerText };`
  );
  assert.ok(res.items.length >= 1);
  assert.ok(res.items.every((t) => /Long window batch/.test(t)));
  assert.equal(res.hash, `#/exp/${r.uid}`);
  assert.match(res.h1, /Long window batch/);
});

// ---------- observations ----------

uiTest('record an observation, then retract it with a required reason', async (page) => {
  const r = await createStageBatch(page, { current: 10, target: 12 });
  const res = await inPage(
    page,
    `await go('#/exp/${r.uid}');
     $('.action-bar [data-action=observe]').click(); await wait(200);
     const d = $('#dialog');
     const estimate = d.querySelector('[data-estimate]').innerText;
     const v = d.querySelector('[name=verdict][value=different]'); v.click(); v.dispatchEvent(new Event('change', { bubbles: true })); await wait(200);
     const preselected = d.querySelector('#obs-stage').dataset.value;
     await num('obs-stage-num', 14);
     d.querySelector('[name=note]').value = 'wrong tray';
     d.querySelector('form').requestSubmit(); await wait(500);
     const afterSave = { open: d.open, rows: document.querySelectorAll('.obs-table tbody tr').length, badges: localStorage.getItem('embryotime.badges.v1') };
     document.querySelector('[data-action=retract]').click(); await wait(200);
     d.querySelector('form').requestSubmit(); await wait(200);
     const needReason = d.querySelector('.dialog-error').textContent;
     d.querySelector('[name=reason]').value = 'Recorded on the wrong batch';
     d.querySelector('form').requestSubmit(); await wait(500);
     const rec = records()[0];
     return { estimate, preselected, afterSave, needReason, retractions: rec.retractions, obs: rec.observations.length,
       row: document.querySelector('.obs-table tbody tr').className, status: document.querySelector('.obs-table tbody tr').innerText };`
  );
  assert.match(res.estimate, /HH9–HH10/); // age carried as a range (33–38 h), not a midpoint
  assert.equal(res.preselected, ''); // the observed stage must be chosen explicitly
  assert.equal(res.afterSave.open, false);
  assert.equal(res.afterSave.rows, 1);
  assert.match(res.afterSave.badges, /first-look/);
  assert.match(res.needReason, /reason/i);
  assert.equal(res.retractions.length, 1);
  assert.equal(res.retractions[0].reason, 'Recorded on the wrong batch');
  assert.equal(res.obs, 1); // original kept
  assert.match(res.row, /is-retracted/);
  assert.match(res.status, /Retracted/i);
  // Badge stays unlocked, but the retracted observation no longer counts.
  const coll = await inPage(page, `await go('#/collection'); return $('.badge-progress .hint').textContent;`);
  assert.match(coll, /^0 observations recorded/);
});

uiTest('observation CSV export: one row per observation, retracted ones marked', async (page) => {
  const r = await createStageBatch(page, { current: 10, target: 12, observed: true, name: 'CSV, "quoted" batch' });
  const csv = await inPage(
    page,
    `await go('#/history'); $('[data-export-obs]').click(); await wait(300);
     return (await Promise.all(window.__downloads))[0];`
  );
  assert.match(csv.name, /^embryotime-observations-\d{4}-\d{2}-\d{2}\.csv$/);
  // Blob.text() decodes UTF-8 and drops the byte-order mark; the BOM itself is unit-tested.
  assert.ok(csv.text.replace(/^\uFEFF/, '').startsWith('Batch record ID,Batch name,Observation ID'));
  assert.match(csv.text, /"CSV, ""quoted"" batch"/);
  assert.match(csv.text, new RegExp(`${r.experimentId},`));
  assert.match(csv.text, /observed at setup/);
  assert.match(csv.text, /,active,/);
});

// ---------- backup and restore ----------

uiTest('backup status, valid restore with a pre-restore copy, and invalid backups rejected', async (page) => {
  await createStageBatch(page, { name: 'Backed up batch' });
  const res = await inPage(
    page,
    `await go('#/history');
     const before = $('#backup-status').innerText;
     $('[data-export-json]').click(); await wait(300);
     const after = $('#backup-status').innerText;
     const [backup] = await Promise.all(window.__downloads); window.__downloads = [];
     const restore = async (text, name = 'b.json') => {
       const input = $('[data-import-json]'); const dt = new DataTransfer(); dt.items.add(new File([text], name, { type: 'application/json' }));
       input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); await wait(400);
       return $('#restore-result').innerText;
     };
     const notJson = await restore('{oops', 'bad.json');
     const data = JSON.parse(backup.text);
     data.experiments[0].stagePlan.targetStage = 99;
     const bad = await restore(JSON.stringify(data), 'broken.json');
     const countAfterBad = records().length;
     window.name = backup.text; // survives the reload below
     localStorage.clear();
     return { before, after, notJson, bad, countAfterBad, backupName: backup.name };`
  );
  await page.reload();
  Object.assign(
    res,
    await inPage(
      page,
      `await go('#/history');
       const input = $('[data-import-json]'); const dt = new DataTransfer(); dt.items.add(new File([window.name], 'good.json', { type: 'application/json' }));
       input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); await wait(500);
       window.name = '';
       return { ok: $('#restore-result').innerText, restored: records().map((x) => x.name), keys: Object.keys(localStorage).filter((k) => k.includes('pre-restore')) };`
    )
  );
  assert.match(res.before, /No backup download recorded/);
  assert.match(res.after, /download started/);
  assert.match(res.backupName, /^embryotime-backup-/);
  assert.match(res.notJson, /not valid JSON[\s\S]*Nothing was changed/);
  assert.match(res.bad, /Not restored — nothing was changed[\s\S]*invalid target stage/);
  assert.equal(res.countAfterBad, 1);
  assert.match(res.ok, /Restored 1 batch/);
  assert.deepEqual(res.restored, ['Backed up batch']);
  assert.equal(res.keys.length, 1);
});

// ---------- legacy ----------

uiTest('legacy duration-based batch keeps its target until explicitly converted', async (page) => {
  const res = {};
  await inPage(
    page,
    `const now = Date.now();
     const legacy = { schemaVersion: 1, uid: 'legacy-1', experimentId: 'OLD-1', name: 'Old batch', batchId: 'S-1',
       currentIncubationMinutes: 2160, placementAt: new Date(now - 2 * 3600e3).toISOString(), timeZone: 'America/Toronto', waitMinutes: 720,
       targetAt: new Date(now + 10 * 3600e3).toISOString(), originalTargetAt: new Date(now + 10 * 3600e3).toISOString(), reminderOffsets: [30],
       notes: '', conditions: '', status: 'active', completedAt: null, completionNote: '', cancelledAt: null, cancelReason: '',
       calendar: { exportedAt: null, exportedTargetAt: null, sequence: 0 }, demo: false, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(),
       history: [{ at: new Date(now).toISOString(), action: 'created', summary: 'Created' }],
       observations: [{ id: 'o1', recordedAt: new Date(now).toISOString(), observedAt: new Date(now - 3600e3).toISOString(), ageMinutes: 2220,
         estimate: { stages: [10, 10], label: 'HH10', method: 'within', ageMinutes: 2220, referenceVersion: 'HH1951/UNSW-2026-10-26' }, verdict: 'match', observedStage: 10, note: 'old note' }] };
     localStorage.setItem('embryotime.experiments.v1', JSON.stringify({ schemaVersion: 1, experiments: [legacy] }));`
  );
  await page.reload();
  Object.assign(
    res,
    await inPage(
      page,
      `await go('#/exp/legacy-1');
     const beforeText = $('.target-card').innerText;
     $('.target-card [data-action=convert]').click(); await wait(250);
     const d = $('#dialog');
     await num('conv-stage-num', 12);
     const preview = d.querySelector('[data-preview]').innerText;
     const v = d.querySelector('[name=plannedReturn][value=none]'); v.click(); v.dispatchEvent(new Event('change', { bubbles: true }));
     d.querySelector('form').requestSubmit(); await wait(500);
     const rec = records()[0];
     return { beforeText, preview, plan: rec.stagePlan, last: rec.history.at(-1), obs: rec.observations, h: $('.target-card').innerText };`
    )
  );
  assert.match(res.beforeText, /Convert to stage-based timing/);
  assert.match(res.preview, /45–49 h − entered 36 h = 9–13 h/);
  assert.equal(res.plan.currentStageBasis, 'entered-duration');
  assert.deepEqual(res.plan.windowHours, [9, 13]);
  assert.equal(res.plan.convertedFrom.waitMinutes, 720);
  assert.equal(res.last.action, 'converted-to-stage');
  assert.equal(res.obs.length, 1);
  assert.equal(res.obs[0].note, 'old note');
  assert.match(res.h, /Estimated HH12 window/i);
});

// ---------- mobile, dark, accessibility ----------

uiTest(
  'mobile: form before the estimate panel, no horizontal scrolling, navigation works',
  async (page) => {
    const res = await inPage(
      page,
      `const out = {};
       await go('#/new');
       out.order = $('.form-main').getBoundingClientRect().top < $('.form-side').getBoundingClientRect().top;
       out.empty = $('#preview-body').innerText;
       for (const h of ['#/', '#/new', '#/workspace', '#/calendar', '#/history', '#/stages', '#/collection']) {
         await go(h); out[h] = document.documentElement.scrollWidth <= window.innerWidth;
       }
       document.querySelector('nav a[href="#/history"]').click(); await wait(250);
       out.nav = location.hash;
       return out;`
    );
    assert.equal(res.order, true);
    assert.match(res.empty, /No estimate yet/);
    for (const h of ['#/', '#/new', '#/workspace', '#/calendar', '#/history', '#/stages', '#/collection']) assert.equal(res[h], true, `horizontal scroll on ${h}`);
    assert.equal(res.nav, '#/history');
  },
  { width: 375, height: 812, mobile: true, colorScheme: 'dark' }
);

uiTest('dialogs: focus moves in, Escape closes, focus returns to the opener', async (page) => {
  const r = await createStageBatch(page, {});
  await inPage(page, `await go('#/exp/${r.uid}'); const b = $('.action-bar [data-action=observe]'); b.focus(); b.click(); await wait(200);`);
  const inside = await inPage(page, `return [$('#dialog').open, $('#dialog').contains(document.activeElement), $('#dialog').getAttribute('aria-labelledby')];`);
  assert.deepEqual(inside, [true, true, 'dialog-title']);
  await page.press('Escape');
  const out = await inPage(page, `await wait(150); return [$('#dialog').open, document.activeElement.dataset.action];`);
  assert.deepEqual(out, [false, 'observe']);
});

uiTest('accessible wheels, chart description with a table alternative, and status not by colour alone', async (page) => {
  const r = await createStageBatch(page, { observed: true });
  const res = await inPage(
    page,
    `await go('#/new');
     const w = $('#f-target-stage');
     const wheel = [w.getAttribute('role'), w.getAttribute('tabindex'), w.getAttribute('aria-label'), !!document.querySelector('label[for], .wheel-number .sr-only')];
     await go('#/exp/${r.uid}');
     const chart = $('.stage-chart-svg').getAttribute('aria-label');
     const table = !!$('.obs-table caption');
     const estTags = document.querySelectorAll('.est-tag').length;
     return { wheel, chart, table, estTags };`
  );
  assert.deepEqual(res.wheel, ['spinbutton', '0', 'Target HH stage', true]);
  assert.match(res.chart, /table below lists every observation/);
  assert.equal(res.table, true);
  assert.ok(res.estTags >= 2); // estimates labelled in text, not only by colour
});

uiTest(
  'reduced motion turns off animations',
  async (page) => {
    await createStageBatch(page, { start: 'fresh', target: 12 });
    const anim = await inPage(page, `await go('#/'); return [getComputedStyle($('.egg-wrap')).animationName, getComputedStyle($('.hen-bob')).animationName];`);
    assert.deepEqual(anim, ['none', 'none']);
  },
  { reducedMotion: true }
);
