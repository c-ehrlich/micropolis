import { describe, expect, it, vi } from 'vitest';

import { makeScriptSuccess, ScriptRuntimeErrorCode } from '../runtime/errors.ts';
import { ScriptResultCode } from '../runtime/result-code.ts';
import { createSimScriptingRuntime } from './create-sim-scripting-runtime.ts';
import { createDefaultSimScriptingBaseCommandRegistrar } from './register-default-commands.ts';

describe('createDefaultSimScriptingBaseCommandRegistrar', () => {
  it('keeps optional CAM/NET/legacy command registration disabled by default', () => {
    const createCamSimSubcommandEntries = vi.fn(() => [
      ['JustCam', () => makeScriptSuccess('cam')] as const,
    ]);
    const createNetSimSubcommandEntries = vi.fn(() => [
      ['ListenTo', () => makeScriptSuccess('net')] as const,
    ]);
    const createLegacyExtraSimSubcommandEntries = vi.fn(() => [
      ['HeatSteps', () => makeScriptSuccess('legacy')] as const,
    ]);
    const registerCamCommand = vi.fn((bundle: ReturnType<typeof createSimScriptingRuntime>) => {
      bundle.runtime.registerCommand('camview', () => makeScriptSuccess('camview'));
    });

    const bundle = createSimScriptingRuntime({
      registerBaseCommands: createDefaultSimScriptingBaseCommandRegistrar({
        createCamSimSubcommandEntries,
        createNetSimSubcommandEntries,
        createLegacyExtraSimSubcommandEntries,
        registerCamCommand,
      }),
    });

    expect(createCamSimSubcommandEntries).not.toHaveBeenCalled();
    expect(createNetSimSubcommandEntries).not.toHaveBeenCalled();
    expect(createLegacyExtraSimSubcommandEntries).not.toHaveBeenCalled();
    expect(registerCamCommand).not.toHaveBeenCalled();

    expect(bundle.runtime.invoke(['sim', 'Speed'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '0',
    });
    expect(bundle.runtime.invoke(['sim', 'JustCam'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.UnknownSubcommand,
      message: 'unknown sim subcommand: JustCam',
    });
    expect(bundle.runtime.invoke(['sim', 'ListenTo'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.UnknownSubcommand,
      message: 'unknown sim subcommand: ListenTo',
    });
    expect(bundle.runtime.invoke(['sim', 'HeatSteps'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.UnknownSubcommand,
      message: 'unknown sim subcommand: HeatSteps',
    });
    expect(bundle.runtime.invoke(['camview'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.UnknownCommand,
      message: 'unknown command: camview',
    });
  });

  it('registers optional command slices only when CAM/NET/legacy flags are enabled', () => {
    const createCamSimSubcommandEntries = vi.fn(() => [
      ['JustCam', () => makeScriptSuccess('cam-subcommand')] as const,
    ]);
    const createNetSimSubcommandEntries = vi.fn(() => [
      ['ListenTo', () => makeScriptSuccess('42')] as const,
      ['HearFrom', () => makeScriptSuccess('heard')] as const,
    ]);
    const createLegacyExtraSimSubcommandEntries = vi.fn(() => [
      ['HeatSteps', () => makeScriptSuccess('256')] as const,
    ]);
    const registerCamCommand = vi.fn((bundle: ReturnType<typeof createSimScriptingRuntime>) => {
      bundle.runtime.registerCommand('camview', () => makeScriptSuccess('cam-command'));
    });

    const bundle = createSimScriptingRuntime({
      registerBaseCommands: createDefaultSimScriptingBaseCommandRegistrar({
        featureFlags: {
          CAM: true,
          NET: true,
          legacyExtras: true,
        },
        createCamSimSubcommandEntries,
        createNetSimSubcommandEntries,
        createLegacyExtraSimSubcommandEntries,
        registerCamCommand,
      }),
    });

    expect(createCamSimSubcommandEntries).toHaveBeenCalledOnce();
    expect(createNetSimSubcommandEntries).toHaveBeenCalledOnce();
    expect(createLegacyExtraSimSubcommandEntries).toHaveBeenCalledOnce();
    expect(registerCamCommand).toHaveBeenCalledOnce();

    expect(bundle.runtime.invoke(['sim', 'JustCam'])).toEqual({
      code: ScriptResultCode.Ok,
      value: 'cam-subcommand',
    });
    expect(bundle.runtime.invoke(['sim', 'ListenTo'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '42',
    });
    expect(bundle.runtime.invoke(['sim', 'HearFrom'])).toEqual({
      code: ScriptResultCode.Ok,
      value: 'heard',
    });
    expect(bundle.runtime.invoke(['sim', 'HeatSteps'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '256',
    });
    expect(bundle.runtime.invoke(['camview'])).toEqual({
      code: ScriptResultCode.Ok,
      value: 'cam-command',
    });
  });

  it('registers built-in camview command by default when CAM is enabled', () => {
    const bundle = createSimScriptingRuntime({
      registerBaseCommands: createDefaultSimScriptingBaseCommandRegistrar({
        featureFlags: {
          CAM: true,
        },
      }),
    });

    expect(bundle.runtime.invoke(['camview', '.cam.main'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '.cam.main',
    });

    // `InitNewCam` calls `DoResizeCam(scam, 512, 512)` in `w_cam.c`.
    expect(bundle.runtime.invoke(['.cam.main', 'size'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '512 512',
    });
  });
});
