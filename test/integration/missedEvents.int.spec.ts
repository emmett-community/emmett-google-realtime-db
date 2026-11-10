import type { Database } from 'firebase-admin/database';
import {
  getInMemoryEventStore,
  type EventStore,
} from '@event-driven-io/emmett';
import { wireRealtimeDBProjections } from '../../src/wireRealtimeDBProjections';
import { createInMemoryDatabase, getProjectionState } from '../../src/testing';
import {
  counterProjection,
  type PersistedCounterState,
} from '../fixtures/projections';

const added = (itemId: string) => ({
  type: 'ItemAdded',
  data: { itemId, quantity: 1 },
});

// A process that stops between the commit and the projection: the event is stored, the read
// model is not written. Appending straight to the event store, without the wiring, does that.
describe('Events missed by a projection', () => {
  const streamId = 'stream-1';
  let database: Database;
  let base: EventStore;
  let appendWithoutProjection: EventStore['appendToStream'];
  let wired: EventStore;
  let reads: number;
  let eventsRead: number;

  const count = async () =>
    (
      await getProjectionState<PersistedCounterState>(
        database,
        'test-counter',
        streamId,
      )
    )?.count;

  beforeEach(() => {
    database = createInMemoryDatabase();
    base = getInMemoryEventStore();
    appendWithoutProjection = base.appendToStream.bind(base);
    const readStream = base.readStream.bind(base);
    reads = 0;
    eventsRead = 0;
    base.readStream = (async (
      ...args: Parameters<EventStore['readStream']>
    ) => {
      reads++;
      const result = await readStream(...args);
      eventsRead += result.events.length;
      return result;
    }) as EventStore['readStream'];
    wired = wireRealtimeDBProjections({
      eventStore: base,
      database,
      projections: [counterProjection],
    });
  });

  it('applies an event missed in the middle with the next append', async () => {
    await wired.appendToStream(streamId, [added('1')]);
    await appendWithoutProjection(streamId, [added('2')]);

    await wired.appendToStream(streamId, [added('3')]);

    expect(await count()).toBe(3);
  });

  it('applies the first events of a stream when the read model was never written', async () => {
    await appendWithoutProjection(streamId, [added('1')]);

    await wired.appendToStream(streamId, [added('2')]);

    expect(await count()).toBe(2);
  });

  it('applies several missed appends at once', async () => {
    await wired.appendToStream(streamId, [added('1')]);
    await appendWithoutProjection(streamId, [added('2')]);
    await appendWithoutProjection(streamId, [added('3'), added('4')]);

    await wired.appendToStream(streamId, [added('5')]);

    expect(await count()).toBe(5);
  });

  it('reads only the missed part of a long stream, not the whole stream', async () => {
    for (let item = 1; item <= 20; item++) {
      await wired.appendToStream(streamId, [added(`${item}`)]);
    }
    await appendWithoutProjection(streamId, [added('21')]);

    await wired.appendToStream(streamId, [added('22')]);

    expect(await count()).toBe(22);
    expect(reads).toBe(1);
    // One event missed; the range asked may be one event wider, depending on the event store
    expect(eventsRead).toBeLessThanOrEqual(2);
  });

  it('does not read the stream when nothing was missed', async () => {
    await wired.appendToStream(streamId, [added('1')]);
    await wired.appendToStream(streamId, [added('2'), added('3')]);

    expect(await count()).toBe(3);
    expect(reads).toBe(0);
  });
});
