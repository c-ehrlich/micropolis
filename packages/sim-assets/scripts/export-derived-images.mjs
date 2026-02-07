import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const PACKAGE_DIR = path.resolve(SCRIPT_DIR, '..');
const REPO_ROOT = path.resolve(PACKAGE_DIR, '..', '..');
const MICROPOLIS_IMAGES_DIR = path.join(REPO_ROOT, 'ref', 'micropolis', 'images');
const DERIVED_IMAGES_ROOT = path.join(PACKAGE_DIR, 'generated-images');
const DERIVED_IMAGES_DIR = path.join(DERIVED_IMAGES_ROOT, 'images');
const MICROPOLIS_IMAGES_PREFIX = 'ref/micropolis/images/';
const DERIVED_IMAGES_PREFIX = 'packages/sim-assets/generated-images/images/';

const XPM_STRING_LITERAL_REGEX = /"([^"]*)"/g;
const X11_NAMED_COLORS = Object.freeze({
  black: [0, 0, 0, 255],
  blue: [0, 0, 255, 255],
  cyan: [0, 255, 255, 255],
  gray50: [127, 127, 127, 255],
  gray69: [176, 176, 176, 255],
  gray75: [191, 191, 191, 255],
  gray81: [207, 207, 207, 255],
  gray100: [255, 255, 255, 255],
  green: [0, 255, 0, 255],
  red: [255, 0, 0, 255],
  yellow: [255, 255, 0, 255],
});

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let k = 0; k < 8; k += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[n] = value >>> 0;
  }
  return table;
})();

/**
 * Deterministically compare ASCII strings for stable export ordering.
 * Mirrors Micropolis canonical file identity semantics from
 * `ref/micropolis/src/sim/g_setup.c` (same filenames), while TypeScript adds
 * deterministic sort order for idempotent derived-image output.
 */
function compareAscii(left, right) {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

/**
 * Convert an absolute path into a repository-relative POSIX path.
 * Micropolis C loaders address canonical files via `HomeDir` + relative paths
 * (for example in `ref/micropolis/src/sim/g_setup.c`); this helper keeps those
 * identities stable while normalizing TypeScript output paths.
 */
function toRepoRelativePosixPath(absolutePath) {
  return path.relative(REPO_ROOT, absolutePath).split(path.sep).join(path.posix.sep);
}

/**
 * Resolve canonical Micropolis image files into derived PNG destinations.
 * Mirrors the canonical XPM image namespace loaded by `XpmReadFileToImage` /
 * `XpmReadFileToPixmap` in `ref/micropolis/src/sim/g_setup.c` (1:1 source file
 * identity), with a TypeScript-only overlay path in
 * `packages/sim-assets/generated-images/images/*.png`.
 */
export function listCanonicalXpmExports({
  sourceImagesDir = MICROPOLIS_IMAGES_DIR,
  outputImagesDir = DERIVED_IMAGES_DIR,
  canonicalImagesPrefix = MICROPOLIS_IMAGES_PREFIX,
  derivedImagesPrefix = DERIVED_IMAGES_PREFIX,
} = {}) {
  const normalizedCanonicalPrefix = canonicalImagesPrefix.endsWith('/')
    ? canonicalImagesPrefix
    : `${canonicalImagesPrefix}/`;
  const normalizedDerivedPrefix = derivedImagesPrefix.endsWith('/')
    ? derivedImagesPrefix
    : `${derivedImagesPrefix}/`;

  const names = readdirSync(sourceImagesDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.xpm'))
    .map((entry) => entry.name)
    .sort((left, right) => compareAscii(left, right));

  return names.map((fileName) => {
    const canonicalSourcePath = `${normalizedCanonicalPrefix}${fileName}`;
    const derivedPngPath = `${normalizedDerivedPrefix}${fileName.slice(0, -'.xpm'.length)}.png`;

    return {
      fileName,
      canonicalSourcePath,
      sourceAbsolutePath: path.join(sourceImagesDir, fileName),
      sourceByteSize: statSync(path.join(sourceImagesDir, fileName)).size,
      derivedPngPath,
      outputAbsolutePath: path.join(outputImagesDir, `${fileName.slice(0, -'.xpm'.length)}.png`),
    };
  });
}

/**
 * Parse the XPM header tuple (`width height colors chars_per_pixel`).
 * Mirrors XPM metadata consumed by `XpmReadFileToImage` and
 * `XpmReadFileToPixmap` in `ref/micropolis/src/sim/g_setup.c`.
 * Parity note: this parser accepts the Micropolis XPM subset and throws on
 * malformed metadata instead of relying on Xpm library error codes.
 */
function parseXpmHeader(headerText, sourcePath) {
  const parts = headerText.trim().split(/\s+/);
  if (parts.length < 4) {
    throw new Error(`Invalid XPM header in ${sourcePath}: "${headerText}"`);
  }

  const width = Number(parts[0]);
  const height = Number(parts[1]);
  const colorCount = Number(parts[2]);
  const charsPerPixel = Number(parts[3]);
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    !Number.isInteger(colorCount) ||
    !Number.isInteger(charsPerPixel) ||
    width <= 0 ||
    height <= 0 ||
    colorCount <= 0 ||
    charsPerPixel <= 0
  ) {
    throw new Error(`Invalid XPM header values in ${sourcePath}: "${headerText}"`);
  }

  return { width, height, colorCount, charsPerPixel };
}

/**
 * Resolve XPM color-table descriptors into a color token (`None`, `#rrggbb`,
 * or named X11 color). C Micropolis delegates this to libXpm via
 * `XpmReadFileToImage` / `XpmReadFileToPixmap`; this TypeScript parser keeps
 * parity for the descriptor patterns present in `ref/micropolis/images`.
 */
function extractXpmColorToken(colorDescriptor, sourcePath) {
  const parts = colorDescriptor.trim().split(/\s+/).filter(Boolean);
  const valuesByKey = new Map();

  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index].toLowerCase();
    if (!valuesByKey.has(key)) {
      valuesByKey.set(key, parts[index + 1]);
    }
  }

  for (const key of ['c', 'g', 'g4', 'm', 's']) {
    const value = valuesByKey.get(key);
    if (value) {
      return value;
    }
  }

  throw new Error(
    `Unable to resolve XPM color token from descriptor "${colorDescriptor}" in ${sourcePath}`,
  );
}

/**
 * Convert an XPM color token to RGBA bytes.
 * Micropolis C rendering uses X server/libXpm color resolution at runtime; this
 * TypeScript implementation is not a 1:1 libXpm port, but preserves behavior
 * for the canonical `ref/micropolis/images` token set (hex, `None`, and the
 * named colors used by tile/object XPMs).
 */
function colorTokenToRgbaBytes(colorToken, sourcePath) {
  if (/^none$/i.test(colorToken)) {
    return [0, 0, 0, 0];
  }

  const normalizedToken = colorToken.toLowerCase();
  const namedColor = X11_NAMED_COLORS[normalizedToken];
  if (namedColor) {
    return namedColor;
  }

  const hexMatch = /^#([0-9a-fA-F]+)$/.exec(colorToken);
  if (!hexMatch) {
    throw new Error(`Unsupported XPM color token "${colorToken}" in ${sourcePath}`);
  }

  const hex = hexMatch[1];
  const scaleChannel = (component) => {
    const value = Number.parseInt(component, 16);
    const maxValue = Math.pow(16, component.length) - 1;
    return Math.round((value * 255) / maxValue);
  };

  if (hex.length === 3) {
    return [
      scaleChannel(hex.slice(0, 1)),
      scaleChannel(hex.slice(1, 2)),
      scaleChannel(hex.slice(2, 3)),
      255,
    ];
  }
  if (hex.length === 4) {
    return [
      scaleChannel(hex.slice(0, 1)),
      scaleChannel(hex.slice(1, 2)),
      scaleChannel(hex.slice(2, 3)),
      scaleChannel(hex.slice(3, 4)),
    ];
  }
  if (hex.length === 6) {
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
      255,
    ];
  }
  if (hex.length === 8) {
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
      Number.parseInt(hex.slice(6, 8), 16),
    ];
  }
  if (hex.length === 12) {
    return [
      scaleChannel(hex.slice(0, 4)),
      scaleChannel(hex.slice(4, 8)),
      scaleChannel(hex.slice(8, 12)),
      255,
    ];
  }
  if (hex.length === 16) {
    return [
      scaleChannel(hex.slice(0, 4)),
      scaleChannel(hex.slice(4, 8)),
      scaleChannel(hex.slice(8, 12)),
      scaleChannel(hex.slice(12, 16)),
    ];
  }

  throw new Error(`Unsupported hex XPM color token "${colorToken}" in ${sourcePath}`);
}

/**
 * Parse a Micropolis XPM file into raw RGBA pixels.
 * Mirrors the canonical image data loaded through libXpm in
 * `ref/micropolis/src/sim/g_setup.c`.
 * Parity note: this parser intentionally handles the Micropolis asset subset
 * and emits strict errors for malformed content to keep exports deterministic.
 */
export function parseMicropolisXpmToRgba(xpmSource, sourcePath = '<inline>') {
  const stringLiterals = [...xpmSource.matchAll(XPM_STRING_LITERAL_REGEX)].map((match) => match[1]);
  if (stringLiterals.length === 0) {
    throw new Error(`No XPM string literals found in ${sourcePath}`);
  }

  const header = parseXpmHeader(stringLiterals[0], sourcePath);
  const colorTable = new Map();
  const colorLines = stringLiterals.slice(1, 1 + header.colorCount);
  const pixelLines = stringLiterals.slice(
    1 + header.colorCount,
    1 + header.colorCount + header.height,
  );

  if (colorLines.length !== header.colorCount) {
    throw new Error(
      `Expected ${header.colorCount} XPM color lines in ${sourcePath}, found ${colorLines.length}`,
    );
  }
  if (pixelLines.length !== header.height) {
    throw new Error(
      `Expected ${header.height} XPM pixel lines in ${sourcePath}, found ${pixelLines.length}`,
    );
  }

  for (const colorLine of colorLines) {
    if (colorLine.length < header.charsPerPixel) {
      throw new Error(`Invalid XPM color table line "${colorLine}" in ${sourcePath}`);
    }

    const symbol = colorLine.slice(0, header.charsPerPixel);
    const colorDescriptor = colorLine.slice(header.charsPerPixel);
    const colorToken = extractXpmColorToken(colorDescriptor, sourcePath);
    colorTable.set(symbol, colorTokenToRgbaBytes(colorToken, sourcePath));
  }

  const rgba = new Uint8Array(header.width * header.height * 4);
  let outputIndex = 0;

  for (let row = 0; row < header.height; row += 1) {
    const pixelLine = pixelLines[row];
    if (pixelLine.length !== header.width * header.charsPerPixel) {
      throw new Error(
        `Invalid XPM pixel width in ${sourcePath} row ${row}: expected ${
          header.width * header.charsPerPixel
        }, found ${pixelLine.length}`,
      );
    }

    for (let column = 0; column < header.width; column += 1) {
      const symbol = pixelLine.slice(
        column * header.charsPerPixel,
        (column + 1) * header.charsPerPixel,
      );
      const rgbaBytes = colorTable.get(symbol);
      if (!rgbaBytes) {
        throw new Error(`Unknown XPM symbol "${symbol}" in ${sourcePath} row ${row}`);
      }

      rgba[outputIndex] = rgbaBytes[0];
      rgba[outputIndex + 1] = rgbaBytes[1];
      rgba[outputIndex + 2] = rgbaBytes[2];
      rgba[outputIndex + 3] = rgbaBytes[3];
      outputIndex += 4;
    }
  }

  return {
    width: header.width,
    height: header.height,
    rgba,
  };
}

/**
 * Compute CRC32 for PNG chunk integrity.
 * PNG encoding has no Micropolis C equivalent; this is TypeScript-only output
 * plumbing for derived-image overlays.
 */
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const value of buffer) {
    crc = CRC32_TABLE[(crc ^ value) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Build one PNG chunk from type + payload.
 * This is TypeScript-only output generation for derived PNG files and does not
 * alter canonical Micropolis asset identities.
 */
function createPngChunk(type, payload) {
  const typeBytes = Buffer.from(type, 'ascii');
  const lengthBytes = Buffer.allocUnsafe(4);
  lengthBytes.writeUInt32BE(payload.length, 0);

  const crcBytes = Buffer.allocUnsafe(4);
  const crcValue = crc32(Buffer.concat([typeBytes, payload]));
  crcBytes.writeUInt32BE(crcValue, 0);

  return Buffer.concat([lengthBytes, typeBytes, payload, crcBytes]);
}

/**
 * Encode RGBA pixel bytes into a deterministic PNG byte stream.
 * This has no direct Micropolis C counterpart because Micropolis ships XPM as
 * canonical source; PNG generation is a TypeScript convenience overlay.
 */
export function encodeRgbaAsPng(width, height, rgba) {
  if (rgba.length !== width * height * 4) {
    throw new Error(
      `RGBA buffer length mismatch: expected ${width * height * 4}, found ${rgba.length}`,
    );
  }

  const bytesPerScanline = width * 4;
  const raw = Buffer.allocUnsafe((bytesPerScanline + 1) * height);

  for (let row = 0; row < height; row += 1) {
    const rowStart = row * (bytesPerScanline + 1);
    raw[rowStart] = 0;

    const sourceStart = row * bytesPerScanline;
    const sourceEnd = sourceStart + bytesPerScanline;
    raw.set(rgba.subarray(sourceStart, sourceEnd), rowStart + 1);
  }

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed = deflateSync(raw, { level: 9 });
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  return Buffer.concat([
    signature,
    createPngChunk('IHDR', ihdr),
    createPngChunk('IDAT', compressed),
    createPngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Write output only when file bytes changed.
 * Micropolis canonical assets are immutable source inputs; this helper enforces
 * idempotent TypeScript derived-output behavior.
 */
function writeFileIfChanged(filePath, nextBytes) {
  const exists = statSync(filePath, { throwIfNoEntry: false }) !== undefined;
  if (exists) {
    const currentBytes = readFileSync(filePath);
    if (currentBytes.equals(nextBytes)) {
      return false;
    }
  }

  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, nextBytes);
  return true;
}

/**
 * Recursively list existing derived PNG files for stale-output pruning.
 * No C equivalent: this is a deterministic TypeScript build-artifact cleanup
 * step for optional PNG overlays.
 */
function listExistingDerivedPngPaths(absoluteDir, relativePrefix = '') {
  const entries = readdirSync(path.join(absoluteDir, relativePrefix), {
    withFileTypes: true,
  });
  const paths = [];

  for (const entry of entries) {
    const relativePath = relativePrefix ? path.posix.join(relativePrefix, entry.name) : entry.name;

    if (entry.isDirectory()) {
      paths.push(...listExistingDerivedPngPaths(absoluteDir, relativePath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.png')) {
      paths.push(relativePath);
    }
  }

  return paths;
}

/**
 * Remove stale derived PNG files not part of current canonical exports.
 * Canonical Micropolis identities stay anchored in `ref/micropolis/images`; this
 * cleanup only affects TypeScript-generated overlay artifacts.
 */
function removeStaleDerivedPngs(
  expectedDerivedPaths,
  dryRun,
  { outputImagesDir = DERIVED_IMAGES_DIR, derivedImagesPrefix = DERIVED_IMAGES_PREFIX } = {},
) {
  const normalizedDerivedPrefix = derivedImagesPrefix.endsWith('/')
    ? derivedImagesPrefix
    : `${derivedImagesPrefix}/`;
  const derivedImagesDirExists = statSync(outputImagesDir, { throwIfNoEntry: false }) !== undefined;
  if (!derivedImagesDirExists) {
    return 0;
  }

  const staleRelativePaths = listExistingDerivedPngPaths(outputImagesDir)
    .filter(
      (relativePath) => !expectedDerivedPaths.has(`${normalizedDerivedPrefix}${relativePath}`),
    )
    .sort((left, right) => compareAscii(left, right));

  if (!dryRun) {
    for (const staleRelativePath of staleRelativePaths) {
      rmSync(path.join(outputImagesDir, staleRelativePath));
    }
  }

  return staleRelativePaths.length;
}

/**
 * Export canonical Micropolis XPM assets as deterministic PNG overlays.
 * Source mapping:
 * - Canonical image identities: `ref/micropolis/src/sim/g_setup.c`
 *   (`XpmReadFileToImage`, `XpmReadFileToPixmap`, and object/tile image loads)
 * Parity note:
 * - This is not a 1:1 C port because Micropolis does not export PNG files.
 *   It preserves canonical `ref/micropolis/images/*.xpm` identity keys and
 *   emits optional derived PNG overlays under
 *   `packages/sim-assets/generated-images/images/*.png`.
 */
export function exportDerivedImages({
  dryRun = false,
  sourceImagesDir = MICROPOLIS_IMAGES_DIR,
  outputImagesDir = DERIVED_IMAGES_DIR,
  canonicalImagesPrefix = MICROPOLIS_IMAGES_PREFIX,
  derivedImagesPrefix = DERIVED_IMAGES_PREFIX,
} = {}) {
  const xpmExports = listCanonicalXpmExports({
    sourceImagesDir,
    outputImagesDir,
    canonicalImagesPrefix,
    derivedImagesPrefix,
  });
  const expectedDerivedPaths = new Set();

  let written = 0;
  let unchanged = 0;
  let skippedEmpty = 0;

  for (const entry of xpmExports) {
    if (entry.sourceByteSize === 0) {
      skippedEmpty += 1;
      continue;
    }

    expectedDerivedPaths.add(entry.derivedPngPath);
    const xpmSource = readFileSync(entry.sourceAbsolutePath, 'utf8');
    const parsed = parseMicropolisXpmToRgba(xpmSource, entry.canonicalSourcePath);
    const pngBytes = encodeRgbaAsPng(parsed.width, parsed.height, parsed.rgba);

    if (dryRun) {
      const existing = statSync(entry.outputAbsolutePath, { throwIfNoEntry: false }) !== undefined;
      if (existing && readFileSync(entry.outputAbsolutePath).equals(pngBytes)) {
        unchanged += 1;
      } else {
        written += 1;
      }
      continue;
    }

    const changed = writeFileIfChanged(entry.outputAbsolutePath, pngBytes);
    if (changed) {
      written += 1;
    } else {
      unchanged += 1;
    }
  }

  const removed = removeStaleDerivedPngs(expectedDerivedPaths, dryRun, {
    outputImagesDir,
    derivedImagesPrefix,
  });

  return {
    total: xpmExports.length,
    written,
    unchanged,
    skippedEmpty,
    removed,
    dryRun,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  const dryRun = process.argv.includes('--dry-run');
  const summary = exportDerivedImages({ dryRun });
  const mode = dryRun ? 'dry-run' : 'write';
  const outputRoot = toRepoRelativePosixPath(DERIVED_IMAGES_DIR);
  process.stdout.write(
    `${mode} exported ${summary.total} canonical xpm(s) to ${outputRoot}; wrote ${summary.written}, unchanged ${summary.unchanged}, skipped-empty ${summary.skippedEmpty}, removed ${summary.removed}\n`,
  );
}
