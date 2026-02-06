# TODO

- [x] Scenario table + `snro.*` loader helpers (`src/scenarios.ts`, `src/load.ts`, `src/node-files.ts`)
- [x] C-style load orchestration parity helpers (`loadFileLikeC`, `loadCityLikeC`, `loadScenarioLikeC`)
- [x] Load->simulate replay fixture checks (`fixtures/load-replay`, `src/replay-fixtures.test.ts`)
- [x] C-style save orchestration parity helpers (`saveFile`/`SaveCity`/`SaveCityAs`)
- [x] Save byte-parity checks against C oracle (`src/save-parity.test.ts`, `runCoreOracleSaveCty`)
- [x] TS<->C `.cty` interoperability round-trip parity checks (`src/persistence-roundtrip-parity.test.ts`, `runCoreOracleLoadCtyBytes`, `runCoreOracleSaveCty`)
- [x] Invalid `.cty` byte-length rejection parity checks for TS + C loaders (`src/persistence-roundtrip-parity.test.ts`; C `_load_file` sizes: `27120`, `99120`, `219120`)
- [x] Replace remaining non-I/O `.cty` parity callsites with bytes-based oracle loading and add command-equivalence checks for `load-cty` vs `load-cty-bytes` (`packages/sim-core/src/io/cty.test.ts`, `packages/micropolis-c-harness/src/core-parity.test.ts`)
