import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE_ROOT = path.resolve(ROOT, '..', '..');
const CORE_DIR = path.join(ROOT, 'core');
const SRC = path.join(CORE_DIR, 'core_oracle.c');
const TRAF_SRC = path.join(WORKSPACE_ROOT, 'ref', 'micropolis', 'src', 'sim', 's_traf.c');
const POWER_SRC = path.join(WORKSPACE_ROOT, 'ref', 'micropolis', 'src', 'sim', 's_power.c');
const SCAN_SRC = path.join(WORKSPACE_ROOT, 'ref', 'micropolis', 'src', 'sim', 's_scan.c');
const CON_SRC = path.join(WORKSPACE_ROOT, 'ref', 'micropolis', 'src', 'sim', 'w_con.c');
const OUT_DIR = path.join(ROOT, 'build', 'core');
const OUT = path.join(OUT_DIR, 'micropolis-core-oracle');

mkdirSync(OUT_DIR, { recursive: true });

const cc = process.env.CC ?? 'cc';
const args = [
  '-O2',
  '-std=gnu89',
  '-Wall',
  '-Wextra',
  '-Werror',
  '-Wno-implicit-int',
  '-Wno-implicit-function-declaration',
  '-Wno-return-type',
  '-Wno-unused-variable',
  '-Wno-parentheses',
  '-Wno-unused-parameter',
  '-Wno-error=implicit-int',
  '-Wno-error=implicit-function-declaration',
  '-Wno-error=return-type',
  '-Wno-error=unused-variable',
  '-I',
  CORE_DIR,
  '-o',
  OUT,
  SRC,
  TRAF_SRC,
  POWER_SRC,
  SCAN_SRC,
  CON_SRC,
];

const result = spawnSync(cc, args, { stdio: 'inherit' });
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

process.stdout.write(`${OUT}\n`);
