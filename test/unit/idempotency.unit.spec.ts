import type { Event } from '@event-driven-io/emmett';
import type { Database, Reference } from 'firebase-admin/database';
import { containing } from '../support/matchers';
import type { RealtimeDBReadModel } from '../../src/projections/types';
import { realtimeDBInlineProjection } from '../../src/projections/realtimeDBInlineProjection';
import { counterProjection } from '../fixtures/projections';
import { itemAdded } from '../fixtures/events';

const handle = (
  projection: typeof counterProjection,
  events: Parameters<typeof counterProjection.handle>[0],
  document: unknown,
) => {
  const ref = { set: jest.fn(), remove: jest.fn() };
  const result = projection.handle(events, {
    document: document as RealtimeDBReadModel | null,
    streamId: 'stream-1',
    database: {} as Database,
    projectionRef: ref as unknown as Reference,
  });
  return { ref, result };
};

const documentAt = (streamPosition: unknown, count = 5) => ({
  count,
  _metadata: {
    streamId: 'stream-1',
    name: 'test-counter',
    schemaVersion: 1,
    streamPosition,
  },
});

describe('Idempotent application by stream position', () => {
  it('writes nothing when every event is at or before the stored position', async () => {
    const { ref, result } = handle(
      counterProjection,
      [
        itemAdded('a', 1, { position: BigInt(2) }),
        itemAdded('b', 1, { position: BigInt(3) }),
      ],
      documentAt('3'),
    );
    await result;

    expect(ref.set).not.toHaveBeenCalled();
    expect(ref.remove).not.toHaveBeenCalled();
  });

  it('applies only the events after the stored position', async () => {
    const { ref, result } = handle(
      counterProjection,
      [
        itemAdded('a', 1, { position: BigInt(2) }),
        itemAdded('b', 1, { position: BigInt(3) }),
        itemAdded('c', 1, { position: BigInt(4) }),
        itemAdded('d', 1, { position: BigInt(5) }),
      ],
      documentAt('3'),
    );
    await result;

    expect(ref.set).toHaveBeenCalledWith({
      count: 7,
      _metadata: containing({ streamPosition: '5' }),
    });
  });

  it.each([
    ['a string', '3'],
    ['a bigint', BigInt(3)],
    ['a number', 3],
  ])('reads the stored position as %s', async (_label, stored) => {
    const { ref, result } = handle(
      counterProjection,
      [itemAdded('a', 1, { position: BigInt(3) })],
      documentAt(stored),
    );
    await result;

    expect(ref.set).not.toHaveBeenCalled();
  });

  it('applies the events at position 0 when the document does not exist', async () => {
    const { ref, result } = handle(
      counterProjection,
      [itemAdded('a', 1, { position: BigInt(0) })],
      null,
    );
    await result;

    expect(ref.set).toHaveBeenCalledWith(expect.objectContaining({ count: 1 }));
  });

  it.each([
    ['has no metadata', { count: 5 }],
    ['has no stream position', { count: 5, _metadata: {} }],
    ['has an unreadable stream position', documentAt('not-a-number')],
    ['has a fractional stream position', documentAt(1.5)],
  ])('applies every event when the document %s', async (_label, document) => {
    const { ref, result } = handle(
      counterProjection,
      [itemAdded('a', 1, { position: BigInt(0) })],
      document,
    );
    await result;

    expect(ref.set).toHaveBeenCalledWith(expect.objectContaining({ count: 6 }));
  });

  it('keeps a replay from changing the stored document', async () => {
    const events = [
      itemAdded('a', 1, { position: BigInt(0) }),
      itemAdded('b', 1, { position: BigInt(1) }),
    ];

    const first = handle(counterProjection, events, null);
    await first.result;
    const stored = (first.ref.set.mock.calls as unknown[][])[0][0] as {
      count: number;
    };

    const replay = handle(counterProjection, events, stored);
    await replay.result;

    expect(stored.count).toBe(2);
    expect(replay.ref.set).not.toHaveBeenCalled();
  });
});

describe('Dates in documents', () => {
  const openedAt = new Date('2026-10-24T12:30:00.000Z');
  const datedProjection = realtimeDBInlineProjection<
    { openedAt: Date; history: Date[] },
    Event
  >({
    name: 'dated',
    canHandle: ['ItemAdded'],
    evolve: () => ({ openedAt, history: [openedAt] }),
  });

  it('writes a Date as an ISO 8601 UTC string, which the database would otherwise drop', async () => {
    const ref = { set: jest.fn(), remove: jest.fn() };

    await datedProjection.handle([itemAdded('a', 1, { position: BigInt(0) })], {
      document: null,
      streamId: 'stream-1',
      database: {} as Database,
      projectionRef: ref as unknown as Reference,
    });

    expect(ref.set).toHaveBeenCalledWith({
      openedAt: '2026-10-24T12:30:00.000Z',
      history: ['2026-10-24T12:30:00.000Z'],
      _metadata: containing({ streamPosition: '0' }),
    });
  });
});
