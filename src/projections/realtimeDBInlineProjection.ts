import type { Event, ReadEvent } from '@event-driven-io/emmett';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import type {
  InlineProjectionHandlerOptions,
  RealtimeDBDefaultInlineProjectionName,
  RealtimeDBInlineProjectionDefinition,
  RealtimeDBInlineProjectionOptions,
  RealtimeDBReadEventMetadata,
  RealtimeDBReadModelMetadata,
} from './types';
import { safeLog, type Logger } from '../observability';

export { RealtimeDBDefaultInlineProjectionName } from './types';

// Tracer name MUST match package.json name exactly
const tracer = trace.getTracer('@emmett-community/emmett-google-realtime-db');

export const handleInlineProjections = async <
  EventType extends Event = Event,
  EventMetaDataType extends RealtimeDBReadEventMetadata = RealtimeDBReadEventMetadata,
>(
  options: InlineProjectionHandlerOptions<EventType, EventMetaDataType>,
): Promise<void> => {
  const { events, projections: allProjections, streamId, database, observability } = options;
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
      await handleSingleProjection(
        projection,
        events,
        streamId,
        database,
        logger,
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
  EventMetaDataType extends RealtimeDBReadEventMetadata = RealtimeDBReadEventMetadata,
>(
  projection: RealtimeDBInlineProjectionDefinition<EventType, EventMetaDataType>,
  events: Array<ReadEvent<EventType, EventMetaDataType>>,
  streamId: string,
  database: import('firebase-admin/database').Database,
  logger: Logger | undefined,
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

    const projectionRef = database.ref(`projections/${projection.name}/${streamId}`);
    const snapshot = await projectionRef.once('value');
    const document = snapshot.val() ?? null;

    safeLog.debug(logger, 'Read document', {
      projectionName: projection.name,
      documentFound: document !== null,
    });

    await projection.handle(events, {
      document,
      streamId,
      database,
      projectionRef,
    });

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

export const realtimeDBInlineProjection = <
  Doc extends Record<string, unknown>,
  EventType extends Event,
  EventMetaDataType extends RealtimeDBReadEventMetadata = RealtimeDBReadEventMetadata,
>(
  options: RealtimeDBInlineProjectionOptions<Doc, EventType, EventMetaDataType>,
): RealtimeDBInlineProjectionDefinition => {
  const projectionName = options.name ?? ('_default' as typeof RealtimeDBDefaultInlineProjectionName);
  const schemaVersion = options.schemaVersion ?? 1;

  return {
    name: projectionName,
    canHandle: options.canHandle,
    handle: async (events, { document, projectionRef, streamId }) => {
      if (events.length === 0) return;

      // Strip metadata if present to get raw state
      let rawDocument: Doc | null = null;
      if (document && typeof document === 'object') {
        if ('_metadata' in document) {
          const { _metadata, ...rest } = document;
          rawDocument = rest as Doc;
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
      for (const event of events) {
        state = await options.evolve(
          state as Doc,
          event as ReadEvent<EventType, EventMetaDataType>,
        );
      }

      const metadata: RealtimeDBReadModelMetadata = {
        streamId,
        name: projectionName,
        schemaVersion,
        streamPosition: events[events.length - 1]!.metadata.streamPosition.toString(),
      };

      if (state !== null) {
        await projectionRef.set({
          ...state,
          _metadata: metadata,
        });
      } else {
        await projectionRef.remove();
      }
    },
  };
};
