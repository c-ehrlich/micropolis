import { describe, expect, it } from 'vitest';

import { SCENARIO_BUNDLE_V1_VERSION } from '../../../../../../packages/scenario-core/src/scenario-bundle-v1.ts';
import { parseExternalScenarioBundleFromFileText } from './scenario-bundle-file.ts';

describe('parseExternalScenarioBundleFromFileText', () => {
  it('parses valid ScenarioBundleV1 JSON payloads', () => {
    const loaded = parseExternalScenarioBundleFromFileText(
      'custom-harbor.json',
      JSON.stringify({
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
      }),
    );

    expect(loaded.fileName).toBe('custom-harbor.json');
    expect(loaded.bundle.key).toBe('user/custom-harbor');
    expect(loaded.bundle.name).toBe('Custom Harbor');
  });

  it('rejects malformed JSON text', () => {
    expect(() => parseExternalScenarioBundleFromFileText('broken.json', '{bad json')).toThrow(
      'external scenario JSON must be valid JSON',
    );
  });

  it('rejects schema-invalid scenario bundles', () => {
    expect(() =>
      parseExternalScenarioBundleFromFileText(
        'legacy.json',
        JSON.stringify({
          version: SCENARIO_BUNDLE_V1_VERSION,
          key: 'legacy/2',
          name: 'Legacy Key',
          description: 'Invalid namespace key should fail Stage 0 schema.',
          tags: ['legacy'],
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
        }),
      ),
    ).toThrow('external scenario JSON must satisfy ScenarioBundleV1 schema');
  });
});
