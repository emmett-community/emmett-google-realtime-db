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

  describe('when logger is provided', () => {
    it('should call logger.debug when provided', () => {
      const debugFn = jest.fn();
      const logger: Logger = { debug: debugFn };

      safeLog.debug(logger, 'debug message', { data: 1 });

      expect(debugFn).toHaveBeenCalledTimes(1);
      expect(debugFn).toHaveBeenCalledWith('debug message', { data: 1 });
    });

    it('should call logger.info when provided', () => {
      const infoFn = jest.fn();
      const logger: Logger = { info: infoFn };

      safeLog.info(logger, 'info message', { data: 2 });

      expect(infoFn).toHaveBeenCalledTimes(1);
      expect(infoFn).toHaveBeenCalledWith('info message', { data: 2 });
    });

    it('should call logger.warn when provided', () => {
      const warnFn = jest.fn();
      const logger: Logger = { warn: warnFn };

      safeLog.warn(logger, 'warn message', { data: 3 });

      expect(warnFn).toHaveBeenCalledTimes(1);
      expect(warnFn).toHaveBeenCalledWith('warn message', { data: 3 });
    });

    it('should call logger.error with error object', () => {
      const errorFn = jest.fn();
      const logger: Logger = { error: errorFn };
      const testError = new Error('test error');

      safeLog.error(logger, 'error message', testError);

      expect(errorFn).toHaveBeenCalledTimes(1);
      expect(errorFn).toHaveBeenCalledWith('error message', testError);
    });
  });

  describe('with partial logger implementations', () => {
    it('should handle logger with only debug method', () => {
      const debugFn = jest.fn();
      const logger: Logger = { debug: debugFn };

      expect(() => {
        safeLog.debug(logger, 'debug msg');
        safeLog.info(logger, 'info msg');
        safeLog.warn(logger, 'warn msg');
        safeLog.error(logger, 'error msg');
      }).not.toThrow();

      expect(debugFn).toHaveBeenCalledTimes(1);
    });

    it('should handle logger with only info method', () => {
      const infoFn = jest.fn();
      const logger: Logger = { info: infoFn };

      expect(() => {
        safeLog.debug(logger, 'debug msg');
        safeLog.info(logger, 'info msg');
        safeLog.warn(logger, 'warn msg');
        safeLog.error(logger, 'error msg');
      }).not.toThrow();

      expect(infoFn).toHaveBeenCalledTimes(1);
    });

    it('should handle logger with only warn method', () => {
      const warnFn = jest.fn();
      const logger: Logger = { warn: warnFn };

      expect(() => {
        safeLog.debug(logger, 'debug msg');
        safeLog.info(logger, 'info msg');
        safeLog.warn(logger, 'warn msg');
        safeLog.error(logger, 'error msg');
      }).not.toThrow();

      expect(warnFn).toHaveBeenCalledTimes(1);
    });

    it('should handle logger with only error method', () => {
      const errorFn = jest.fn();
      const logger: Logger = { error: errorFn };

      expect(() => {
        safeLog.debug(logger, 'debug msg');
        safeLog.info(logger, 'info msg');
        safeLog.warn(logger, 'warn msg');
        safeLog.error(logger, 'error msg');
      }).not.toThrow();

      expect(errorFn).toHaveBeenCalledTimes(1);
    });

    it('should work with full logger implementation', () => {
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
    });
  });
});
