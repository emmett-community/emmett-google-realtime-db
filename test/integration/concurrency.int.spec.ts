import * as admin from 'firebase-admin';
import type { Database } from 'firebase-admin/database';
import type { EventStore } from '@event-driven-io/emmett';
import { wireRealtimeDBProjections } from '../../src/wireRealtimeDBProjections';
import { getProjectionState } from '../../src/projections/realtimeDBInlineProjectionSpec';
import {
  cartProjection,
  counterProjection,
  type PersistedCartState,
  type PersistedCounterState,
} from '../fixtures/projections';
import { itemAdded, itemRemoved } from '../fixtures/events';

describe('High Volume Operations Integration', () => {
  let database: Database;
  let app: admin.app.App;
  let mockEventStore: jest.Mocked<EventStore>;

  beforeAll(() => {
    app = admin.initializeApp(
      {
        projectId: process.env.FIRESTORE_PROJECT_ID || 'test-project',
        databaseURL: `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST || 'localhost:9000'}?ns=test-project`,
      },
      `test-concurrency-${Date.now()}`,
    );
    database = admin.database(app);
  });

  afterAll(async () => {
    await app.delete();
  });

  beforeEach(async () => {
    await database.ref().remove();

    mockEventStore = {
      appendToStream: jest.fn().mockImplementation(async () => ({
        streamVersion: BigInt(1),
        nextExpectedStreamVersion: BigInt(2),
        createdNewStream: false,
      })),
      readStream: jest.fn(),
      aggregateStream: jest.fn(),
    } as any;
  });

  describe('Sequential Operations on Same Stream', () => {
    it('handles 10 sequential appends to same stream', async () => {
      // Keep reference to original mock before wiring
      const originalAppendMock = mockEventStore.appendToStream;

      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database,
        projections: [counterProjection],
      });

      const streamId = 'concurrent-stream';

      // 10 sequential appends (without transactions, concurrent appends would cause race conditions)
      for (let i = 0; i < 10; i++) {
        await wired.appendToStream(
          streamId,
          [itemAdded(`item-${i}`, 1, { position: BigInt(i) })] as any,
          {},
        );
      }

      const state = await getProjectionState<PersistedCounterState>(
        database,
        'test-counter',
        streamId,
      );

      expect(state).not.toBeNull();
      expect(state?.count).toBe(10);
      expect(originalAppendMock).toHaveBeenCalledTimes(10);
    });

    it('handles 20 sequential appends with state accumulation', async () => {
      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database,
        projections: [cartProjection],
      });

      const streamId = 'large-sequential';

      // 20 sequential appends
      for (let i = 0; i < 20; i++) {
        await wired.appendToStream(
          streamId,
          [itemAdded(`item-${i}`, 1, { position: BigInt(i), unitPrice: 100 })] as any,
          {},
        );
      }

      const state = await getProjectionState<PersistedCartState>(
        database,
        'test-cart',
        streamId,
      );

      expect(state?.items).toHaveLength(20);
      expect(state?.totalQuantity).toBe(20);
      expect(state?.totalAmount).toBe(2000); // 20 * 100
    });

    it('handles mixed sequential add and remove operations', async () => {
      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database,
        projections: [counterProjection],
      });

      const streamId = 'mixed-sequential';

      // 5 adds sequentially
      for (let i = 0; i < 5; i++) {
        await wired.appendToStream(
          streamId,
          [itemAdded(`item-${i}`, 1, { position: BigInt(i) })] as any,
          {},
        );
      }

      // 5 removes sequentially
      for (let i = 0; i < 5; i++) {
        await wired.appendToStream(
          streamId,
          [itemRemoved(`item-${i}`, { position: BigInt(i + 5) })] as any,
          {},
        );
      }

      const state = await getProjectionState<PersistedCounterState>(
        database,
        'test-counter',
        streamId,
      );

      // 5 adds - 5 removes = 0
      expect(state?.count).toBe(0);
    });

    it('maintains consistency with rapid sequential operations', async () => {
      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database,
        projections: [counterProjection],
      });

      const streamId = 'rapid-sequential';

      // 10 sequential operations
      for (let i = 0; i < 10; i++) {
        await wired.appendToStream(
          streamId,
          [itemAdded(`item-${i}`, 1, { position: BigInt(i) })] as any,
          {},
        );
      }

      const state = await getProjectionState<PersistedCounterState>(
        database,
        'test-counter',
        streamId,
      );
      expect(state?.count).toBe(10);
    });
  });

  describe('Operations on Multiple Streams', () => {
    it('handles 5 streams with 5 appends each', async () => {
      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database,
        projections: [counterProjection],
      });

      const streams = ['stream-1', 'stream-2', 'stream-3', 'stream-4', 'stream-5'];

      // Process each stream sequentially
      for (const streamId of streams) {
        for (let i = 0; i < 5; i++) {
          await wired.appendToStream(
            streamId,
            [itemAdded(`item-${i}`, 1, { position: BigInt(i) })] as any,
            {},
          );
        }
      }

      // Verify each stream has count = 5
      for (const streamId of streams) {
        const state = await getProjectionState<PersistedCounterState>(
          database,
          'test-counter',
          streamId,
        );
        expect(state?.count).toBe(5);
      }
    });

    it('maintains stream isolation with sequential operations', async () => {
      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database,
        projections: [cartProjection],
      });

      // Stream 1: 10 appends
      for (let i = 0; i < 10; i++) {
        await wired.appendToStream(
          'stream-isolated-1',
          [itemAdded(`item-${i}`, 2, { position: BigInt(i), unitPrice: 50 })] as any,
          {},
        );
      }

      // Stream 2: 15 appends
      for (let i = 0; i < 15; i++) {
        await wired.appendToStream(
          'stream-isolated-2',
          [itemAdded(`item-${i}`, 1, { position: BigInt(i), unitPrice: 100 })] as any,
          {},
        );
      }

      const state1 = await getProjectionState<PersistedCartState>(
        database,
        'test-cart',
        'stream-isolated-1',
      );
      const state2 = await getProjectionState<PersistedCartState>(
        database,
        'test-cart',
        'stream-isolated-2',
      );

      expect(state1?.items).toHaveLength(10);
      expect(state1?.totalQuantity).toBe(20); // 10 items * 2 quantity
      expect(state1?.totalAmount).toBe(1000); // 20 * 50

      expect(state2?.items).toHaveLength(15);
      expect(state2?.totalQuantity).toBe(15); // 15 items * 1 quantity
      expect(state2?.totalAmount).toBe(1500); // 15 * 100
    });

    it('handles sequential operations across different projections', async () => {
      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database,
        projections: [counterProjection, cartProjection],
      });

      const streamId = 'multi-projection-sequential';

      // 10 sequential appends affecting both projections
      for (let i = 0; i < 10; i++) {
        await wired.appendToStream(
          streamId,
          [itemAdded(`item-${i}`, 3, { position: BigInt(i), unitPrice: 200 })] as any,
          {},
        );
      }

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

      expect(counterState?.count).toBe(10);
      expect(cartState?.items).toHaveLength(10);
      expect(cartState?.totalQuantity).toBe(30); // 10 * 3
      expect(cartState?.totalAmount).toBe(6000); // 30 * 200
    });
  });

  describe('Error Handling', () => {
    it('handles failed appends gracefully in sequential scenario', async () => {
      let callCount = 0;
      mockEventStore.appendToStream.mockImplementation(async () => {
        callCount++;
        // Fail every 3rd call
        if (callCount % 3 === 0) {
          throw new Error('Simulated append failure');
        }
        return {
          streamVersion: BigInt(callCount),
          nextExpectedStreamVersion: BigInt(callCount + 1),
          createdNewStream: false,
        };
      });

      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database,
        projections: [counterProjection],
      });

      const streamId = 'error-handling';

      // Sequential operations with error handling
      for (let i = 0; i < 9; i++) {
        try {
          await wired.appendToStream(
            streamId,
            [itemAdded(`item-${i}`, 1, { position: BigInt(i) })] as any,
            {},
          );
        } catch {
          // Ignore errors, continue with next operation
        }
      }

      const state = await getProjectionState<PersistedCounterState>(
        database,
        'test-counter',
        streamId,
      );

      // Only 6 should succeed (3, 6, 9 failed)
      expect(state?.count).toBe(6);
    });

    it('stops when projection fails but earlier projections already persisted', async () => {
      const failingProjection = {
        ...cartProjection,
        handle: jest.fn().mockRejectedValue(new Error('Projection error')),
      };

      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database,
        projections: [counterProjection, failingProjection],
      });

      const streamId = 'partial-failure';

      // Operation will fail due to failing projection
      await expect(
        wired.appendToStream(
          streamId,
          [itemAdded('item-1', 1, { position: BigInt(0) })] as any,
          {},
        ),
      ).rejects.toThrow('Projection error');

      // Counter projection WAS updated because it ran before the failing one
      // Projections are not transactional - they run sequentially
      const counterState = await getProjectionState<PersistedCounterState>(
        database,
        'test-counter',
        streamId,
      );

      // Counter was updated (not atomic across projections)
      expect(counterState).not.toBeNull();
      expect(counterState?.count).toBe(1);
    });
  });

  describe('Performance and Stress Tests', () => {
    it('handles 50 sequential appends without degradation', async () => {
      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database,
        projections: [counterProjection],
      });

      const streamId = 'stress-test';
      const startTime = Date.now();

      // Sequential appends for high volume test
      for (let i = 0; i < 50; i++) {
        await wired.appendToStream(
          streamId,
          [itemAdded(`item-${i}`, 1, { position: BigInt(i) })] as any,
          {},
        );
      }

      const duration = Date.now() - startTime;

      const state = await getProjectionState<PersistedCounterState>(
        database,
        'test-counter',
        streamId,
      );

      expect(state?.count).toBe(50);
      expect(duration).toBeLessThan(10000); // Should complete within 10 seconds
    }, 15000); // Extended timeout for stress test

    it('handles complex cart scenario with 30 sequential operations', async () => {
      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database,
        projections: [cartProjection],
      });

      const streamId = 'complex-cart';

      // Add 20 items
      for (let i = 0; i < 20; i++) {
        await wired.appendToStream(
          streamId,
          [itemAdded(`item-${i}`, 2, { position: BigInt(i), unitPrice: 100 })] as any,
          {},
        );
      }

      // Remove 1 from first 10 items
      for (let i = 0; i < 10; i++) {
        await wired.appendToStream(
          streamId,
          [itemRemoved(`item-${i}`, { position: BigInt(i + 20), quantity: 1 })] as any,
          {},
        );
      }

      const state = await getProjectionState<PersistedCartState>(
        database,
        'test-cart',
        streamId,
      );

      expect(state?.items).toHaveLength(20);
      // First 10 items have quantity 1 (2-1), next 10 have quantity 2
      const totalQuantity = 10 * 1 + 10 * 2;
      expect(state?.totalQuantity).toBe(totalQuantity); // 30
    }, 15000);
  });
});
