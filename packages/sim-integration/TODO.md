# @city/sim-integration

`@city/sim-integration` is implemented and no longer a stub.

Current status:

- Integration runtime orchestration is in place in `src/runtime.ts`.
- Sugar activity command bridge + stdout protocol parsing are in place in `src/sugar/*`.
- TTY stdin command buffering/channel parity behavior is in place in `src/tty/*`.
- NET UDP listen/hear hooks and Node adapters are in place in `src/net/*` and `src/adapters/*`.
- Ownership/layering contract is documented in `INTEGRATION-CONTRACT.md`.

Next work (from `PLAN.md`):

- Complete remaining plan checklist gates and checkpoint validations.
- Ensure package-level scripts/checks are consistently wired for local package gating.
- Close final acceptance checklist items after workspace gates pass.
