import type { Database } from 'firebase-admin/database';
import type { EventStore } from '@event-driven-io/emmett';
import { wireRealtimeDBProjections } from '../../src/wireRealtimeDBProjections';
import { getProjectionState } from '../../src/testing';
import {
  cartProjection,
  counterProjection,
  confirmationProjection,
  type PersistedCartState,
  type PersistedCounterState,
} from '../fixtures/projections';
import {
  itemAdded,
  itemRemoved,
  orderConfirmed,
  orderCancelled,
} from '../fixtures/events';
import { InMemoryRealtimeDb } from '../support/inMemoryRealtimeDb';

describe('Wire Realtime DB Projections Integration', () => {
  let database: Database;
  let mockEventStore: jest.Mocked<EventStore>;

  beforeEach(async () => {
    database = new InMemoryRealtimeDb() as unknown as Database;

    const appendToStreamMock = jest.fn().mockResolvedValue({
      streamVersion: BigInt(1),
      nextExpectedStreamVersion: BigInt(2),
      createdNewStream: false,
    });

    mockEventStore = {
      appendToStream: appendToStreamMock,
      readStream: jest.fn(),
      aggregateStream: jest.fn(),
    } as any;
  });

  describe('Integration with EventStore', () => {
    it('wires event store and updates projections on append', async () => {
      // Keep reference to original mock before wiring
      const originalAppendMock = mockEventStore.appendToStream;

      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database,
        projections: [counterProjection],
      });

      const streamId = 'stream-1';
      const events = [itemAdded('item-1', 1, { position: BigInt(0) })];

      await wired.appendToStream(streamId, events as any, {});

      // Verify original event store mock was called
      expect(originalAppendMock).toHaveBeenCalledWith(
        streamId,
        events,
        {},
      );

      // Verify projection was updated in database
      const state = await getProjectionState<PersistedCounterState>(
        database,
        'test-counter',
        streamId,
      );

      expect(state).not.toBeNull();
      expect(state?.count).toBe(1);
    });

    it('updates projections after each append', async () => {
      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database,
        projections: [cartProjection],
      });

      const streamId = 'cart-123';

      // First append
      await wired.appendToStream(
        streamId,
        [itemAdded('item-1', 2, { position: BigInt(0), unitPrice: 100 })] as any,
        {},
      );

      let state = await getProjectionState<PersistedCartState>(
        database,
        'test-cart',
        streamId,
      );
      expect(state?.totalQuantity).toBe(2);
      expect(state?.totalAmount).toBe(200);

      // Second append
      await wired.appendToStream(
        streamId,
        [itemAdded('item-2', 3, { position: BigInt(1), unitPrice: 200 })] as any,
        {},
      );

      state = await getProjectionState<PersistedCartState>(
        database,
        'test-cart',
        streamId,
      );
      expect(state?.items).toHaveLength(2);
      expect(state?.totalQuantity).toBe(5);
      expect(state?.totalAmount).toBe(800); // (2*100) + (3*200)
    });

    it('handles multiple projections on same append', async () => {
      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database,
        projections: [counterProjection, cartProjection],
      });

      const streamId = 'multi-projection';
      const events = [itemAdded('item-1', 5, { position: BigInt(0), unitPrice: 100 })];

      await wired.appendToStream(streamId, events as any, {});

      // Check both projections were updated
      const counterState = await getProjectionState<PersistedCounterState>(
        database,
        'test-counter',
        streamId,
      );
      const cartState = await getProjectionState<PersistedCartState>(
        database,
        'test-cart',
        streamId,
      );

      expect(counterState?.count).toBe(1);
      expect(cartState?.totalQuantity).toBe(5);
      expect(cartState?.totalAmount).toBe(500);
    });

    it('passes append options correctly to original event store', async () => {
      // Keep reference to original mock before wiring
      const originalAppendMock = mockEventStore.appendToStream;

      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database,
        projections: [counterProjection],
      });

      const streamId = 'stream-with-options';
      const events = [itemAdded('item-1', 1, { position: BigInt(0) })];
      const options = { expectedStreamVersion: BigInt(5) };

      await wired.appendToStream(streamId, events as any, options);

      expect(originalAppendMock).toHaveBeenCalledWith(
        streamId,
        events,
        options,
      );
    });

    it('preserves result from original append', async () => {
      const expectedResult = {
        streamVersion: BigInt(10),
        nextExpectedStreamVersion: BigInt(11),
        createdNewStream: false,
      };

      mockEventStore.appendToStream.mockResolvedValue(expectedResult);

      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database,
        projections: [counterProjection],
      });

      const result = await wired.appendToStream(
        'stream-1',
        [itemAdded('item-1', 1, { position: BigInt(0) })] as any,
        {},
      );

      expect(result).toEqual(expectedResult);
    });
  });

  describe('Multiple Streams', () => {
    it('creates separate projections for different streams', async () => {
      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database,
        projections: [counterProjection],
      });

      // Append to stream 1
      await wired.appendToStream(
        'stream-1',
        [itemAdded('item-1', 1, { position: BigInt(0) })] as any,
        {},
      );

      // Append to stream 2
      await wired.appendToStream(
        'stream-2',
        [itemAdded('item-2', 1, { position: BigInt(0) })] as any,
        {},
      );

      // Check both projections exist independently
      const state1 = await getProjectionState<PersistedCounterState>(
        database,
        'test-counter',
        'stream-1',
      );
      const state2 = await getProjectionState<PersistedCounterState>(
        database,
        'test-counter',
        'stream-2',
      );

      expect(state1).not.toBeNull();
      expect(state2).not.toBeNull();
      expect(state1?._metadata.streamId).toBe('stream-1');
      expect(state2?._metadata.streamId).toBe('stream-2');
    });

    it('maintains stream isolation', async () => {
      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database,
        projections: [counterProjection],
      });

      // Add 3 events to stream-1
      await wired.appendToStream(
        'stream-1',
        [
          itemAdded('item-1', 1, { position: BigInt(0) }),
          itemAdded('item-2', 1, { position: BigInt(1) }),
          itemAdded('item-3', 1, { position: BigInt(2) }),
        ] as any,
        {},
      );

      // Add 1 event to stream-2
      await wired.appendToStream(
        'stream-2',
        [itemAdded('item-1', 1, { position: BigInt(0) })] as any,
        {},
      );

      const state1 = await getProjectionState<PersistedCounterState>(
        database,
        'test-counter',
        'stream-1',
      );
      const state2 = await getProjectionState<PersistedCounterState>(
        database,
        'test-counter',
        'stream-2',
      );

      expect(state1?.count).toBe(3);
      expect(state2?.count).toBe(1);
    });

    it('deletes projection in one stream without affecting another', async () => {
      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database,
        projections: [cartProjection],
      });

      // Create projections in both streams
      await wired.appendToStream(
        'stream-1',
        [itemAdded('item-1', 1, { position: BigInt(0) })] as any,
        {},
      );
      await wired.appendToStream(
        'stream-2',
        [itemAdded('item-2', 1, { position: BigInt(0) })] as any,
        {},
      );

      // Cancel order in stream-1 (deletes projection)
      await wired.appendToStream(
        'stream-1',
        [orderCancelled('order-1', { position: BigInt(1) })] as any,
        {},
      );

      const state1 = await getProjectionState<PersistedCartState>(
        database,
        'test-cart',
        'stream-1',
      );
      const state2 = await getProjectionState<PersistedCartState>(
        database,
        'test-cart',
        'stream-2',
      );

      expect(state1).toBeNull(); // Deleted
      expect(state2).not.toBeNull(); // Still exists
    });
  });

  describe('EventStore Behavior Preservation', () => {
    it('calls original appendToStream before updating projections', async () => {
      const callOrder: string[] = [];

      mockEventStore.appendToStream.mockImplementation(async () => {
        callOrder.push('append');
        return {
          streamVersion: BigInt(1),
          nextExpectedStreamVersion: BigInt(2),
          createdNewStream: false,
        };
      });

      const testProjection = {
        ...counterProjection,
        handle: jest.fn().mockImplementation(async () => {
          callOrder.push('projection');
        }),
      };

      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database,
        projections: [testProjection],
      });

      await wired.appendToStream(
        'stream-1',
        [itemAdded('item-1', 1, { position: BigInt(0) })] as any,
        {},
      );

      expect(callOrder).toEqual(['append', 'projection']);
    });

    it('does not update projections if append fails', async () => {
      mockEventStore.appendToStream.mockRejectedValue(
        new Error('Append failed'),
      );

      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database,
        projections: [counterProjection],
      });

      await expect(
        wired.appendToStream(
          'stream-1',
          [itemAdded('item-1', 1, { position: BigInt(0) })] as any,
          {},
        ),
      ).rejects.toThrow('Append failed');

      // Projection should not exist
      const state = await getProjectionState<PersistedCounterState>(
        database,
        'test-counter',
        'stream-1',
      );
      expect(state).toBeNull();
    });

    it('throws error if projection update fails after successful append', async () => {
      // Keep reference to original mock before wiring
      const originalAppendMock = mockEventStore.appendToStream;

      const failingProjection = {
        ...counterProjection,
        handle: jest.fn().mockRejectedValue(new Error('Projection failed')),
      };

      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database,
        projections: [failingProjection],
      });

      await expect(
        wired.appendToStream(
          'stream-1',
          [itemAdded('item-1', 1, { position: BigInt(0) })] as any,
          {},
        ),
      ).rejects.toThrow('Projection failed');

      // Verify append was called (event stored)
      expect(originalAppendMock).toHaveBeenCalled();
    });

    it('preserves EventStore methods and properties', () => {
      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database,
        projections: [counterProjection],
      });

      expect(wired.readStream).toBe(mockEventStore.readStream);
      expect(wired.aggregateStream).toBe(mockEventStore.aggregateStream);
    });
  });

  describe('Event Filtering', () => {
    it('only updates projections that can handle event types', async () => {
      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database,
        projections: [counterProjection, confirmationProjection],
      });

      const streamId = 'filter-test';

      // ItemAdded event - only counterProjection should handle
      await wired.appendToStream(
        streamId,
        [itemAdded('item-1', 1, { position: BigInt(0) })] as any,
        {},
      );

      const counterState = await getProjectionState<PersistedCounterState>(
        database,
        'test-counter',
        streamId,
      );
      const confirmState = await getProjectionState<{ confirmedAt: string | null }>(
        database,
        'test-confirmation',
        streamId,
      );

      expect(counterState).not.toBeNull();
      expect(confirmState).toBeNull(); // Not created

      // OrderConfirmed event - only confirmationProjection should handle
      await wired.appendToStream(
        streamId,
        [orderConfirmed('order-1', { position: BigInt(1) })] as any,
        {},
      );

      const confirmStateAfter = await getProjectionState<{ confirmedAt: string | null }>(
        database,
        'test-confirmation',
        streamId,
      );

      expect(confirmStateAfter).not.toBeNull();
      expect(confirmStateAfter?.confirmedAt).toBeTruthy();
    });

    it('does not create projection for unhandled event types', async () => {
      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database,
        projections: [counterProjection],
      });

      const streamId = 'unhandled-events';

      // OrderConfirmed is not in counterProjection.canHandle
      await wired.appendToStream(
        streamId,
        [orderConfirmed('order-1', { position: BigInt(0) })] as any,
        {},
      );

      const state = await getProjectionState<PersistedCounterState>(
        database,
        'test-counter',
        streamId,
      );

      expect(state).toBeNull();
    });
  });

  describe('Complex Scenarios', () => {
    it('handles full shopping cart lifecycle', async () => {
      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database,
        projections: [cartProjection],
      });

      const streamId = 'cart-lifecycle';

      // 1. Add items
      await wired.appendToStream(
        streamId,
        [
          itemAdded('item-1', 2, { position: BigInt(0), unitPrice: 100 }),
          itemAdded('item-2', 1, { position: BigInt(1), unitPrice: 200 }),
        ] as any,
        {},
      );

      let state = await getProjectionState<PersistedCartState>(
        database,
        'test-cart',
        streamId,
      );
      expect(state?.totalQuantity).toBe(3);
      expect(state?.totalAmount).toBe(400);
      expect(state?.status).toBe('Open');

      // 2. Remove item
      await wired.appendToStream(
        streamId,
        [itemRemoved('item-1', { position: BigInt(2), quantity: 1 })] as any,
        {},
      );

      state = await getProjectionState<PersistedCartState>(
        database,
        'test-cart',
        streamId,
      );
      expect(state?.totalQuantity).toBe(2);
      expect(state?.totalAmount).toBe(300);

      // 3. Confirm order
      await wired.appendToStream(
        streamId,
        [orderConfirmed('order-1', { position: BigInt(3) })] as any,
        {},
      );

      state = await getProjectionState<PersistedCartState>(
        database,
        'test-cart',
        streamId,
      );
      expect(state?.status).toBe('Confirmed');
      expect(state?.totalQuantity).toBe(2); // Unchanged

      // 4. Cancel order (deletes projection)
      await wired.appendToStream(
        streamId,
        [orderCancelled('order-1', { position: BigInt(4) })] as any,
        {},
      );

      state = await getProjectionState<PersistedCartState>(
        database,
        'test-cart',
        streamId,
      );
      expect(state).toBeNull();
    });

    it('handles multiple sequential appends with state accumulation', async () => {
      // Create a mock that returns incrementing versions
      let currentVersion = BigInt(-1);
      const incrementingMock = jest.fn().mockImplementation((_, events) => {
        const eventsLength = events.length;
        const newVersion = currentVersion + BigInt(eventsLength);
        const result = {
          nextExpectedStreamVersion: newVersion,
          createdNewStream: currentVersion === BigInt(-1),
        };
        currentVersion = newVersion;
        return Promise.resolve(result);
      });

      const customMockEventStore = {
        appendToStream: incrementingMock,
        readStream: jest.fn(),
        aggregateStream: jest.fn(),
      } as any;

      const wired = wireRealtimeDBProjections({
        eventStore: customMockEventStore,
        database,
        projections: [counterProjection],
      });

      const streamId = 'sequential-appends';

      // 10 sequential appends - use plain events without metadata
      for (let i = 0; i < 10; i++) {
        await wired.appendToStream(
          streamId,
          [
            {
              type: 'ItemAdded',
              data: { itemId: `item-${i}`, quantity: 1 },
            },
          ] as any,
          {},
        );
      }

      const state = await getProjectionState<PersistedCounterState>(
        database,
        'test-counter',
        streamId,
      );

      expect(state?.count).toBe(10);
      expect(state?._metadata.streamPosition).toBe(BigInt(9));
    });

    it('handles mixed events (add and remove)', async () => {
      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database,
        projections: [counterProjection],
      });

      const streamId = 'mixed-events';

      await wired.appendToStream(
        streamId,
        [
          itemAdded('item-1', 1, { position: BigInt(0) }),
          itemAdded('item-2', 1, { position: BigInt(1) }),
          itemRemoved('item-1', { position: BigInt(2) }),
          itemAdded('item-3', 1, { position: BigInt(3) }),
          itemRemoved('item-2', { position: BigInt(4) }),
        ] as any,
        {},
      );

      const state = await getProjectionState<PersistedCounterState>(
        database,
        'test-counter',
        streamId,
      );

      // 1 + 1 - 1 + 1 - 1 = 1
      expect(state?.count).toBe(1);
    });
  });
});
