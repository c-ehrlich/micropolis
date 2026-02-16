import type { FormEvent } from 'react';

/**
 * Prevent accidental form submission reload while editing metadata.
 * Not from Micropolis C: browser form behavior guard for SPA workflow.
 */
export function preventFormSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
}

/**
 * Parse integer form input with deterministic fallback.
 * Parity note: integers mirror C-style whole-number scenario/objective fields, while fallback
 * behavior is editor-specific UI handling.
 */
export function parseIntegerInput(rawValue: string, fallback: number): number {
  if (rawValue.trim().length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(rawValue, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}
