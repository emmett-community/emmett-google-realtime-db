import type { EventStore, ReadEvent } from '@event-driven-io/emmett';
import type { Database } from 'firebase-admin/database';
import {
  handleInlineProjections,
  type RealtimeDBInlineProjectionDefinition,
} from './projections';

export type WireRealtimeDBProjectionsOptions<T extends EventStore = EventStore> = {
  eventStore: T;
  database: Database;
  projections: RealtimeDBInlineProjectionDefinition[];
};

export const wireRealtimeDBProjections = <T extends EventStore>(
  options: WireRealtimeDBProjectionsOptions<T>,
): T => {
  const { eventStore, database, projections } = options;

  const originalAppend = eventStore.appendToStream.bind(eventStore);

  eventStore.appendToStream = async (streamName, events, appendOptions) => {
    const result = await originalAppend(streamName, events, appendOptions);

    // Create ReadEvents with metadata from append result
    // nextExpectedStreamVersion is the version AFTER appending, so event positions are:
    // nextExpectedStreamVersion - events.length, nextExpectedStreamVersion - events.length + 1, ..., nextExpectedStreamVersion - 1
    const eventsLength = BigInt(events.length);

    // Support both old (streamVersion) and new (nextExpectedStreamVersion) API
    const versionValue = (result as any).nextExpectedStreamVersion ?? (result as any).streamVersion;
    const nextVersion = typeof versionValue === 'bigint'
      ? versionValue
      : BigInt(versionValue);

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
    });

    return result;
  };

  return eventStore;
};
