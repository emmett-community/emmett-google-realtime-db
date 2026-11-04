import { toRealtimeDBValue } from '../../src/projections';

describe('toRealtimeDBValue', () => {
  it('returns plain data unchanged', () => {
    const value = { a: 'x', b: 1, c: [{ d: true }], e: null };

    expect(toRealtimeDBValue(value)).toEqual(value);
  });

  it('converts a Date to an ISO 8601 UTC string at any depth', () => {
    const at = new Date('2026-10-24T12:30:00.000Z');

    expect(
      toRealtimeDBValue({ openedAt: at, items: [{ addedAt: at }] }),
    ).toEqual({
      openedAt: '2026-10-24T12:30:00.000Z',
      items: [{ addedAt: '2026-10-24T12:30:00.000Z' }],
    });
  });

  it('converts Firestore Timestamp values, in the public and internal shapes', () => {
    const date = new Date('2026-10-24T12:30:00.000Z');
    const timestamp = { seconds: 1, nanoseconds: 0, toDate: () => date };
    const internal = { _seconds: 1, _nanoseconds: 0, toDate: () => date };

    expect(toRealtimeDBValue({ a: timestamp, b: internal })).toEqual({
      a: '2026-10-24T12:30:00.000Z',
      b: '2026-10-24T12:30:00.000Z',
    });
  });

  it('keeps objects that only look like a timestamp', () => {
    const value = { seconds: 1, toDate: 'not a function' };

    expect(toRealtimeDBValue(value)).toEqual(value);
  });

  it('does not change the value it receives', () => {
    const at = new Date('2026-10-24T12:30:00.000Z');
    const value = { at, list: [at] };

    toRealtimeDBValue(value);

    expect(value.at).toBe(at);
    expect(value.list[0]).toBe(at);
  });

  it('accepts the same object more than once', () => {
    const shared = { n: 1 };

    expect(toRealtimeDBValue({ a: shared, b: shared })).toEqual({
      a: { n: 1 },
      b: { n: 1 },
    });
  });

  it('rejects circular references with a clear error', () => {
    const value: Record<string, unknown> = { a: 1 };
    value.self = value;

    expect(() => toRealtimeDBValue(value)).toThrow('circular');
  });
});
