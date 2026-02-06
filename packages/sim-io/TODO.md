# TODO

- [x] Scenario table + `snro.*` loader helpers (`src/scenarios.ts`, `src/load.ts`, `src/node-files.ts`)
- [x] C-style load orchestration parity helpers (`loadFileLikeC`, `loadCityLikeC`, `loadScenarioLikeC`)
- [x] Load->simulate replay fixture checks (`fixtures/load-replay`, `src/replay-fixtures.test.ts`)
- [x] C-style save orchestration parity helpers (`saveFile`/`SaveCity`/`SaveCityAs`)
- [x] Save byte-parity checks against C oracle (`src/save-parity.test.ts`, `runCoreOracleSaveCty`)
- [x] TS<->C `.cty` interoperability round-trip parity checks (`src/persistence-roundtrip-parity.test.ts`, `runCoreOracleLoadCty`, `runCoreOracleSaveCty`)
