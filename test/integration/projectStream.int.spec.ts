import type { Database } from 'firebase-admin/database';
import {
  getInMemoryEventStore,
  type EventStore,
} from '@event-driven-io/emmett';
import { projectStream } from '../../src/projectStream';
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

describe('projectStream Integration', () => {
  const streamId = 'stream-1';
  let database: Database;
  let eventStore: EventStore;

  const count = async () =>
    (
      await getProjectionState<PersistedCounterState>(
        database,
        'test-counter',
        streamId,
      )
    )?.count;

  const catchUp = () =>
    projectStream({
      eventStore,
      database,
      projections: [counterProjection],
      streamName: streamId,
    });

  beforeEach(() => {
    database = createInMemoryDatabase();
    eventStore = wireRealtimeDBProjections({
      eventStore: getInMemoryEventStore(),
      database,
      projections: [counterProjection],
    });
  });

  it('rebuilds a read model that was lost from the stored events', async () => {
    await eventStore.appendToStream(streamId, [
      added('item-1'),
      added('item-2'),
    ]);
    await database.ref(`projections/test-counter/${streamId}`).remove();

    await catchUp();

    expect(await count()).toBe(2);
  });

  it('changes nothing when the read model is up to date', async () => {
    await eventStore.appendToStream(streamId, [
      added('item-1'),
      added('item-2'),
    ]);

    await catchUp();

    expect(await count()).toBe(2);
  });

  it('applies on top of the rebuilt read model the events appended afterwards', async () => {
    await eventStore.appendToStream(streamId, [added('item-1')]);
    await database.ref(`projections/test-counter/${streamId}`).remove();

    await catchUp();
    await eventStore.appendToStream(streamId, [added('item-2')]);

    expect(await count()).toBe(2);
  });

  it('does nothing for a stream that does not exist', async () => {
    await catchUp();

    expect(await count()).toBeUndefined();
  });
});
