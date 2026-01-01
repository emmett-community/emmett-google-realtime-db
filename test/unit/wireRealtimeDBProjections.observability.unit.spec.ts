import type { EventStore } from '@event-driven-io/emmett';
import type { Database } from 'firebase-admin/database';
import { wireRealtimeDBProjections } from '../../src/wireRealtimeDBProjections';
import type { Logger } from '../../src/observability';
import { counterProjection } from '../fixtures/projections';
import { itemAdded } from '../fixtures/events';

describe('wireRealtimeDBProjections - Observability', () => {
  let mockEventStore: jest.Mocked<EventStore>;
  let mockDatabase: Database;

  beforeEach(() => {
    mockEventStore = {
      appendToStream: jest.fn().mockResolvedValue({
        nextExpectedStreamVersion: BigInt(1),
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

  describe('without observability options', () => {
    it('should work without observability options', async () => {
      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database: mockDatabase,
        projections: [counterProjection],
      });

      const events = [itemAdded('item-1', 1)];
      await expect(wired.appendToStream('stream-1', events, {})).resolves.toBeDefined();
    });

    it('should work with empty observability options', async () => {
      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database: mockDatabase,
        projections: [counterProjection],
        observability: {},
      });

      const events = [itemAdded('item-1', 1)];
      await expect(wired.appendToStream('stream-1', events, {})).resolves.toBeDefined();
    });
  });

  describe('with logger - canonical (context, message) format', () => {
    it('should call logger.info with (context, message) on initialization', () => {
      const infoFn = jest.fn();
      const logger: Logger = {
        debug: jest.fn(),
        info: infoFn,
        warn: jest.fn(),
        error: jest.fn(),
      };

      wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database: mockDatabase,
        projections: [counterProjection],
        observability: { logger },
      });

      expect(infoFn).toHaveBeenCalledTimes(1);
      // Canonical format: (context, message)
      expect(infoFn).toHaveBeenCalledWith({}, 'Wiring RealtimeDB projections');
    });

    it('should call logger.debug with (context, message) on append operations', async () => {
      const debugFn = jest.fn();
      const logger: Logger = {
        debug: debugFn,
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };

      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database: mockDatabase,
        projections: [counterProjection],
        observability: { logger },
      });

      const events = [itemAdded('item-1', 1)];
      await wired.appendToStream('stream-1', events, {});

      // Check for append entry log - (context, message) format
      expect(debugFn).toHaveBeenCalledWith(
        expect.objectContaining({
          streamName: 'stream-1',
          eventCount: 1,
        }),
        'Appending to stream',
      );

      // Check for append completion log - (context, message) format
      expect(debugFn).toHaveBeenCalledWith(
        expect.objectContaining({
          streamName: 'stream-1',
          newVersion: '1',
        }),
        'Append completed',
      );
    });

    it('should call logger.error with (context, message) on failure', async () => {
      const errorFn = jest.fn();
      const logger: Logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: errorFn,
      };
      const testError = new Error('Append failed');

      mockEventStore.appendToStream = jest.fn().mockRejectedValue(testError);

      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database: mockDatabase,
        projections: [counterProjection],
        observability: { logger },
      });

      const events = [itemAdded('item-1', 1)];

      await expect(wired.appendToStream('stream-1', events, {})).rejects.toThrow(
        'Append failed',
      );

      // Canonical format: ({ err: Error }, message)
      expect(errorFn).toHaveBeenCalledWith(
        { err: testError },
        'Failed to append to stream',
      );
    });

    it('should work with full logger implementation', async () => {
      const debugFn = jest.fn();
      const infoFn = jest.fn();
      const warnFn = jest.fn();
      const errorFn = jest.fn();

      const fullLogger: Logger = {
        debug: debugFn,
        info: infoFn,
        warn: warnFn,
        error: errorFn,
      };

      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database: mockDatabase,
        projections: [counterProjection],
        observability: { logger: fullLogger },
      });

      const events = [itemAdded('item-1', 1)];
      await wired.appendToStream('stream-1', events, {});

      expect(infoFn).toHaveBeenCalled();
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
        const wired = wireRealtimeDBProjections({
          eventStore: mockEventStore,
          database: mockDatabase,
          projections: [counterProjection],
        });

        const events = [itemAdded('item-1', 1)];
        await wired.appendToStream('stream-1', events, {});

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
