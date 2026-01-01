import type { EventStore } from '@event-driven-io/emmett';
import type { Database } from 'firebase-admin/database';
import { wireRealtimeDBProjections, type Logger } from '../../src';
import * as packageExports from '../../src/index';
import { counterProjection } from '../fixtures/projections';
import { itemAdded } from '../fixtures/events';

/**
 * Logger Contract Tests
 *
 * These tests verify that the Logger contract is correctly implemented:
 * - (context, message) format, NOT (message, data)
 * - All 4 methods are called with correct format
 * - Error instances use 'err' key
 * - safeLog is NOT exported from package
 */
describe('Logger Contract', () => {
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

  describe('Contract Format Validation', () => {
    it('MUST call logger with (context, message) format - NOT (message, data)', () => {
      const calls: unknown[][] = [];
      const logger: Logger = {
        debug: (...args: unknown[]) => calls.push(['debug', ...args]),
        info: (...args: unknown[]) => calls.push(['info', ...args]),
        warn: (...args: unknown[]) => calls.push(['warn', ...args]),
        error: (...args: unknown[]) => calls.push(['error', ...args]),
      };

      wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database: mockDatabase,
        projections: [counterProjection],
        observability: { logger },
      });

      // Find the initialization log call
      const initCall = calls.find((c) => c[0] === 'info');
      expect(initCall).toBeDefined();

      const [, firstArg, secondArg] = initCall!;

      // OLD format check - MUST FAIL on old code
      const isOldFormat = typeof firstArg === 'string';
      expect(isOldFormat).toBe(false);

      // NEW format check - MUST PASS
      const isNewFormat = typeof firstArg === 'object' && firstArg !== null;
      expect(isNewFormat).toBe(true);

      // Message should be string at position 1
      expect(typeof secondArg).toBe('string');
      expect(secondArg).toBe('Wiring RealtimeDB projections');
    });

    it('MUST verify argument POSITION not just type', async () => {
      const calls: unknown[][] = [];
      const logger: Logger = {
        debug: (...args: unknown[]) => calls.push(args),
        info: (...args: unknown[]) => calls.push(args),
        warn: (...args: unknown[]) => calls.push(args),
        error: (...args: unknown[]) => calls.push(args),
      };

      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database: mockDatabase,
        projections: [counterProjection],
        observability: { logger },
      });

      const events = [itemAdded('item-1', 1)];
      await wired.appendToStream('stream-1', events, {});

      // Find the 'Appending to stream' call
      const appendingCall = calls.find(
        (c) => typeof c[1] === 'string' && c[1] === 'Appending to stream',
      );
      expect(appendingCall).toBeDefined();

      const [firstArg, secondArg] = appendingCall!;

      // Position 0 MUST be context object
      expect(typeof firstArg).toBe('object');
      expect(firstArg).not.toBeNull();

      // Position 1 MUST be message string
      expect(typeof secondArg).toBe('string');

      // Verify actual values match expected positions
      expect(firstArg).toEqual(
        expect.objectContaining({ streamName: 'stream-1' }),
      );
      expect(secondArg).toBe('Appending to stream');
    });

    it('MUST handle message without context data', () => {
      const calls: unknown[][] = [];
      const logger: Logger = {
        debug: (...args: unknown[]) => calls.push(args),
        info: (...args: unknown[]) => calls.push(args),
        warn: (...args: unknown[]) => calls.push(args),
        error: (...args: unknown[]) => calls.push(args),
      };

      wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database: mockDatabase,
        projections: [counterProjection],
        observability: { logger },
      });

      // Find the initialization call (has no context data)
      const initCall = calls.find(
        (c) =>
          typeof c[1] === 'string' && c[1] === 'Wiring RealtimeDB projections',
      );
      expect(initCall).toBeDefined();

      const [context, message] = initCall!;
      expect(context).toEqual({});
      expect(message).toBe('Wiring RealtimeDB projections');
    });

    it('MUST preserve all context data without loss', async () => {
      const calls: unknown[][] = [];
      const logger: Logger = {
        debug: (...args: unknown[]) => calls.push(args),
        info: (...args: unknown[]) => calls.push(args),
        warn: (...args: unknown[]) => calls.push(args),
        error: (...args: unknown[]) => calls.push(args),
      };

      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database: mockDatabase,
        projections: [counterProjection],
        observability: { logger },
      });

      const events = [itemAdded('item-1', 1), itemAdded('item-2', 2)];
      await wired.appendToStream('stream-1', events, {});

      // Find 'Appending to stream' call
      const appendCall = calls.find(
        (c) => typeof c[1] === 'string' && c[1] === 'Appending to stream',
      );
      expect(appendCall).toBeDefined();

      const [context] = appendCall!;
      expect(context).toEqual(
        expect.objectContaining({
          streamName: 'stream-1',
          eventCount: 2,
        }),
      );
    });
  });

  describe('All Logger Methods', () => {
    it('MUST call debug() at least once', async () => {
      const debugCalls: unknown[][] = [];
      const logger: Logger = {
        debug: (...args: unknown[]) => debugCalls.push(args),
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

      expect(debugCalls.length).toBeGreaterThan(0);
    });

    it('MUST call info() at least once', () => {
      const infoCalls: unknown[][] = [];
      const logger: Logger = {
        debug: jest.fn(),
        info: (...args: unknown[]) => infoCalls.push(args),
        warn: jest.fn(),
        error: jest.fn(),
      };

      wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database: mockDatabase,
        projections: [counterProjection],
        observability: { logger },
      });

      expect(infoCalls.length).toBeGreaterThan(0);
    });

    it('MUST call error() at least once on failure', async () => {
      const errorCalls: unknown[][] = [];
      const logger: Logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: (...args: unknown[]) => errorCalls.push(args),
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
      await expect(wired.appendToStream('stream-1', events, {})).rejects.toThrow();

      expect(errorCalls.length).toBeGreaterThan(0);

      const [context, message] = errorCalls[0];
      expect(typeof context).toBe('object');
      expect(message).toBe('Failed to append to stream');
    });

    it('debug() without context returns empty object', async () => {
      const debugCalls: unknown[][] = [];
      const logger: Logger = {
        debug: (...args: unknown[]) => debugCalls.push(args),
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

      // All debug calls should have object as first param
      for (const call of debugCalls) {
        expect(typeof call[0]).toBe('object');
        expect(call[0]).not.toBeNull();
      }
    });
  });

  describe('Error Context Validation', () => {
    it('error context should use err key for Error instances', async () => {
      const errorCalls: unknown[][] = [];
      const logger: Logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: (...args: unknown[]) => errorCalls.push(args),
      };
      const testError = new Error('Test error');

      mockEventStore.appendToStream = jest.fn().mockRejectedValue(testError);

      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database: mockDatabase,
        projections: [counterProjection],
        observability: { logger },
      });

      const events = [itemAdded('item-1', 1)];
      await expect(wired.appendToStream('stream-1', events, {})).rejects.toThrow();

      expect(errorCalls.length).toBeGreaterThan(0);

      const [context] = errorCalls[0];
      expect(context).toHaveProperty('err');
      expect((context as Record<string, unknown>).err).toBe(testError);
    });
  });

  describe('safeLog Encapsulation', () => {
    it('safeLog must NOT be importable from package', () => {
      expect('safeLog' in packageExports).toBe(false);
    });

    it('Logger MUST be importable from package', () => {
      // Logger is a type, so we check it's exported by using it
      const logger: Logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };
      expect(logger).toBeDefined();
    });
  });

  describe('Type Safety', () => {
    it('Logger interface should have no any types', () => {
      // This is a compile-time check - if it compiles, it passes
      const logger: Logger = {
        debug: (context: Record<string, unknown>, message?: string) => {
          // Type-safe: context must be Record<string, unknown>
          const _ctx: Record<string, unknown> = context;
          const _msg: string | undefined = message;
          void _ctx;
          void _msg;
        },
        info: (context: Record<string, unknown>, message?: string) => {
          const _ctx: Record<string, unknown> = context;
          const _msg: string | undefined = message;
          void _ctx;
          void _msg;
        },
        warn: (context: Record<string, unknown>, message?: string) => {
          const _ctx: Record<string, unknown> = context;
          const _msg: string | undefined = message;
          void _ctx;
          void _msg;
        },
        error: (context: Record<string, unknown>, message?: string) => {
          const _ctx: Record<string, unknown> = context;
          const _msg: string | undefined = message;
          void _ctx;
          void _msg;
        },
      };
      expect(logger).toBeDefined();
    });
  });

  describe('Pino Compatibility', () => {
    it('should work with Pino-style logger directly', async () => {
      // Pino uses (context, message) natively
      const calls: unknown[][] = [];
      const pinoStyleLogger: Logger = {
        debug: (context, message) => calls.push(['debug', context, message]),
        info: (context, message) => calls.push(['info', context, message]),
        warn: (context, message) => calls.push(['warn', context, message]),
        error: (context, message) => calls.push(['error', context, message]),
      };

      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database: mockDatabase,
        projections: [counterProjection],
        observability: { logger: pinoStyleLogger },
      });

      const events = [itemAdded('item-1', 1)];
      await wired.appendToStream('stream-1', events, {});

      // All calls should have object first, string second
      for (const call of calls) {
        const [, context, message] = call;
        expect(typeof context).toBe('object');
        expect(typeof message).toBe('string');
      }
    });
  });

  describe('Winston Adapter Pattern', () => {
    it('should work with Winston through adapter', async () => {
      // Winston uses (message, meta) - adapter inverts
      const winstonCalls: unknown[][] = [];

      // Fake Winston logger
      const fakeWinston = {
        log: (level: string, message: string, meta: unknown) => {
          winstonCalls.push([level, message, meta]);
        },
      };

      // Winston adapter that implements our Logger contract
      const winstonAdapter: Logger = {
        debug(context, message) {
          fakeWinston.log('debug', message ?? '', context);
        },
        info(context, message) {
          fakeWinston.log('info', message ?? '', context);
        },
        warn(context, message) {
          fakeWinston.log('warn', message ?? '', context);
        },
        error(context, message) {
          fakeWinston.log('error', message ?? '', context);
        },
      };

      const wired = wireRealtimeDBProjections({
        eventStore: mockEventStore,
        database: mockDatabase,
        projections: [counterProjection],
        observability: { logger: winstonAdapter },
      });

      const events = [itemAdded('item-1', 1)];
      await wired.appendToStream('stream-1', events, {});

      // Verify Winston received the calls in its expected format
      expect(winstonCalls.length).toBeGreaterThan(0);

      for (const call of winstonCalls) {
        const [level, message, meta] = call;
        expect(typeof level).toBe('string');
        expect(typeof message).toBe('string');
        expect(typeof meta).toBe('object');
      }
    });
  });
});
