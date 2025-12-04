import type {
  CanHandle,
  Event,
  ProjectionDefinition,
  ProjectionHandler,
  ReadEvent,
  ReadEventMetadataWithoutGlobalPosition,
} from '@event-driven-io/emmett';
import type { Database, Reference } from 'firebase-admin/database';

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

export type RealtimeDBProjectionInlineHandlerContext = {
  document: RealtimeDBReadModel | null;
  streamId: string;
  database: Database;
  projectionRef: Reference;
};

export type RealtimeDBInlineProjectionHandler<
  EventType extends Event = Event,
  EventMetaDataType extends RealtimeDBReadEventMetadata = RealtimeDBReadEventMetadata,
> = ProjectionHandler<
  EventType,
  EventMetaDataType,
  RealtimeDBProjectionInlineHandlerContext
>;

export type RealtimeDBInlineProjectionDefinition<
  EventType extends Event = Event,
  EventMetaDataType extends RealtimeDBReadEventMetadata = RealtimeDBReadEventMetadata,
> = ProjectionDefinition<
  EventType,
  EventMetaDataType,
  RealtimeDBProjectionInlineHandlerContext
> & { name: string };

export type InlineProjectionHandlerOptions<
  EventType extends Event = Event,
  EventMetaDataType extends RealtimeDBReadEventMetadata = RealtimeDBReadEventMetadata,
> = {
  events: Array<ReadEvent<EventType, EventMetaDataType>>;
  projections: RealtimeDBInlineProjectionDefinition<
    EventType,
    EventMetaDataType
  >[];
  streamId: string;
  database: Database;
};

export type RealtimeDBWithNotNullDocumentEvolve<
  Doc extends Record<string, unknown>,
  EventType extends Event,
  EventMetaDataType extends RealtimeDBReadEventMetadata = RealtimeDBReadEventMetadata,
> =
  | ((document: Doc, event: ReadEvent<EventType, EventMetaDataType>) => Doc | null)
  | ((document: Doc, event: ReadEvent<EventType>) => Promise<Doc | null>);

export type RealtimeDBWithNullableDocumentEvolve<
  Doc extends Record<string, unknown>,
  EventType extends Event,
  EventMetaDataType extends RealtimeDBReadEventMetadata = RealtimeDBReadEventMetadata,
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
  EventMetaDataType extends RealtimeDBReadEventMetadata = RealtimeDBReadEventMetadata,
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
