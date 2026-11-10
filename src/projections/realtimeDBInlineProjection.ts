import type { Event, ReadEvent } from '@event-driven-io/emmett';
import { context, trace, SpanStatusCode, type Span } from '@opentelemetry/api';
import type {
  InlineProjectionHandlerOptions,
  RealtimeDBDefaultInlineProjectionName,
  RealtimeDBInlineProjectionDefinition,
  RealtimeDBInlineProjectionOptions,
  RealtimeDBReadEventMetadata,
  RealtimeDBReadModel,
  RealtimeDBReadModelMetadata,
  StoredEventsReader,
} from './types';
import { safeLog, type Logger } from '../observability';
import { toRealtimeDBValue } from './serializeValues';

export { RealtimeDBDefaultInlineProjectionName } from './types';

// Tracer name MUST match package.json name exactly
const tracer = trace.getTracer('@emmett-community/emmett-google-realtime-db');

// Runs a call with the span active, so the spans it creates (a read of the event store, for
// example) are children of the span
const withinSpan = <T>(span: Span, call: () => T | Promise<T>): Promise<T> =>
  Promise.resolve(context.with(trace.setSpan(context.active(), span), call));

const READ_TIMEOUTS_MS = [5000, 8000, 12000];

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const TIMEOUT_ERROR_MESSAGE = 'Realtime DB read timed out.';

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(TIMEOUT_ERROR_MESSAGE));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

const isTimeoutError = (error: unknown): boolean => {
  return error instanceof Error && error.message === TIMEOUT_ERROR_MESSAGE;
};

const resetRealtimeDbConnection = (
  database: import('firebase-admin/database').Database,
  logger: Logger | undefined,
  projectionName: string,
  streamId: string,
): void => {
  try {
    safeLog.warn(logger, 'Resetting Realtime DB connection after timeout', {
      projectionName,
      streamId,
    });
    database.goOffline();
    database.goOnline();
  } catch (error) {
    safeLog.error(logger, 'Failed to reset Realtime DB connection', error);
  }
};

const readSnapshotWithRetry = async (
  projectionRef: import('firebase-admin/database').Reference,
  database: import('firebase-admin/database').Database,
  logger: Logger | undefined,
  projectionName: string,
  streamId: string,
): Promise<import('firebase-admin/database').DataSnapshot> => {
  let lastError: unknown;

  for (let attempt = 0; attempt < READ_TIMEOUTS_MS.length; attempt += 1) {
    try {
      return await withTimeout(
        projectionRef.once('value'),
        READ_TIMEOUTS_MS[attempt],
      );
    } catch (error) {
      lastError = error;
      safeLog.warn(logger, 'Realtime DB read failed, retrying', {
        projectionName,
        streamId,
        attempt: attempt + 1,
        timeoutMs: READ_TIMEOUTS_MS[attempt],
      });
      if (isTimeoutError(error)) {
        resetRealtimeDbConnection(database, logger, projectionName, streamId);
      }
      if (attempt < READ_TIMEOUTS_MS.length - 1) {
        await sleep(500 * (attempt + 1));
      }
    }
  }

  safeLog.error(logger, 'Realtime DB read failed after retries', lastError);
  throw lastError instanceof Error
    ? lastError
    : new Error('Realtime DB read failed after retries.');
};

export const handleInlineProjections = async <
  EventType extends Event = Event,
  EventMetaDataType extends RealtimeDBReadEventMetadata =
    RealtimeDBReadEventMetadata,
>(
  options: InlineProjectionHandlerOptions<EventType, EventMetaDataType>,
): Promise<void> => {
  const {
    events,
    projections: allProjections,
    streamId,
    database,
    observability,
    readStoredEvents,
    streamIsNew,
  } = options;
  const logger = observability?.logger;

  const span = tracer.startSpan('emmett.realtime_db.handle_projections', {
    attributes: {
      'emmett.stream_id': streamId,
      'emmett.event_count': events.length,
    },
  });

  try {
    const eventTypes = events.map((e) => e.type);

    const projections = allProjections.filter((p) =>
      p.canHandle.some((type) => eventTypes.includes(type)),
    );

    safeLog.debug(logger, 'Handling inline projections', {
      streamId,
      eventCount: events.length,
      projectionNames: projections.map((p) => p.name),
    });

    safeLog.debug(logger, 'Filtered projections', {
      matchingProjectionCount: projections.length,
    });

    span.setAttribute('emmett.projection_count', projections.length);

    for (const projection of projections) {
      await withinSpan(span, () =>
        handleSingleProjection(projection, events, streamId, database, logger, {
          readStoredEvents,
          streamIsNew,
        }),
      );
    }

    span.setStatus({ code: SpanStatusCode.OK });

    safeLog.debug(logger, 'Projections handling completed', {
      streamId,
      projectionsProcessed: projections.length,
    });
  } catch (error) {
    span.recordException(error as Error);
    span.setStatus({ code: SpanStatusCode.ERROR });

    safeLog.error(logger, 'Failed to handle projections', error);

    throw error;
  } finally {
    span.end();
  }
};

const handleSingleProjection = async <
  EventType extends Event = Event,
  EventMetaDataType extends RealtimeDBReadEventMetadata =
    RealtimeDBReadEventMetadata,
>(
  projection: RealtimeDBInlineProjectionDefinition<
    EventType,
    EventMetaDataType
  >,
  events: Array<ReadEvent<EventType, EventMetaDataType>>,
  streamId: string,
  database: import('firebase-admin/database').Database,
  logger: Logger | undefined,
  stream: { readStoredEvents?: StoredEventsReader; streamIsNew?: boolean },
): Promise<void> => {
  const span = tracer.startSpan('emmett.realtime_db.projection.handle', {
    attributes: {
      'emmett.projection_name': projection.name,
      'emmett.stream_id': streamId,
    },
  });

  try {
    safeLog.debug(logger, 'Handling projection', {
      projectionName: projection.name,
      streamId,
    });

    const projectionRef = database.ref(
      `projections/${projection.name}/${streamId}`,
    );
    const snapshot = await withinSpan(span, () =>
      readSnapshotWithRetry(
        projectionRef,
        database,
        logger,
        projection.name,
        streamId,
      ),
    );
    const document = (snapshot.val() as RealtimeDBReadModel | null) ?? null;

    safeLog.debug(logger, 'Read document', {
      projectionName: projection.name,
      documentFound: document !== null,
    });

    await withinSpan(span, () =>
      projection.handle(events, {
        document,
        streamId,
        database,
        projectionRef,
        readStoredEvents: stream.readStoredEvents,
        streamIsNew: stream.streamIsNew,
      }),
    );

    span.setStatus({ code: SpanStatusCode.OK });
  } catch (error) {
    span.recordException(error as Error);
    span.setStatus({ code: SpanStatusCode.ERROR });

    safeLog.error(logger, 'Failed to handle projection', error);

    throw error;
  } finally {
    span.end();
  }
};

/**
 * The document is written after the append commits, so a process that stops in between leaves it
 * behind the stream. The next events then start after a gap, and applying only them would skip the
 * missed ones for good, since the stored position would move past them. When the document is behind
 * the first event received (or missing for a stream that is not new), the stored events in between
 * are read and applied first.
 */
const withMissedEvents = async <
  EventType extends Event,
  EventMetaDataType extends RealtimeDBReadEventMetadata,
>(
  received: Array<ReadEvent<EventType, EventMetaDataType>>,
  storedPosition: bigint | null,
  readStoredEvents: StoredEventsReader | undefined,
  streamIsNew: boolean | undefined,
): Promise<Array<ReadEvent<EventType, EventMetaDataType>>> => {
  if (!readStoredEvents) return received;

  const firstPosition = BigInt(received[0].metadata.streamPosition);
  // A missing document is behind only when the event store says the stream already existed
  const behind =
    storedPosition === null
      ? streamIsNew === false
      : firstPosition > storedPosition + BigInt(1);
  if (!behind) return received;

  const stored = await readStoredEvents({
    after: storedPosition,
    before: firstPosition,
  });
  const missed = stored.filter((event) => {
    const position = BigInt(event.metadata.streamPosition);
    return (
      position < firstPosition &&
      (storedPosition === null || position > storedPosition)
    );
  }) as unknown as Array<ReadEvent<EventType, EventMetaDataType>>;

  return [...missed, ...received];
};

// The stream position is stored as a string; accept a bigint or a number too.
const readStoredStreamPosition = (document: unknown): bigint | null => {
  if (!document || typeof document !== 'object') return null;

  const metadata = (document as { _metadata?: { streamPosition?: unknown } })
    ._metadata;
  const position = metadata?.streamPosition;
  if (position === undefined || position === null) return null;

  try {
    return BigInt(position as string | number | bigint);
  } catch {
    return null;
  }
};

export const realtimeDBInlineProjection = <
  Doc extends Record<string, unknown>,
  EventType extends Event,
  EventMetaDataType extends RealtimeDBReadEventMetadata =
    RealtimeDBReadEventMetadata,
>(
  options: RealtimeDBInlineProjectionOptions<Doc, EventType, EventMetaDataType>,
): RealtimeDBInlineProjectionDefinition => {
  const projectionName =
    options.name ??
    ('_default' as typeof RealtimeDBDefaultInlineProjectionName);
  const schemaVersion = options.schemaVersion ?? 1;

  return {
    name: projectionName,
    canHandle: options.canHandle,
    handle: async (
      received,
      { document, projectionRef, streamId, readStoredEvents, streamIsNew },
    ) => {
      if (received.length === 0) return;

      const storedPosition = readStoredStreamPosition(document);
      const events = await withMissedEvents(
        received,
        storedPosition,
        readStoredEvents,
        streamIsNew,
      );

      // Idempotency: events at or before the stored stream position were
      // already applied (redelivery, retry after a failed append response).
      const pendingEvents =
        storedPosition === null
          ? events
          : events.filter(
              (event) => BigInt(event.metadata.streamPosition) > storedPosition,
            );
      if (pendingEvents.length === 0) return;
      const lastEvent = pendingEvents[pendingEvents.length - 1];

      // Strip metadata if present to get raw state
      let rawDocument: Doc | null = null;
      if (document && typeof document === 'object') {
        if ('_metadata' in document) {
          rawDocument = Object.fromEntries(
            Object.entries(document).filter(([key]) => key !== '_metadata'),
          ) as Doc;
        } else {
          rawDocument = document as Doc;
        }
      }

      let state: Doc | null =
        'initialState' in options
          ? (rawDocument ?? options.initialState())
          : rawDocument;

      // Evolve state through all events
      // Note: evolve can create state from null, so we always call it
      for (const event of pendingEvents) {
        state = await options.evolve(
          state as Doc,
          event as ReadEvent<EventType, EventMetaDataType>,
        );
      }

      const metadata: RealtimeDBReadModelMetadata = {
        streamId,
        name: projectionName,
        schemaVersion,
        streamPosition: lastEvent.metadata.streamPosition.toString(),
      };

      if (state !== null) {
        await projectionRef.set({
          ...toRealtimeDBValue(state),
          _metadata: metadata,
        });
      } else {
        await projectionRef.remove();
      }
    },
  };
};
