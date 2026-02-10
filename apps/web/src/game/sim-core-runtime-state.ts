import {
  createClassicMapStore,
  createRng,
  createSimContext,
  createSimState,
  createToolContext,
  doSimInit,
  initMapArrays,
  initWillStuff,
  type MapStore,
  type SimContext,
  type SimHooks,
  type SimState,
  type ToolContext,
} from '../../../../packages/sim-core/src/index.ts';

const DEFAULT_STARTING_FUNDS = 20_000;

/**
 * Construction options for Authoritative Runtime sim-core authority-owned state.
 * Mirrors Sim-Core Authority bootstrap wiring expected by Micropolis initialization paths in
 * `ref/micropolis/src/sim/s_init.c` and simulation boot flow in
 * `ref/micropolis/src/sim/s_sim.c`.
 * Parity note: explicit `seed`/`startingFunds` options are TypeScript test seams.
 */
export interface SimCoreRuntimeStateOptions {
  readonly seed?: number;
  readonly startingFunds?: number;
  /**
   * Optional hook overrides for Authoritative Runtime host integrations.
   * Mirrors `TickCount`/`SendMes`/`SendMesAt`/`UISet*` callback ownership across
   * `ref/micropolis/src/sim/w_stubs.c`, `ref/micropolis/src/sim/s_msg.c`, and
   * `ref/micropolis/src/sim/w_update.c`.
   * Parity note: this is an integration seam for bridge payload projection; the
   * underlying sim-core hook semantics remain 1:1 with C ownership.
   */
  readonly hooks?: Partial<SimHooks>;
}

/**
 * Owns the authoritative Authoritative Runtime sim-core runtime bundle.
 * Mirrors single-process ownership intent in `ref/micropolis/src/sim/w_sim.c` where
 * map data, simulation state, simulation context, and tool context are initialized
 * and advanced by one authority process.
 * Parity note: this is a composition helper for web host wiring, not a direct C type.
 */
export class SimCoreRuntimeState {
  public readonly store: MapStore;
  public readonly simState: SimState;
  public readonly simContext: SimContext;
  public readonly toolContext: ToolContext;

  public constructor(options: SimCoreRuntimeStateOptions = {}) {
    const store = createClassicMapStore();
    const simState = createSimState();
    const simContext = createSimContext({
      store,
      rng: createRng(options.seed),
      hooks: {
        tickCount: () => simState.Fcycle,
        ...options.hooks,
      },
    });

    initMapArrays(store);
    initWillStuff(simContext, simState, { seed: options.seed });
    simState.InitSimLoad = 2;
    doSimInit(simContext, simState);
    simState.TotalFunds = normalizeStartingFunds(options.startingFunds);
    simState.SimMetaSpeed = simState.SimSpeed;

    const toolContext = createToolContext({
      store,
      rng: simContext.rng,
      funds: simState.TotalFunds,
      autoBulldoze: simState.autoBulldoze,
      doAnimation: simState.doAnimation,
    });

    this.store = store;
    this.simState = simState;
    this.simContext = simContext;
    this.toolContext = toolContext;
  }
}

function normalizeStartingFunds(startingFunds: number | undefined): number {
  if (startingFunds === undefined || !Number.isFinite(startingFunds)) {
    return DEFAULT_STARTING_FUNDS;
  }

  return Math.trunc(startingFunds);
}
