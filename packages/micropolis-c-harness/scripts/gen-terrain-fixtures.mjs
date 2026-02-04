import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(PKG, '..', '..');
const BIN = path.join(PKG, 'build', 'terrain', 'micropolis-terrain-harness');
const FIXTURE_DIR = path.join(REPO_ROOT, 'packages', 'sim-core', 'fixtures', 'terrain');

execFileSync(process.execPath, [path.join(PKG, 'scripts', 'build-terrain-harness.mjs')], {
  stdio: 'inherit',
});

const cases = [
  {
    seed: 123,
    treeLevel: -1,
    lakeLevel: -1,
    curveLevel: -1,
    createIsland: -1,
  },
  {
    seed: 123,
    treeLevel: 0,
    lakeLevel: 0,
    curveLevel: 0,
    createIsland: 1,
  },
  // Chosen to reliably hit the early-return island branch:
  // `if (CreateIsland < 0) if (Rand(100) < 10) { MakeIsland(); return; }`
  // in `ref/micropolis/src/sim/s_gen.c`.
  {
    seed: 5,
    treeLevel: -1,
    lakeLevel: -1,
    curveLevel: -1,
    createIsland: -1,
  },
  {
    seed: 456,
    treeLevel: 0,
    lakeLevel: -1,
    curveLevel: -1,
    createIsland: 0,
  },
];

const fileNameFor = (c) =>
  `gen_seed-${c.seed}_tree-${c.treeLevel}_lake-${c.lakeLevel}_curve-${c.curveLevel}_island-${c.createIsland}.u16le`;

mkdirSync(FIXTURE_DIR, { recursive: true });

const manifest = [];
for (const c of cases) {
  const dumpPath = path.join(FIXTURE_DIR, fileNameFor(c));
  const dumpPathRel = path.relative(REPO_ROOT, dumpPath);
  const args = [
    `--seed=${c.seed}`,
    `--treeLevel=${c.treeLevel}`,
    `--lakeLevel=${c.lakeLevel}`,
    `--curveLevel=${c.curveLevel}`,
    `--createIsland=${c.createIsland}`,
    '--format=u16le',
    `--dump-path=${dumpPath}`,
  ];

  execFileSync(BIN, args, { stdio: 'inherit' });
  manifest.push({
    ...c,
    format: 'u16le',
    file: path.basename(dumpPath),
    dumpPath: dumpPathRel,
    args: args.filter((a) => !a.startsWith('--dump-path=')),
  });
}

writeFileSync(
  path.join(FIXTURE_DIR, 'manifest.json'),
  JSON.stringify(
    {
      generatedBy: '@city/micropolis-c-harness gen:terrain-fixtures',
      cReference: 'ref/micropolis/src/sim/s_gen.c (GenerateMap + helpers)',
      world: { width: 120, height: 100 },
      fixtures: manifest,
    },
    null,
    2,
  ),
);
