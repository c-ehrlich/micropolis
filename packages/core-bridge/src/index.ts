/**
 * Placeholder bridge metadata used to freeze the package surface in Stage 0.
 * Mirrors the protocol ownership direction in `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: intentionally different from Micropolis C integration code because this is
 * a scaffold export only and does not implement Sugar/TTY/NET runtime behavior yet.
 */
export interface CoreBridgeScaffold {
  readonly packageName: '@city/core-bridge';
  readonly stage: 'stage-0-contract-freeze';
}

/**
 * Returns static scaffold metadata for `@city/core-bridge`.
 * Mirrors the protocol-owner packaging intent from `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: intentionally different from C behavior because this helper has no transport side effects.
 */
export function getCoreBridgeScaffold(): CoreBridgeScaffold {
  return {
    packageName: '@city/core-bridge',
    stage: 'stage-0-contract-freeze',
  };
}

export * from './command-outcome.ts';
export type {
  CoreHost as Stage1CoreHost,
  CoreHostEventListener as Stage1CoreHostEventListener,
  CoreHostResult as Stage1CoreHostResult,
  CoreHostUnsubscribe as Stage1CoreHostUnsubscribe,
} from './core-host.ts';
export * from './fixtures.ts';
export * from './host.ts';
export {
  defineCoreHostConformanceSuite,
  type HostConformanceCreateOptions,
  type HostConformanceSuiteAdapter,
} from './host-conformance-suite.ts';
export * from './local-host.ts';
export * from './mock-authority-engine.ts';
export * from './mock-host.ts';
export * from './sequencing.ts';
export * from './types.ts';
export * from './validation.ts';
