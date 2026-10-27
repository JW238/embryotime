// Tiny Chrome DevTools Protocol driver for browser tests — no npm dependencies.
// Uses an installed Chrome/Chromium (CHROME_PATH, or the usual install locations) and Node's
// built-in WebSocket (Node 22+). Each test page gets its own incognito-like browser context,
// so localStorage never leaks between tests and never touches a real profile.

import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

export function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) ?? null;
}

/** Build the release into a temp folder and serve it exactly as it will be published. */
export async function startSite() {
  const out = mkdtempSync(join(tmpdir(), 'embryotime-site-'));
  execFileSync(process.execPath, [join(ROOT, 'scripts/build.mjs'), '--out', out], { cwd: ROOT });
  const server = spawn(process.execPath, [join(ROOT, 'server.js')], { env: { ...process.env, SITE_ROOT: out, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const port = await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('server did not start')), 10_000);
    server.stdout.on('data', (d) => {
      const m = /localhost:(\d+)/.exec(String(d));
      if (m) {
        clearTimeout(t);
        res(Number(m[1]));
      }
    });
  });
  return {
    url: `http://127.0.0.1:${port}/`,
    out,
    stop() {
      server.kill();
      rmSync(out, { recursive: true, force: true });
    },
  };
}

export async function launchBrowser() {
  const exe = findChrome();
  if (!exe) return null;
  const profile = mkdtempSync(join(tmpdir(), 'embryotime-chrome-'));
  const proc = spawn(exe, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    'about:blank',
  ]);
  const wsUrl = await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('Chrome did not start')), 20_000);
    proc.stderr.on('data', (d) => {
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(String(d));
      if (m) {
        clearTimeout(t);
        res(m[1]);
      }
    });
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let nextId = 1;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve: ok, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} ${msg.error.data ?? ''}`));
      else ok(msg.result);
    } else for (const l of listeners) l(msg);
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((ok, reject) => {
      const id = nextId++;
      pending.set(id, { resolve: ok, reject });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });

  return {
    async newPage({ width = 1280, height = 900, mobile = false, colorScheme = 'light', reducedMotion = false } = {}) {
      const { browserContextId } = await send('Target.createBrowserContext', { disposeOnDetach: true });
      const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      const s = (m, p) => send(m, p, sessionId);
      const errors = [];
      const downloads = [];
      const onEvent = (msg) => {
        if (msg.sessionId !== sessionId) return;
        if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
        if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
        if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error' && !/favicon/.test(msg.params.entry.url ?? '')) errors.push(msg.params.entry.text);
      };
      listeners.add(onEvent);
      await s('Page.enable');
      await s('Runtime.enable');
      await s('Log.enable');
      await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
      await s('Emulation.setEmulatedMedia', {
        features: [
          { name: 'prefers-color-scheme', value: colorScheme },
          { name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : 'no-preference' },
        ],
      });
      // Test hooks installed before any page script: controllable clock, auto-confirm,
      // captured downloads (blob contents read back) and CSP violation tracking.
      await s('Page.addScriptToEvaluateOnNewDocument', {
        source: `
          (() => {
            const realNow = Date.now.bind(Date);
            let shift = 0;
            try { shift = Number(sessionStorage.getItem('__shift') || 0); } catch {}
            window.__shift = shift;
            Date.now = () => realNow() + window.__shift;
            window.__confirmAnswer = true;
            window.confirm = () => window.__confirmAnswer;
            window.__downloads = [];
            // Keep the Blob behind each object URL so downloads can be read back without
            // fetch(blob:), which the app's Content-Security-Policy correctly blocks.
            const blobs = new Map();
            const createURL = URL.createObjectURL.bind(URL);
            URL.createObjectURL = (b) => { const u = createURL(b); blobs.set(u, b); return u; };
            const click = HTMLAnchorElement.prototype.click;
            HTMLAnchorElement.prototype.click = function () {
              if (this.download) {
                const name = this.download;
                const blob = blobs.get(this.href);
                window.__downloads.push((blob ? blob.text() : Promise.resolve('')).then((text) => ({ name, text })));
                return;
              }
              return click.call(this);
            };
            window.__csp = [];
            document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
          })();`,
      });
      const page = {
        errors,
        downloads,
        async goto(url) {
          const loaded = new Promise((ok) => {
            const l = (msg) => {
              if (msg.sessionId === sessionId && msg.method === 'Page.loadEventFired') {
                listeners.delete(l);
                ok();
              }
            };
            listeners.add(l);
          });
          await s('Page.navigate', { url });
          await loaded;
          await page.waitFor('document.querySelector("main .view")');
        },
        /** Reload outside of any evaluate call (a reload would cut that call off). */
        async reload() {
          const loaded = new Promise((ok) => {
            const l = (msg) => {
              if (msg.sessionId === sessionId && msg.method === 'Page.loadEventFired') {
                listeners.delete(l);
                ok();
              }
            };
            listeners.add(l);
          });
          await s('Page.reload', {});
          await loaded;
          await page.waitFor('document.querySelector("main .view")');
        },
        async eval(expression) {
          const r = await s('Runtime.evaluate', { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true });
          if (r.exceptionDetails) throw new Error(`In page: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
          return r.result.value;
        },
        async waitFor(expr, timeout = 5000) {
          const start = Date.now();
          for (;;) {
            const ok = await page.eval(`return Boolean(${expr});`).catch(() => false);
            if (ok) return;
            if (Date.now() - start > timeout) throw new Error(`Timed out waiting for: ${expr}`);
            await new Promise((r) => setTimeout(r, 50));
          }
        },
        /** Shift the app clock (persists across reloads in this tab). */
        async shiftClock(ms) {
          await page.eval(`sessionStorage.setItem('__shift', String(${ms})); window.__shift = ${ms};`);
        },
        async takeDownloads() {
          return page.eval(`const d = await Promise.all(window.__downloads); window.__downloads = []; return d;`);
        },
        async setViewport(w, h, isMobile = false) {
          await s('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: isMobile });
        },
        /** Real keyboard input (goes to the focused element, like a user's key press). */
        async press(key) {
          const code = { Escape: 'Escape', Enter: 'Enter', Tab: 'Tab', ArrowDown: 'ArrowDown', ArrowUp: 'ArrowUp' }[key] ?? key;
          const vk = { Escape: 27, Enter: 13, Tab: 9, ArrowDown: 40, ArrowUp: 38 }[key];
          await s('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk });
          await s('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
        },
        async key(selector, key) {
          await page.eval(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }));`);
        },
        async close() {
          listeners.delete(onEvent);
          await send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
        },
      };
      return page;
    },
    async close() {
      try {
        await send('Browser.close');
      } catch {
        // already closed
      }
      ws.close();
      const exited = new Promise((ok) => (proc.exitCode !== null ? ok() : proc.once('exit', ok)));
      proc.kill();
      await Promise.race([exited, new Promise((ok) => setTimeout(ok, 5000))]);
      try {
        rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {
        // A leftover temp profile is harmless.
      }
    },
  };
}
