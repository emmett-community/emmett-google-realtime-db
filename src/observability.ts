/**
 * Observability types for emmett-google-realtime-db.
 *
 * This module provides optional logging integration
 * following a "silent by default" philosophy.
 */

/**
 * Minimal logger interface compatible with Pino, Winston, console, and similar loggers.
 * All methods are optional to support partial implementations.
 */
export interface Logger {
  debug?(msg: string, data?: unknown): void;
  info?(msg: string, data?: unknown): void;
  warn?(msg: string, data?: unknown): void;
  error?(msg: string, err?: unknown): void;
}

/**
 * Observability configuration options.
 */
export type ObservabilityOptions = {
  /**
   * Optional logger instance for diagnostic output.
   * When not provided, the library operates silently.
   *
   * @example
   * ```typescript
   * import pino from 'pino';
   *
   * const eventStore = wireRealtimeDBProjections({
   *   eventStore: baseEventStore,
   *   database,
   *   projections: [...],
   *   observability: { logger: pino() },
   * });
   * ```
   */
  logger?: Logger;
};

/**
 * Internal helper to safely call logger methods, handling partial implementations.
 * Always use: safeLog.error(logger, msg, error) - never { error }
 */
export const safeLog = {
  debug: (logger: Logger | undefined, msg: string, data?: unknown) =>
    logger?.debug?.(msg, data),
  info: (logger: Logger | undefined, msg: string, data?: unknown) =>
    logger?.info?.(msg, data),
  warn: (logger: Logger | undefined, msg: string, data?: unknown) =>
    logger?.warn?.(msg, data),
  error: (logger: Logger | undefined, msg: string, error?: unknown) =>
    logger?.error?.(msg, error),
};
