import type { SugarBuddy } from '../types.ts';
import { quoteTcl } from './quote-tcl.ts';

/**
 * Serialize `SugarStartUp "<uri>"` with a trailing newline for subprocess stdin.
 * Mirrors command construction in `ref/micropolis/micropolisactivity.py` as a
 * 1:1 command-string port (including `QuoteTCL` escaping behavior).
 */
export function serializeSugarStartUpCommand(uri: string): string {
  return `SugarStartUp "${quoteTcl(uri)}"\n`;
}

/**
 * Serialize `SugarNickName "<nick>"` with a trailing newline for subprocess stdin.
 * Mirrors command construction in `ref/micropolis/micropolisactivity.py` as a
 * 1:1 command-string port (including `QuoteTCL` escaping behavior).
 */
export function serializeSugarNickNameCommand(nick: string): string {
  return `SugarNickName "${quoteTcl(nick)}"\n`;
}

/**
 * Serialize `SugarShare` with a trailing newline for subprocess stdin.
 * Mirrors `share()` -> `send_process('SugarShare\\n')` in
 * `ref/micropolis/micropolisactivity.py` as a 1:1 port.
 */
export function serializeSugarShareCommand(): string {
  return 'SugarShare\n';
}

/**
 * Serialize `SugarQuit` with a trailing newline for subprocess stdin.
 * Mirrors `quit_process()` -> `send_process('SugarQuit\\n')` in
 * `ref/micropolis/micropolisactivity.py` as a 1:1 port.
 */
export function serializeSugarQuitCommand(): string {
  return 'SugarQuit\n';
}

/**
 * Serialize `SugarActivate` with a trailing newline for subprocess stdin.
 * Mirrors `_focus_in_cb()` -> `send_process('SugarActivate\\n')` in
 * `ref/micropolis/micropolisactivity.py` as a 1:1 port.
 */
export function serializeSugarActivateCommand(): string {
  return 'SugarActivate\n';
}

/**
 * Serialize `SugarDeactivate` with a trailing newline for subprocess stdin.
 * Mirrors `_focus_out_cb()` -> `send_process('SugarDeactivate\\n')` in
 * `ref/micropolis/micropolisactivity.py` as a 1:1 port.
 */
export function serializeSugarDeactivateCommand(): string {
  return 'SugarDeactivate\n';
}

/**
 * Serialize `SugarBuddyAdd "<key>" "<nick>" "<color>" "<address>"` and `\n`.
 * Mirrors `_buddy_appeared_cb` in `ref/micropolis/micropolisactivity.py`.
 * Parity note: preserves Micropolis field precedence: prefer `buddy.props`
 * (`key`, `nick`, `color`, `ip4_address`) only when all props fields exist;
 * otherwise fall back to getter calls (`get_name` twice, then color/address).
 */
export function serializeSugarBuddyAddCommand(buddy: SugarBuddy | unknown): string {
  return serializeSugarBuddyCommand('SugarBuddyAdd', buddy);
}

/**
 * Serialize `SugarBuddyDel "<key>" "<nick>" "<color>" "<address>"` and `\n`.
 * Mirrors `_buddy_disappeared_cb` in `ref/micropolis/micropolisactivity.py`.
 * Parity note: uses the same Micropolis buddy extraction order as add.
 */
export function serializeSugarBuddyDelCommand(buddy: SugarBuddy | unknown): string {
  return serializeSugarBuddyCommand('SugarBuddyDel', buddy);
}

type LegacyBuddyProps = {
  key?: unknown;
  nick?: unknown;
  color?: unknown;
  ip4_address?: unknown;
};

/**
 * Build one Sugar buddy command line with Micropolis quote/newline parity.
 * Mirrors string assembly in `ref/micropolis/micropolisactivity.py` where
 * each buddy field is wrapped in double quotes and the command ends in `\n`.
 */
function serializeSugarBuddyCommand(
  command: 'SugarBuddyAdd' | 'SugarBuddyDel',
  buddy: SugarBuddy | unknown,
): string {
  const fields = extractBuddyFields(buddy);
  return `${command} "${quoteTcl(fields.key)}" "${quoteTcl(fields.nick)}" "${quoteTcl(fields.color)}" "${quoteTcl(fields.address)}"\n`;
}

/**
 * Resolve buddy fields using Micropolis precedence rules.
 * Mirrors `_buddy_appeared_cb` / `_buddy_disappeared_cb` in
 * `ref/micropolis/micropolisactivity.py`: try props path first, and if that
 * path is unavailable fall back to getter calls in fixed key/nick/color/address
 * order.
 */
function extractBuddyFields(buddy: SugarBuddy | unknown): SugarBuddy {
  if (isSugarBuddy(buddy)) {
    return buddy;
  }

  const props = getCompleteLegacyProps(buddy);
  if (props !== undefined) {
    return {
      key: toOptionalString(props.key),
      nick: toOptionalString(props.nick),
      color: toOptionalString(props.color),
      address: toOptionalString(props.ip4_address),
    };
  }

  return {
    key: callOptionalStringGetter(buddy, 'get_name'),
    nick: callOptionalStringGetter(buddy, 'get_name'),
    color: callOptionalStringGetter(buddy, 'get_color'),
    address: callOptionalStringGetter(buddy, 'get_ip4_address'),
  };
}

/**
 * Check for already-normalized `SugarBuddy` input used by runtime APIs.
 * This is intentionally different from Micropolis Python objects by accepting
 * the TypeScript-first canonical buddy shape directly.
 */
function isSugarBuddy(value: unknown): value is SugarBuddy {
  return (
    isRecord(value) &&
    typeof value.key === 'string' &&
    typeof value.nick === 'string' &&
    typeof value.color === 'string' &&
    typeof value.address === 'string'
  );
}

/**
 * Emulate Micropolis "props path" availability checks for legacy buddy objects.
 * Mirrors Python attribute access behavior by requiring all props fields to
 * exist before using that path; otherwise caller falls back to getters.
 */
function getCompleteLegacyProps(value: unknown): LegacyBuddyProps | undefined {
  if (!isRecord(value) || !isRecord(value.props)) {
    return undefined;
  }

  if (
    !('key' in value.props) ||
    !('nick' in value.props) ||
    !('color' in value.props) ||
    !('ip4_address' in value.props)
  ) {
    return undefined;
  }

  return value.props;
}

/**
 * Invoke one legacy Sugar buddy getter and normalize missing/non-string to `''`.
 * Mirrors Micropolis `... or ''` fallback intent in
 * `ref/micropolis/micropolisactivity.py`.
 */
function callOptionalStringGetter(
  value: unknown,
  getterName: 'get_name' | 'get_color' | 'get_ip4_address',
): string {
  if (!isRecord(value)) {
    return '';
  }

  const getter = value[getterName];
  if (typeof getter !== 'function') {
    return '';
  }

  return toOptionalString(getter());
}

/**
 * Convert nullable/non-string values to optional-string parity fallback.
 * Mirrors the `value or ''` normalization intent in Micropolis Python.
 */
function toOptionalString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Narrow unknown values to object records for safe property access.
 * This is a TypeScript runtime helper with no direct Micropolis equivalent.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
