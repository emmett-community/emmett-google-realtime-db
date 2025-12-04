import type { Event, ReadEvent } from '@event-driven-io/emmett';
import { realtimeDBInlineProjection } from '../../src/projections/realtimeDBInlineProjection';
import type { RealtimeDBReadEventMetadata, RealtimeDBReadModelMetadata } from '../../src/projections/types';

// Cart state type for testing (without metadata)
export type CartState = {
  items: Array<{ itemId: string; quantity: number; unitPrice?: number }>;
  totalQuantity: number;
  totalAmount: number;
  status: 'Open' | 'Confirmed' | 'Cancelled';
};

// Simple counter state for basic tests (without metadata)
export type CounterState = {
  count: number;
};

// Helper types for persisted states (with metadata)
export type PersistedCartState = CartState & {
  _metadata: RealtimeDBReadModelMetadata;
};

export type PersistedCounterState = CounterState & {
  _metadata: RealtimeDBReadModelMetadata;
};

export type PersistedVersionedState = { data: string } & {
  _metadata: RealtimeDBReadModelMetadata;
};

// Cart projection with full state management
export const cartProjection = realtimeDBInlineProjection<
  CartState,
  Event,
  RealtimeDBReadEventMetadata
>({
  name: 'test-cart',
  canHandle: ['ItemAdded', 'ItemRemoved', 'OrderConfirmed', 'OrderCancelled'],
  initialState: () => ({
    items: [],
    totalQuantity: 0,
    totalAmount: 0,
    status: 'Open',
  }),
  evolve: (
    state: CartState,
    event: ReadEvent<Event, RealtimeDBReadEventMetadata>,
  ): CartState | null => {
    switch (event.type) {
      case 'ItemAdded': {
        const { itemId, quantity, unitPrice = 0 } = event.data as any;
        const existingItem = state.items.find((i) => i.itemId === itemId);

        const updatedItems = existingItem
          ? state.items.map((i) =>
              i.itemId === itemId
                ? { ...i, quantity: i.quantity + quantity }
                : i,
            )
          : [...state.items, { itemId, quantity, unitPrice }];

        return {
          ...state,
          items: updatedItems,
          totalQuantity: state.totalQuantity + quantity,
          totalAmount: state.totalAmount + quantity * unitPrice,
        };
      }

      case 'ItemRemoved': {
        const { itemId, quantity = 1 } = event.data as any;
        const existingItem = state.items.find((i) => i.itemId === itemId);

        if (!existingItem) return state;

        const newQuantity = existingItem.quantity - quantity;
        const updatedItems =
          newQuantity <= 0
            ? state.items.filter((i) => i.itemId !== itemId)
            : state.items.map((i) =>
                i.itemId === itemId ? { ...i, quantity: newQuantity } : i,
              );

        return {
          ...state,
          items: updatedItems,
          totalQuantity: state.totalQuantity - quantity,
          totalAmount:
            state.totalAmount - quantity * (existingItem.unitPrice ?? 0),
        };
      }

      case 'OrderConfirmed':
        return {
          ...state,
          status: 'Confirmed',
        };

      case 'OrderCancelled':
        // Return null to delete projection
        return null;

      default:
        return state;
    }
  },
});

// Simple counter projection for basic tests
export const counterProjection = realtimeDBInlineProjection<
  CounterState,
  Event,
  RealtimeDBReadEventMetadata
>({
  name: 'test-counter',
  canHandle: ['ItemAdded', 'ItemRemoved'],
  initialState: () => ({ count: 0 }),
  evolve: (
    state: CounterState,
    event: ReadEvent<Event, RealtimeDBReadEventMetadata>,
  ): CounterState => {
    switch (event.type) {
      case 'ItemAdded':
        return { count: state.count + 1 };
      case 'ItemRemoved':
        return { count: state.count - 1 };
      default:
        return state;
    }
  },
});

// Projection that only handles specific events
export const confirmationProjection = realtimeDBInlineProjection<
  { confirmedAt: string | null; cancelledAt: string | null },
  Event,
  RealtimeDBReadEventMetadata
>({
  name: 'test-confirmation',
  canHandle: ['OrderConfirmed', 'OrderCancelled'],
  initialState: () => ({ confirmedAt: null, cancelledAt: null }),
  evolve: (
    state: { confirmedAt: string | null; cancelledAt: string | null },
    event: ReadEvent<Event, RealtimeDBReadEventMetadata>,
  ) => {
    switch (event.type) {
      case 'OrderConfirmed':
        return { ...state, confirmedAt: new Date().toISOString() };
      case 'OrderCancelled':
        return { ...state, cancelledAt: new Date().toISOString() };
      default:
        return state;
    }
  },
});

// Projection without initial state (nullable document)
export const nullableProjection = realtimeDBInlineProjection<
  { value: string },
  Event,
  RealtimeDBReadEventMetadata
>({
  name: 'test-nullable',
  canHandle: ['ItemAdded', 'ItemRemoved'],
  evolve: (
    state: { value: string } | null,
    event: ReadEvent<Event, RealtimeDBReadEventMetadata>,
  ): { value: string } | null => {
    if (event.type === 'ItemAdded' && state === null) {
      return { value: 'created' };
    }
    if (event.type === 'ItemRemoved' && state !== null) {
      return null; // Delete
    }
    return state;
  },
});

// Projection with custom schema version
export const versionedProjection = realtimeDBInlineProjection<
  { data: string },
  Event,
  RealtimeDBReadEventMetadata
>({
  name: 'test-versioned',
  schemaVersion: 2,
  canHandle: ['ItemAdded'],
  initialState: () => ({ data: 'v2' }),
  evolve: (
    state: { data: string },
    _event: ReadEvent<Event, RealtimeDBReadEventMetadata>,
  ): { data: string } => {
    return state;
  },
});
