import type { Event, ReadEvent } from '@event-driven-io/emmett';
import type { RealtimeDBReadEventMetadata } from '../../src/projections/types';

// Test event types
export type TestEvent =
  | ItemAddedEvent
  | ItemRemovedEvent
  | OrderConfirmedEvent
  | OrderCancelledEvent;

export type ItemAddedEvent = {
  type: 'ItemAdded';
  data: {
    itemId: string;
    quantity: number;
    unitPrice?: number;
  };
};

export type ItemRemovedEvent = {
  type: 'ItemRemoved';
  data: {
    itemId: string;
    quantity?: number;
  };
};

export type OrderConfirmedEvent = {
  type: 'OrderConfirmed';
  data: {
    orderId: string;
    confirmedAt?: Date;
  };
};

export type OrderCancelledEvent = {
  type: 'OrderCancelled';
  data: {
    orderId: string;
    reason?: string;
  };
};

// Generic ReadEvent factory - returns Event type for compatibility
export const createReadEvent = <T extends Event>(
  event: T,
  streamPosition: bigint = BigInt(0),
  streamName: string = 'test-stream',
): ReadEvent<Event, RealtimeDBReadEventMetadata> => ({
  ...event,
  metadata: {
    streamName,
    streamPosition,
    messageId: `msg-${streamPosition}`,
  },
} as ReadEvent<Event, RealtimeDBReadEventMetadata>);

// Specific event factories - all return generic Event type
export const itemAdded = (
  itemId: string,
  quantity: number,
  options: {
    position?: bigint;
    streamName?: string;
    unitPrice?: number;
  } = {},
): ReadEvent<Event, RealtimeDBReadEventMetadata> =>
  createReadEvent(
    {
      type: 'ItemAdded',
      data: {
        itemId,
        quantity,
        ...(options.unitPrice !== undefined && { unitPrice: options.unitPrice }),
      },
    } as ItemAddedEvent,
    options.position ?? BigInt(0),
    options.streamName ?? 'test-stream',
  );

export const itemRemoved = (
  itemId: string,
  options: {
    position?: bigint;
    streamName?: string;
    quantity?: number;
  } = {},
): ReadEvent<Event, RealtimeDBReadEventMetadata> =>
  createReadEvent(
    {
      type: 'ItemRemoved',
      data: {
        itemId,
        ...(options.quantity !== undefined && { quantity: options.quantity }),
      },
    } as ItemRemovedEvent,
    options.position ?? BigInt(0),
    options.streamName ?? 'test-stream',
  );

export const orderConfirmed = (
  orderId: string,
  options: {
    position?: bigint;
    streamName?: string;
    confirmedAt?: Date;
  } = {},
): ReadEvent<Event, RealtimeDBReadEventMetadata> =>
  createReadEvent(
    {
      type: 'OrderConfirmed',
      data: {
        orderId,
        ...(options.confirmedAt && { confirmedAt: options.confirmedAt }),
      },
    } as OrderConfirmedEvent,
    options.position ?? BigInt(0),
    options.streamName ?? 'test-stream',
  );

export const orderCancelled = (
  orderId: string,
  options: {
    position?: bigint;
    streamName?: string;
    reason?: string;
  } = {},
): ReadEvent<Event, RealtimeDBReadEventMetadata> =>
  createReadEvent(
    {
      type: 'OrderCancelled',
      data: {
        orderId,
        ...(options.reason && { reason: options.reason }),
      },
    } as OrderCancelledEvent,
    options.position ?? BigInt(0),
    options.streamName ?? 'test-stream',
  );

// Helper to create a sequence of events
export const createEventSequence = (
  events: Array<{
    type: 'add' | 'remove' | 'confirm' | 'cancel';
    itemId?: string;
    orderId?: string;
    quantity?: number;
    reason?: string;
  }>,
  streamName: string = 'test-stream',
): ReadEvent<Event, RealtimeDBReadEventMetadata>[] => {
  return events.map((event, index) => {
    const position = BigInt(index);
    switch (event.type) {
      case 'add':
        return itemAdded(event.itemId!, event.quantity ?? 1, {
          position,
          streamName,
        });
      case 'remove':
        return itemRemoved(event.itemId!, { position, streamName });
      case 'confirm':
        return orderConfirmed(event.orderId!, { position, streamName });
      case 'cancel':
        return orderCancelled(event.orderId!, {
          position,
          streamName,
          reason: event.reason,
        });
      default:
        throw new Error(`Unknown event type: ${event.type}`);
    }
  });
};
