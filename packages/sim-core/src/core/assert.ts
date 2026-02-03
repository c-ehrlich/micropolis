export function assertDefined<T>(value: T, message?: string): asserts value is NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error(message ?? 'Expected value to be defined');
  }
}

export function getOrThrow<T>(value: T, message?: string): NonNullable<T> {
  assertDefined(value, message);
  return value;
}
