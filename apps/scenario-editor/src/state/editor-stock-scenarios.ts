import {
  getScenarioDefinition,
  SCENARIO_BUNDLE_V1_MAP_HEIGHT,
  SCENARIO_BUNDLE_V1_MAP_WIDTH,
  SCENARIO_TABLE,
  type ScenarioBundleV1,
  type ScenarioId,
} from '@city/scenario-core';
import {
  classicBuiltinScenarioKeyForLegacyId,
  getClassicBuiltinScenarioRuntimeDefinitionByLegacyId,
  type ScenarioEventDefinition,
  type ScenarioObjectivePredicate,
  type ScenarioRuntimeAction,
} from '@city/scenario-runtime';
import { decodeCityFileForMap } from '@city/sim-core';

/**
 * One stock Micropolis scenario row shown by the editor open menu.
 * Mirrors `LoadScenario(short s)` table constants in
 * `ref/micropolis/src/sim/s_fileio.c` while exposing canonical `builtin/*` keys.
 */
export interface ScenarioEditorStockScenarioOption {
  readonly fileName: string;
  readonly id: ScenarioId;
  readonly key: string;
  readonly name: string;
  readonly startFunds: number;
  readonly startYear: number;
}

/**
 * Optional loader override for stock scenario bytes.
 * Mirrors `_load_file(fname, ResourceDir)` in `ref/micropolis/src/sim/s_fileio.c`;
 * parity difference: browser/tests inject custom byte loaders.
 */
export interface ScenarioEditorStockScenarioLoadOptions {
  readonly loadScenarioResourceBytes?: (fileName: string) => Promise<Uint8Array>;
}

/**
 * Readonly stock scenario options for Export-screen selection controls.
 * Mirrors classic scenario metadata rows from `LoadScenario` in
 * `ref/micropolis/src/sim/s_fileio.c`, with canonical `builtin/*` key identity.
 */
export function getScenarioEditorStockScenarioOptions(): readonly ScenarioEditorStockScenarioOption[] {
  return SCENARIO_EDITOR_STOCK_SCENARIO_OPTIONS;
}

/**
 * Load one stock scenario into editor bundle form from canonical `snro.*` bytes.
 * Mirrors `LoadScenario` resource decode ownership in
 * `ref/micropolis/src/sim/s_fileio.c`; parity difference: result is Stage 0
 * `ScenarioBundleV1` (`tile-words`) for iterative browser editing.
 */
export async function loadScenarioEditorStockScenarioBundle(
  scenarioId: number,
  options: ScenarioEditorStockScenarioLoadOptions = {},
): Promise<ScenarioBundleV1> {
  const scenario = getScenarioDefinition(scenarioId);
  const scenarioKey = classicBuiltinScenarioKeyForLegacyId(scenario.id);
  if (scenarioKey === undefined) {
    throw new Error(`expected builtin scenario key for id ${scenario.id}`);
  }

  const loadScenarioResourceBytes =
    options.loadScenarioResourceBytes ?? readScenarioEditorStockScenarioResourceBytes;
  const scenarioBytes = await loadScenarioResourceBytes(scenario.fileName);
  const decodedScenarioCity = decodeCityFileForMap(scenarioBytes, {
    width: SCENARIO_BUNDLE_V1_MAP_WIDTH,
    height: SCENARIO_BUNDLE_V1_MAP_HEIGHT,
  });

  const runtimeDefinition = getClassicBuiltinScenarioRuntimeDefinitionByLegacyId(scenario.id);
  const script =
    runtimeDefinition === undefined
      ? []
      : toScenarioEditorStockBundleScript(runtimeDefinition.events);
  const bundle: ScenarioBundleV1 = {
    version: 1,
    key: scenarioKey,
    name: scenario.name,
    description: `Classic stock scenario imported from ${scenario.fileName}.`,
    tags: ['builtin', 'classic', 'stock'],
    start: {
      startYear: scenario.startYear,
      startFunds: scenario.startFunds,
    },
    map: {
      kind: 'tile-words',
      width: SCENARIO_BUNDLE_V1_MAP_WIDTH,
      height: SCENARIO_BUNDLE_V1_MAP_HEIGHT,
      tileWords: Array.from(decodedScenarioCity.map),
    },
    ...(runtimeDefinition?.objective === undefined
      ? {}
      : {
          objective: cloneScenarioRuntimeObjectivePredicate(runtimeDefinition.objective.predicate),
        }),
    ...(script.length === 0 ? {} : { script }),
  };

  return bundle;
}

/**
 * Resolve and fetch one stock `snro.*` file as unsigned bytes.
 * Mirrors `_load_file(fname, ResourceDir)` from `ref/micropolis/src/sim/s_fileio.c`,
 * adapted to browser `fetch` over Vite-resolved local URLs.
 */
async function readScenarioEditorStockScenarioResourceBytes(fileName: string): Promise<Uint8Array> {
  const resourceUrl = SCENARIO_EDITOR_STOCK_SCENARIO_RESOURCE_URLS.get(fileName);
  if (resourceUrl === undefined) {
    throw new Error(`unsupported scenario file: ${fileName}`);
  }

  const response = await fetch(resourceUrl);
  if (!response.ok) {
    throw new Error(`failed to fetch scenario resource ${resourceUrl}: ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Convert runtime event definitions into Stage 4 bundle script rows.
 * Mirrors `ScenarioDisaster` trigger/action styles from
 * `ref/micropolis/src/sim/s_disast.c`; parity difference: each rule becomes one
 * explicit bundle event row for editor/script authoring.
 */
function toScenarioEditorStockBundleScript(
  events: readonly ScenarioEventDefinition[],
): NonNullable<ScenarioBundleV1['script']> {
  const scriptRows: NonNullable<ScenarioBundleV1['script']> = [];
  for (const event of events) {
    for (const rule of event.rules) {
      scriptRows.push({
        trigger:
          rule.when.kind === 'countdown-equals'
            ? { atTick: rule.when.value }
            : { everyTicks: rule.when.kind === 'always' ? 1 : rule.when.interval },
        actions: [cloneScenarioRuntimeAction(rule.action)],
      });
    }
  }
  return scriptRows;
}

/**
 * Clone one runtime objective predicate tree into bundle-objective shape.
 * Mirrors metric domains from `DoScenarioScore` in `ref/micropolis/src/sim/s_msg.c`;
 * parity difference: cloning strips runtime-only object identity concerns.
 */
function cloneScenarioRuntimeObjectivePredicate(
  predicate: ScenarioObjectivePredicate,
): NonNullable<ScenarioBundleV1['objective']> {
  if (predicate.kind === 'metric') {
    return {
      kind: 'metric',
      metric: predicate.metric,
      op: predicate.op,
      value: predicate.value,
    };
  }
  if (predicate.kind === 'all') {
    return {
      kind: 'all',
      predicates: predicate.predicates.map((child) =>
        cloneScenarioRuntimeObjectivePredicate(child),
      ),
    };
  }
  if (predicate.kind === 'any') {
    return {
      kind: 'any',
      predicates: predicate.predicates.map((child) =>
        cloneScenarioRuntimeObjectivePredicate(child),
      ),
    };
  }
  return {
    kind: 'not',
    predicate: cloneScenarioRuntimeObjectivePredicate(predicate.predicate),
  };
}

/**
 * Clone one runtime action into bundle-script action shape.
 * Mirrors `ScenarioDisaster`/`DoScenarioScore` action domains from
 * `ref/micropolis/src/sim/s_disast.c` and `ref/micropolis/src/sim/s_msg.c`.
 */
function cloneScenarioRuntimeAction(
  action: ScenarioRuntimeAction,
): NonNullable<ScenarioBundleV1['script']>[number]['actions'][number] {
  return action.kind === 'send-message'
    ? { kind: 'send-message', messageId: action.messageId }
    : { kind: action.kind };
}

const SCENARIO_EDITOR_STOCK_SCENARIO_OPTIONS: readonly ScenarioEditorStockScenarioOption[] =
  Object.freeze(
    SCENARIO_TABLE.map((scenario): ScenarioEditorStockScenarioOption => {
      const scenarioKey = classicBuiltinScenarioKeyForLegacyId(scenario.id);
      if (scenarioKey === undefined) {
        throw new Error(`expected builtin scenario key for id ${scenario.id}`);
      }
      return {
        id: scenario.id,
        key: scenarioKey,
        name: scenario.name,
        fileName: scenario.fileName,
        startYear: scenario.startYear,
        startFunds: scenario.startFunds,
      };
    }),
  );
const SCENARIO_EDITOR_STOCK_SCENARIO_RESOURCE_URLS: ReadonlyMap<string, URL> = new Map(
  SCENARIO_TABLE.map(({ fileName }) => [
    fileName,
    new URL(`../../../../ref/micropolis/res/${fileName}`, import.meta.url),
  ]),
);
