# Sim Scripting Build Checklist (`@city/sim-scripting`)

## Agent Loop

Use this exact loop:

1. Pick the next unchecked task.
2. Implement only that task (and required supporting code).
3. Run tests/checks.
4. Mark the task checked.
5. Check off completed task(s) and record notes in `Execution Log`.

## Scope lock
- In scope:
  - Tcl-like command runtime and command handlers from `ref/micropolis/spec/scripting/SPEC.md`
  - callback bridge (`UI*`, `HandlePacket`, tool/status callbacks)
  - scheduling semantics (`Kick`, delayed update, timer hooks)
- Out of scope:
  - actual Tk rendering/windowing
  - browser/DOM UI implementation

## Parity lock (applies to every task)
- [ ] Keep command names case-sensitive and unknown subcommand behavior as error.
- [ ] Preserve C integer behavior where relevant (truncating integer division/assignments).
- [ ] Preserve side-effect order (`Kick()` timing and callback sequencing).
- [ ] Keep legacy quirks configurable for parity mode:
  - `CityFileName` allocation bug shape (`w_sim.c`)
  - `Dollars` literal-format behavior
  - `Disasters` inversion
  - `Speed` accepts `0..7` but clamps to `0..3`

## Phase 0: Package/test skeleton
- [x] `P0.1` Add test tooling to `@city/sim-scripting`.
  - Files: `/Users/cje/dev/city/packages/sim-scripting/package.json`, `/Users/cje/dev/city/packages/sim-scripting/vitest.config.ts` (new), `/Users/cje/dev/city/packages/sim-scripting/tsconfig.json`
  - Done when:
    - `pnpm -C /Users/cje/dev/city/packages/sim-scripting test` runs
    - one placeholder test passes

- [x] `P0.2` Add runtime result/error primitives.
  - Files: `/Users/cje/dev/city/packages/sim-scripting/src/runtime/result-code.ts`, `/Users/cje/dev/city/packages/sim-scripting/src/runtime/errors.ts`
  - Done when:
    - types exist for success/error returns
    - unit test validates basic error/result mapping

- [x] `P0.3` Add command runtime kernel.
  - Files: `/Users/cje/dev/city/packages/sim-scripting/src/runtime/script-runtime.ts`, `/Users/cje/dev/city/packages/sim-scripting/src/runtime/script-runtime.test.ts`
  - Done when:
    - can register command by name and invoke by argv
    - unknown command returns error

- [x] `P0.4` Add scripting bridge state and registries.
  - Files: `/Users/cje/dev/city/packages/sim-scripting/src/state/scripting-state.ts`, `/Users/cje/dev/city/packages/sim-scripting/src/state/view-registry.ts`, `/Users/cje/dev/city/packages/sim-scripting/src/state/sprite-registry.ts`, `/Users/cje/dev/city/packages/sim-scripting/src/state/widget-registry.ts`
  - Done when:
    - state shape supports sim/view/widget/sprite/callback references
    - registry tests cover add/get/remove and duplicate handling

- [x] `P0.5` Add bootstrap API.
  - Files: `/Users/cje/dev/city/packages/sim-scripting/src/bootstrap/create-sim-scripting-runtime.ts`, `/Users/cje/dev/city/packages/sim-scripting/src/index.ts`
  - Done when:
    - runtime can be created from one entrypoint
    - bootstrap test verifies base command registration hook flow

## Phase 1: `sim` command (core)
- [x] `P1.1` Add `sim` command dispatcher and subcommand table.
  - C reference: `ref/micropolis/src/sim/w_sim.c` (`SimCmd`, hash dispatch)
  - Files: `/Users/cje/dev/city/packages/sim-scripting/src/commands/sim-command.ts`, `/Users/cje/dev/city/packages/sim-scripting/src/commands/sim-command.test.ts`
  - Done when:
    - `sim <Subcommand>` dispatch works
    - unknown subcommand error matches expected shape

- [x] `P1.2` Implement accessor read/write subcommands.
  - C reference: `SIMCMD_ACCESS_INT(...)` entries in `w_sim.c`
  - Done when:
    - each accessor supports get and set
    - bad argc/parse failures return error

- [x] `P1.3` Implement read-only getter subcommands.
  - C reference: `SIMCMD_GET_INT`, `SIMCMD_GET_STR`, explicit getters in `w_sim.c`
  - Done when:
    - getters return formatted string values
    - coordinate getters use `(tile << 4) + 8` where required

- [x] `P1.4` Implement session control/redraw subcommands and `Kick` hook.
  - C reference: `SIMCMD_CALL`, `SIMCMD_CALL_KICK` groups
  - Done when:
    - call-only commands trigger hook
    - call+kick commands also schedule delayed update

- [x] `P1.5` Implement speed/delay/skip/rest controls.
  - C reference: `SimCmdSpeed`, `SimCmdDelay`, `SimCmdSkips`, `SimCmdSkip`, `SimCmdNeedRest`
  - Done when:
    - arg validation/ranges match C
    - speed accepts `0..7` and returns clamped speed

- [x] `P1.6` Implement city/game setup subcommands.
  - C reference: `SimCmdCityName`, `SimCmdCityFileName`, `SimCmdGameLevel`, `SimCmdYear`, load/generate entries
  - Done when:
    - `CityName`, `CityFileName`, `GameLevel`, `Year` semantics match spec/C
    - parity mode supports `CityFileName` legacy bug behavior

- [x] `P1.7` Implement budget/options subcommands.
  - C reference: `SimCmdFunds`, `SimCmdTaxRate`, `SimCmdRoadFund`, `SimCmdFireFund`, `SimCmdPoliceFund`, options toggles
  - Done when:
    - percent math uses C-like integer behavior
    - update flags and callbacks are triggered in correct order

- [x] `P1.8` Implement map/dynamic/overlay misc subcommands.
  - C reference: `SimCmdTile`, `SimCmdFill`, `SimCmdDynamicData`, `SimCmdResetDynamic`, `SimCmdFlushStyle`, `SimCmdDoOverlay`, `SimCmdDonDither`
  - Done when:
    - all ranges and map bounds checks are covered
    - dynamic map flag updates and kick behavior are correct

- [x] `P1.9` Implement disasters/sprite-goal utility subcommands.
  - C reference: `SimCmdMonsterGoal`, `SimCmdMonsterDirection`, `SimCmdHelicopterGoal`, disaster creators
  - Done when:
    - sprite lookup/create behavior follows C flow
    - direction range checks enforced

- [x] `P1.10` Implement URL/browser/random/dollars utilities.
  - C reference: `SimCmdQuoteURL`, `SimCmdOpenWebBrowser`, `SimCmdRand`, `SimCmdDollars`
  - Done when:
    - URL quoting behavior matches byte escaping rules
    - random result shape matches C command contract
    - `Dollars` behavior matches compatibility mode expectation

## Phase 2: `editorview` and `mapview`
- [x] `P2.1` Add `editorview` command family shell (`configure/position/size`).
  - C references: `w_editor.c`, shared specs in `w_tk.c`
  - Done when:
    - handlers parse args and set/get state correctly

- [x] `P2.2` Implement editor tool and pan commands.
  - Commands: `Pan`, `PanStart`, `PanTo`, `PanBy`, `ToolDown`, `ToolDrag`, `ToolUp`, `DoTool`
  - Done when:
    - pan delta math and `Kick` behavior are tested
    - tile/view coordinate conversions are covered

- [x] `P2.3` Implement editor mode/visibility/auto commands.
  - Commands: `AutoGoto`, `AutoGoing`, `AutoGoal`, `AutoSpeed`, `Visible`, `ToolState`, `ToolMode`, `Sound`, `Skip`, `Update`, `ShowMe`, `Follow`, `ShowOverlay`, `OverlayMode`, `DynamicFilter`
  - Done when:
    - auto-go state transitions match expected C behavior

- [x] `P2.4` Add `mapview` command family shell (`configure/position/size`).
  - C reference: `w_map.c`
  - Done when:
    - parse/set/get behavior tested

- [x] `P2.5` Implement map pan/track/state/visibility commands.
  - Commands: `MapState`, `ShowEditors`, `PanStart`, `PanTo`, `Visible`, `ViewAt`
  - Done when:
    - `16/3` and `*16/3` conversion logic is tested
    - `ViewAt` returns current placeholder behavior

## Phase 3: `graphview`, `dateview`, `sprite`
- [x] `P3.1` Implement `graphview` commands and state.
  - Commands: `configure`, `position`, `size`, `Visible`, `Range`, `Mask`
  - Done when:
    - `Range` restricted to `10|120`
    - mask range validated (`0..63`)

- [ ] `P3.2` Implement `dateview` commands and state.
  - Commands: `configure`, `position`, `size`, `Visible`, `Reset`, `Set`
  - Done when:
    - month/year ranges enforced
    - redraw scheduling hook called on `Reset`/`Set`

- [ ] `P3.3` Implement `sprite` creation and dispatch.
  - C reference: `w_sprite.c`
  - Done when:
    - `sprite <name> <type>` registers sprite command
    - type range check matches C (`1..OBJN-1`)

- [ ] `P3.4` Implement sprite field accessors + `Init` + `Explode`.
  - Done when:
    - every accessor listed in spec works
    - `Init` pixel bounds checks are enforced

## Phase 4: `piemenu` and `interval`
- [ ] `P4.1` Implement `piemenu` state model and command shell.
  - Commands: `configure`, `add`, `delete`, `entryconfigure`, `index`
  - Done when:
    - entry creation/deletion/configuration state is covered by tests

- [ ] `P4.2` Implement `piemenu` activation/invocation/posting commands.
  - Commands: `activate`, `invoke`, `show`, `pending`, `defer`, `post`, `unpost`, `grab`, `ungrab`, `distance`, `direction`
  - Done when:
    - index parsing modes (`active`, `last`, `none`, `@x,y`, label match) are tested

- [ ] `P4.3` Implement `interval` command family.
  - Commands: `configure`, `get`, `set`, `reset`
  - Done when:
    - min/max swap, clamp, and disabled behavior match C logic

## Phase 5: Callback bridge (`UI*`)
- [ ] `P5.1` Add callback dispatcher and registration API.
  - Files: `/Users/cje/dev/city/packages/sim-scripting/src/callbacks/ui-callbacks.ts`
  - Done when:
    - callbacks can be registered/overridden and invoked by name

- [ ] `P5.2` Implement startup/lifecycle callbacks.
  - Procedures: `UIStartMicropolis`, `UIPlayNewCity`, `UIReallyStartGame`, `UIStartLoad`, `UIStartScenario`, `UINewGame`, `DoStopMicropolis`
  - Done when:
    - invocation contracts and argument passing are tested

- [ ] `P5.3` Implement file I/O callbacks.
  - Procedures: `UISaveCityAs`, `UIDidSaveCity`, `UIDidntSaveCity`, `UIDidLoadCity`, `UIDidntLoadCity`, `UIDidLoadScenario`
  - Done when:
    - success/failure callback emission is deterministic

- [ ] `P5.4` Implement status/budget/evaluation callbacks.
  - Procedures: `UISetFunds`, `UISetDate`, `UISetDemand`, `UISetOptions`, `UISetSpeed`, `UISetGameLevel`, `UISetCityName`, `UISetMapState`, `UIShowBudgetAndWait`, `UIUpdateBudget`, `UISetBudget`, `UISetBudgetValues`, `UISetEvaluation`
  - Done when:
    - all callback argument orders match spec

- [ ] `P5.5` Implement message/notice/autogoto callbacks.
  - Procedures: `UISetMessage`, `UIPopUpMessage`, `UIShowPicture`, `UIShowZoneStatus`, `UIAutoGoto`, `UILoseGame`, `UIWinGame`
  - Done when:
    - picture/text flow and autogoto coordinate conversion are tested

- [ ] `P5.6` Implement tool/sound callbacks.
  - Procedures: `UIDidTool*`, `UISetToolState`, `DoPendTool`, `UIDidPan`, `UIDidStopPan`, `UIEarthQuake`, `UIInitializeSound`, `UIShutDownSound`, `UIMakeSound`, `UIMakeSoundOn`, `UIStartSound`, `UIStopSound`, `UISoundOff`
  - Done when:
    - wildcard tool callback mapping is covered by tests

## Phase 6: Optional features and source deltas
- [ ] `P6.1` Add feature flags for `CAM`, `NET`, and `legacyExtras`.
  - Done when:
    - command registration is controlled by flags

- [ ] `P6.2` Implement optional `camview` command family.
  - C reference: `w_cam.c`
  - Done when:
    - documented subcommands are supported in feature-on mode

- [ ] `P6.3` Implement optional networking commands and `HandlePacket`.
  - C reference: `w_net.c`
  - Done when:
    - `sim ListenTo`, `sim HearFrom`, and packet callback contract are tested

- [ ] `P6.4` Implement source-delta extras in `legacyExtras`.
  - Extras: `sim HeatSteps`, `sim HeatFlow`, `sim HeatRule`, `UIDidGenerateNewCity`, `DropFireBombs`
  - Done when:
    - extras are unavailable by default and available when `legacyExtras=true`

## Cross-cutting test tasks
- [ ] `T1` Add transcript tests for end-to-end command flows.
  - Done when:
    - at least one transcript each for `sim`, `editorview`, `mapview`, `sprite`

- [ ] `T2` Add compatibility tests for all parity quirks listed in “Parity lock”.
  - Done when:
    - each quirk has an explicit test with C-source reference in comments

- [ ] `T3` Add sim-core integration tests.
  - Done when:
    - scripting runtime drives `sim-core` hooks for representative update cycle

## Documentation tasks
- [ ] `D1` Add JSDoc to every exported function/class with C source mapping.
  - Done when:
    - each export references relevant `ref/micropolis/src/sim/*.c` location
    - doc states whether behavior is 1:1 or intentionally different

- [ ] `D2` Update `/Users/cje/dev/city/packages/sim-scripting/TODO.md` to point to this checklist and next unchecked task.
  - Done when:
    - TODO reflects active task ID

## Completion gate
- [ ] `G1` All checklist tasks above are checked.
- [ ] `G2` Package and workspace checks pass:
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm format`

## Execution Log
- [x] `2026-02-07` Completed `P0.1` by adding package scripts, `vitest.config.ts`, and a passing placeholder test in `src/index.test.ts`.
- [x] `2026-02-07` Completed `P0.2` by adding Tcl-style runtime result codes, structured runtime errors, and unit tests for error/result mapping.
- [x] `2026-02-07` Completed `P0.3` by adding `ScriptRuntime` command registration/invocation kernel and coverage for dispatch, unknown-command errors, and thrown-error normalization.
- [x] `2026-02-07` Completed `P0.4` by adding typed scripting bridge state plus view/sprite/widget registries with duplicate-safe add/get/remove coverage.
- [x] `2026-02-07` Completed `P0.5` by adding `createSimScriptingRuntime` bootstrap entrypoint, exporting it from package index, and covering base command registration hook flow with bootstrap tests.
- [x] `2026-02-07` Completed `P1.1` by adding `sim` command registration/dispatch helpers, a case-sensitive subcommand table scaffold, and tests for dispatch plus typed missing/unknown-subcommand failures.
- [x] `2026-02-07` Repaired `P1.1` by adding `createSimSubcommandTable` with C-style duplicate overwrite semantics (`HASHED_CMD`/`Tcl_CreateHashEntry`) and coverage that validates last-registration-wins dispatch.
- [x] `2026-02-07` Completed `P1.2` by porting all `SIMCMD_ACCESS_INT(...)` `sim` subcommands with C-defaulted backing state, read/write accessor behavior, and tests for get/set plus argc and integer-parse failure paths.
- [x] `2026-02-07` Completed `P1.3` by porting `sim` read-only getter subcommands (`SIMCMD_GET_STR` + explicit getters), adding tile-center coordinate conversion parity for the required getter set, and covering formatted-return/argc-parity behavior in `sim-command` tests.
- [x] `2026-02-07` Completed `P1.4` by adding session/redraw `sim` call and call+`Kick` subcommands (`SIMCMD_CALL`/`SIMCMD_CALL_KICK` parity), implementing `Kick` delayed-update coalescing hooks (`UpdateDelayed` behavior), and adding tests for side-effect order plus no-kick `Update`.
- [x] `2026-02-07` Completed `P1.5` by adding `sim` speed/delay/skip/rest subcommands with C-parity argc/range validation (`SimCmdSpeed`/`Delay`/`Skips`/`Skip`/`NeedRest`), `setSpeed` clamp behavior (`0..7` input to `0..3` effective speed), `setSkips` reset semantics, and `Kick` sequencing coverage in `sim-command` tests.
- [x] `2026-02-07` Completed `P1.6` by adding `sim` city/game setup subcommands (`CityName`, `CityFileName`, `GameLevel`, `Year`, `GenerateNewCity`, `GenerateSomeCity`, `LoadCity`, `LoadScenario`), including configurable legacy `CityFileName` allocation-bug parity mode and C-mapped validation/side-effect tests.
- [x] `2026-02-07` Completed `P1.7` by adding `sim` budget/options subcommands (`Funds`, `TaxRate`, `FireFund`, `PoliceFund`, `RoadFund`, `AutoBudget`, `AutoGoto`, `AutoBulldoze`, `Disasters`, `Sound`, `DoAnimation`, `DoMessages`, `DoNotices`) with C-parity integer-percent math, update-flag transitions, and callback ordering coverage.
- [x] `2026-02-07` Completed `P1.8` by adding `sim` map/dynamic/overlay misc subcommands (`FlushStyle`, `DonDither`, `DoOverlay`, `Tile`, `Fill`, `DynamicData`, `ResetDynamic`) with C-parity arg/range/map-bounds checks, dynamic-map flag updates, and `Kick` coalescing coverage.
- [x] `2026-02-07` Completed `P1.9` by adding disaster creator and sprite-goal utility `sim` subcommands (`MakeFire`, `MakeFlood`, `MakeTornado`, `MakeEarthquake`, `MakeMonster`, `MakeMeltdown`, `FireBomb`, `MonsterGoal`, `HelicopterGoal`, `MonsterDirection`) with C-style call/no-argc behavior, GOD/COP lookup-create-lookup parity flow, and direction range/error-path coverage.
- [x] `2026-02-07` Completed `P1.10` by adding `sim` URL/browser/random/dollars utilities (`QuoteURL`, `OpenWebBrowser`, `Rand`, `Dollars`) with C-mapped byte-escaping and command-string behavior, signed-16-bit `Rand(short)` range parity, and configurable legacy `Dollars` literal-format compatibility mode.
- [x] `2026-02-07` Completed `P2.1` by adding the `editorview` command-family shell (`configure`, `position`, `size`), including top-level view-command creation/registration, C-style argc + Tcl-integer parsing parity from `w_editor.c`/`w_tk.c`, and colocated unit coverage for set/get/error paths.
- [x] `2026-02-07` Completed `P2.2` by adding `editorview` pan/tool subcommands (`Pan`, `PanStart`, `PanTo`, `PanBy`, `ToolDown`, `ToolDrag`, `ToolUp`, `DoTool`) with C-mapped pan clamp/delta logic from `w_editor.c`/`w_x.c`, command-level kick coalescing parity, and colocated tests covering kick behavior plus view/pixel and tile command coordinate semantics.
- [x] `2026-02-07` Completed `P2.3` by adding `editorview` mode/visibility/auto commands (`AutoGoto`, `AutoGoing`, `AutoGoal`, `AutoSpeed`, `Visible`, `ToolState`, `ToolMode`, `Sound`, `Skip`, `Update`, `ShowMe`, `Follow`, `ShowOverlay`, `OverlayMode`, `DynamicFilter`) with C-parity state transitions from `w_editor.c`/`w_x.c` and colocated tests covering auto-go threshold/flag behavior plus follow lookup/pan updates.
- [x] `2026-02-07` Completed `P2.4` by adding the `mapview` command-family shell (`configure`, `position`, `size`), including top-level `mapview pathName ?options?` command creation/registration, Tcl-style integer parsing and argc parity for `MapCmdposition`/`MapCmdsize`, and colocated tests covering configure/set/get, case-sensitive unknown-subcommand errors, and default map-size initialization from `MAP_W/MAP_H`.
- [x] `2026-02-07` Completed `P2.5` by adding `mapview` pan/track/state/visibility subcommands (`MapState`, `ShowEditors`, `PanStart`, `PanTo`, `Visible`, `ViewAt`) with C-parity `*3/16` hit-box and `*16/3` pan-delta integer math from `w_map.c`, `Kick()` sequencing for `MapState`/`PanTo`, and placeholder `ViewAt` behavior coverage.
- [x] `2026-02-07` Completed `P3.1` by adding the `graphview` command family and typed graph state (`configure`, `position`, `size`, `Visible`, `Range`, `Mask`) with C-parity validation from `w_graph.c`, including `Range` (`10|120`) and `Mask` (`0..63`) constraints plus `NewGraph` redraw-flag side effects.
