import { safeLog, type Logger } from '../../src/observability';

describe('Observability - safeLog', () => {
  describe('when logger is undefined', () => {
    it('should not throw when calling debug', () => {
      expect(() => safeLog.debug(undefined, 'test message')).not.toThrow();
    });

    it('should not throw when calling info', () => {
      expect(() => safeLog.info(undefined, 'test message')).not.toThrow();
    });

    it('should not throw when calling warn', () => {
      expect(() => safeLog.warn(undefined, 'test message')).not.toThrow();
    });

    it('should not throw when calling error', () => {
      expect(() => safeLog.error(undefined, 'test message')).not.toThrow();
    });

    it('should not throw when calling with data', () => {
      expect(() =>
        safeLog.debug(undefined, 'test message', { key: 'value' }),
      ).not.toThrow();
      expect(() =>
        safeLog.info(undefined, 'test message', { key: 'value' }),
      ).not.toThrow();
      expect(() =>
        safeLog.warn(undefined, 'test message', { key: 'value' }),
      ).not.toThrow();
      expect(() =>
        safeLog.error(undefined, 'test message', new Error('test')),
      ).not.toThrow();
    });
  });

  describe('when logger is provided - canonical (context, message) format', () => {
    it('should call logger.debug with (context, message) format', () => {
      const debugFn = jest.fn();
      const logger: Logger = {
        debug: debugFn,
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };

      safeLog.debug(logger, 'debug message', { data: 1 });

      expect(debugFn).toHaveBeenCalledTimes(1);
      // First arg is context object, second is message
      expect(debugFn).toHaveBeenCalledWith({ data: 1 }, 'debug message');
    });

    it('should call logger.info with (context, message) format', () => {
      const infoFn = jest.fn();
      const logger: Logger = {
        debug: jest.fn(),
        info: infoFn,
        warn: jest.fn(),
        error: jest.fn(),
      };

      safeLog.info(logger, 'info message', { data: 2 });

      expect(infoFn).toHaveBeenCalledTimes(1);
      expect(infoFn).toHaveBeenCalledWith({ data: 2 }, 'info message');
    });

    it('should call logger.warn with (context, message) format', () => {
      const warnFn = jest.fn();
      const logger: Logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: warnFn,
        error: jest.fn(),
      };

      safeLog.warn(logger, 'warn message', { data: 3 });

      expect(warnFn).toHaveBeenCalledTimes(1);
      expect(warnFn).toHaveBeenCalledWith({ data: 3 }, 'warn message');
    });

    it('should call logger.error with err key for Error instances', () => {
      const errorFn = jest.fn();
      const logger: Logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: errorFn,
      };
      const testError = new Error('test error');

      safeLog.error(logger, 'error message', testError);

      expect(errorFn).toHaveBeenCalledTimes(1);
      expect(errorFn).toHaveBeenCalledWith({ err: testError }, 'error message');
    });
  });

  describe('context normalization', () => {
    it('should return empty object when data is undefined', () => {
      const debugFn = jest.fn();
      const logger: Logger = {
        debug: debugFn,
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };

      safeLog.debug(logger, 'message without data');

      expect(debugFn).toHaveBeenCalledWith({}, 'message without data');
    });

    it('should return empty object when data is null', () => {
      const debugFn = jest.fn();
      const logger: Logger = {
        debug: debugFn,
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };

      safeLog.debug(logger, 'message with null', null);

      expect(debugFn).toHaveBeenCalledWith({}, 'message with null');
    });

    it('should spread object data into context', () => {
      const debugFn = jest.fn();
      const logger: Logger = {
        debug: debugFn,
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };

      safeLog.debug(logger, 'message with object', { key: 'value', num: 42 });

      expect(debugFn).toHaveBeenCalledWith(
        { key: 'value', num: 42 },
        'message with object',
      );
    });

    it('should wrap primitive data in data key', () => {
      const debugFn = jest.fn();
      const logger: Logger = {
        debug: debugFn,
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };

      safeLog.debug(logger, 'message with string', 'primitive string');

      expect(debugFn).toHaveBeenCalledWith(
        { data: 'primitive string' },
        'message with string',
      );
    });

    it('should wrap array data in data key', () => {
      const debugFn = jest.fn();
      const logger: Logger = {
        debug: debugFn,
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };

      safeLog.debug(logger, 'message with array', [1, 2, 3]);

      expect(debugFn).toHaveBeenCalledWith(
        { data: [1, 2, 3] },
        'message with array',
      );
    });
  });

  describe('error context normalization', () => {
    it('should wrap Error instance in err key', () => {
      const errorFn = jest.fn();
      const logger: Logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: errorFn,
      };
      const testError = new Error('test');

      safeLog.error(logger, 'error msg', testError);

      expect(errorFn).toHaveBeenCalledWith({ err: testError }, 'error msg');
    });

    it('should spread object error into context', () => {
      const errorFn = jest.fn();
      const logger: Logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: errorFn,
      };

      safeLog.error(logger, 'error msg', { code: 500, reason: 'Server Error' });

      expect(errorFn).toHaveBeenCalledWith(
        { code: 500, reason: 'Server Error' },
        'error msg',
      );
    });

    it('should return empty object when error is undefined', () => {
      const errorFn = jest.fn();
      const logger: Logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: errorFn,
      };

      safeLog.error(logger, 'error msg');

      expect(errorFn).toHaveBeenCalledWith({}, 'error msg');
    });

    it('should wrap primitive error in err key', () => {
      const errorFn = jest.fn();
      const logger: Logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: errorFn,
      };

      safeLog.error(logger, 'error msg', 'string error');

      expect(errorFn).toHaveBeenCalledWith({ err: 'string error' }, 'error msg');
    });
  });

  describe('protection against mutation', () => {
    it('should create shallow copy of context to prevent mutation', () => {
      const debugFn = jest.fn();
      const logger: Logger = {
        debug: debugFn,
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };
      const originalData = { key: 'value' };

      safeLog.debug(logger, 'message', originalData);

      const passedContext = debugFn.mock.calls[0][0];
      expect(passedContext).toEqual(originalData);
      expect(passedContext).not.toBe(originalData); // Different object reference
    });
  });

  describe('with full logger implementation', () => {
    it('should work with all methods', () => {
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

      safeLog.debug(fullLogger, 'debug');
      safeLog.info(fullLogger, 'info');
      safeLog.warn(fullLogger, 'warn');
      safeLog.error(fullLogger, 'error');

      expect(debugFn).toHaveBeenCalledTimes(1);
      expect(infoFn).toHaveBeenCalledTimes(1);
      expect(warnFn).toHaveBeenCalledTimes(1);
      expect(errorFn).toHaveBeenCalledTimes(1);

      // All should receive (context, message) format
      expect(debugFn).toHaveBeenCalledWith({}, 'debug');
      expect(infoFn).toHaveBeenCalledWith({}, 'info');
      expect(warnFn).toHaveBeenCalledWith({}, 'warn');
      expect(errorFn).toHaveBeenCalledWith({}, 'error');
    });
  });
});
