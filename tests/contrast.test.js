// WCAG contrast of the theme's text and status tokens, in light and dark mode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

function tokens(block) {
  const out = {};
  for (const m of block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2];
  return out;
}
const light = tokens(css.slice(css.indexOf(':root {'), css.indexOf('@media (prefers-color-scheme: dark)')));
const darkStart = css.indexOf('@media (prefers-color-scheme: dark)');
const dark = { ...light, ...tokens(css.slice(darkStart, css.indexOf('\n}\n', darkStart))) };

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const TEXT_PAIRS = [
  ['text', 'bg'],
  ['text', 'surface'],
  ['text-2', 'surface'],
  ['text-2', 'bg'],
  ['accent', 'surface'],
  ['danger', 'surface'],
  ['warn', 'surface'],
  ['warn', 'warn-soft'],
  ['danger', 'danger-soft'],
  ['accent', 'accent-soft'],
  ['planned', 'planned-soft'],
  ['on-danger', 'danger'],
];

for (const [mode, t] of [['light', light], ['dark', dark]]) {
  test(`${mode} theme: text tokens meet WCAG AA (4.5:1)`, () => {
    for (const [fg, bg] of TEXT_PAIRS) {
      assert.ok(t[fg] && t[bg], `missing token ${fg} or ${bg}`);
      const r = ratio(t[fg], t[bg]);
      assert.ok(r >= 4.5, `${fg} on ${bg} = ${r.toFixed(2)}:1 in ${mode} mode`);
    }
  });
  test(`${mode} theme: chart marks meet 3:1 against the surface`, () => {
    for (const k of ['chart-est', 'chart-obs']) assert.ok(ratio(t[k], t.surface) >= 3, `${k} in ${mode}`);
  });
}

test('focus indicators and reduced-motion rules exist', () => {
  assert.match(css, /:focus-visible \{ outline: 2px solid var\(--accent\)/);
  assert.match(css, /\.btn:focus-visible[^{]*\{ outline: 3px solid var\(--accent\)/);
  assert.ok((css.match(/@media \(prefers-reduced-motion: reduce\)/g) ?? []).length >= 2);
  assert.match(css, /\[hidden\] \{ display: none !important; \}/);
});
