import { describe, expect, expectTypeOf, it } from 'vitest';

import type { RealtimeCallbacks } from '../../../sim-core/src/sim/realtime.ts';
import type { IntegrationRuntimeHooks } from '../runtime.ts';
import { createIntegrationRuntime } from '../runtime.ts';
import {
  createSimCoreSoundHookAdapter,
  DEFAULT_SIM_CORE_SOUND_CHANNEL,
  type SimCoreRealtimeSoundHooks,
} from './sim-core-hooks.ts';

describe('sim-core sound hook adapter contracts', () => {
  it('is compile-time compatible with sim-core RealtimeCallbacks and runtime IntegrationRuntimeHooks', () => {
    const simCoreHooks: RealtimeCallbacks = {
      onSound(_channel, _id) {},
    };

    expectTypeOf<RealtimeCallbacks>().toMatchTypeOf<SimCoreRealtimeSoundHooks>();

    const adapterHooks = createSimCoreSoundHookAdapter(simCoreHooks);
    expectTypeOf(adapterHooks).toMatchTypeOf<Pick<IntegrationRuntimeHooks, 'onSoundToken'>>();

    createIntegrationRuntime({
      features: {
        sugar: true,
      },
      hooks: adapterHooks,
    });
  });

  it('forwards PlaySound tokens into sim-core style onSound callbacks using the default city channel', () => {
    const calls: Array<{ channel: string; id: string }> = [];
    const runtime = createIntegrationRuntime({
      features: {
        sugar: true,
      },
      hooks: createSimCoreSoundHookAdapter({
        onSound(channel, id) {
          calls.push({ channel, id });
        },
      }),
    });

    runtime.handleOutputLine('PlaySound Siren');

    expect(calls).toEqual([{ channel: DEFAULT_SIM_CORE_SOUND_CHANNEL, id: 'siren' }]);
  });

  it('rejects non-sim-core onSound signatures at compile time', () => {
    createSimCoreSoundHookAdapter({
      // @ts-expect-error Sim-core sound callback signature is (channel: string, id: string).
      onSound(_channel: number, _id: string) {},
    });
  });
});
