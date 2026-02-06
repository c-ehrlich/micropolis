import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(PKG, '..', '..');
const BIN = path.join(PKG, 'build', 'terrain', 'micropolis-terrain-harness');
const FIXTURE_DIR = path.join(REPO_ROOT, 'packages', 'sim-core', 'fixtures', 'terrain');

execFileSync(process.execPath, [path.join(PKG, 'scripts', 'build-terrain-harness.mjs')], {
  stdio: 'inherit',
});

/**
 * Minimal Micropolis RNG helpers used only to classify the first
 * `GenerateMap` island-branch gate (`Rand(100) < 10`).
 *
 * C references:
 * - `Rand`/`Rand16` in `ref/micropolis/src/sim/s_sim.c`
 * - `sim_rand`/`sim_srand` in `ref/micropolis/src/sim/rand.c`
 */
const RANDOM_RANGE = 0xffff;
const SIM_RAND_MOD = ((RANDOM_RANGE + 1) << 8) >>> 0;

const simRand16 = (state) => {
  const next = (Math.imul(state, 1103515245) + 12345) >>> 0;
  const value = ((next % SIM_RAND_MOD) >>> 8) & RANDOM_RANGE;
  return { next, value };
};

const micropolisRand = (seed, range) => {
  let state = seed >>> 0;
  const inclusiveRange = (range | 0) + 1;
  let maxMultiple = Math.trunc(RANDOM_RANGE / inclusiveRange);
  maxMultiple *= inclusiveRange;

  while (true) {
    const draw = simRand16(state);
    state = draw.next;
    if (draw.value < maxMultiple) {
      return { state, value: draw.value % inclusiveRange };
    }
  }
};

const randomIslandTaken = (seed) => micropolisRand(seed >>> 0, 100).value < 10;

const findSeedForRandomIslandBranch = (wantTaken) => {
  for (let seed = 1; seed <= 200_000; seed += 1) {
    if (randomIslandTaken(seed) === wantTaken) {
      return seed >>> 0;
    }
  }
  throw new Error(`unable to find seed for random-island branch: wantTaken=${wantTaken}`);
};

const DEFAULT_STAGE_MATRIX_SEED = 123;
const LEVEL_MATRIX = [-1, 0, 1];
const randomIslandTakenSeed = findSeedForRandomIslandBranch(true);
const randomIslandNotTakenSeed = findSeedForRandomIslandBranch(false);

const seen = new Set();
const cases = [];
const addCase = (entry) => {
  const key = `${entry.seed}|${entry.treeLevel}|${entry.lakeLevel}|${entry.curveLevel}|${entry.createIsland}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  cases.push(entry);
};

// Phase 4.1 stage-gate matrix:
// cover all combinations of TreeLevel/LakeLevel/CurveLevel in {-1,0,1}
// using the non-island path (`CreateIsland == 0`).
for (const treeLevel of LEVEL_MATRIX) {
  for (const lakeLevel of LEVEL_MATRIX) {
    for (const curveLevel of LEVEL_MATRIX) {
      addCase({
        seed: DEFAULT_STAGE_MATRIX_SEED,
        treeLevel,
        lakeLevel,
        curveLevel,
        createIsland: 0,
      });
    }
  }
}

// Island branch coverage cases:
// - forced island (`CreateIsland == 1`)
// - random island branch not taken (`CreateIsland < 0`, `Rand(100) >= 10`)
// - random island branch taken (`CreateIsland < 0`, `Rand(100) < 10`, early return)
addCase({
  seed: DEFAULT_STAGE_MATRIX_SEED,
  treeLevel: 0,
  lakeLevel: 0,
  curveLevel: 0,
  createIsland: 1,
});
addCase({
  seed: DEFAULT_STAGE_MATRIX_SEED,
  treeLevel: 1,
  lakeLevel: 1,
  curveLevel: 1,
  createIsland: 1,
});
addCase({
  seed: randomIslandNotTakenSeed,
  treeLevel: -1,
  lakeLevel: 1,
  curveLevel: 0,
  createIsland: -1,
});
addCase({
  seed: randomIslandTakenSeed,
  treeLevel: 1,
  lakeLevel: -1,
  curveLevel: 1,
  createIsland: -1,
});

const fileNameFor = (c) =>
  `gen_seed-${c.seed}_tree-${c.treeLevel}_lake-${c.lakeLevel}_curve-${c.curveLevel}_island-${c.createIsland}.u16le`;

mkdirSync(FIXTURE_DIR, { recursive: true });
for (const file of readdirSync(FIXTURE_DIR)) {
  if (file.endsWith('.u16le')) {
    unlinkSync(path.join(FIXTURE_DIR, file));
  }
}

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
