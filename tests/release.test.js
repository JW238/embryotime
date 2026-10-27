// Release build: content-hashed, self-contained release folders (issue: mixed cached assets).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, contentHash, siteFiles, verifyRelease } from '../scripts/build.mjs';

function tmp() {
  return mkdtempSync(join(tmpdir(), 'embryotime-release-'));
}

test('build writes one content-hashed release and an index that only references it', () => {
  const out = tmp();
  try {
    const r = build({ out });
    assert.match(r.hash, /^[0-9a-f]{10}$/);
    assert.equal(r.hash, contentHash(siteFiles()));
    const index = readFileSync(join(out, 'index.html'), 'utf8');
    assert.match(index, new RegExp(`src="r/${r.hash}/src/app.js"`));
    assert.match(index, new RegExp(`href="r/${r.hash}/styles.css"`));
    assert.match(index, new RegExp(`<meta name="embryotime-release" content="${r.hash}">`));
    assert.doesNotMatch(index, /src="src\//);
    assert.ok(existsSync(join(out, '.nojekyll')));
    for (const f of siteFiles()) assert.ok(existsSync(join(out, 'r', r.hash, f)), f);
    // Nothing but site files is published.
    assert.deepEqual(readdirSync(out).sort(), ['.nojekyll', 'index.html', 'r', 'release.json']);
    assert.ok(!siteFiles().some((f) => f.startsWith('tests/') || f.includes('server') || f.includes('package')));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('rebuilding unchanged sources is deterministic; old releases are kept up to the limit', () => {
  const out = tmp();
  try {
    const a = build({ out });
    assert.equal(build({ out }).hash, a.hash);
    // Simulate two earlier releases still referenced by cached pages.
    const manifest = JSON.parse(readFileSync(join(out, 'release.json'), 'utf8'));
    for (const old of ['aaaaaaaaaa', 'bbbbbbbbbb']) mkdirSync(join(out, 'r', old), { recursive: true });
    writeFileSync(join(out, 'release.json'), JSON.stringify({ ...manifest, releases: [a.hash, 'aaaaaaaaaa', 'bbbbbbbbbb'] }));
    const kept = build({ out, keep: 2 });
    assert.deepEqual(kept.releases, [a.hash, 'aaaaaaaaaa']);
    assert.ok(existsSync(join(out, 'r', 'aaaaaaaaaa')));
    assert.ok(!existsSync(join(out, 'r', 'bbbbbbbbbb'))); // pruned beyond the limit
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('the release check rejects imports that could reach another release or a missing file', () => {
  const out = tmp();
  try {
    const { hash } = build({ out });
    const app = join(out, 'r', hash, 'src', 'app.js');
    const original = readFileSync(app, 'utf8');
    writeFileSync(app, `import '../../other/x.js';\n${original}`);
    assert.throws(() => verifyRelease(out, hash), /outside its release/);
    writeFileSync(app, `import './missing.js';\n${original}`);
    assert.throws(() => verifyRelease(out, hash), /missing/);
    writeFileSync(app, `import 'https://cdn.example/x.js';\n${original}`);
    assert.throws(() => verifyRelease(out, hash), /non-relative/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
