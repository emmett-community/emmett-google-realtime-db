import type { Database } from 'firebase-admin/database';
import { realtimeDBInlineProjection } from '../../src/projections/realtimeDBInlineProjection';
import {
  cartProjection,
  counterProjection,
  nullableProjection,
  versionedProjection,
} from '../fixtures/projections';
import { itemAdded, itemRemoved, orderCancelled } from '../fixtures/events';

describe('realtimeDBInlineProjection', () => {
  describe('Projection creation', () => {
    it('creates projection with default name "_default"', () => {
      const projection = realtimeDBInlineProjection({
        canHandle: ['ItemAdded'],
        evolve: (state: { count: number } | null) => state,
      });

      expect(projection.name).toBe('_default');
      expect(projection.canHandle).toEqual(['ItemAdded']);
    });

    it('creates projection with custom name', () => {
      const projection = realtimeDBInlineProjection({
        name: 'my-custom-projection',
        canHandle: ['ItemAdded', 'ItemRemoved'],
        evolve: (state: { count: number } | null) => state,
      });

      expect(projection.name).toBe('my-custom-projection');
      expect(projection.canHandle).toEqual(['ItemAdded', 'ItemRemoved']);
    });

    it('sets canHandle event types correctly', () => {
      expect(cartProjection.canHandle).toEqual([
        'ItemAdded',
        'ItemRemoved',
        'OrderConfirmed',
        'OrderCancelled',
      ]);
    });

    it('uses schema version 1 by default', async () => {
      const mockRef = {
        set: jest.fn(),
        remove: jest.fn(),
      };

      const projection = counterProjection;
      const events = [itemAdded('item-1', 1, { position: BigInt(0) })];

      await projection.handle(events, {
        document: null,
        streamId: 'stream-1',
        database: {} as Database,
        projectionRef: mockRef as any,
      });

      expect(mockRef.set).toHaveBeenCalledWith(
        expect.objectContaining({
          _metadata: expect.objectContaining({
            schemaVersion: 1,
          }),
        }),
      );
    });

    it('uses custom schema version when provided', async () => {
      const mockRef = {
        set: jest.fn(),
        remove: jest.fn(),
      };

      const events = [itemAdded('item-1', 1, { position: BigInt(0) })];

      await versionedProjection.handle(events, {
        document: null,
        streamId: 'stream-1',
        database: {} as Database,
        projectionRef: mockRef as any,
      });

      expect(mockRef.set).toHaveBeenCalledWith(
        expect.objectContaining({
          _metadata: expect.objectContaining({
            schemaVersion: 2,
          }),
        }),
      );
    });
  });

  describe('State evolution', () => {
    it('applies initial state when document is null', async () => {
      const mockRef = {
        set: jest.fn(),
        remove: jest.fn(),
      };

      const events = [itemAdded('item-1', 1, { position: BigInt(0) })];

      await counterProjection.handle(events, {
        document: null,
        streamId: 'stream-1',
        database: {} as Database,
        projectionRef: mockRef as any,
      });

      expect(mockRef.set).toHaveBeenCalledWith({
        count: 1,
        _metadata: {
          streamId: 'stream-1',
          name: 'test-counter',
          schemaVersion: 1,
          streamPosition: '0',
        },
      });
      expect(mockRef.remove).not.toHaveBeenCalled();
    });

    it('does not apply initial state when document exists', async () => {
      const mockRef = {
        set: jest.fn(),
        remove: jest.fn(),
      };

      const existingDocument = {
        count: 5,
        _metadata: {
          streamId: 'stream-1',
          name: 'test-counter',
          schemaVersion: 1,
          streamPosition: BigInt(2),
        },
      };

      const events = [itemAdded('item-1', 1, { position: BigInt(3) })];

      await counterProjection.handle(events, {
        document: existingDocument as any,
        streamId: 'stream-1',
        database: {} as Database,
        projectionRef: mockRef as any,
      });

      expect(mockRef.set).toHaveBeenCalledWith({
        count: 6, // 5 + 1, not starting from initial state (0)
        _metadata: {
          streamId: 'stream-1',
          name: 'test-counter',
          schemaVersion: 1,
          streamPosition: '3',
        },
      });
    });

    it('applies multiple events sequentially', async () => {
      const mockRef = {
        set: jest.fn(),
        remove: jest.fn(),
      };

      const events = [
        itemAdded('item-1', 2, { position: BigInt(0) }),
        itemAdded('item-2', 3, { position: BigInt(1) }),
        itemRemoved('item-1', { position: BigInt(2) }),
      ];

      await counterProjection.handle(events, {
        document: null,
        streamId: 'stream-1',
        database: {} as Database,
        projectionRef: mockRef as any,
      });

      // 0 + 1 (first add) + 1 (second add) - 1 (remove) = 1
      expect(mockRef.set).toHaveBeenCalledWith({
        count: 1,
        _metadata: {
          streamId: 'stream-1',
          name: 'test-counter',
          schemaVersion: 1,
          streamPosition: '2', // Last event position
        },
      });
    });

    it('handles sync evolve function', async () => {
      const mockRef = {
        set: jest.fn(),
        remove: jest.fn(),
      };

      const events = [itemAdded('item-1', 1, { position: BigInt(0) })];

      await counterProjection.handle(events, {
        document: null,
        streamId: 'stream-1',
        database: {} as Database,
        projectionRef: mockRef as any,
      });

      expect(mockRef.set).toHaveBeenCalled();
    });

    it('removes document when evolve returns null', async () => {
      const mockRef = {
        set: jest.fn(),
        remove: jest.fn(),
      };

      const events = [orderCancelled('order-1', { position: BigInt(0) })];

      await cartProjection.handle(events, {
        document: { items: [], totalQuantity: 0, totalAmount: 0, status: 'Open' } as any,
        streamId: 'stream-1',
        database: {} as Database,
        projectionRef: mockRef as any,
      });

      expect(mockRef.remove).toHaveBeenCalled();
      expect(mockRef.set).not.toHaveBeenCalled();
    });

    it('does nothing when events array is empty', async () => {
      const mockRef = {
        set: jest.fn(),
        remove: jest.fn(),
      };

      await counterProjection.handle([], {
        document: null,
        streamId: 'stream-1',
        database: {} as Database,
        projectionRef: mockRef as any,
      });

      expect(mockRef.set).not.toHaveBeenCalled();
      expect(mockRef.remove).not.toHaveBeenCalled();
    });
  });

  describe('Metadata generation', () => {
    it('includes correct streamId in metadata', async () => {
      const mockRef = {
        set: jest.fn(),
        remove: jest.fn(),
      };

      const events = [itemAdded('item-1', 1, { position: BigInt(0) })];

      await counterProjection.handle(events, {
        document: null,
        streamId: 'my-custom-stream-123',
        database: {} as Database,
        projectionRef: mockRef as any,
      });

      expect(mockRef.set).toHaveBeenCalledWith(
        expect.objectContaining({
          _metadata: expect.objectContaining({
            streamId: 'my-custom-stream-123',
          }),
        }),
      );
    });

    it('includes correct projection name in metadata', async () => {
      const mockRef = {
        set: jest.fn(),
        remove: jest.fn(),
      };

      const events = [itemAdded('item-1', 1, { position: BigInt(0) })];

      await cartProjection.handle(events, {
        document: null,
        streamId: 'stream-1',
        database: {} as Database,
        projectionRef: mockRef as any,
      });

      expect(mockRef.set).toHaveBeenCalledWith(
        expect.objectContaining({
          _metadata: expect.objectContaining({
            name: 'test-cart',
          }),
        }),
      );
    });

    it('includes stream position of last event in metadata', async () => {
      const mockRef = {
        set: jest.fn(),
        remove: jest.fn(),
      };

      const events = [
        itemAdded('item-1', 1, { position: BigInt(5) }),
        itemAdded('item-2', 1, { position: BigInt(6) }),
        itemAdded('item-3', 1, { position: BigInt(7) }),
      ];

      await counterProjection.handle(events, {
        document: null,
        streamId: 'stream-1',
        database: {} as Database,
        projectionRef: mockRef as any,
      });

      expect(mockRef.set).toHaveBeenCalledWith(
        expect.objectContaining({
          _metadata: expect.objectContaining({
            streamPosition: '7', // Position of last event
          }),
        }),
      );
    });

    it('includes schema version in metadata', async () => {
      const mockRef = {
        set: jest.fn(),
        remove: jest.fn(),
      };

      const events = [itemAdded('item-1', 1, { position: BigInt(0) })];

      await versionedProjection.handle(events, {
        document: null,
        streamId: 'stream-1',
        database: {} as Database,
        projectionRef: mockRef as any,
      });

      expect(mockRef.set).toHaveBeenCalledWith(
        expect.objectContaining({
          _metadata: expect.objectContaining({
            schemaVersion: 2,
          }),
        }),
      );
    });
  });

  describe('Edge cases', () => {
    it('handles projection without initial state (nullable)', async () => {
      const mockRef = {
        set: jest.fn(),
        remove: jest.fn(),
      };

      const events = [itemAdded('item-1', 1, { position: BigInt(0) })];

      await nullableProjection.handle(events, {
        document: null,
        streamId: 'stream-1',
        database: {} as Database,
        projectionRef: mockRef as any,
      });

      expect(mockRef.set).toHaveBeenCalledWith({
        value: 'created',
        _metadata: expect.objectContaining({
          streamId: 'stream-1',
        }),
      });
    });

    it('handles large stream positions (BigInt)', async () => {
      const mockRef = {
        set: jest.fn(),
        remove: jest.fn(),
      };

      const largePosition = BigInt('9007199254740991'); // MAX_SAFE_INTEGER
      const events = [itemAdded('item-1', 1, { position: largePosition })];

      await counterProjection.handle(events, {
        document: null,
        streamId: 'stream-1',
        database: {} as Database,
        projectionRef: mockRef as any,
      });

      expect(mockRef.set).toHaveBeenCalledWith(
        expect.objectContaining({
          _metadata: expect.objectContaining({
            streamPosition: largePosition.toString(),
          }),
        }),
      );
    });

    it('preserves state when evolve returns same state', async () => {
      const mockRef = {
        set: jest.fn(),
        remove: jest.fn(),
      };

      const noOpProjection = realtimeDBInlineProjection({
        name: 'no-op',
        canHandle: ['ItemAdded'],
        initialState: () => ({ value: 'unchanged' }),
        evolve: (state: { value: string }) => state, // Always returns same state
      });

      const events = [itemAdded('item-1', 1, { position: BigInt(0) })];

      await noOpProjection.handle(events, {
        document: null,
        streamId: 'stream-1',
        database: {} as Database,
        projectionRef: mockRef as any,
      });

      expect(mockRef.set).toHaveBeenCalledWith({
        value: 'unchanged',
        _metadata: expect.any(Object),
      });
    });
  });
});
