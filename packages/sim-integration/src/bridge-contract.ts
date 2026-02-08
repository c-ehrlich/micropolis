import type {
  CoreBridgeV1ClientEnvelope,
  CoreBridgeV1Envelope,
  CoreBridgeV1ServerEnvelope,
} from '../../core-bridge/src/index.ts';

/**
 * Canonical client-envelope contract consumed by integration runtime migration seams.
 * Mirrors command ingress intent in `ref/micropolis/src/sim/w_sim.c` and transport intake
 * boundaries in `ref/micropolis/src/sim/w_net.c`.
 * Parity note: intentionally different from Micropolis C string parsing by aliasing the
 * frozen `@city/core-bridge` envelope union directly (no local protocol fork).
 */
export type IntegrationBridgeClientEnvelopeV1 = CoreBridgeV1ClientEnvelope;

/**
 * Canonical server-envelope contract emitted by integration runtime migration seams.
 * Mirrors authoritative event fanout intent around sim/update networking in
 * `ref/micropolis/src/sim/w_sim.c` and `ref/micropolis/src/sim/w_net.c`.
 * Parity note: intentionally different from C callback/text transport by aliasing the
 * frozen `@city/core-bridge` envelope union directly (no local protocol fork).
 */
export type IntegrationBridgeServerEnvelopeV1 = CoreBridgeV1ServerEnvelope;

/**
 * Frozen envelope-kind discriminant union forwarded from `@city/core-bridge`.
 * Mirrors event-category intent from `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: intentionally different from legacy ad-hoc string channels by requiring
 * one shared discriminant set owned by `@city/core-bridge`.
 */
export type IntegrationBridgeEnvelopeKindV1 = CoreBridgeV1Envelope['kind'];

/**
 * Bridge-envelope handler seam for migrating `@city/sim-integration` runtime entry points.
 * Mirrors separation of inbound command handling and outbound update emission across
 * `ref/micropolis/src/sim/w_sim.c` and `ref/micropolis/src/sim/w_net.c`.
 * Parity note: intentionally different from C global callback wiring by exposing explicit
 * typed handlers that depend on bridge-owned contracts.
 */
export interface IntegrationBridgeEnvelopeHandlersV1 {
  onClientEnvelope?: (envelope: IntegrationBridgeClientEnvelopeV1) => void;
  onServerEnvelope?: (envelope: IntegrationBridgeServerEnvelopeV1) => void;
}
