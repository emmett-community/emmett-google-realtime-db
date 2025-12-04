import type { Event, ReadEvent } from '@event-driven-io/emmett';
import type {
  InlineProjectionHandlerOptions,
  RealtimeDBDefaultInlineProjectionName,
  RealtimeDBInlineProjectionDefinition,
  RealtimeDBInlineProjectionOptions,
  RealtimeDBReadEventMetadata,
  RealtimeDBReadModelMetadata,
} from './types';

export { RealtimeDBDefaultInlineProjectionName } from './types';

export const handleInlineProjections = async <
  EventType extends Event = Event,
  EventMetaDataType extends RealtimeDBReadEventMetadata = RealtimeDBReadEventMetadata,
>(
  options: InlineProjectionHandlerOptions<EventType, EventMetaDataType>,
): Promise<void> => {
  const { events, projections: allProjections, streamId, database } = options;

  const eventTypes = events.map((e) => e.type);

  const projections = allProjections.filter((p) =>
    p.canHandle.some((type) => eventTypes.includes(type)),
  );

  for (const projection of projections) {
    const projectionRef = database.ref(`projections/${projection.name}/${streamId}`);
    const snapshot = await projectionRef.once('value');
    const document = snapshot.val() ?? null;

    await projection.handle(events, {
      document,
      streamId,
      database,
      projectionRef,
    });
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
