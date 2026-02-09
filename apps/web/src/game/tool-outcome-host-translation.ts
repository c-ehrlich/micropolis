import type { ToolResult } from '../../../../packages/sim-core/src/index.ts';
import type { CoreHostRejectCode } from './core-host';

/**
 * Host-side acknowledgement outcome for one applied tool command.
 * Mirrors successful `DoTool` paths in `ref/micropolis/src/sim/w_tool.c`
 * where no reject branch is taken and placement commit proceeds.
 * Parity note: explicit ack payload objects are a TypeScript bridge addition.
 */
export interface HostToolAckOutcome {
  readonly kind: 'ack';
}

/**
 * Host-side rejection outcome for one denied tool command.
 * Mirrors `DoTool` failure classes in `ref/micropolis/src/sim/w_tool.c` where:
 * - `-1` maps to out-of-bounds style rejection (`SendMes(34)`)
 * - `-2` maps to no-funds style rejection (`SendMes(33)`).
 * Parity note: typed code/message fields are a TypeScript bridge addition.
 */
export interface HostToolRejectOutcome {
  readonly kind: 'reject';
  readonly code: CoreHostRejectCode;
  readonly message: string;
}

/**
 * Stable host-level outcome union for tool command translation.
 * Mirrors C success versus reject branching in `DoTool` from
 * `ref/micropolis/src/sim/w_tool.c`.
 */
export type HostToolOutcome = HostToolAckOutcome | HostToolRejectOutcome;

const HOST_TOOL_ACK_OUTCOME: HostToolAckOutcome = { kind: 'ack' };
const HOST_TOOL_OUT_OF_BOUNDS_REJECT: HostToolRejectOutcome = {
  kind: 'reject',
  code: 'OUT_OF_BOUNDS',
  message: 'tool coordinates are out of bounds',
};
const HOST_TOOL_NO_FUNDS_REJECT: HostToolRejectOutcome = {
  kind: 'reject',
  code: 'NO_FUNDS',
  message: 'insufficient funds for tool placement',
};
const HOST_TOOL_INVALID_PLACEMENT_REJECT: HostToolRejectOutcome = {
  kind: 'reject',
  code: 'INVALID_PLACEMENT',
  message: 'tool placement was rejected by simulation rules',
};

const HOST_TOOL_OUTCOME_BY_RESULT = {
  ok: HOST_TOOL_ACK_OUTCOME,
  'out-of-bounds': HOST_TOOL_OUT_OF_BOUNDS_REJECT,
  'no-funds': HOST_TOOL_NO_FUNDS_REJECT,
  reject: HOST_TOOL_INVALID_PLACEMENT_REJECT,
} satisfies Record<ToolResult, HostToolOutcome>;

/**
 * Translate one sim-core tool result into a stable host ack/reject outcome.
 * Mirrors `DoTool` return-code branching in `ref/micropolis/src/sim/w_tool.c`,
 * while preserving deterministic bridge-level reject codes/messages in TypeScript.
 * Parity note: the mapping is not 1:1 C text because C emits message IDs instead
 * of typed host reject payload fields.
 */
export function translateToolResultToHostOutcome(result: ToolResult): HostToolOutcome {
  const outcome = HOST_TOOL_OUTCOME_BY_RESULT[result];
  if (outcome.kind === 'ack') {
    return outcome;
  }

  // Return a fresh object so callers can safely cache/mutate local copies.
  return { ...outcome };
}

/**
 * Stable preflight reject for host-side out-of-bounds coordinate validation.
 * Mirrors C `DoTool`/`ToolDown` handling in `ref/micropolis/src/sim/w_tool.c`
 * where out-of-bounds class failures route to the same `SendMes(34)` branch.
 */
export function createOutOfBoundsHostRejectOutcome(): HostToolRejectOutcome {
  return { ...HOST_TOOL_OUT_OF_BOUNDS_REJECT };
}
