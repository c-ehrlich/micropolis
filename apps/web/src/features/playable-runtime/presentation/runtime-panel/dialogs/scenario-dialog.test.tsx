// @vitest-environment jsdom

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SCENARIO_BUNDLE_V1_VERSION } from '../../../../../../../../packages/scenario-core/src/scenario-bundle-v1.ts';
import type { ExternalScenarioBundleFile } from '../../../behavior/scenario-bundle-file.ts';
import type { RuntimeDialogActions } from '../runtime-panel-types.ts';
import { ScenarioDialog } from './scenario-dialog.tsx';

const DIALOG_ACTIONS: RuntimeDialogActions = {
  closeGameDialog: () => {},
  loadPendingCityFile: async () => {},
  loadScenarioBundleFile: () => {},
  regenerateNewCityTerrainSeed: () => {},
  saveCityFromDraft: () => {},
  selectScenarioKey: () => {},
  setGameLevel: () => {},
  setPendingLoadFile: () => {},
  setSaveFileNameDraft: () => {},
  startNewCity: () => {},
  startScenario: () => {},
};

const LOADED_EXTERNAL_SCENARIO_BUNDLE: ExternalScenarioBundleFile = {
  fileName: 'custom-harbor.json',
  bundle: {
    version: SCENARIO_BUNDLE_V1_VERSION,
    key: 'user/custom-harbor',
    name: 'Custom Harbor',
    description: 'Player-authored scenario bundle.',
    tags: ['harbor', 'sandbox'],
    start: {
      startYear: 1910,
      startFunds: 15000,
    },
    map: {
      kind: 'city-file-bytes',
      width: 120,
      height: 100,
      cityFileBytes: 'AA==',
    },
  },
};

describe('ScenarioDialog', () => {
  it('renders external scenario metadata review after load before start', () => {
    const markup = renderToStaticMarkup(
      <ScenarioDialog
        dialogActions={DIALOG_ACTIONS}
        controlsDisabled={false}
        loadedExternalScenarioBundle={LOADED_EXTERNAL_SCENARIO_BUNDLE}
        selectedGameLevel={0}
        selectedScenarioKey="user/custom-harbor"
      />,
    );

    expect(markup).toContain('Loaded Scenario Review');
    expect(markup).toContain('External: Custom Harbor (user/custom-harbor)');
    expect(markup).toContain('custom-harbor.json');
    expect(markup).toContain('1910, $15000');
    expect(markup).toContain('Player-authored scenario bundle.');
    expect(markup).toContain('Difficulty');
    expect(markup).toContain('Start Scenario');
  });

  it('does not render external review metadata for built-in scenario selection', () => {
    const markup = renderToStaticMarkup(
      <ScenarioDialog
        dialogActions={DIALOG_ACTIONS}
        controlsDisabled={false}
        loadedExternalScenarioBundle={LOADED_EXTERNAL_SCENARIO_BUNDLE}
        selectedGameLevel={0}
        selectedScenarioKey="builtin/dullsville"
      />,
    );

    expect(markup).not.toContain('Loaded Scenario Review');
    expect(markup).toContain('1. Dullsville (1900)');
  });
});
