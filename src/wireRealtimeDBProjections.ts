import type {
  Event,
  EventStore,
  ReadEvent,
  ReadStreamOptions,
} from '@event-driven-io/emmett';
import type { Database } from 'firebase-admin/database';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import {
  handleInlineProjections,
  type RealtimeDBInlineProjectionDefinition,
  type RealtimeDBReadEventMetadata,
  type StoredEventsRange,
} from './projections';
import { safeLog, type ObservabilityOptions } from './observability';

// Tracer name MUST match package.json name exactly
const tracer = trace.getTracer('@emmett-community/emmett-google-realtime-db');

export type WireRealtimeDBProjectionsOptions<
  T extends EventStore = EventStore,
> = {
  eventStore: T;
  database: Database;
  projections: RealtimeDBInlineProjectionDefinition[];
  observability?: ObservabilityOptions;
};

/**
 * Read options covering the positions in `range`. Event stores do not agree on what `from` and `to`
 * mean: some take them as stream positions starting at 0, others as indexes of events whose
 * positions start at 1. The options asked here cover the range either way, at most one event
 * wider; the projection keeps only the events in the range.
 */
const readRangeOptions = (range: StoredEventsRange): ReadStreamOptions =>
  range.after === null
    ? { to: range.before - BigInt(1) }
    : { from: range.after, maxCount: range.before - range.after };

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

          const result = await originalAppend(
            streamName,
            events,
            appendOptions,
          );

          // Create ReadEvents with metadata from append result
          // nextExpectedStreamVersion is the version AFTER appending, so event positions are:
          // nextExpectedStreamVersion - events.length, nextExpectedStreamVersion - events.length + 1, ..., nextExpectedStreamVersion - 1
          const eventsLength = BigInt(events.length);

          // Support both old (streamVersion) and new (nextExpectedStreamVersion) API
          const { nextExpectedStreamVersion, streamVersion } = result as {
            nextExpectedStreamVersion?: bigint | number;
            streamVersion?: bigint | number;
          };
          const versionValue = nextExpectedStreamVersion ?? streamVersion;
          const nextVersion =
            typeof versionValue === 'bigint'
              ? versionValue
              : BigInt(versionValue as number);

          // An event store that returns the stored ids gives one per event, in order; the
          // projection must see that same identity
          const { messageIds } = result as { messageIds?: unknown };
          const storedIds =
            Array.isArray(messageIds) && messageIds.length === events.length
              ? messageIds
              : undefined;

          const readEvents = events.map((event, index) => {
            // nextExpectedStreamVersion is the version of the LAST event in the batch
            // For a batch of N events, the first event has position: nextExpectedStreamVersion - N + 1
            // Each subsequent event: (nextExpectedStreamVersion - N + 1) + index
            const position =
              nextVersion - eventsLength + BigInt(1) + BigInt(index);
            const storedId: unknown = storedIds?.[index];
            const appendMetadata = (
              event as { metadata?: Record<string, unknown> }
            ).metadata;
            return {
              ...event,
              metadata: {
                ...appendMetadata,
                streamName,
                streamPosition: position,
                messageId:
                  typeof storedId === 'string'
                    ? storedId
                    : `${streamName}-${position}`,
              },
            };
          }) as ReadEvent[];

          const { createdNewStream } = result as {
            createdNewStream?: boolean;
          };

          await handleInlineProjections({
            events: readEvents,
            projections,
            streamId: streamName,
            database,
            observability,
            // A projection left behind by an earlier append reads the events it missed
            readStoredEvents: async (range) =>
              (await eventStore.readStream(streamName, readRangeOptions(range)))
                .events as unknown as ReadEvent<
                Event,
                RealtimeDBReadEventMetadata
              >[],
            streamIsNew: createdNewStream,
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
