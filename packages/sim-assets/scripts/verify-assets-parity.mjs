import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const PACKAGE_DIR = path.resolve(SCRIPT_DIR, '..');
const REPO_ROOT = path.resolve(PACKAGE_DIR, '..', '..');
const MICROPOLIS_ROOT = path.join(REPO_ROOT, 'ref', 'micropolis');
const MICROPOLIS_RES_DIR = path.join(MICROPOLIS_ROOT, 'res');
const MICROPOLIS_IMAGES_DIR = path.join(MICROPOLIS_ROOT, 'images');

const EXPECTED_TILE_COUNT = 960;
const EXPECTED_TILE_HEADERS = {
  'tiles.xpm': '16 15360 14 1',
  'tilesbw.xpm': '16 15360 2 1',
  'tilessm.xpm': '4 2880 14 1',
};
const EXPECTED_STRI_LINE_COUNTS = {
  202: 20,
  219: 27,
  301: 64,
  356: 19,
};
const EXPECTED_SCENARIO_IDS = [111, 222, 333, 444, 555, 666, 777, 888];
const EXPECTED_SCENARIO_SIZE = 27120;
const EXPECTED_SPRITE_FRAME_COUNTS = {
  1: 5,
  2: 8,
  3: 11,
  4: 8,
  5: 16,
  6: 3,
  7: 6,
  8: 4,
};
const EXPECTED_KNOWN_MISSING_BITMAPS = ['micropolisl', 'splashscreen'];

/**
 * Read the first quoted XPM header tuple (`"w h colors cpp"`) from a Micropolis
 * XPM file in `ref/micropolis/images`.
 * Mirrors the XPM metadata read path used by `XpmReadFileToImage` /
 * `XpmReadFileToPixmap` in `ref/micropolis/src/sim/g_setup.c` (1:1 header tuple;
 * TypeScript verifier only parses text for parity validation).
 */
export function readXpmHeader(xpmFileName) {
  const xpmPath = path.join(MICROPOLIS_IMAGES_DIR, xpmFileName);
  const xpmText = readFileSync(xpmPath, 'utf8');
  const headerMatch = xpmText.match(/"(\d+\s+\d+\s+\d+\s+\d+)"/);
  if (!headerMatch) {
    throw new Error(`Unable to parse XPM header from ${xpmFileName}`);
  }

  return headerMatch[1].replace(/\s+/g, ' ').trim();
}

/**
 * Count newline-delimited entries in a Micropolis `stri.<id>` file exactly the
 * way `GetIndString` computes `lines` in `ref/micropolis/src/sim/w_resrc.c`:
 * line count is the number of `'\n'` bytes, not `split('\n').length`.
 */
export function countStringTableLinesByNewlineBytes(striId) {
  const striPath = path.join(MICROPOLIS_RES_DIR, `stri.${striId}`);
  const bytes = readFileSync(striPath);
  let lines = 0;

  for (const byte of bytes) {
    if (byte === 0x0a) {
      lines += 1;
    }
  }

  return lines;
}

/**
 * Discover object sprite frame indexes from `ref/micropolis/images/obj<ID>-<i>.xpm`.
 * Mirrors `GetObjectXpms` in `ref/micropolis/src/sim/g_setup.c`, which loads
 * sequential frame files for each hard-coded sprite id (1:1 basename pattern;
 * TypeScript verifier additionally reports unexpected IDs/holes).
 */
export function collectSpriteFrames() {
  const spriteFrames = new Map();
  const names = readdirSync(MICROPOLIS_IMAGES_DIR);

  for (const name of names) {
    const match = /^obj(\d+)-(\d+)\.xpm$/.exec(name);
    if (!match) {
      continue;
    }

    const spriteId = Number(match[1]);
    const frame = Number(match[2]);
    const frames = spriteFrames.get(spriteId) ?? [];
    frames.push(frame);
    spriteFrames.set(spriteId, frames);
  }

  for (const frames of spriteFrames.values()) {
    frames.sort((left, right) => left - right);
  }

  return spriteFrames;
}

const collectTclFilesRecursively = (rootDir, relativePrefix = '') => {
  const entries = readdirSync(path.join(rootDir, relativePrefix), { withFileTypes: true });
  const filePaths = [];

  for (const entry of entries) {
    const relativePath = relativePrefix ? path.posix.join(relativePrefix, entry.name) : entry.name;
    if (entry.isDirectory()) {
      filePaths.push(...collectTclFilesRecursively(rootDir, relativePath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.tcl')) {
      filePaths.push(relativePath);
    }
  }

  return filePaths;
};

/**
 * Validate locked parity invariants for canonical Micropolis assets used by
 * `@city/sim-assets`.
 * Source mapping:
 * - `TILE_COUNT` and tile/sprite loading: `ref/micropolis/src/sim/headers/sim.h`,
 *   `ref/micropolis/src/sim/g_setup.c`
 * - String-table and resource file semantics: `ref/micropolis/src/sim/w_resrc.c`,
 *   `ref/micropolis/src/sim/s_fileio.c`
 * - Known missing bitmap refs: `ref/micropolis/res/*.tcl`
 * The checks are parity assertions only; no canonical asset data is transformed.
 */
export function verifyAssetsParity() {
  const failures = [];

  const simHeader = readFileSync(
    path.join(MICROPOLIS_ROOT, 'src', 'sim', 'headers', 'sim.h'),
    'utf8',
  );
  const tileCountMatch = simHeader.match(/#define\s+TILE_COUNT\s+(\d+)/);
  if (!tileCountMatch) {
    failures.push('Unable to find `#define TILE_COUNT` in ref/micropolis/src/sim/headers/sim.h.');
  } else {
    const tileCount = Number(tileCountMatch[1]);
    if (tileCount !== EXPECTED_TILE_COUNT) {
      failures.push(`Expected TILE_COUNT=${EXPECTED_TILE_COUNT}, found TILE_COUNT=${tileCount}.`);
    }
  }

  for (const [fileName, expectedHeader] of Object.entries(EXPECTED_TILE_HEADERS)) {
    const actualHeader = readXpmHeader(fileName);
    if (actualHeader !== expectedHeader) {
      failures.push(`Expected ${fileName} header "${expectedHeader}", found "${actualHeader}".`);
    }
  }

  for (const [idText, expectedLineCount] of Object.entries(EXPECTED_STRI_LINE_COUNTS)) {
    const id = Number(idText);
    const actualLineCount = countStringTableLinesByNewlineBytes(id);
    if (actualLineCount !== expectedLineCount) {
      failures.push(
        `Expected stri.${id} newline line count ${expectedLineCount}, found ${actualLineCount}.`,
      );
    }
  }

  for (const id of EXPECTED_SCENARIO_IDS) {
    const scenarioPath = path.join(MICROPOLIS_RES_DIR, `snro.${id}`);
    const size = statSync(scenarioPath).size;
    if (size !== EXPECTED_SCENARIO_SIZE) {
      failures.push(`Expected snro.${id} size ${EXPECTED_SCENARIO_SIZE}, found ${size}.`);
    }
  }

  const actualFramesBySprite = collectSpriteFrames();
  const expectedSpriteIds = Object.keys(EXPECTED_SPRITE_FRAME_COUNTS)
    .map(Number)
    .sort((left, right) => left - right);
  const actualSpriteIds = [...actualFramesBySprite.keys()].sort((left, right) => left - right);

  if (JSON.stringify(actualSpriteIds) !== JSON.stringify(expectedSpriteIds)) {
    failures.push(
      `Expected sprite IDs [${expectedSpriteIds.join(', ')}], found [${actualSpriteIds.join(', ')}].`,
    );
  }

  for (const spriteId of expectedSpriteIds) {
    const frames = actualFramesBySprite.get(spriteId) ?? [];
    const expectedFrameCount = EXPECTED_SPRITE_FRAME_COUNTS[spriteId];
    if (frames.length !== expectedFrameCount) {
      failures.push(
        `Expected obj${spriteId}-*.xpm frame count ${expectedFrameCount}, found ${frames.length}.`,
      );
    }

    for (let frame = 0; frame < expectedFrameCount; frame += 1) {
      if (frames[frame] !== frame) {
        failures.push(
          `Expected obj${spriteId} frames [0..${expectedFrameCount - 1}], found [${frames.join(', ')}].`,
        );
        break;
      }
    }
  }

  const imageBaseNames = new Set(
    readdirSync(MICROPOLIS_IMAGES_DIR)
      .filter((name) => name.endsWith('.xpm'))
      .map((name) => name.slice(0, -'.xpm'.length)),
  );

  const missingKnownBitmaps = EXPECTED_KNOWN_MISSING_BITMAPS.filter((name) =>
    imageBaseNames.has(name),
  );
  if (missingKnownBitmaps.length > 0) {
    failures.push(
      `Expected known-missing bitmap names to remain absent from ref images, but found: ${missingKnownBitmaps.join(', ')}.`,
    );
  }

  const tclFiles = collectTclFilesRecursively(MICROPOLIS_RES_DIR);
  const tclText = tclFiles
    .map((relativePath) => readFileSync(path.join(MICROPOLIS_RES_DIR, relativePath), 'utf8'))
    .join('\n');
  const referencedMissingBitmaps = EXPECTED_KNOWN_MISSING_BITMAPS.filter((name) =>
    tclText.includes(`${name}.xpm`),
  );
  if (JSON.stringify(referencedMissingBitmaps) !== JSON.stringify(EXPECTED_KNOWN_MISSING_BITMAPS)) {
    failures.push(
      `Expected Tcl references for known missing bitmaps [${EXPECTED_KNOWN_MISSING_BITMAPS.join(', ')}], found [${referencedMissingBitmaps.join(', ')}].`,
    );
  }

  return {
    ok: failures.length === 0,
    failures,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  const result = verifyAssetsParity();

  if (!result.ok) {
    process.stderr.write('Asset parity verification failed:\n');
    for (const failure of result.failures) {
      process.stderr.write(`- ${failure}\n`);
    }
    process.exitCode = 1;
  } else {
    process.stdout.write(
      'Asset parity verification passed (tile count, XPM headers, stri counts, snro sizes, sprite frames, known missing bitmaps).\n',
    );
  }
}
