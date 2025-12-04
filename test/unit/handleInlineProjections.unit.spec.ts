import type { Database, Reference } from 'firebase-admin/database';
import { handleInlineProjections } from '../../src/projections/realtimeDBInlineProjection';
import type { RealtimeDBInlineProjectionDefinition } from '../../src/projections/types';
import {
  cartProjection,
  confirmationProjection,
  counterProjection,
} from '../fixtures/projections';
import {
  createEventSequence,
  itemAdded,
  orderConfirmed,
} from '../fixtures/events';

describe('handleInlineProjections', () => {
  let mockDatabase: Database;
  let mockProjectionRef: jest.Mocked<Reference>;
  let mockSnapshot: { val: jest.Mock; exists: jest.Mock };

  beforeEach(() => {
    mockSnapshot = {
      val: jest.fn().mockReturnValue(null),
      exists: jest.fn().mockReturnValue(false),
    };

    mockProjectionRef = {
      set: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
      once: jest.fn().mockResolvedValue(mockSnapshot),
    } as any;

    mockDatabase = {
      ref: jest.fn().mockReturnValue(mockProjectionRef),
    } as any;
  });

  describe('Projection filtering', () => {
    it('processes only projections that can handle event types', async () => {
      const events = [itemAdded('item-1', 1, { position: BigInt(0) })];
      const projections = [counterProjection, confirmationProjection];

      await handleInlineProjections({
        events: events as any,
        projections: projections as any,
        streamId: 'stream-1',
        database: mockDatabase,
      });

      expect(mockProjectionRef.set).toHaveBeenCalledTimes(1);
    });

    it('does not process projections without matching event types', async () => {
      const events = [orderConfirmed('order-1', { position: BigInt(0) })];
      const projections = [counterProjection];

      await handleInlineProjections({
        events: events as any,
        projections: projections as any,
        streamId: 'stream-1',
        database: mockDatabase,
      });

      expect(mockProjectionRef.set).not.toHaveBeenCalled();
    });

    it('processes multiple projections when all match', async () => {
      const events = [itemAdded('item-1', 1, { position: BigInt(0) })];

      const mockRef1 = {
        ...mockProjectionRef,
        set: jest.fn().mockResolvedValue(undefined),
        once: jest.fn().mockResolvedValue(mockSnapshot),
      };
      const mockRef2 = {
        ...mockProjectionRef,
        set: jest.fn().mockResolvedValue(undefined),
        once: jest.fn().mockResolvedValue(mockSnapshot),
      };

      (mockDatabase.ref as jest.Mock)
        .mockReturnValueOnce(mockRef1)
        .mockReturnValueOnce(mockRef2);

      const projections = [counterProjection, cartProjection];

      await handleInlineProjections({
        events: events as any,
        projections: projections as any,
        streamId: 'stream-1',
        database: mockDatabase,
      });

      expect(mockRef1.set).toHaveBeenCalled();
      expect(mockRef2.set).toHaveBeenCalled();
    });

    it('extracts event types correctly', async () => {
      const events = createEventSequence([
        { type: 'add', itemId: 'item-1', quantity: 1 },
        { type: 'remove', itemId: 'item-1' },
        { type: 'confirm', orderId: 'order-1' },
      ]);

      const spyProjection: RealtimeDBInlineProjectionDefinition = {
        name: 'spy',
        canHandle: ['ItemAdded', 'ItemRemoved', 'OrderConfirmed'],
        handle: jest.fn(),
      };

      await handleInlineProjections({
        events: events as any,
        projections: [spyProjection] as any,
        streamId: 'stream-1',
        database: mockDatabase,
      });

      expect(spyProjection.handle).toHaveBeenCalled();
    });
  });

  describe('Projection processing', () => {
    it('reads existing document from Realtime DB', async () => {
      const existingDoc = {
        count: 5,
        _metadata: {
          streamId: 'stream-1',
          name: 'test-counter',
          schemaVersion: 1,
          streamPosition: BigInt(2),
        },
      };

      mockSnapshot.val.mockReturnValue(existingDoc);
      mockSnapshot.exists.mockReturnValue(true);

      const events = [itemAdded('item-1', 1, { position: BigInt(3) })];

      await handleInlineProjections({
        events: events as any,
        projections: [counterProjection] as any,
        streamId: 'stream-1',
        database: mockDatabase,
      });

      expect(mockProjectionRef.once).toHaveBeenCalledWith('value');
      expect(mockProjectionRef.set).toHaveBeenCalledWith(
        expect.objectContaining({ count: 6 }),
      );
    });

    it('passes null document when projection does not exist', async () => {
      mockSnapshot.val.mockReturnValue(null);
      mockSnapshot.exists.mockReturnValue(false);

      const events = [itemAdded('item-1', 1, { position: BigInt(0) })];

      await handleInlineProjections({
        events: events as any,
        projections: [counterProjection] as any,
        streamId: 'stream-1',
        database: mockDatabase,
      });

      expect(mockProjectionRef.set).toHaveBeenCalledWith(
        expect.objectContaining({ count: 1 }),
      );
    });

    it('calls handle for each matching projection', async () => {
      const mockHandle1 = jest.fn();
      const mockHandle2 = jest.fn();

      const projection1: RealtimeDBInlineProjectionDefinition = {
        name: 'proj1',
        canHandle: ['ItemAdded'],
        handle: mockHandle1,
      };

      const projection2: RealtimeDBInlineProjectionDefinition = {
        name: 'proj2',
        canHandle: ['ItemAdded'],
        handle: mockHandle2,
      };

      const mockRef1 = {
        ...mockProjectionRef,
        once: jest.fn().mockResolvedValue(mockSnapshot),
      };
      const mockRef2 = {
        ...mockProjectionRef,
        once: jest.fn().mockResolvedValue(mockSnapshot),
      };

      (mockDatabase.ref as jest.Mock)
        .mockReturnValueOnce(mockRef1)
        .mockReturnValueOnce(mockRef2);

      const events = [itemAdded('item-1', 1, { position: BigInt(0) })];

      await handleInlineProjections({
        events: events as any,
        projections: [projection1, projection2] as any,
        streamId: 'stream-1',
        database: mockDatabase,
      });

      expect(mockHandle1).toHaveBeenCalledWith(events, {
        document: null,
        streamId: 'stream-1',
        database: mockDatabase,
        projectionRef: mockRef1,
      });

      expect(mockHandle2).toHaveBeenCalledWith(events, {
        document: null,
        streamId: 'stream-1',
        database: mockDatabase,
        projectionRef: mockRef2,
      });
    });

    it('passes correct database reference path', async () => {
      const events = [itemAdded('item-1', 1, { position: BigInt(0) })];

      await handleInlineProjections({
        events: events as any,
        projections: [counterProjection] as any,
        streamId: 'my-stream-123',
        database: mockDatabase,
      });

      expect(mockDatabase.ref).toHaveBeenCalledWith(
        'projections/test-counter/my-stream-123',
      );
    });
  });

  describe('Projection ordering and isolation', () => {
    it('processes projections in order', async () => {
      const callOrder: string[] = [];

      const projection1: RealtimeDBInlineProjectionDefinition = {
        name: 'first',
        canHandle: ['ItemAdded'],
        handle: async () => {
          callOrder.push('first');
        },
      };

      const projection2: RealtimeDBInlineProjectionDefinition = {
        name: 'second',
        canHandle: ['ItemAdded'],
        handle: async () => {
          callOrder.push('second');
        },
      };

      const projection3: RealtimeDBInlineProjectionDefinition = {
        name: 'third',
        canHandle: ['ItemAdded'],
        handle: async () => {
          callOrder.push('third');
        },
      };

      const events = [itemAdded('item-1', 1, { position: BigInt(0) })];

      await handleInlineProjections({
        events: events as any,
        projections: [projection1, projection2, projection3] as any,
        streamId: 'stream-1',
        database: mockDatabase,
      });

      expect(callOrder).toEqual(['first', 'second', 'third']);
    });

    it('keeps projections isolated (one does not affect another)', async () => {
      const mockRef1 = {
        ...mockProjectionRef,
        set: jest.fn().mockResolvedValue(undefined),
        once: jest.fn().mockResolvedValue(mockSnapshot),
      };

      const mockRef2 = {
        ...mockProjectionRef,
        set: jest.fn().mockResolvedValue(undefined),
        once: jest.fn().mockResolvedValue(mockSnapshot),
      };

      (mockDatabase.ref as jest.Mock)
        .mockReturnValueOnce(mockRef1)
        .mockReturnValueOnce(mockRef2);

      const events = [itemAdded('item-1', 2, { position: BigInt(0), unitPrice: 100 })];

      await handleInlineProjections({
        events: events as any,
        projections: [counterProjection, cartProjection] as any,
        streamId: 'stream-1',
        database: mockDatabase,
      });

      expect(mockRef1.set).toHaveBeenCalledWith(
        expect.objectContaining({ count: 1 }),
      );

      expect(mockRef2.set).toHaveBeenCalledWith(
        expect.objectContaining({
          items: expect.any(Array),
          totalQuantity: 2,
        }),
      );
    });
  });

  describe('Error handling', () => {
    it('fails fast when projection throws error', async () => {
      const failingProjection: RealtimeDBInlineProjectionDefinition = {
        name: 'failing',
        canHandle: ['ItemAdded'],
        handle: async () => {
          throw new Error('Projection failed');
        },
      };

      const successProjection: RealtimeDBInlineProjectionDefinition = {
        name: 'success',
        canHandle: ['ItemAdded'],
        handle: jest.fn(),
      };

      const events = [itemAdded('item-1', 1, { position: BigInt(0) })];

      await expect(
        handleInlineProjections({
          events: events as any,
          projections: [failingProjection, successProjection] as any,
          streamId: 'stream-1',
          database: mockDatabase,
        }),
      ).rejects.toThrow('Projection failed');

      expect(successProjection.handle).not.toHaveBeenCalled();
    });
  });

  describe('Empty projections and events', () => {
    it('does nothing when projections array is empty', async () => {
      const events = [itemAdded('item-1', 1, { position: BigInt(0) })];

      await handleInlineProjections({
        events: events as any,
        projections: [] as any,
        streamId: 'stream-1',
        database: mockDatabase,
      });

      expect(mockDatabase.ref).not.toHaveBeenCalled();
    });

    it('does nothing when events array is empty', async () => {
      await handleInlineProjections({
        events: [] as any,
        projections: [counterProjection] as any,
        streamId: 'stream-1',
        database: mockDatabase,
      });

      expect(mockDatabase.ref).not.toHaveBeenCalled();
    });
  });
});
