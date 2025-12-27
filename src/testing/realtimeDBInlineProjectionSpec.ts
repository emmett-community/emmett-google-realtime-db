import type { Event, ReadEvent } from '@event-driven-io/emmett';
import type { Database } from 'firebase-admin/database';
import type {
  RealtimeDBInlineProjectionDefinition,
  RealtimeDBReadEventMetadata,
} from '../projections/types';

export type ProjectionTestContext = {
  database: Database;
  streamId: string;
};

export const testProjection = async <
  EventType extends Event = Event,
  EventMetaDataType extends RealtimeDBReadEventMetadata = RealtimeDBReadEventMetadata,
>(
  projection: RealtimeDBInlineProjectionDefinition<EventType, EventMetaDataType>,
  events: Array<ReadEvent<EventType, EventMetaDataType>>,
  context: ProjectionTestContext,
): Promise<void> => {
  const { database, streamId } = context;
  const projectionRef = database.ref(`projections/${projection.name}/${streamId}`);
  const snapshot = await projectionRef.once('value');
  const document = snapshot.val() ?? null;

  await projection.handle(events, {
    document,
    streamId,
    database,
    projectionRef,
  });
};

export const getProjectionState = async <T = unknown>(
  database: Database,
  projectionName: string,
  streamId: string,
): Promise<T | null> => {
  const ref = database.ref(`projections/${projectionName}/${streamId}`);
  const snapshot = await ref.once('value');
  const data = snapshot.val();

  if (!data) return null;

  // Convert streamPosition from string to BigInt if needed
  if (data._metadata && typeof data._metadata.streamPosition === 'string') {
    data._metadata.streamPosition = BigInt(data._metadata.streamPosition);
  }

  return data as T;
};

export const clearProjection = async (
  database: Database,
  projectionName: string,
  streamId: string,
): Promise<void> => {
  const ref = database.ref(`projections/${projectionName}/${streamId}`);
  await ref.remove();
};

export const clearAllProjections = async (
  database: Database,
): Promise<void> => {
  const ref = database.ref('projections');
  await ref.remove();
};
