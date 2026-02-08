import { describe, expect, it } from 'vitest';

import {
  serializeSugarActivateCommand,
  serializeSugarBuddyAddCommand,
  serializeSugarBuddyDelCommand,
  serializeSugarDeactivateCommand,
  serializeSugarNickNameCommand,
  serializeSugarQuitCommand,
  serializeSugarShareCommand,
  serializeSugarStartUpCommand,
} from './activity-bridge.ts';

describe('activity bridge outbound command parity', () => {
  it('serializes startup and nickname commands with QuoteTCL escaping and trailing newline', () => {
    // Mirrors send_process('SugarStartUp "' + QuoteTCL(uri) + '"\n') and
    // send_process('SugarNickName "' + QuoteTCL(nick) + '"\n')
    // in ref/micropolis/micropolisactivity.py.
    expect(serializeSugarStartUpCommand('file:///city/"shared"')).toBe(
      'SugarStartUp "file:///city/\\"shared\\""\n',
    );
    expect(serializeSugarNickNameCommand('"Mayor"')).toBe('SugarNickName "\\"Mayor\\""\n');
  });

  it('serializes fixed Sugar lifecycle commands with exact command text and trailing newline', () => {
    expect(serializeSugarShareCommand()).toBe('SugarShare\n');
    expect(serializeSugarQuitCommand()).toBe('SugarQuit\n');
    expect(serializeSugarActivateCommand()).toBe('SugarActivate\n');
    expect(serializeSugarDeactivateCommand()).toBe('SugarDeactivate\n');
  });

  it('serializes SugarBuddyAdd with normalized buddy fields in key/nick/color/address order', () => {
    expect(
      serializeSugarBuddyAddCommand({
        key: 'k-1',
        nick: 'n-1',
        color: '#00A0FF,#F0F0F0',
        address: '10.0.0.1',
      }),
    ).toBe('SugarBuddyAdd "k-1" "n-1" "#00A0FF,#F0F0F0" "10.0.0.1"\n');
  });

  it('serializes SugarBuddyDel from complete legacy props fields', () => {
    expect(
      serializeSugarBuddyDelCommand({
        props: {
          key: 'props-key',
          nick: 'props-nick',
          color: 'props-color',
          ip4_address: 'props-address',
        },
      }),
    ).toBe('SugarBuddyDel "props-key" "props-nick" "props-color" "props-address"\n');
  });

  it('falls back to legacy getters for all fields if any props field is missing, preserving getter call order', () => {
    const getterCalls: string[] = [];
    const buddy = {
      props: {
        key: 'props-key',
        nick: 'props-nick',
        color: 'props-color',
      },
      get_name: () => {
        const value = getterCalls.length === 0 ? 'getter-key' : 'getter-nick';
        getterCalls.push(value);
        return value;
      },
      get_color: () => {
        getterCalls.push('getter-color');
        return 'getter-color';
      },
      get_ip4_address: () => {
        getterCalls.push('getter-address');
        return 'getter-address';
      },
    };

    // Mirrors micropolisactivity.py try/except AttributeError behavior:
    // missing one props field causes a full fallback to getters.
    expect(serializeSugarBuddyAddCommand(buddy)).toBe(
      'SugarBuddyAdd "getter-key" "getter-nick" "getter-color" "getter-address"\n',
    );
    expect(getterCalls).toEqual(['getter-key', 'getter-nick', 'getter-color', 'getter-address']);
  });
});
