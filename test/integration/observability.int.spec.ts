import type { Database } from 'firebase-admin/database';
import type { EventStore } from '@event-driven-io/emmett';
import { wireRealtimeDBProjections } from '../../src/wireRealtimeDBProjections';
import type { Logger } from '../../src/observability';
import { counterProjection } from '../fixtures/projections';
import { itemAdded } from '../fixtures/events';
import { InMemoryRealtimeDb } from '../support/inMemoryRealtimeDb';

describe('Observability - Integration Tests', () => {
  let database: Database;
  let mockEventStore: jest.Mocked<EventStore>;

  beforeEach(async () => {
    database = new InMemoryRealtimeDb() as unknown as Database;

    mockEventStore = {
      appendToStream: jest.fn().mockResolvedValue({
        streamVersion: BigInt(1),
        nextExpectedStreamVersion: BigInt(2),
        createdNewStream: false,
      }),
      readStream: jest.fn(),
      aggregateStream: jest.fn(),
    } as any;
  });

  describe('Silent by default', () => {
    it('should not produce any logs without logger configured', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const consoleDebugSpy = jest.spyOn(console, 'debug').mockImplementation();
      const consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation();
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      try {
        const wired = wireRealtimeDBProjections({
          eventStore: mockEventStore,
          database,
          projections: [counterProjection],
        });

        const events = [itemAdded('item-1', 1, { position: BigInt(0) })];
        await wired.appendToStream('stream-1', events as any, {});

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

    it('should work normally without observability options', async () => {
      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database,
        projections: [counterProjection],
      });

      const events = [itemAdded('item-1', 1, { position: BigInt(0) })];
      const result = await wired.appendToStream('stream-1', events as any, {});

      expect(result).toBeDefined();
      expect(result.nextExpectedStreamVersion).toBe(BigInt(2));
    });
  });

  describe('With logger configured', () => {
    it('should emit info log on initialization', () => {
      const infoFn = jest.fn();
      const logger: Logger = { info: infoFn };

      wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database,
        projections: [counterProjection],
        observability: { logger },
      });

      expect(infoFn).toHaveBeenCalledWith(
        'Wiring RealtimeDB projections',
        undefined,
      );
    });

    it('should emit debug logs during append operation', async () => {
      const debugFn = jest.fn();
      const logger: Logger = { debug: debugFn };

      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database,
        projections: [counterProjection],
        observability: { logger },
      });

      const events = [itemAdded('item-1', 1, { position: BigInt(0) })];
      await wired.appendToStream('stream-1', events as any, {});

      // Should have logged multiple debug messages
      expect(debugFn.mock.calls.length).toBeGreaterThan(0);

      // Verify specific log messages
      const messages = debugFn.mock.calls.map((call) => call[0]);
      expect(messages).toContain('Appending to stream');
      expect(messages).toContain('Append completed');
      expect(messages).toContain('Handling inline projections');
      expect(messages).toContain('Read document');
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
        database,
        projections: [counterProjection],
        observability: { logger: fullLogger },
      });

      const events = [itemAdded('item-1', 1, { position: BigInt(0) })];
      await wired.appendToStream('stream-1', events as any, {});

      expect(infoFn).toHaveBeenCalled();
      expect(debugFn).toHaveBeenCalled();
      // warn and error should not be called in successful operation
      expect(warnFn).not.toHaveBeenCalled();
      expect(errorFn).not.toHaveBeenCalled();
    });

    it('should work with partial logger implementation', async () => {
      const infoFn = jest.fn();
      const partialLogger: Logger = { info: infoFn };

      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database,
        projections: [counterProjection],
        observability: { logger: partialLogger },
      });

      const events = [itemAdded('item-1', 1, { position: BigInt(0) })];

      // Should not throw even though debug is called internally
      await expect(
        wired.appendToStream('stream-1', events as any, {}),
      ).resolves.toBeDefined();

      expect(infoFn).toHaveBeenCalled();
    });

    it('should emit error log on failure', async () => {
      const errorFn = jest.fn();
      const logger: Logger = { error: errorFn };
      const testError = new Error('Append failed');

      mockEventStore.appendToStream = jest.fn().mockRejectedValue(testError);

      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database,
        projections: [counterProjection],
        observability: { logger },
      });

      const events = [itemAdded('item-1', 1, { position: BigInt(0) })];

      await expect(
        wired.appendToStream('stream-1', events as any, {}),
      ).rejects.toThrow('Append failed');

      expect(errorFn).toHaveBeenCalledWith(
        'Failed to append to stream',
        testError,
      );
    });
  });

  describe('Behavior unchanged', () => {
    it('should produce same results with and without logger', async () => {
      // Without logger
      const wiredWithout = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database,
        projections: [counterProjection],
      });

      const events1 = [itemAdded('item-1', 1, { position: BigInt(0) })];
      const result1 = await wiredWithout.appendToStream('stream-1', events1 as any, {});

      // Reset for second test
      database = new InMemoryRealtimeDb() as unknown as Database;
      mockEventStore.appendToStream = jest.fn().mockResolvedValue({
        streamVersion: BigInt(1),
        nextExpectedStreamVersion: BigInt(2),
        createdNewStream: false,
      });

      // With logger
      const logger: Logger = { debug: jest.fn(), info: jest.fn() };
      const wiredWith = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database,
        projections: [counterProjection],
        observability: { logger },
      });

      const events2 = [itemAdded('item-1', 1, { position: BigInt(0) })];
      const result2 = await wiredWith.appendToStream('stream-2', events2 as any, {});

      // Results should be equivalent
      expect(result1.nextExpectedStreamVersion).toBe(result2.nextExpectedStreamVersion);
    });
  });
});
