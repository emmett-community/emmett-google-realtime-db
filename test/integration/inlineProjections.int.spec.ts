import * as admin from 'firebase-admin';
import type { Database } from 'firebase-admin/database';
import type { Event } from '@event-driven-io/emmett';
import {
  handleInlineProjections,
  realtimeDBInlineProjection,
} from '../../src/projections/realtimeDBInlineProjection';
import type { RealtimeDBReadEventMetadata } from '../../src/projections/types';
import {
  getProjectionState,
  clearProjection,
  clearAllProjections,
} from '../../src/projections/realtimeDBInlineProjectionSpec';
import {
  cartProjection,
  counterProjection,
  confirmationProjection,
  nullableProjection,
  versionedProjection,
  type CounterState,
  type PersistedCartState,
  type PersistedCounterState,
  type PersistedVersionedState,
} from '../fixtures/projections';
import {
  itemAdded,
  itemRemoved,
  orderConfirmed,
  orderCancelled,
  createEventSequence,
} from '../fixtures/events';

describe('Inline Projections Integration', () => {
  let database: Database;
  let app: admin.app.App;

  beforeAll(() => {
    // Initialize Firebase with emulator
    app = admin.initializeApp(
      {
        projectId: process.env.FIRESTORE_PROJECT_ID || 'test-project',
        databaseURL: `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST || 'localhost:9000'}?ns=test-project`,
      },
      `test-inline-projections-${Date.now()}`,
    );
    database = admin.database(app);
  });

  afterAll(async () => {
    await app.delete();
  });

  beforeEach(async () => {
    // Clear all data before each test
    await database.ref().remove();
  });

  describe('Basic Persistence', () => {
    it('creates projection in Realtime DB at correct path', async () => {
      const streamId = 'cart-123';
      const events = [itemAdded('item-1', 2, { position: BigInt(0) })];

      await handleInlineProjections({
        events: events as any,
        projections: [cartProjection] as any,
        streamId,
        database,
      });

      // Verify projection exists at correct path
      const snapshot = await database
        .ref(`projections/test-cart/${streamId}`)
        .once('value');

      expect(snapshot.exists()).toBe(true);
      const data = snapshot.val();
      expect(data).toHaveProperty('items');
      expect(data).toHaveProperty('_metadata');
    });

    it('updates existing projection correctly', async () => {
      const streamId = 'cart-456';

      // First append
      await handleInlineProjections({
        events: [itemAdded('item-1', 2, { position: BigInt(0) })] as any,
        projections: [cartProjection] as any,
        streamId,
        database,
      });

      const firstState = await getProjectionState<PersistedCartState>(
        database,
        'test-cart',
        streamId,
      );
      expect(firstState?.totalQuantity).toBe(2);
      expect(firstState?._metadata.streamPosition).toBe(BigInt(0));

      // Second append
      await handleInlineProjections({
        events: [itemAdded('item-2', 3, { position: BigInt(1) })] as any,
        projections: [cartProjection] as any,
        streamId,
        database,
      });

      const secondState = await getProjectionState<PersistedCartState>(
        database,
        'test-cart',
        streamId,
      );
      expect(secondState?.items).toHaveLength(2);
      expect(secondState?.totalQuantity).toBe(5); // 2 + 3
      expect(secondState?._metadata.streamPosition).toBe(BigInt(1));
    });

    it('deletes projection when evolve returns null', async () => {
      const streamId = 'cart-789';

      // Create projection first
      await handleInlineProjections({
        events: [itemAdded('item-1', 1, { position: BigInt(0) })] as any,
        projections: [cartProjection] as any,
        streamId,
        database,
      });

      const stateBeforeDelete = await getProjectionState<PersistedCartState>(
        database,
        'test-cart',
        streamId,
      );
      expect(stateBeforeDelete).not.toBeNull();

      // Cancel order (triggers deletion)
      await handleInlineProjections({
        events: [orderCancelled('order-1', { position: BigInt(1) })] as any,
        projections: [cartProjection] as any,
        streamId,
        database,
      });

      const stateAfterDelete = await getProjectionState<PersistedCartState>(
        database,
        'test-cart',
        streamId,
      );
      expect(stateAfterDelete).toBeNull();
    });

    it('persists metadata correctly', async () => {
      const streamId = 'stream-with-metadata';
      const events = [itemAdded('item-1', 5, { position: BigInt(42) })];

      await handleInlineProjections({
        events: events as any,
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
        streamId: 'stream-with-metadata',
        name: 'test-counter',
        schemaVersion: 1,
        streamPosition: BigInt(42),
      });
    });
  });

  describe('Multiple Events', () => {
    it('applies multiple events sequentially', async () => {
      const streamId = 'cart-multi';
      const events = [
        itemAdded('item-1', 2, { position: BigInt(0), unitPrice: 100 }),
        itemAdded('item-2', 3, { position: BigInt(1), unitPrice: 200 }),
        itemRemoved('item-1', { position: BigInt(2), quantity: 1 }),
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

      expect(state?.items).toHaveLength(2);
      expect(state?.items[0]).toEqual({
        itemId: 'item-1',
        quantity: 1, // 2 - 1
        unitPrice: 100,
      });
      expect(state?.items[1]).toEqual({
        itemId: 'item-2',
        quantity: 3,
        unitPrice: 200,
      });
      expect(state?.totalQuantity).toBe(4); // (2-1) + 3
      expect(state?.totalAmount).toBe(700); // (2*100 - 1*100) + (3*200)
    });

    it('updates stream position to last event', async () => {
      const streamId = 'stream-positions';
      const events = [
        itemAdded('item-1', 1, { position: BigInt(5) }),
        itemAdded('item-2', 1, { position: BigInt(6) }),
        itemAdded('item-3', 1, { position: BigInt(7) }),
      ];

      await handleInlineProjections({
        events: events as any,
        projections: [counterProjection] as any,
        streamId,
        database,
      });

      const state = await getProjectionState<PersistedCounterState>(
        database,
        'test-counter',
        streamId,
      );

      expect(state?._metadata.streamPosition).toBe(BigInt(7));
      expect(state?.count).toBe(3);
    });

    it('accumulates state changes across events', async () => {
      const streamId = 'accumulation-test';
      const events = createEventSequence([
        { type: 'add', itemId: 'A', quantity: 1 },
        { type: 'add', itemId: 'B', quantity: 2 },
        { type: 'add', itemId: 'A', quantity: 3 }, // Should update existing
        { type: 'remove', itemId: 'B', quantity: 1 },
      ]);

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

      expect(state?.items).toHaveLength(2);
      const itemA = state?.items.find((i) => i.itemId === 'A');
      const itemB = state?.items.find((i) => i.itemId === 'B');

      expect(itemA?.quantity).toBe(4); // 1 + 3
      expect(itemB?.quantity).toBe(1); // 2 - 1
      expect(state?.totalQuantity).toBe(5); // 4 + 1
    });
  });

  describe('Multiple Projections', () => {
    it('updates two projections independently for same stream', async () => {
      const streamId = 'shared-stream';
      const events = [itemAdded('item-1', 5, { position: BigInt(0) })];

      await handleInlineProjections({
        events: events as any,
        projections: [counterProjection, cartProjection] as any,
        streamId,
        database,
      });

      // Check counter projection
      const counterState = await getProjectionState<PersistedCounterState>(
        database,
        'test-counter',
        streamId,
      );
      expect(counterState?.count).toBe(1);

      // Check cart projection
      const cartState = await getProjectionState<PersistedCartState>(
        database,
        'test-cart',
        streamId,
      );
      expect(cartState?.totalQuantity).toBe(5);
    });

    it('stores projections in different paths', async () => {
      const streamId = 'path-test';
      const events = [orderConfirmed('order-1', { position: BigInt(0) })];

      await handleInlineProjections({
        events: events as any,
        projections: [cartProjection, confirmationProjection] as any,
        streamId,
        database,
      });

      // Verify paths exist independently
      const cartSnapshot = await database
        .ref(`projections/test-cart/${streamId}`)
        .once('value');
      const confirmSnapshot = await database
        .ref(`projections/test-confirmation/${streamId}`)
        .once('value');

      expect(cartSnapshot.exists()).toBe(true);
      expect(confirmSnapshot.exists()).toBe(true);

      const cartData = cartSnapshot.val();
      const confirmData = confirmSnapshot.val();

      expect(cartData.status).toBe('Confirmed');
      expect(confirmData.confirmedAt).toBeTruthy();
    });

    it('deleting one projection does not affect another', async () => {
      const streamId = 'delete-isolation';

      // Create both projections
      await handleInlineProjections({
        events: [itemAdded('item-1', 1, { position: BigInt(0) })] as any,
        projections: [cartProjection, counterProjection] as any,
        streamId,
        database,
      });

      // Delete cart projection (via OrderCancelled)
      await handleInlineProjections({
        events: [orderCancelled('order-1', { position: BigInt(1) })] as any,
        projections: [cartProjection, counterProjection] as any,
        streamId,
        database,
      });

      const cartState = await getProjectionState<PersistedCartState>(
        database,
        'test-cart',
        streamId,
      );
      const counterState = await getProjectionState<PersistedCounterState>(
        database,
        'test-counter',
        streamId,
      );

      expect(cartState).toBeNull(); // Deleted
      expect(counterState).not.toBeNull(); // Still exists
      expect(counterState?.count).toBe(1); // Unchanged
    });
  });

  describe('Edge Cases', () => {
    it('handles stream ID with special characters', async () => {
      const streamId = 'cart:user@123_test-session';
      const events = [itemAdded('item-1', 1, { position: BigInt(0) })];

      await handleInlineProjections({
        events: events as any,
        projections: [counterProjection] as any,
        streamId,
        database,
      });

      const state = await getProjectionState<PersistedCounterState>(
        database,
        'test-counter',
        streamId,
      );

      expect(state).not.toBeNull();
      expect(state?._metadata.streamId).toBe(streamId);
    });

    it('handles projection name with special characters', async () => {
      // Create a new projection with special characters in name
      const customProjection = realtimeDBInlineProjection<
        CounterState,
        Event,
        RealtimeDBReadEventMetadata
      >({
        name: 'test-counter:v2_beta',
        canHandle: ['ItemAdded'],
        initialState: () => ({ count: 0 }),
        evolve: (state: CounterState, event: Event) => {
          if (event.type === 'ItemAdded') {
            return { count: state.count + 1 };
          }
          return state;
        },
      });

      const streamId = 'stream-1';
      const events = [itemAdded('item-1', 1, { position: BigInt(0) })];

      await handleInlineProjections({
        events: events as any,
        projections: [customProjection] as any,
        streamId,
        database,
      });

      const state = await getProjectionState<PersistedCounterState>(
        database,
        'test-counter:v2_beta',
        streamId,
      );

      expect(state).not.toBeNull();
      expect(state?._metadata.name).toBe('test-counter:v2_beta');
    });

    it('handles large payloads', async () => {
      const streamId = 'large-cart';
      const events = Array.from({ length: 50 }, (_, i) =>
        itemAdded(`item-${i}`, 1, { position: BigInt(i) }),
      );

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

      expect(state?.items).toHaveLength(50);
      expect(state?.totalQuantity).toBe(50);
    });

    it('handles BigInt in metadata correctly', async () => {
      const streamId = 'bigint-test';
      const largePosition = BigInt('9007199254740991'); // MAX_SAFE_INTEGER
      const events = [itemAdded('item-1', 1, { position: largePosition })];

      await handleInlineProjections({
        events: events as any,
        projections: [counterProjection] as any,
        streamId,
        database,
      });

      const state = await getProjectionState<PersistedCounterState>(
        database,
        'test-counter',
        streamId,
      );

      // BigInt should be preserved (serialized as string in JSON)
      expect(state?._metadata.streamPosition).toBe(largePosition);
    });

    it('handles nullable projection (no initial state)', async () => {
      const streamId = 'nullable-test';

      // First event creates document
      await handleInlineProjections({
        events: [itemAdded('item-1', 1, { position: BigInt(0) })] as any,
        projections: [nullableProjection] as any,
        streamId,
        database,
      });

      const stateAfterCreate = await getProjectionState<{ value: string }>(
        database,
        'test-nullable',
        streamId,
      );
      expect(stateAfterCreate?.value).toBe('created');

      // Second event deletes document
      await handleInlineProjections({
        events: [itemRemoved('item-1', { position: BigInt(1) })] as any,
        projections: [nullableProjection] as any,
        streamId,
        database,
      });

      const stateAfterDelete = await getProjectionState<{ value: string }>(
        database,
        'test-nullable',
        streamId,
      );
      expect(stateAfterDelete).toBeNull();
    });

    // Note: Async evolve functions are not supported with Firebase transactions
    // which are required for concurrency safety. Only synchronous evolve functions
    // should be used with this library.

    it('handles custom schema version', async () => {
      const streamId = 'versioned-test';
      const events = [itemAdded('item-1', 1, { position: BigInt(0) })];

      await handleInlineProjections({
        events: events as any,
        projections: [versionedProjection] as any,
        streamId,
        database,
      });

      const state = await getProjectionState<PersistedVersionedState>(
        database,
        'test-versioned',
        streamId,
      );

      expect(state?._metadata.schemaVersion).toBe(2);
      expect(state?.data).toBe('v2');
    });
  });

  describe('Query and Read', () => {
    it('reads projection using getProjectionState utility', async () => {
      const streamId = 'read-test';
      const events = [itemAdded('item-1', 10, { position: BigInt(0) })];

      await handleInlineProjections({
        events: events as any,
        projections: [counterProjection] as any,
        streamId,
        database,
      });

      const state = await getProjectionState<PersistedCounterState>(
        database,
        'test-counter',
        streamId,
      );

      expect(state).not.toBeNull();
      expect(state?.count).toBe(1);
      expect(state?._metadata).toBeDefined();
    });

    it('returns null for non-existent projection', async () => {
      const state = await getProjectionState<PersistedCartState>(
        database,
        'test-cart',
        'non-existent-stream',
      );

      expect(state).toBeNull();
    });

    it('includes metadata in read result', async () => {
      const streamId = 'metadata-read';
      const events = [itemAdded('item-1', 1, { position: BigInt(99) })];

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

      expect(state?._metadata).toEqual({
        streamId: 'metadata-read',
        name: 'test-cart',
        schemaVersion: 1,
        streamPosition: BigInt(99),
      });
    });
  });

  describe('Cleanup Utilities', () => {
    it('clears specific projection using clearProjection', async () => {
      const streamId = 'clear-test';
      const events = [itemAdded('item-1', 1, { position: BigInt(0) })];

      // Create projection
      await handleInlineProjections({
        events: events as any,
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

      // Clear it
      await clearProjection(database, 'test-counter', streamId);

      state = await getProjectionState<PersistedCounterState>(
        database,
        'test-counter',
        streamId,
      );
      expect(state).toBeNull();
    });

    it('clears all projections using clearAllProjections', async () => {
      const streamId = 'clear-all-test';
      const events = [itemAdded('item-1', 1, { position: BigInt(0) })];

      // Create multiple projections
      await handleInlineProjections({
        events: events as any,
        projections: [counterProjection, cartProjection] as any,
        streamId,
        database,
      });

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
      expect(counterState).toBeNull();
      expect(cartState).toBeNull();
    });
  });
});
