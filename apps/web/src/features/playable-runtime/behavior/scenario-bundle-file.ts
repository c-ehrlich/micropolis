import {
  parseScenarioBundleV1,
  type ScenarioBundleV1,
} from '../../../../../../packages/scenario-core/src/scenario-bundle-v1.ts';

/**
 * Parsed external scenario bundle selected from the runtime file picker.
 * Mirrors selected-scenario ownership in `LoadScenario` from
 * `ref/micropolis/src/sim/s_fileio.c`.
 * Difference: preserves JSON source filename for web-only UX flows.
 */
export interface ExternalScenarioBundleFile {
  fileName: string;
  bundle: ScenarioBundleV1;
}

/**
 * Parses one external scenario JSON document from file-picker text input.
 * Mirrors `LoadScenario` file-ingest intent in `ref/micropolis/src/sim/s_fileio.c`.
 * Difference: validates Stage 0 `ScenarioBundleV1` JSON contracts rather than
 * legacy `snro.*` binary scenario files.
 */
export function parseExternalScenarioBundleFromFileText(
  fileName: string,
  fileText: string,
): ExternalScenarioBundleFile {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(fileText);
  } catch {
    throw new Error('external scenario JSON must be valid JSON');
  }

  try {
    return {
      fileName,
      bundle: parseScenarioBundleV1(parsedJson),
    };
  } catch {
    throw new Error('external scenario JSON must satisfy ScenarioBundleV1 schema');
  }
}
