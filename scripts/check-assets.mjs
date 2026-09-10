#!/usr/bin/env node
// Kill gate 1b: assert zero binary asset files anywhere in the repo or dist/.
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const BANNED = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tga', '.svg', '.ico',
  '.mp3', '.ogg', '.wav', '.m4a', '.flac', '.aac',
  '.glb', '.gltf', '.fbx', '.obj', '.dae', '.stl', '.ply', '.hdr', '.exr', '.ktx2', '.basis',
  '.ttf', '.otf', '.woff', '.woff2',
]);
const SKIP_DIRS = new Set(['node_modules', '.git', 'test-results', 'playwright-report', '.playwright']);

const offenders = [];
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (BANNED.has(extname(entry).toLowerCase())) offenders.push(relative(ROOT, p));
  }
}
walk(ROOT);
if (existsSync(join(ROOT, 'dist'))) walk(join(ROOT, 'dist'));

if (offenders.length) {
  console.error(`ASSET GUARD FAILED — ${offenders.length} banned asset file(s):`);
  for (const o of offenders) console.error('  ' + o);
  process.exit(1);
}
console.log('ASSET GUARD PASS — zero asset files in repo and dist/.');
