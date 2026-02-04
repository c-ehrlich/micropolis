import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'terrain', 'terrain_harness.c');
const OUT_DIR = path.join(ROOT, 'build', 'terrain');
const OUT = path.join(OUT_DIR, 'micropolis-terrain-harness');

mkdirSync(OUT_DIR, { recursive: true });

const cc = process.env.CC ?? 'cc';
const args = ['-O2', '-std=c99', '-Wall', '-Wextra', '-Werror', '-o', OUT, SRC];

const result = spawnSync(cc, args, { stdio: 'inherit' });
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

process.stdout.write(`${OUT}\n`);
