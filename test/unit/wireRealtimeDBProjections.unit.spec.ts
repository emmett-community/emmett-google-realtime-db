import type { EventStore } from '@event-driven-io/emmett';
import type { Database } from 'firebase-admin/database';
import { wireRealtimeDBProjections } from '../../src/wireRealtimeDBProjections';
import { counterProjection, cartProjection } from '../fixtures/projections';
import { itemAdded, orderConfirmed } from '../fixtures/events';

describe('wireRealtimeDBProjections', () => {
  let mockEventStore: jest.Mocked<EventStore>;
  let mockDatabase: Database;

  beforeEach(() => {
    mockEventStore = {
      appendToStream: jest.fn().mockResolvedValue({
        nextExpectedStreamVersion: BigInt(0),
        globalPosition: BigInt(100),
      }),
    } as any;

    mockDatabase = {
      ref: jest.fn().mockReturnValue({
        once: jest.fn().mockResolvedValue({ val: () => null }),
        set: jest.fn().mockResolvedValue(undefined),
        remove: jest.fn().mockResolvedValue(undefined),
      }),
    } as any;
  });

  describe('Wrapper behavior', () => {
    it('returns the same EventStore instance', () => {
      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database: mockDatabase,
        projections: [counterProjection],
      });

      expect(wired).toBe(mockEventStore);
    });

    it('intercepts appendToStream', async () => {
      const originalAppend = jest.fn().mockResolvedValue({ nextExpectedStreamVersion: BigInt(0) });
      mockEventStore.appendToStream = originalAppend;

      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database: mockDatabase,
        projections: [counterProjection],
      });

      const events = [itemAdded('item-1', 1, { position: BigInt(0) })];

      await wired.appendToStream('stream-1', events, {});

      // Original append should have been called
      expect(originalAppend).toHaveBeenCalledWith(
        'stream-1',
        events,
        {},
      );
    });

    it('calls original appendToStream first', async () => {
      const callOrder: string[] = [];

      mockEventStore.appendToStream = jest.fn().mockImplementation(async () => {
        callOrder.push('append');
        return { streamVersion: BigInt(1) };
      });

      const testProjection = {
        name: 'test',
        canHandle: ['ItemAdded'],
        handle: async () => {
          callOrder.push('projection');
        },
      };

      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database: mockDatabase,
        projections: [testProjection],
      });

      const events = [{ type: 'ItemAdded', data: { itemId: 'item-1', quantity: 1 } }];

      await wired.appendToStream('stream-1', events, {});

      expect(callOrder).toEqual(['append', 'projection']);
    });

    it('updates projections after append', async () => {
      const mockRef = {
        once: jest.fn().mockResolvedValue({ val: () => null }),
        set: jest.fn().mockResolvedValue(undefined),
        remove: jest.fn().mockResolvedValue(undefined),
      };

      (mockDatabase.ref as jest.Mock).mockReturnValue(mockRef);

      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database: mockDatabase,
        projections: [counterProjection],
      });

      const events = [itemAdded('item-1', 1, { position: BigInt(0) })];

      await wired.appendToStream('stream-1', events, {});

      expect(mockRef.set).toHaveBeenCalled();
    });

    it('passes events correctly to projection handler', async () => {
      const mockHandle = jest.fn();
      const testProjection = {
        name: 'test',
        canHandle: ['ItemAdded'],
        handle: mockHandle,
      };

      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database: mockDatabase,
        projections: [testProjection],
      });

      // Plain Event without metadata (as it comes from appendToStream)
      const events = [
        {
          type: 'ItemAdded',
          data: { itemId: 'item-1', quantity: 1 },
        },
      ];

      await wired.appendToStream('stream-1', events, {});

      // Wire function creates metadata from append result
      expect(mockHandle).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            type: 'ItemAdded',
            data: { itemId: 'item-1', quantity: 1 },
            metadata: expect.objectContaining({
              streamName: 'stream-1',
              streamPosition: BigInt(0),
              messageId: 'stream-1-0',
            }),
          }),
        ],
        expect.objectContaining({
          streamId: 'stream-1',
          database: mockDatabase,
        }),
      );
    });
  });

  describe('Error handling', () => {
    it('does not update projections if append fails', async () => {
      mockEventStore.appendToStream = jest
        .fn()
        .mockRejectedValue(new Error('Append failed'));

      const mockRef = {
        once: jest.fn(),
        set: jest.fn(),
        remove: jest.fn(),
      };

      (mockDatabase.ref as jest.Mock).mockReturnValue(mockRef);

      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database: mockDatabase,
        projections: [counterProjection],
      });

      const events = [{ type: 'ItemAdded', data: { itemId: 'item-1', quantity: 1 } }];

      await expect(wired.appendToStream('stream-1', events, {})).rejects.toThrow(
        'Append failed',
      );

      // Projections should not have been updated
      expect(mockRef.set).not.toHaveBeenCalled();
    });

    it('preserves append result even if projection update fails', async () => {
      const appendSpy = jest.fn().mockResolvedValue({ streamVersion: BigInt(1) });
      mockEventStore.appendToStream = appendSpy;

      const failingProjection = {
        name: 'failing',
        canHandle: ['ItemAdded'],
        handle: async () => {
          throw new Error('Projection failed');
        },
      };

      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database: mockDatabase,
        projections: [failingProjection],
      });

      const events = [itemAdded('item-1', 1, { position: BigInt(0) })];

      // Append succeeds but projection fails
      await expect(wired.appendToStream('stream-1', events, {})).rejects.toThrow(
        'Projection failed',
      );

      // Original append was called
      expect(appendSpy).toHaveBeenCalled();
    });

    it('preserves result from original append', async () => {
      const expectedResult = {
        streamVersion: BigInt(5),
        globalPosition: BigInt(999),
      };

      mockEventStore.appendToStream = jest.fn().mockResolvedValue(expectedResult);

      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database: mockDatabase,
        projections: [counterProjection],
      });

      const events = [itemAdded('item-1', 1, { position: BigInt(0) })];

      const result = await wired.appendToStream('stream-1', events, {});

      expect(result).toEqual(expectedResult);
    });
  });

  describe('Type preservation', () => {
    it('preserves EventStore type through generic parameter', () => {
      type CustomEventStore = EventStore & { customMethod: () => void };

      const customEventStore: CustomEventStore = {
        ...mockEventStore,
        customMethod: () => {},
      } as CustomEventStore;

      const wired = wireRealtimeDBProjections<CustomEventStore>({
        eventStore: customEventStore,
        database: mockDatabase,
        projections: [counterProjection],
      });

      // Type check: should have custom method
      expect(typeof wired.customMethod).toBe('function');
    });

    it('preserves EventStore methods', () => {
      mockEventStore.readStream = jest.fn();
      mockEventStore.aggregateStream = jest.fn();

      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database: mockDatabase,
        projections: [counterProjection],
      });

      expect(wired.readStream).toBeDefined();
      expect(wired.aggregateStream).toBeDefined();
    });
  });

  describe('Multiple projections', () => {
    it('updates all matching projections', async () => {
      const mockRef1 = {
        once: jest.fn().mockResolvedValue({ val: () => null }),
        set: jest.fn().mockResolvedValue(undefined),
        remove: jest.fn().mockResolvedValue(undefined),
      };

      const mockRef2 = {
        once: jest.fn().mockResolvedValue({ val: () => null }),
        set: jest.fn().mockResolvedValue(undefined),
        remove: jest.fn().mockResolvedValue(undefined),
      };

      (mockDatabase.ref as jest.Mock)
        .mockReturnValueOnce(mockRef1)
        .mockReturnValueOnce(mockRef2);

      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database: mockDatabase,
        projections: [counterProjection, cartProjection],
      });

      const events = [itemAdded('item-1', 1, { position: BigInt(0), unitPrice: 100 })];

      await wired.appendToStream('stream-1', events, {});

      expect(mockRef1.set).toHaveBeenCalled();
      expect(mockRef2.set).toHaveBeenCalled();
    });

    it('only updates projections that can handle event types', async () => {
      const mockRef = {
        once: jest.fn().mockResolvedValue({ val: () => null }),
        set: jest.fn().mockResolvedValue(undefined),
        remove: jest.fn().mockResolvedValue(undefined),
      };

      (mockDatabase.ref as jest.Mock).mockReturnValue(mockRef);

      // counterProjection cannot handle OrderConfirmed
      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database: mockDatabase,
        projections: [counterProjection],
      });

      const events = [orderConfirmed('order-1', { position: BigInt(0) })];

      await wired.appendToStream('stream-1', events, {});

      // Should not update projection
      expect(mockRef.set).not.toHaveBeenCalled();
    });
  });

  describe('Stream isolation', () => {
    it('updates projections for correct stream', async () => {
      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database: mockDatabase,
        projections: [counterProjection],
      });

      const events = [itemAdded('item-1', 1, { position: BigInt(0) })];

      await wired.appendToStream('stream-123', events, {});

      expect(mockDatabase.ref).toHaveBeenCalledWith(
        'projections/test-counter/stream-123',
      );
    });
  });
});
