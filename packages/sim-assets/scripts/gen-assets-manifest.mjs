import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const PACKAGE_DIR = path.resolve(SCRIPT_DIR, '..');
const REPO_ROOT = path.resolve(PACKAGE_DIR, '..', '..');
const MICROPOLIS_ROOT = path.join(REPO_ROOT, 'ref', 'micropolis');
const OUTPUT_DIR = path.join(PACKAGE_DIR, 'src', 'generated');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'assets-manifest.ts');

const SOURCE_ROOTS = {
  res: path.join(MICROPOLIS_ROOT, 'res'),
  images: path.join(MICROPOLIS_ROOT, 'images'),
  manual: path.join(MICROPOLIS_ROOT, 'manual'),
};
const HELP_TCL_HELP_ID_REGEX = /^\s*Help\s+([^\s{]+)\s+\{/;

const compareAscii = (left, right) => {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
};

/**
 * Deterministically list all files under a directory as POSIX-style relative paths.
 * Mirrors Micropolis path traversal assumptions for canonical asset roots used by
 * `GetResource` in `ref/micropolis/src/sim/w_resrc.c` and XPM/manual loads in
 * `ref/micropolis/src/sim/g_setup.c` plus `ref/micropolis/res/micropolis.tcl`
 * (same canonical files, TypeScript script adds deterministic ordering).
 */
export function listRelativeFiles(rootDir) {
  const walk = (currentDir, relativePrefix) => {
    const entries = readdirSync(currentDir, { withFileTypes: true }).sort((left, right) =>
      compareAscii(left.name, right.name),
    );
    const files = [];

    for (const entry of entries) {
      const relativePath = relativePrefix
        ? path.posix.join(relativePrefix, entry.name)
        : entry.name;
      const absolutePath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        files.push(...walk(absolutePath, relativePath));
        continue;
      }

      if (entry.isFile()) {
        files.push(relativePath);
      }
    }

    return files;
  };

  return walk(rootDir, '');
}

/**
 * Build a deterministic file manifest for a canonical Micropolis asset root.
 * Preserves raw byte size so downstream parity checks can mirror C loader behavior
 * from `w_resrc.c` where resources are read as full byte buffers (1:1 size parity,
 * TypeScript manifest only adds stable metadata structure).
 */
export function createFileEntries(rootDir) {
  return listRelativeFiles(rootDir).map((relativePath) => ({
    path: relativePath,
    size: statSync(path.join(rootDir, relativePath)).size,
  }));
}

/**
 * Scan canonical Micropolis asset roots under `ref/micropolis/{res,images,manual}`.
 * Mirrors the same canonical input locations used by C/Tcl runtime loading in:
 * - `ref/micropolis/src/sim/w_resrc.c` (resource files under `res/`)
 * - `ref/micropolis/src/sim/g_setup.c` (sprite/image XPM files under `images/`)
 * - `ref/micropolis/res/micropolis.tcl` (manual/help HTML docs under `manual/`)
 * This is a parity-preserving scan of source files; TypeScript adds deterministic
 * ordering metadata only and does not alter canonical file identities.
 */
export function scanCanonicalInputs() {
  return {
    res: createFileEntries(SOURCE_ROOTS.res),
    images: createFileEntries(SOURCE_ROOTS.images),
    manual: createFileEntries(SOURCE_ROOTS.manual),
  };
}

/**
 * Build the canonical assets manifest from Micropolis source directories.
 * Mirrors resource naming and sprite/manual identities from:
 * - `ref/micropolis/src/sim/w_resrc.c` (`%c%c%c%c.%d` resource files)
 * - `ref/micropolis/src/sim/g_setup.c` (`obj<ID>-<frame>.xpm` sprites)
 * - `ref/micropolis/res/micropolis.tcl` (`ResourceDir/doc/<id>.html` manual mapping)
 * (TypeScript manifest groups and sorts these identities deterministically).
 */
export function createAssetsManifest() {
  const fileManifest = scanCanonicalInputs();

  const resourceFiles = fileManifest.res
    .filter((entry) => !entry.path.includes('/'))
    .map((entry) => {
      const match = /^([a-z]{4})\.(\d+)$/.exec(entry.path);
      if (!match) {
        return null;
      }

      return {
        type: match[1],
        id: Number(match[2]),
        path: entry.path,
        size: entry.size,
      };
    })
    .filter((entry) => entry !== null)
    .sort((left, right) => {
      const typeCompare = compareAscii(left.type, right.type);
      if (typeCompare !== 0) {
        return typeCompare;
      }
      return left.id - right.id;
    });

  const spriteFrames = fileManifest.images
    .map((entry) => {
      const match = /^obj(\d+)-(\d+)\.xpm$/.exec(entry.path);
      if (!match) {
        return null;
      }

      return {
        spriteId: Number(match[1]),
        frame: Number(match[2]),
        path: entry.path,
        size: entry.size,
      };
    })
    .filter((entry) => entry !== null)
    .sort((left, right) => {
      if (left.spriteId !== right.spriteId) {
        return left.spriteId - right.spriteId;
      }
      return left.frame - right.frame;
    });

  const manualHtmlIds = fileManifest.manual
    .filter((entry) => entry.path.endsWith('.html') && !entry.path.includes('/'))
    .map((entry) => entry.path.slice(0, -'.html'.length))
    .sort((left, right) => compareAscii(left, right));
  const helpTclPath = path.join(SOURCE_ROOTS.res, 'help.tcl');
  const helpTclSource = readFileSync(helpTclPath, 'utf8');
  const helpIds = createHelpIdsFromHelpTcl(helpTclSource);

  return {
    generatedBy: '@city/sim-assets/scripts/gen-assets-manifest.mjs',
    sourceRoots: {
      res: 'ref/micropolis/res',
      images: 'ref/micropolis/images',
      manual: 'ref/micropolis/manual',
    },
    files: fileManifest,
    parity: {
      cResourceFiles: resourceFiles,
      spriteFrames,
      helpIds,
      manualHtmlIds,
    },
  };
}

/**
 * Extract unique `Help <id>` names from canonical `help.tcl`.
 * Mirrors `Help` command registrations in `ref/micropolis/res/help.tcl` and
 * `proc Help` message keys in `ref/micropolis/res/micropolis.tcl`.
 * Parity notes: IDs are kept in first-seen order and de-duplicated for stable,
 * deterministic TypeScript manifest output.
 */
function createHelpIdsFromHelpTcl(helpTclSource) {
  const seen = new Set();
  const helpIds = [];

  for (const line of helpTclSource.split('\n')) {
    const match = HELP_TCL_HELP_ID_REGEX.exec(line);
    if (!match) {
      continue;
    }

    const id = match[1];
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    helpIds.push(id);
  }

  return helpIds;
}

/**
 * Generate `src/generated/assets-manifest.ts` from canonical Micropolis assets.
 * This is a TypeScript build artifact step with C/Tcl parity intent: canonical
 * file identities remain sourced from `ref/micropolis` rather than rewritten data.
 */
export function generateAssetsManifest() {
  const manifest = createAssetsManifest();
  const fileContents = `/**
 * Generated by \`packages/sim-assets/scripts/gen-assets-manifest.mjs\`.
 * Canonical source roots: \`ref/micropolis/{res,images,manual}\`.
 * Do not edit manually.
 */
export const ASSETS_MANIFEST = ${JSON.stringify(manifest, null, 2)} as const;
`;

  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(OUTPUT_FILE, fileContents);

  return OUTPUT_FILE;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  const outputFile = generateAssetsManifest();
  const outputPathForLog = path
    .relative(REPO_ROOT, outputFile)
    .split(path.sep)
    .join(path.posix.sep);
  process.stdout.write(`generated ${outputPathForLog}\n`);
}
