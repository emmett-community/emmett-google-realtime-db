import * as admin from 'firebase-admin';
import type { Database } from 'firebase-admin/database';
import {
  testProjection,
  getProjectionState,
  clearProjection,
  clearAllProjections,
} from '../../src/projections/realtimeDBInlineProjectionSpec';
import { handleInlineProjections } from '../../src/projections/realtimeDBInlineProjection';
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

describe('Projection State Integration', () => {
  let database: Database;
  let app: admin.app.App;

  beforeAll(() => {
    app = admin.initializeApp(
      {
        projectId: process.env.FIRESTORE_PROJECT_ID || 'test-project',
        databaseURL: `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST || 'localhost:9000'}?ns=test-project`,
      },
      `test-projection-state-${Date.now()}`,
    );
    database = admin.database(app);
  });

  afterAll(async () => {
    await app.delete();
  });

  beforeEach(async () => {
    await database.ref().remove();
  });

  describe('Testing Utilities Validation', () => {
    describe('testProjection', () => {
      it('applies events to projection and persists state', async () => {
        const streamId = 'test-stream';
        const events = [
          itemAdded('item-1', 2, { position: BigInt(0) }),
          itemAdded('item-2', 3, { position: BigInt(1) }),
        ];

        await testProjection(cartProjection, events as any, {
          streamId,
          database,
        });

        const result = await getProjectionState<PersistedCartState>(
          database,
          'test-cart',
          streamId,
        );

        expect(result).not.toBeNull();
        expect(result?.items).toHaveLength(2);
        expect(result?.totalQuantity).toBe(5);
      });

      it('deletes projection when evolve returns null', async () => {
        const streamId = 'deleted-stream';
        const events = [
          itemAdded('item-1', 1, { position: BigInt(0) }),
          orderCancelled('order-1', { position: BigInt(1) }),
        ];

        await testProjection(cartProjection, events as any, {
          streamId,
          database,
        });

        const result = await getProjectionState<PersistedCartState>(
          database,
          'test-cart',
          streamId,
        );

        expect(result).toBeNull();
      });

      it('creates projection in database', async () => {
        const streamId = 'persisted-stream';
        const events = [itemAdded('item-1', 1, { position: BigInt(0) })];

        await testProjection(counterProjection, events as any, {
          streamId,
          database,
        });

        // Verify it exists in database
        const state = await getProjectionState<PersistedCounterState>(
          database,
          'test-counter',
          streamId,
        );

        expect(state).not.toBeNull();
        expect(state?.count).toBe(1);
      });

      it('works with existing document', async () => {
        const streamId = 'existing-doc';

        // Create initial state
        await testProjection(
          counterProjection,
          [itemAdded('item-1', 1, { position: BigInt(0) })] as any,
          { streamId, database },
        );

        // Apply more events to existing state
        await testProjection(
          counterProjection,
          [itemAdded('item-2', 1, { position: BigInt(1) })] as any,
          { streamId, database },
        );

        const result = await getProjectionState<PersistedCounterState>(
          database,
          'test-counter',
          streamId,
        );

        expect(result?.count).toBe(2); // 1 + 1
      });
    });

    describe('getProjectionState', () => {
      it('reads projection state correctly', async () => {
        const streamId = 'read-test';
        const events = [
          itemAdded('item-1', 3, { position: BigInt(0), unitPrice: 100 }),
        ];

        await handleInlineProjections({
          events: events as any,
          projections: [cartProjection] as any,
          streamId,
          database,
        });

        const state = await getProjectionState<PersistedCartState>(
          database,
          'test-cart',
          streamId,
        );

        expect(state).not.toBeNull();
        expect(state?.totalQuantity).toBe(3);
        expect(state?.totalAmount).toBe(300);
        expect(state?._metadata.streamId).toBe(streamId);
      });

      it('returns null for non-existent projection', async () => {
        const state = await getProjectionState<PersistedCartState>(
          database,
          'test-cart',
          'does-not-exist',
        );

        expect(state).toBeNull();
      });

      it('returns null after projection is deleted', async () => {
        const streamId = 'deleted-projection';

        // Create projection
        await handleInlineProjections({
          events: [itemAdded('item-1', 1, { position: BigInt(0) })] as any,
          projections: [cartProjection] as any,
          streamId,
          database,
        });

        // Delete it
        await handleInlineProjections({
          events: [orderCancelled('order-1', { position: BigInt(1) })] as any,
          projections: [cartProjection] as any,
          streamId,
          database,
        });

        const state = await getProjectionState<PersistedCartState>(
          database,
          'test-cart',
          streamId,
        );

        expect(state).toBeNull();
      });

      it('includes metadata in result', async () => {
        const streamId = 'metadata-test';
        await handleInlineProjections({
          events: [itemAdded('item-1', 1, { position: BigInt(42) })] as any,
          projections: [counterProjection] as any,
          streamId,
          database,
        });

        const state = await getProjectionState<PersistedCounterState>(
          database,
          'test-counter',
          streamId,
        );

        expect(state?._metadata).toEqual({
          streamId: 'metadata-test',
          name: 'test-counter',
          schemaVersion: 1,
          streamPosition: BigInt(42),
        });
      });
    });

    describe('clearProjection', () => {
      it('clears specific projection', async () => {
        const streamId = 'clear-specific';
        await handleInlineProjections({
          events: [itemAdded('item-1', 1, { position: BigInt(0) })] as any,
          projections: [counterProjection] as any,
          streamId,
          database,
        });

        let state = await getProjectionState<PersistedCounterState>(
          database,
          'test-counter',
          streamId,
        );
        expect(state).not.toBeNull();

        await clearProjection(database, 'test-counter', streamId);

        state = await getProjectionState<PersistedCounterState>(
          database,
          'test-counter',
          streamId,
        );
        expect(state).toBeNull();
      });

      it('does not affect other projections in same stream', async () => {
        const streamId = 'multi-clear';
        await handleInlineProjections({
          events: [itemAdded('item-1', 1, { position: BigInt(0) })] as any,
          projections: [counterProjection, cartProjection] as any,
          streamId,
          database,
        });

        // Clear only counter
        await clearProjection(database, 'test-counter', streamId);

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

        expect(counterState).toBeNull();
        expect(cartState).not.toBeNull(); // Still exists
      });

      it('does not affect same projection in other streams', async () => {
        // Create projections in two streams
        await handleInlineProjections({
          events: [itemAdded('item-1', 1, { position: BigInt(0) })] as any,
          projections: [counterProjection] as any,
          streamId: 'stream-1',
          database,
        });

        await handleInlineProjections({
          events: [itemAdded('item-2', 1, { position: BigInt(0) })] as any,
          projections: [counterProjection] as any,
          streamId: 'stream-2',
          database,
        });

        // Clear only stream-1
        await clearProjection(database, 'test-counter', 'stream-1');

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

        expect(state1).toBeNull();
        expect(state2).not.toBeNull(); // Still exists
      });
    });

    describe('clearAllProjections', () => {
      it('clears all projections', async () => {
        const streamId = 'clear-all-test';

        // Create multiple projections
        await handleInlineProjections({
          events: [itemAdded('item-1', 1, { position: BigInt(0) })] as any,
          projections: [
            counterProjection,
            cartProjection,
            confirmationProjection,
          ] as any,
          streamId,
          database,
        });

        await handleInlineProjections({
          events: [orderConfirmed('order-1', { position: BigInt(1) })] as any,
          projections: [confirmationProjection] as any,
          streamId,
          database,
        });

        // Verify they exist
        let counterState = await getProjectionState<PersistedCounterState>(
          database,
          'test-counter',
          streamId,
        );
        let cartState = await getProjectionState<PersistedCartState>(
          database,
          'test-cart',
          streamId,
        );
        expect(counterState).not.toBeNull();
        expect(cartState).not.toBeNull();

        // Clear all
        await clearAllProjections(database);

        // Verify all are gone
        counterState = await getProjectionState<PersistedCounterState>(
          database,
          'test-counter',
          streamId,
        );
        cartState = await getProjectionState<PersistedCartState>(
          database,
          'test-cart',
          streamId,
        );
        const confirmState = await getProjectionState<{
          confirmedAt: string | null;
        }>(database, 'test-confirmation', streamId);

        expect(counterState).toBeNull();
        expect(cartState).toBeNull();
        expect(confirmState).toBeNull();
      });

      it('clears projections across multiple streams', async () => {
        // Create projections in different streams
        await handleInlineProjections({
          events: [itemAdded('item-1', 1, { position: BigInt(0) })] as any,
          projections: [counterProjection] as any,
          streamId: 'stream-1',
          database,
        });

        await handleInlineProjections({
          events: [itemAdded('item-2', 1, { position: BigInt(0) })] as any,
          projections: [counterProjection] as any,
          streamId: 'stream-2',
          database,
        });

        await handleInlineProjections({
          events: [itemAdded('item-3', 1, { position: BigInt(0) })] as any,
          projections: [cartProjection] as any,
          streamId: 'stream-3',
          database,
        });

        await clearAllProjections(database);

        // Verify all are gone
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
        const state3 = await getProjectionState<PersistedCartState>(
          database,
          'test-cart',
          'stream-3',
        );

        expect(state1).toBeNull();
        expect(state2).toBeNull();
        expect(state3).toBeNull();
      });
    });
  });

  describe('State Queries', () => {
    it('queries non-existent projection returns null', async () => {
      const state = await getProjectionState<PersistedCartState>(
        database,
        'non-existent',
        'stream-123',
      );

      expect(state).toBeNull();
    });

    it('queries after delete returns null', async () => {
      const streamId = 'query-after-delete';

      await handleInlineProjections({
        events: [itemAdded('item-1', 1, { position: BigInt(0) })] as any,
        projections: [cartProjection] as any,
        streamId,
        database,
      });

      await clearProjection(database, 'test-cart', streamId);

      const state = await getProjectionState<PersistedCartState>(
        database,
        'test-cart',
        streamId,
      );

      expect(state).toBeNull();
    });

    it('partial updates preserve unaffected fields', async () => {
      const streamId = 'partial-updates';

      // Create cart with items
      await handleInlineProjections({
        events: [
          itemAdded('item-1', 2, { position: BigInt(0), unitPrice: 100 }),
          itemAdded('item-2', 3, { position: BigInt(1), unitPrice: 200 }),
        ] as any,
        projections: [cartProjection] as any,
        streamId,
        database,
      });

      let state = await getProjectionState<PersistedCartState>(
        database,
        'test-cart',
        streamId,
      );
      expect(state?.status).toBe('Open');
      expect(state?.totalQuantity).toBe(5);

      // Confirm order (only changes status)
      await handleInlineProjections({
        events: [orderConfirmed('order-1', { position: BigInt(2) })] as any,
        projections: [cartProjection] as any,
        streamId,
        database,
      });

      state = await getProjectionState<PersistedCartState>(
        database,
        'test-cart',
        streamId,
      );

      // Status changed, but other fields preserved
      expect(state?.status).toBe('Confirmed');
      expect(state?.totalQuantity).toBe(5); // Unchanged
      expect(state?.items).toHaveLength(2); // Unchanged
    });

    it('reads latest state after multiple updates', async () => {
      const streamId = 'multiple-updates';

      // Update 1
      await handleInlineProjections({
        events: [itemAdded('item-1', 1, { position: BigInt(0) })] as any,
        projections: [counterProjection] as any,
        streamId,
        database,
      });

      let state = await getProjectionState<PersistedCounterState>(
        database,
        'test-counter',
        streamId,
      );
      expect(state?.count).toBe(1);

      // Update 2
      await handleInlineProjections({
        events: [itemAdded('item-2', 1, { position: BigInt(1) })] as any,
        projections: [counterProjection] as any,
        streamId,
        database,
      });

      state = await getProjectionState<PersistedCounterState>(
        database,
        'test-counter',
        streamId,
      );
      expect(state?.count).toBe(2);

      // Update 3
      await handleInlineProjections({
        events: [itemRemoved('item-1', { position: BigInt(2) })] as any,
        projections: [counterProjection] as any,
        streamId,
        database,
      });

      state = await getProjectionState<PersistedCounterState>(
        database,
        'test-counter',
        streamId,
      );
      expect(state?.count).toBe(1); // 2 - 1
    });
  });

  describe('Direct Database Operations', () => {
    it('reads projection using raw Firebase reference', async () => {
      const streamId = 'raw-read';
      await handleInlineProjections({
        events: [itemAdded('item-1', 5, { position: BigInt(0) })] as any,
        projections: [counterProjection] as any,
        streamId,
        database,
      });

      // Read using raw reference
      const snapshot = await database
        .ref(`projections/test-counter/${streamId}`)
        .once('value');

      const data = snapshot.val();
      expect(data).not.toBeNull();
      expect(data.count).toBe(1);
      expect(data._metadata).toBeDefined();
    });

    it('verifies projection path structure', async () => {
      const streamId = 'path-structure';
      await handleInlineProjections({
        events: [itemAdded('item-1', 1, { position: BigInt(0) })] as any,
        projections: [counterProjection, cartProjection] as any,
        streamId,
        database,
      });

      // Verify projections node exists
      const projectionsSnapshot = await database
        .ref('projections')
        .once('value');
      expect(projectionsSnapshot.exists()).toBe(true);

      // Verify projection-specific nodes exist
      const counterSnapshot = await database
        .ref('projections/test-counter')
        .once('value');
      const cartSnapshot = await database.ref('projections/test-cart').once('value');

      expect(counterSnapshot.exists()).toBe(true);
      expect(cartSnapshot.exists()).toBe(true);

      // Verify stream-specific nodes exist
      const counterStreamSnapshot = await database
        .ref(`projections/test-counter/${streamId}`)
        .once('value');
      const cartStreamSnapshot = await database
        .ref(`projections/test-cart/${streamId}`)
        .once('value');

      expect(counterStreamSnapshot.exists()).toBe(true);
      expect(cartStreamSnapshot.exists()).toBe(true);
    });
  });
});
