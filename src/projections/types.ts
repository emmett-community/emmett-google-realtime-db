import type {
  CanHandle,
  Event,
  ProjectionDefinition,
  ProjectionHandler,
  ReadEvent,
  ReadEventMetadataWithoutGlobalPosition,
} from '@event-driven-io/emmett';
import type { Database, Reference } from 'firebase-admin/database';
import type { ObservabilityOptions } from '../observability';

export const RealtimeDBDefaultInlineProjectionName = '_default';

export type RealtimeDBReadEventMetadata =
  ReadEventMetadataWithoutGlobalPosition<bigint>;

export type RealtimeDBReadModelMetadata = {
  streamId: string;
  name: string;
  schemaVersion: number;
  streamPosition: string;
};

export type RealtimeDBReadModel = {
  _metadata: RealtimeDBReadModelMetadata;
  [key: string]: unknown;
};

/**
 * The stored events whose position is after `after` (or from the start of the stream when it is
 * `null`) and before `before`. A reader may return more events than that; the projection keeps
 * only the ones in the range.
 */
export type StoredEventsRange = {
  after: bigint | null;
  before: bigint;
};

export type StoredEventsReader = (
  range: StoredEventsRange,
) => Promise<Array<ReadEvent<Event, RealtimeDBReadEventMetadata>>>;

export type RealtimeDBProjectionInlineHandlerContext = {
  document: RealtimeDBReadModel | null;
  streamId: string;
  database: Database;
  projectionRef: Reference;
  /**
   * Reads the stored events of the stream. Given by `wireRealtimeDBProjections`, so a projection
   * whose document is behind the events it receives reads the ones it missed instead of skipping
   * them.
   */
  readStoredEvents?: StoredEventsReader;
  /** `true` when the events received are the first ones of the stream. */
  streamIsNew?: boolean;
};

export type RealtimeDBInlineProjectionHandler<
  EventType extends Event = Event,
  EventMetaDataType extends RealtimeDBReadEventMetadata =
    RealtimeDBReadEventMetadata,
> = ProjectionHandler<
  EventType,
  EventMetaDataType,
  RealtimeDBProjectionInlineHandlerContext
>;

export type RealtimeDBInlineProjectionDefinition<
  EventType extends Event = Event,
  EventMetaDataType extends RealtimeDBReadEventMetadata =
    RealtimeDBReadEventMetadata,
> = ProjectionDefinition<
  EventType,
  EventMetaDataType,
  RealtimeDBProjectionInlineHandlerContext
> & { name: string };

export type InlineProjectionHandlerOptions<
  EventType extends Event = Event,
  EventMetaDataType extends RealtimeDBReadEventMetadata =
    RealtimeDBReadEventMetadata,
> = {
  events: Array<ReadEvent<EventType, EventMetaDataType>>;
  projections: RealtimeDBInlineProjectionDefinition<
    EventType,
    EventMetaDataType
  >[];
  streamId: string;
  database: Database;
  observability?: ObservabilityOptions;
  /** See `RealtimeDBProjectionInlineHandlerContext.readStoredEvents`. */
  readStoredEvents?: StoredEventsReader;
  /** See `RealtimeDBProjectionInlineHandlerContext.streamIsNew`. */
  streamIsNew?: boolean;
};

export type RealtimeDBWithNotNullDocumentEvolve<
  Doc extends Record<string, unknown>,
  EventType extends Event,
  EventMetaDataType extends RealtimeDBReadEventMetadata =
    RealtimeDBReadEventMetadata,
> =
  | ((
      document: Doc,
      event: ReadEvent<EventType, EventMetaDataType>,
    ) => Doc | null)
  | ((document: Doc, event: ReadEvent<EventType>) => Promise<Doc | null>);

export type RealtimeDBWithNullableDocumentEvolve<
  Doc extends Record<string, unknown>,
  EventType extends Event,
  EventMetaDataType extends RealtimeDBReadEventMetadata =
    RealtimeDBReadEventMetadata,
> =
  | ((
      document: Doc | null,
      event: ReadEvent<EventType, EventMetaDataType>,
    ) => Doc | null)
  | ((
      document: Doc | null,
      event: ReadEvent<EventType>,
    ) => Promise<Doc | null>);

export type RealtimeDBInlineProjectionOptions<
  Doc extends Record<string, unknown>,
  EventType extends Event,
  EventMetaDataType extends RealtimeDBReadEventMetadata =
    RealtimeDBReadEventMetadata,
> = {
  name?: string;
  schemaVersion?: number;
  canHandle: CanHandle<EventType>;
} & (
  | {
      evolve: RealtimeDBWithNullableDocumentEvolve<
        Doc,
        EventType,
        EventMetaDataType
      >;
    }
  | {
      evolve: RealtimeDBWithNotNullDocumentEvolve<
        Doc,
        EventType,
        EventMetaDataType
      >;
      initialState: () => Doc;
    }
);
