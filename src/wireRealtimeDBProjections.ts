import type { EventStore, ReadEvent } from '@event-driven-io/emmett';
import type { Database } from 'firebase-admin/database';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import {
  handleInlineProjections,
  type RealtimeDBInlineProjectionDefinition,
} from './projections';
import { safeLog, type ObservabilityOptions } from './observability';

// Tracer name MUST match package.json name exactly
const tracer = trace.getTracer('@emmett-community/emmett-google-realtime-db');

export type WireRealtimeDBProjectionsOptions<T extends EventStore = EventStore> = {
  eventStore: T;
  database: Database;
  projections: RealtimeDBInlineProjectionDefinition[];
  observability?: ObservabilityOptions;
};

export const wireRealtimeDBProjections = <T extends EventStore>(
  options: WireRealtimeDBProjectionsOptions<T>,
): T => {
  const { eventStore, database, projections, observability } = options;
  const logger = observability?.logger;

  safeLog.info(logger, 'Wiring RealtimeDB projections');

  const originalAppend = eventStore.appendToStream.bind(eventStore);

  eventStore.appendToStream = async (streamName, events, appendOptions) => {
    return tracer.startActiveSpan(
      'emmett.realtime_db.append_to_stream',
      {
        attributes: {
          'emmett.stream_name': streamName,
          'emmett.event_count': events.length,
        },
      },
      async (span) => {
        try {
          safeLog.debug(logger, 'Appending to stream', {
            streamName,
            eventCount: events.length,
          });

          const result = await originalAppend(streamName, events, appendOptions);

          // Create ReadEvents with metadata from append result
          // nextExpectedStreamVersion is the version AFTER appending, so event positions are:
          // nextExpectedStreamVersion - events.length, nextExpectedStreamVersion - events.length + 1, ..., nextExpectedStreamVersion - 1
          const eventsLength = BigInt(events.length);

          // Support both old (streamVersion) and new (nextExpectedStreamVersion) API
          const versionValue =
            (result as any).nextExpectedStreamVersion ??
            (result as any).streamVersion;
          const nextVersion =
            typeof versionValue === 'bigint' ? versionValue : BigInt(versionValue);

          const readEvents = events.map((event, index) => {
            // nextExpectedStreamVersion is the version of the LAST event in the batch
            // For a batch of N events, the first event has position: nextExpectedStreamVersion - N + 1
            // Each subsequent event: (nextExpectedStreamVersion - N + 1) + index
            const position = nextVersion - eventsLength + BigInt(1) + BigInt(index);
            return {
              ...event,
              metadata: {
                streamName,
                streamPosition: position,
                messageId: `${streamName}-${position}`,
              },
            };
          }) as ReadEvent[];

          await handleInlineProjections({
            events: readEvents,
            projections,
            streamId: streamName,
            database,
            observability,
          });

          span.setAttribute('emmett.new_version', Number(nextVersion));
          span.setStatus({ code: SpanStatusCode.OK });

          safeLog.debug(logger, 'Append completed', {
            streamName,
            newVersion: nextVersion.toString(),
          });

          return result;
        } catch (error) {
          span.recordException(error as Error);
          span.setStatus({ code: SpanStatusCode.ERROR });

          safeLog.error(logger, 'Failed to append to stream', error);

          throw error;
        } finally {
          span.end();
        }
      },
    );
  };

  return eventStore;
};
