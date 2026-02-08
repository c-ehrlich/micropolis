/**
 * Canonical bridge protocol version expected by the web runtime `hello` handshake.
 * Mirrors the strict version-lockstep requirement documented in
 * `ref/micropolis/spec/integration/SPEC.md` via Stage contract mapping.
 * Parity note: Micropolis C integration does not define this websocket `hello` envelope;
 * this constant is an intentional bridge-layer addition for Stage 4.
 */
export const BRIDGE_PROTOCOL_VERSION = 'bridge-v1';

/**
 * Canonical simulation core version expected by the web runtime `hello` handshake.
 * Mirrors Stage lockstep compatibility constraints mapped from
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: this version token is a bridge contract artifact, not a direct C symbol.
 */
export const BRIDGE_CORE_VERSION = 'core-v1';

/**
 * Canonical handshake failure code for `hello` protocol/core incompatibility.
 * Mirrors Stage validator semantics mapped from `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: explicit error codes are intentionally stronger than Micropolis C stderr-only
 * startup failures to support deterministic browser UX.
 */
export const HELLO_VERSION_MISMATCH_CODE = 'HELLO_VERSION_MISMATCH';

/**
 * Required version fields carried by bridge `hello` payloads.
 * Mirrors lockstep protocol/core version checks documented in
 * `ref/micropolis/spec/integration/SPEC.md` integration mapping.
 */
export interface HelloVersions {
  readonly protocolVersion: string;
  readonly coreVersion: string;
}

/**
 * Minimal `hello` payload consumed by the web runtime during bootstrap.
 * Mirrors transport identity expectations mapped from
 * `ref/micropolis/spec/integration/SPEC.md` startup and integration glue.
 * Parity note: envelope shape is bridge-specific and intentionally not a 1:1 C struct.
 */
export interface HelloPayload extends HelloVersions {
  readonly roomId: string;
  readonly clientId: string;
}

/**
 * Structured mismatch details returned by bridge `hello` compatibility validation.
 * Mirrors Stage validator diagnostics mapped from
 * `ref/micropolis/spec/integration/SPEC.md`.
 */
export interface HelloVersionMismatch {
  readonly code: typeof HELLO_VERSION_MISMATCH_CODE;
  readonly message: string;
  readonly expected: HelloVersions;
  readonly received: HelloVersions;
}

/**
 * Union result for `hello` compatibility checks.
 * Mirrors strict startup gating intent from `ref/micropolis/spec/integration/SPEC.md`.
 */
export type HelloCompatibilityResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly mismatch: HelloVersionMismatch };

/**
 * Expected bridge versions for lockstep handshake checks.
 * Mirrors Stage frozen handshake defaults mapped from
 * `ref/micropolis/spec/integration/SPEC.md`.
 */
export const EXPECTED_HELLO_VERSIONS: HelloVersions = {
  protocolVersion: BRIDGE_PROTOCOL_VERSION,
  coreVersion: BRIDGE_CORE_VERSION,
};

/**
 * Build a host `hello` payload with deterministic identity defaults and optional
 * version overrides.
 * Mirrors deterministic local identity expectations from Stage docs mapped to
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: this helper centralizes bridge bootstrap shape in TypeScript.
 */
export function createHelloPayload(
  identity: Pick<HelloPayload, 'roomId' | 'clientId'>,
  versions: Partial<HelloVersions> = {},
): HelloPayload {
  return {
    roomId: identity.roomId,
    clientId: identity.clientId,
    protocolVersion: versions.protocolVersion ?? BRIDGE_PROTOCOL_VERSION,
    coreVersion: versions.coreVersion ?? BRIDGE_CORE_VERSION,
  };
}

/**
 * Validate host `hello` payload versions against the canonical runtime expectation.
 * Mirrors strict lockstep handshake gating mapped from
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: unlike Micropolis C startup glue, this returns structured diagnostics
 * for deterministic browser error UX.
 */
export function validateHelloCompatibility(
  hello: HelloPayload,
  expected: HelloVersions = EXPECTED_HELLO_VERSIONS,
): HelloCompatibilityResult {
  const protocolMatches = hello.protocolVersion === expected.protocolVersion;
  const coreMatches = hello.coreVersion === expected.coreVersion;
  if (protocolMatches && coreMatches) {
    return { ok: true };
  }

  return {
    ok: false,
    mismatch: {
      code: HELLO_VERSION_MISMATCH_CODE,
      message: `hello version mismatch: expected ${expected.protocolVersion}/${expected.coreVersion}, received ${hello.protocolVersion}/${hello.coreVersion}`,
      expected,
      received: {
        protocolVersion: hello.protocolVersion,
        coreVersion: hello.coreVersion,
      },
    },
  };
}
