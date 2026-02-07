# Integration Contract (`@city/sim-integration`)

## Purpose

This document defines ownership boundaries between `@city/sim-integration`,
`@city/sim-core`, `@city/sim-ui`, and `@city/sim-io`.

Parity baseline for this package is the Micropolis integration surface in:

- `ref/micropolis/micropolisactivity.py` (Sugar process bridge)
- `ref/micropolis/src/sim/w_tk.c` (TTY stdin command loop)
- `ref/micropolis/src/sim/w_sim.c` and `ref/micropolis/src/sim/w_net.c` (NET Tcl commands + UDP hooks)

## Ownership Boundaries

| Package | Owns | Must Not Own |
| --- | --- | --- |
| `@city/sim-core` | Deterministic simulation state transitions, simulation systems, and hook contracts (`SimHooks`, `uiSet`, `sendMes`, `sendMesAt`, `makeSound`). | Transport adapters, process/stdin/stdout wiring, UDP socket wiring, and host runtime integration glue. |
| `@city/sim-integration` | Platform bridge runtime for Sugar/TTY/NET command transport and adapter boundaries for host I/O. | Simulation rules, map mutation logic, save/load file orchestration, UI rendering/state stores, or message string lookup. |
| `@city/sim-ui` | UI state/view rendering and user-facing handling of core hook outputs (messages, heads/options, map invalidation). | Simulation stepping rules, `.cty` persistence encoding/decoding, and low-level integration transport protocols. |
| `@city/sim-io` | `.cty`/scenario load-save orchestration and persistence adapters around `@city/sim-core` state/context. | Sugar/TTY/NET transport behavior and UI rendering/state policy. |

## Contract Rules

1. `@city/sim-integration` is a transport boundary layer only. It can forward events/commands, but must not reimplement `@city/sim-core` simulation behavior.
2. `@city/sim-core` remains the authority for simulation-side hook semantics and parity behavior; integration consumes those semantics but does not redefine them.
3. `@city/sim-ui` owns presentation decisions for core events/messages; integration may surface transport tokens, but UI interpretation stays in `@city/sim-ui`.
4. `@city/sim-io` owns persistence format parity and file orchestration; integration does not parse or serialize city/scenario files.
5. Cross-package composition must preserve one-way responsibilities: simulation logic in core, transport in integration, presentation in ui, persistence in io.

## Dependency Direction (Required)

- `@city/sim-core`: no dependency on `@city/sim-integration`, `@city/sim-ui`, or `@city/sim-io`.
- `@city/sim-integration`: may depend on shared types/adapters, but must not import simulation implementation internals from `@city/sim-core`.
- `@city/sim-ui`: may consume `@city/sim-core` outputs and `@city/sim-integration` runtime events.
- `@city/sim-io`: may consume `@city/sim-core` state/context contracts for load/save orchestration.

This separation preserves Micropolis parity layering: simulation (`sim/*.c`) stays distinct from integration transport (`micropolisactivity.py`, `w_tk.c`, `w_net.c`) and file orchestration (`s_fileio.c`).
