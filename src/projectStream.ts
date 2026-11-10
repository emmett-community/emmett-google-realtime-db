import type { EventStore } from '@event-driven-io/emmett';
import type { Database } from 'firebase-admin/database';
import {
  handleInlineProjections,
  type RealtimeDBInlineProjectionDefinition,
} from './projections';
import type { ObservabilityOptions } from './observability';

export type ProjectStreamOptions = {
  eventStore: EventStore;
  database: Database;
  projections: RealtimeDBInlineProjectionDefinition[];
  streamName: string;
  observability?: ObservabilityOptions;
};

/**
 * Brings the read models of one stream up to date by applying its stored events to the
 * projections. The inline projections are written after the append commits, in a separate
 * store, so a process that stops in between leaves them behind; this catches them up. Each
 * projection skips the events at or before the stream position it already stored, so calling it
 * on a stream whose read models are up to date changes nothing.
 *
 * The event store must give the stored events the same stream positions that its append results
 * report through `nextExpectedStreamVersion`, as `wireRealtimeDBProjections` uses those.
 */
export const projectStream = async (
  options: ProjectStreamOptions,
): Promise<void> => {
  const { eventStore, database, projections, streamName, observability } =
    options;
  if (projections.length === 0) return;

  const { events } = await eventStore.readStream(streamName);
  if (events.length === 0) return;

  await handleInlineProjections({
    events,
    projections,
    streamId: streamName,
    database,
    observability,
  });
};
