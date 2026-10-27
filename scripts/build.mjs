#!/usr/bin/env node
// Release build for GitHub Pages — no dependencies, no bundling.
//
// Problem it solves: GitHub Pages lets browsers cache every file for up to 10 minutes, each
// file independently. During a deployment a visitor could combine an old index.html with new
// JavaScript modules (or the reverse) and get a broken app.
//
// Strategy: every release is copied into an immutable, content-hashed folder
//   <out>/r/<hash>/styles.css, <out>/r/<hash>/src/**.js
// and <out>/index.html points only into that folder. Module imports are relative, so a page
// can only ever load modules from its own release folder. Previous release folders are kept
// (default: 5), so a cached old index.html still finds its own consistent set of files.
//
// Usage:
//   node scripts/build.mjs [--out docs] [--keep 5] [--seed-legacy <git-ref>]
// --seed-legacy copies the root-level index/styles/src files of an earlier un-versioned
// deployment into <out> (only if missing), so pages cached from before this scheme still work.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function args(argv) {
  const out = { out: 'docs', keep: 5, seedLegacy: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out.out = argv[++i];
    else if (argv[i] === '--keep') out.keep = Number(argv[++i]);
    else if (argv[i] === '--seed-legacy') out.seedLegacy = argv[++i];
    else throw new Error(`Unknown argument ${argv[i]}`);
  }
  if (!Number.isInteger(out.keep) || out.keep < 1) throw new Error('--keep must be a positive integer');
  return out;
}

function listFiles(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files.push(...listFiles(p));
    else files.push(p);
  }
  return files;
}

/** Site files, as POSIX paths relative to the project root. */
export function siteFiles(root = ROOT) {
  const src = listFiles(join(root, 'src')).filter((f) => f.endsWith('.js'));
  return ['styles.css', ...src.map((f) => relative(root, f).split(sep).join('/'))].sort();
}

export function contentHash(files, root = ROOT) {
  const h = createHash('sha256');
  for (const f of files) {
    h.update(f);
    h.update('\0');
    h.update(readFileSync(join(root, f)));
    h.update('\0');
  }
  h.update(readFileSync(join(root, 'index.html')));
  return h.digest('hex').slice(0, 10);
}

const IMPORT_RE = /(?:import|export)\s+(?:[^'"`;]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

/** Throws if any module import or page asset would load from outside its release folder. */
export function verifyRelease(outDir, hash) {
  const base = join(outDir, 'r', hash);
  const problems = [];
  for (const file of listFiles(base).filter((f) => f.endsWith('.js'))) {
    const code = readFileSync(file, 'utf8');
    for (const m of code.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2];
      if (!spec.startsWith('./') && !spec.startsWith('../')) {
        problems.push(`${relative(outDir, file)} imports non-relative "${spec}"`);
        continue;
      }
      const target = resolve(dirname(file), spec);
      if (!target.startsWith(base + sep)) problems.push(`${relative(outDir, file)} imports "${spec}" outside its release`);
      else if (!existsSync(target)) problems.push(`${relative(outDir, file)} imports missing "${spec}"`);
    }
  }
  const index = readFileSync(join(outDir, 'index.html'), 'utf8');
  for (const m of index.matchAll(/(?:src|href)="([^"#][^"]*)"/g)) {
    const ref = m[1];
    if (/^(data:|https?:|mailto:)/.test(ref)) {
      if (/^https?:/.test(ref)) problems.push(`index.html references external "${ref}"`);
      continue;
    }
    if (!ref.startsWith(`r/${hash}/`)) problems.push(`index.html references "${ref}" outside release ${hash}`);
    else if (!existsSync(join(outDir, ref))) problems.push(`index.html references missing "${ref}"`);
  }
  if (problems.length) throw new Error(`Release check failed:\n  ${problems.join('\n  ')}`);
}

export function build({ out = 'docs', keep = 5, seedLegacy = null, root = ROOT } = {}) {
  const outDir = resolve(root, out);
  const files = siteFiles(root);
  const hash = contentHash(files, root);
  const relDir = join(outDir, 'r', hash);

  for (const f of files) {
    const dest = join(relDir, ...f.split('/'));
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(join(root, f)));
  }

  let index = readFileSync(join(root, 'index.html'), 'utf8');
  const before = index;
  index = index.replace('href="styles.css"', `href="r/${hash}/styles.css"`).replace('src="src/app.js"', `src="r/${hash}/src/app.js"`);
  if (index === before) throw new Error('index.html does not reference styles.css and src/app.js as expected');
  index = index.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  <meta name="embryotime-release" content="${hash}">`);
  writeFileSync(join(outDir, 'index.html'), index);
  writeFileSync(join(outDir, '.nojekyll'), '');

  // Release history: newest first; prune folders beyond `keep`.
  const manifestPath = join(outDir, 'release.json');
  const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')).releases ?? [] : [];
  const releases = [hash, ...previous.filter((h) => h !== hash)].slice(0, keep);
  const rDir = join(outDir, 'r');
  for (const name of readdirSync(rDir)) if (!releases.includes(name)) rmSync(join(rDir, name), { recursive: true, force: true });
  writeFileSync(manifestPath, JSON.stringify({ current: hash, releases }, null, 2) + '\n');

  if (seedLegacy) seedLegacyLayout(outDir, seedLegacy, root);
  verifyRelease(outDir, hash);
  return { hash, outDir, files: files.length, releases };
}

/** Copy an earlier root-level deployment's files so caches from before versioning stay consistent. */
function seedLegacyLayout(outDir, ref, root) {
  const listing = execFileSync('git', ['ls-tree', '-r', '--name-only', ref], { cwd: root, encoding: 'utf8' }).trim().split('\n');
  const legacy = listing.filter((f) => f === 'styles.css' || (f.startsWith('src/') && f.endsWith('.js')));
  for (const f of legacy) {
    const dest = join(outDir, ...f.split('/'));
    if (existsSync(dest)) continue;
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, execFileSync('git', ['show', `${ref}:${f}`], { cwd: root }));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = build(args(process.argv.slice(2)));
  console.log(`Built release ${result.hash} (${result.files} files) into ${posix.normalize(relative(ROOT, result.outDir) || '.')}; kept releases: ${result.releases.join(', ')}`);
}
