import type { Database, Reference } from 'firebase-admin/database';
import { handleInlineProjections } from '../../src/projections/realtimeDBInlineProjection';
import type { Logger } from '../../src/observability';
import { counterProjection, confirmationProjection } from '../fixtures/projections';
import { itemAdded } from '../fixtures/events';

describe('handleInlineProjections - Observability', () => {
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

  describe('without observability options', () => {
    it('should work without observability options', async () => {
      const events = [itemAdded('item-1', 1, { position: BigInt(0) })];

      await expect(
        handleInlineProjections({
          events: events as any,
          projections: [counterProjection] as any,
          streamId: 'stream-1',
          database: mockDatabase,
        }),
      ).resolves.toBeUndefined();
    });

    it('should work with empty observability options', async () => {
      const events = [itemAdded('item-1', 1, { position: BigInt(0) })];

      await expect(
        handleInlineProjections({
          events: events as any,
          projections: [counterProjection] as any,
          streamId: 'stream-1',
          database: mockDatabase,
          observability: {},
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('with logger', () => {
    it('should call logger.debug on projection handling entry', async () => {
      const debugFn = jest.fn();
      const logger: Logger = { debug: debugFn };

      const events = [itemAdded('item-1', 1, { position: BigInt(0) })];

      await handleInlineProjections({
        events: events as any,
        projections: [counterProjection] as any,
        streamId: 'stream-1',
        database: mockDatabase,
        observability: { logger },
      });

      expect(debugFn).toHaveBeenCalledWith(
        'Handling inline projections',
        expect.objectContaining({
          streamId: 'stream-1',
          eventCount: 1,
          projectionNames: expect.any(Array),
        }),
      );
    });

    it('should log filtered projections count', async () => {
      const debugFn = jest.fn();
      const logger: Logger = { debug: debugFn };

      const events = [itemAdded('item-1', 1, { position: BigInt(0) })];

      await handleInlineProjections({
        events: events as any,
        projections: [counterProjection, confirmationProjection] as any,
        streamId: 'stream-1',
        database: mockDatabase,
        observability: { logger },
      });

      expect(debugFn).toHaveBeenCalledWith(
        'Filtered projections',
        expect.objectContaining({
          matchingProjectionCount: 1,
        }),
      );
    });

    it('should log when document is read', async () => {
      const debugFn = jest.fn();
      const logger: Logger = { debug: debugFn };

      const events = [itemAdded('item-1', 1, { position: BigInt(0) })];

      await handleInlineProjections({
        events: events as any,
        projections: [counterProjection] as any,
        streamId: 'stream-1',
        database: mockDatabase,
        observability: { logger },
      });

      expect(debugFn).toHaveBeenCalledWith(
        'Read document',
        expect.objectContaining({
          projectionName: expect.any(String),
          documentFound: false,
        }),
      );
    });

    it('should log when document is found', async () => {
      const debugFn = jest.fn();
      const logger: Logger = { debug: debugFn };

      mockSnapshot.val.mockReturnValue({ count: 5 });

      const events = [itemAdded('item-1', 1, { position: BigInt(0) })];

      await handleInlineProjections({
        events: events as any,
        projections: [counterProjection] as any,
        streamId: 'stream-1',
        database: mockDatabase,
        observability: { logger },
      });

      expect(debugFn).toHaveBeenCalledWith(
        'Read document',
        expect.objectContaining({
          documentFound: true,
        }),
      );
    });

    it('should log completion', async () => {
      const debugFn = jest.fn();
      const logger: Logger = { debug: debugFn };

      const events = [itemAdded('item-1', 1, { position: BigInt(0) })];

      await handleInlineProjections({
        events: events as any,
        projections: [counterProjection] as any,
        streamId: 'stream-1',
        database: mockDatabase,
        observability: { logger },
      });

      expect(debugFn).toHaveBeenCalledWith(
        'Projections handling completed',
        expect.objectContaining({
          streamId: 'stream-1',
          projectionsProcessed: 1,
        }),
      );
    });

    it('should log error on failure', async () => {
      const errorFn = jest.fn();
      const logger: Logger = { error: errorFn };
      const testError = new Error('Database error');

      mockProjectionRef.once.mockRejectedValue(testError);

      const events = [itemAdded('item-1', 1, { position: BigInt(0) })];

      await expect(
        handleInlineProjections({
          events: events as any,
          projections: [counterProjection] as any,
          streamId: 'stream-1',
          database: mockDatabase,
          observability: { logger },
        }),
      ).rejects.toThrow('Database error');

      expect(errorFn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to handle'),
        testError,
      );
    });

    it('should work with partial logger', async () => {
      const debugFn = jest.fn();
      const logger: Logger = { debug: debugFn };

      const events = [itemAdded('item-1', 1, { position: BigInt(0) })];

      await expect(
        handleInlineProjections({
          events: events as any,
          projections: [counterProjection] as any,
          streamId: 'stream-1',
          database: mockDatabase,
          observability: { logger },
        }),
      ).resolves.toBeUndefined();

      expect(debugFn).toHaveBeenCalled();
    });
  });

  describe('no console output', () => {
    it('should not produce console output without logger', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const consoleDebugSpy = jest.spyOn(console, 'debug').mockImplementation();
      const consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation();
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      try {
        const events = [itemAdded('item-1', 1, { position: BigInt(0) })];

        await handleInlineProjections({
          events: events as any,
          projections: [counterProjection] as any,
          streamId: 'stream-1',
          database: mockDatabase,
        });

        expect(consoleSpy).not.toHaveBeenCalled();
        expect(consoleDebugSpy).not.toHaveBeenCalled();
        expect(consoleInfoSpy).not.toHaveBeenCalled();
        expect(consoleWarnSpy).not.toHaveBeenCalled();
        expect(consoleErrorSpy).not.toHaveBeenCalled();
      } finally {
        consoleSpy.mockRestore();
        consoleDebugSpy.mockRestore();
        consoleInfoSpy.mockRestore();
        consoleWarnSpy.mockRestore();
        consoleErrorSpy.mockRestore();
      }
    });
  });
});
