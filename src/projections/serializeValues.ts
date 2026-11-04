const isTimestampLike = (value: object): value is { toDate: () => Date } =>
  typeof (value as { toDate?: unknown }).toDate === 'function' &&
  ('seconds' in value || '_seconds' in value);

const convert = (value: unknown, ancestors: Set<object>): unknown => {
  if (value === null || typeof value !== 'object') return value;

  if (value instanceof Date) return value.toISOString();
  if (isTimestampLike(value)) return value.toDate().toISOString();

  if (ancestors.has(value)) {
    throw new Error('Cannot write a document with a circular reference');
  }
  ancestors.add(value);

  const result = Array.isArray(value)
    ? value.map((item) => convert(item, ancestors))
    : Object.fromEntries(
        Object.entries(value).map(([key, child]) => [
          key,
          convert(child, ancestors),
        ]),
      );

  ancestors.delete(value);
  return result;
};

/**
 * Returns a copy of `value` that the Realtime Database can store.
 *
 * The database has no date type and drops a `Date` without an error, so `Date`
 * and Firestore `Timestamp` values become ISO 8601 UTC strings. Read models
 * hold those dates as strings when they are read back.
 */
export const toRealtimeDBValue = <T>(value: T): T =>
  convert(value, new Set()) as T;
