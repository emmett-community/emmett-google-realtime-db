import type { Database, Reference } from 'firebase-admin/database';
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { handleInlineProjections } from '../../src/projections/realtimeDBInlineProjection';
import { cartProjection } from '../fixtures/projections';
import { itemAdded } from '../fixtures/events';

const exporter = new InMemorySpanExporter();
const contextManager = new AsyncLocalStorageContextManager();
const provider = new BasicTracerProvider();
provider.addSpanProcessor(new SimpleSpanProcessor(exporter));

const activeSpanId = () => trace.getActiveSpan()?.spanContext().spanId;
const finished = (name: string): ReadableSpan[] =>
  exporter.getFinishedSpans().filter((span) => span.name === name);

// What a projection does, including reading the events it missed from the event store, is traced
// under the span of the projection
describe('handleInlineProjections - tracing context', () => {
  beforeAll(() => {
    provider.register({ contextManager: contextManager.enable() });
  });

  afterAll(async () => {
    await provider.shutdown();
    contextManager.disable();
    trace.disable();
    context.disable();
  });

  it('reads the document and the missed events with the projection span active', async () => {
    const seenByRead: (string | undefined)[] = [];
    const seenByWrite: (string | undefined)[] = [];
    const projectionRef = {
      once: jest.fn(() => {
        seenByRead.push(activeSpanId());
        return Promise.resolve({ val: () => null, exists: () => false });
      }),
      set: jest.fn(() => {
        seenByWrite.push(activeSpanId());
        return Promise.resolve();
      }),
      remove: jest.fn().mockResolvedValue(undefined),
    } as unknown as Reference;
    const database = {
      ref: jest.fn().mockReturnValue(projectionRef),
    } as unknown as Database;
    const seenByReader: (string | undefined)[] = [];

    await handleInlineProjections({
      events: [itemAdded('item-2', 1, { position: BigInt(2) })],
      projections: [cartProjection],
      streamId: 'cart-1',
      database,
      streamIsNew: false,
      readStoredEvents: () => {
        seenByReader.push(activeSpanId());
        return Promise.resolve([
          itemAdded('item-1', 1, { position: BigInt(1) }),
        ]);
      },
    });

    const [all] = finished('emmett.realtime_db.handle_projections');
    const [single] = finished('emmett.realtime_db.projection.handle');
    const projectionSpanId = single.spanContext().spanId;
    expect(single.parentSpanId).toBe(all.spanContext().spanId);
    expect(seenByRead).toEqual([projectionSpanId]);
    expect(seenByReader).toEqual([projectionSpanId]);
    expect(seenByWrite).toEqual([projectionSpanId]);
  });
});
