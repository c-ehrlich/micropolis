import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { encodeRgbaAsPng } from './export-derived-images.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const PACKAGE_DIR = path.resolve(SCRIPT_DIR, '..');
const REPO_ROOT = path.resolve(PACKAGE_DIR, '..', '..');
const MICROPOLISCORE_TILESETS_DIR = path.join(PACKAGE_DIR, 'micropoliscore-tilesets');

const MICROPOLISCORE_OBJECT_SHEET_SPECS = Object.freeze([
  // Mirrors object dimensions from `InitSprite` in `ref/micropolis/src/sim/w_sprite.c`.
  Object.freeze({ assetBasename: 'train', frameWidth: 32, frameHeight: 32 }),
  Object.freeze({ assetBasename: 'chopper', frameWidth: 32, frameHeight: 32 }),
  Object.freeze({ assetBasename: 'plane', frameWidth: 48, frameHeight: 48 }),
  Object.freeze({ assetBasename: 'ship', frameWidth: 48, frameHeight: 48 }),
  Object.freeze({ assetBasename: 'monster', frameWidth: 48, frameHeight: 48 }),
  Object.freeze({ assetBasename: 'tornado', frameWidth: 48, frameHeight: 48 }),
  Object.freeze({ assetBasename: 'explode', frameWidth: 48, frameHeight: 48 }),
]);

const BITMAP_FILE_HEADER_SIZE = 14;
const BITMAP_INFO_HEADER_SIZE = 40;
const BITMAP_SIGNATURE = 'BM';
const BI_RGB = 0;

/**
 * Deterministically compare ASCII strings for stable export ordering.
 * Mirrors canonical Micropolis object identity ordering from `GetObjectXpms` in
 * `ref/micropolis/src/sim/g_setup.c` while TypeScript adds idempotent file iteration.
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
 * Convert an absolute path into a repository-relative POSIX path for logs.
 * Mirrors canonical file naming rooted at `HomeDir` in `g_setup.c`; this helper only
 * normalizes TypeScript export diagnostics.
 */
function toRepoRelativePosixPath(absolutePath) {
  return path.relative(REPO_ROOT, absolutePath).split(path.sep).join(path.posix.sep);
}

/**
 * Parse one uncompressed indexed BMP (4-bit or 8-bit) into top-down palette indices.
 * Related C behavior: Micropolis classic object drawing in `w_sprite.c` uses picture+mask
 * pixmaps loaded by `GetObjectXpms` in `g_setup.c`. This is not a 1:1 C port because
 * MicropolisCore packs ship BMP strips instead of XPM picture/mask pairs.
 */
export function parseIndexedBmpToPaletteIndexes(bmpBytes, sourcePath = '<inline>') {
  if (bmpBytes.length < BITMAP_FILE_HEADER_SIZE + BITMAP_INFO_HEADER_SIZE) {
    throw new Error(`BMP too small in ${sourcePath}`);
  }

  if (bmpBytes.toString('ascii', 0, 2) !== BITMAP_SIGNATURE) {
    throw new Error(`Unsupported BMP signature in ${sourcePath}`);
  }

  const dataOffset = bmpBytes.readUInt32LE(10);
  const dibHeaderSize = bmpBytes.readUInt32LE(14);
  if (dibHeaderSize < BITMAP_INFO_HEADER_SIZE) {
    throw new Error(`Unsupported BMP DIB header size ${dibHeaderSize} in ${sourcePath}`);
  }

  const width = bmpBytes.readInt32LE(18);
  const heightRaw = bmpBytes.readInt32LE(22);
  const planes = bmpBytes.readUInt16LE(26);
  const bitsPerPixel = bmpBytes.readUInt16LE(28);
  const compression = bmpBytes.readUInt32LE(30);
  const colorsUsed = bmpBytes.readUInt32LE(46);

  if (!Number.isInteger(width) || width <= 0) {
    throw new Error(`Unsupported BMP width ${width} in ${sourcePath}`);
  }
  if (!Number.isInteger(heightRaw) || heightRaw === 0) {
    throw new Error(`Unsupported BMP height ${heightRaw} in ${sourcePath}`);
  }
  if (planes !== 1) {
    throw new Error(`Unsupported BMP planes ${planes} in ${sourcePath}`);
  }
  if (bitsPerPixel !== 4 && bitsPerPixel !== 8) {
    throw new Error(`Unsupported BMP bits-per-pixel ${bitsPerPixel} in ${sourcePath}`);
  }
  if (compression !== BI_RGB) {
    throw new Error(`Unsupported BMP compression ${compression} in ${sourcePath}`);
  }

  const height = Math.abs(heightRaw);
  const isTopDown = heightRaw < 0;
  const paletteColorCount = colorsUsed === 0 ? 1 << bitsPerPixel : colorsUsed;
  const paletteOffset = BITMAP_FILE_HEADER_SIZE + dibHeaderSize;
  const paletteByteLength = paletteColorCount * 4;
  if (paletteOffset + paletteByteLength > bmpBytes.length) {
    throw new Error(`Truncated BMP palette in ${sourcePath}`);
  }

  const palette = [];
  for (let index = 0; index < paletteColorCount; index += 1) {
    const entryOffset = paletteOffset + index * 4;
    const blue = bmpBytes[entryOffset];
    const green = bmpBytes[entryOffset + 1];
    const red = bmpBytes[entryOffset + 2];
    if (blue === undefined || green === undefined || red === undefined) {
      throw new Error(`Truncated BMP palette entry ${index} in ${sourcePath}`);
    }
    palette.push([red, green, blue]);
  }

  const rowStride = Math.floor((bitsPerPixel * width + 31) / 32) * 4;
  const pixelArrayByteLength = rowStride * height;
  if (dataOffset + pixelArrayByteLength > bmpBytes.length) {
    throw new Error(`Truncated BMP pixel array in ${sourcePath}`);
  }

  const indexes = new Uint8Array(width * height);
  for (let row = 0; row < height; row += 1) {
    const sourceRow = isTopDown ? row : height - 1 - row;
    const sourceRowOffset = dataOffset + sourceRow * rowStride;
    const targetRowOffset = row * width;
    if (bitsPerPixel === 8) {
      indexes.set(bmpBytes.subarray(sourceRowOffset, sourceRowOffset + width), targetRowOffset);
      continue;
    }

    const packedBytesPerRow = Math.ceil(width / 2);
    for (let byteIndex = 0; byteIndex < packedBytesPerRow; byteIndex += 1) {
      const packed = bmpBytes[sourceRowOffset + byteIndex];
      if (packed === undefined) {
        throw new Error(`Truncated 4-bit BMP row data in ${sourcePath}`);
      }

      const leftPixel = packed >> 4;
      const rightPixel = packed & 0x0f;
      const leftColumn = byteIndex * 2;
      const rightColumn = leftColumn + 1;
      indexes[targetRowOffset + leftColumn] = leftPixel;
      if (rightColumn < width) {
        indexes[targetRowOffset + rightColumn] = rightPixel;
      }
    }
  }

  return {
    width,
    height,
    palette,
    indexes,
  };
}

/**
 * Compute a per-pixel transparency mask using border-connected matte fill per frame.
 * Related C behavior: classic Micropolis sprite rendering applies explicit object masks via
 * `XSetClipMask` in `DrawSprite` (`w_sprite.c`). This adapter reconstructs an alpha mask
 * for MicropolisCore BMP strips by treating each frame's top-left index as matte and only
 * clearing pixels connected to the frame border.
 */
export function createBorderConnectedFrameMatteMask({
  indexes,
  width,
  height,
  frameWidth,
  frameHeight,
}) {
  if (indexes.length !== width * height) {
    throw new Error(
      `Index buffer length mismatch: expected ${width * height}, found ${indexes.length}`,
    );
  }
  if (width % frameWidth !== 0 || height % frameHeight !== 0) {
    throw new Error(
      `Frame size ${frameWidth}x${frameHeight} does not tile sheet size ${width}x${height}`,
    );
  }

  const frameColumns = width / frameWidth;
  const frameRows = height / frameHeight;
  const transparentMask = new Uint8Array(width * height);

  for (let frameRow = 0; frameRow < frameRows; frameRow += 1) {
    for (let frameColumn = 0; frameColumn < frameColumns; frameColumn += 1) {
      const frameX = frameColumn * frameWidth;
      const frameY = frameRow * frameHeight;
      const matteIndex = indexes[frameY * width + frameX];
      if (matteIndex === undefined) {
        throw new Error(`Missing matte index for frame (${frameColumn}, ${frameRow})`);
      }

      const frameVisited = new Uint8Array(frameWidth * frameHeight);
      const queue = [];
      let queueHead = 0;

      const enqueueIfMatte = (localX, localY) => {
        const localOffset = localY * frameWidth + localX;
        if (frameVisited[localOffset] === 1) {
          return;
        }
        const globalX = frameX + localX;
        const globalY = frameY + localY;
        const globalOffset = globalY * width + globalX;
        if (indexes[globalOffset] !== matteIndex) {
          return;
        }
        frameVisited[localOffset] = 1;
        queue.push(localX, localY);
      };

      for (let localX = 0; localX < frameWidth; localX += 1) {
        enqueueIfMatte(localX, 0);
        enqueueIfMatte(localX, frameHeight - 1);
      }
      for (let localY = 1; localY < frameHeight - 1; localY += 1) {
        enqueueIfMatte(0, localY);
        enqueueIfMatte(frameWidth - 1, localY);
      }

      while (queueHead < queue.length) {
        const localX = queue[queueHead];
        const localY = queue[queueHead + 1];
        queueHead += 2;

        const neighbors = [
          [localX + 1, localY],
          [localX - 1, localY],
          [localX, localY + 1],
          [localX, localY - 1],
        ];
        for (const [neighborX, neighborY] of neighbors) {
          if (
            neighborX < 0 ||
            neighborY < 0 ||
            neighborX >= frameWidth ||
            neighborY >= frameHeight
          ) {
            continue;
          }
          enqueueIfMatte(neighborX, neighborY);
        }
      }

      for (let localY = 0; localY < frameHeight; localY += 1) {
        for (let localX = 0; localX < frameWidth; localX += 1) {
          const localOffset = localY * frameWidth + localX;
          if (frameVisited[localOffset] !== 1) {
            continue;
          }
          const globalX = frameX + localX;
          const globalY = frameY + localY;
          transparentMask[globalY * width + globalX] = 1;
        }
      }
    }
  }

  return transparentMask;
}

/**
 * Build RGBA pixels for one MicropolisCore object sheet using the matte mask heuristic.
 * Related C behavior: this adapts the clip-mask result used by `DrawSprite` in `w_sprite.c`
 * to a single RGBA sheet representation for browser rendering.
 */
export function bakeMicropolisCoreObjectSheetToRgba({
  width,
  height,
  palette,
  indexes,
  frameWidth,
  frameHeight,
}) {
  const transparentMask = createBorderConnectedFrameMatteMask({
    width,
    height,
    indexes,
    frameWidth,
    frameHeight,
  });

  const rgba = new Uint8Array(width * height * 4);
  for (let pixelIndex = 0; pixelIndex < indexes.length; pixelIndex += 1) {
    const paletteIndex = indexes[pixelIndex];
    const color = palette[paletteIndex];
    if (color === undefined) {
      throw new Error(`Palette index ${paletteIndex} out of range`);
    }
    const outputOffset = pixelIndex * 4;
    rgba[outputOffset] = color[0];
    rgba[outputOffset + 1] = color[1];
    rgba[outputOffset + 2] = color[2];
    rgba[outputOffset + 3] = transparentMask[pixelIndex] === 1 ? 0 : 255;
  }

  return rgba;
}

/**
 * Write file bytes only when content changed for deterministic idempotent exports.
 * Mirrors stable canonical source ownership from `g_setup.c`; this helper only controls
 * TypeScript-derived `*-alpha.png` artifacts.
 */
function writeFileIfChanged(filePath, nextBytes) {
  const existingStats = statSync(filePath, { throwIfNoEntry: false });
  if (existingStats !== undefined) {
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
 * List existing exported MicropolisCore object alpha sheet filenames for cleanup.
 * No direct C counterpart: this is deterministic build-artifact pruning.
 */
function listExistingAlphaSheets(tilesetsDir) {
  const alphaSheetPaths = [];
  const entries = readdirSync(tilesetsDir, { withFileTypes: true }).sort((left, right) =>
    compareAscii(left.name, right.name),
  );
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const tilesetDir = path.join(tilesetsDir, entry.name);
    const files = readdirSync(tilesetDir, { withFileTypes: true })
      .filter((file) => file.isFile() && file.name.endsWith('-alpha.png'))
      .map((file) => path.join(tilesetDir, file.name))
      .sort((left, right) => compareAscii(left, right));
    alphaSheetPaths.push(...files);
  }
  return alphaSheetPaths;
}

/**
 * Export RGBA MicropolisCore object sheets with reconstructed transparency masks.
 * Related C behavior: classic object art uses separate picture/mask pixmaps from
 * `GetObjectXpms` and `DrawSprite` (`g_setup.c` / `w_sprite.c`). This TypeScript exporter
 * derives a browser alpha channel for MicropolisCore BMP strips and writes
 * `packages/sim-assets/micropoliscore-tilesets/<tileset>/<object>-alpha.png`.
 */
export function exportMicropolisCoreObjectAlphaImages({
  dryRun = false,
  tilesetsDir = MICROPOLISCORE_TILESETS_DIR,
} = {}) {
  const expectedOutputs = new Set();
  const tilesetEntries = readdirSync(tilesetsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => compareAscii(left.name, right.name));

  let written = 0;
  let unchanged = 0;

  for (const tilesetEntry of tilesetEntries) {
    const tilesetDir = path.join(tilesetsDir, tilesetEntry.name);
    for (const spec of MICROPOLISCORE_OBJECT_SHEET_SPECS) {
      const sourceBmpPath = path.join(tilesetDir, `${spec.assetBasename}.bmp`);
      const sourcePngPath = path.join(tilesetDir, `${spec.assetBasename}.png`);
      const outputPngPath = path.join(tilesetDir, `${spec.assetBasename}-alpha.png`);
      expectedOutputs.add(outputPngPath);

      const sourcePath = statSync(sourceBmpPath, { throwIfNoEntry: false })
        ? sourceBmpPath
        : sourcePngPath;
      if (statSync(sourcePath, { throwIfNoEntry: false }) === undefined) {
        throw new Error(
          `Missing MicropolisCore object sheet for ${tilesetEntry.name}/${spec.assetBasename}`,
        );
      }

      const bmpBytes = readFileSync(sourcePath);
      const parsed = parseIndexedBmpToPaletteIndexes(bmpBytes, toRepoRelativePosixPath(sourcePath));
      const rgba = bakeMicropolisCoreObjectSheetToRgba({
        ...parsed,
        frameWidth: spec.frameWidth,
        frameHeight: spec.frameHeight,
      });
      const pngBytes = encodeRgbaAsPng(parsed.width, parsed.height, rgba);

      if (dryRun) {
        const existingStats = statSync(outputPngPath, { throwIfNoEntry: false });
        if (existingStats !== undefined && readFileSync(outputPngPath).equals(pngBytes)) {
          unchanged += 1;
        } else {
          written += 1;
        }
        continue;
      }

      if (writeFileIfChanged(outputPngPath, pngBytes)) {
        written += 1;
      } else {
        unchanged += 1;
      }
    }
  }

  const staleOutputs = listExistingAlphaSheets(tilesetsDir)
    .filter((outputPath) => !expectedOutputs.has(outputPath))
    .sort((left, right) => compareAscii(left, right));
  if (!dryRun) {
    for (const staleOutputPath of staleOutputs) {
      rmSync(staleOutputPath);
    }
  }

  return {
    tilesetCount: tilesetEntries.length,
    outputCount: expectedOutputs.size,
    written,
    unchanged,
    removed: staleOutputs.length,
    dryRun,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  const dryRun = process.argv.includes('--dry-run');
  const summary = exportMicropolisCoreObjectAlphaImages({ dryRun });
  const mode = dryRun ? 'dry-run' : 'write';
  const outputRoot = toRepoRelativePosixPath(MICROPOLISCORE_TILESETS_DIR);
  process.stdout.write(
    `${mode} exported ${summary.outputCount} MicropolisCore object alpha sheet(s) under ${outputRoot}; wrote ${summary.written}, unchanged ${summary.unchanged}, removed ${summary.removed}\n`,
  );
}
