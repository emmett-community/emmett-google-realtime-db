import path from 'node:path';
import type { EventStore } from '@event-driven-io/emmett';
import admin from 'firebase-admin';
import type { Database } from 'firebase-admin/database';
import { GenericContainer, Wait } from 'testcontainers';
import { handleInlineProjections } from '../../src/projections/realtimeDBInlineProjection';
import { getProjectionState } from '../../src/testing';
import { wireRealtimeDBProjections } from '../../src/wireRealtimeDBProjections';
import { itemAdded } from '../fixtures/events';
import { counterProjection, type PersistedCounterState } from '../fixtures/projections';

jest.setTimeout(60000);

const projectId = 'demo-project';

let emulator: import('testcontainers').StartedTestContainer | null = null;
let emulatorHost = '';
let databasePort = 0;
let database: Database;
let app: admin.app.App;

const startEmulator = async () => {
  const container = await new GenericContainer(
    'myfstartup/firebase-emulator-suite:15',
  )
    .withPlatform('linux/amd64')
    .withExposedPorts(4000, 8080, 9000)
    .withBindMounts([
      {
        source: path.join(process.cwd(), 'test', 'support', 'firebase', 'firebase.json'),
        target: '/app/firebase.json',
        mode: 'ro' as const,
      },
      {
        source: path.join(process.cwd(), 'test', 'support', 'firebase', '.firebaserc'),
        target: '/app/.firebaserc',
        mode: 'ro' as const,
      },
    ])
    .withEnvironment({ PROJECT_ID: projectId })
    .withWaitStrategy(Wait.forHealthCheck())
    .start();

  emulatorHost = container.getHost();
  databasePort = container.getMappedPort(9000);

  process.env.FIREBASE_DATABASE_EMULATOR_HOST = `${emulatorHost}:${databasePort}`;
  process.env.FIRESTORE_PROJECT_ID = projectId;
  process.env.GCLOUD_PROJECT = projectId;

  return container;
};

beforeAll(async () => {
  emulator = await startEmulator();

  app = admin.initializeApp(
    {
      projectId,
      databaseURL: `http://${emulatorHost}:${databasePort}?ns=${projectId}`,
    },
    `realtime-db-e2e-${Date.now()}`,
  );
  database = admin.database(app);
});

afterAll(async () => {
  await app.delete();
  if (emulator) {
    await emulator.stop();
  }
});

beforeEach(async () => {
  await database.ref().remove();
});

describe('Realtime DB projections e2e', () => {
  it('persists projection state using handleInlineProjections', async () => {
    const streamId = 'stream-inline';
    const events = [itemAdded('item-1', 1, { position: BigInt(0) })];

    await handleInlineProjections({
      events: events as any,
      projections: [counterProjection] as any,
      streamId,
      database,
    });

    const state = await getProjectionState<PersistedCounterState>(
      database,
      'test-counter',
      streamId,
    );

    expect(state).not.toBeNull();
    expect(state?.count).toBe(1);
    expect(state?._metadata.streamPosition).toBe(BigInt(0));
  });

  it('writes projections when wiring event store appends', async () => {
    const mockEventStore: jest.Mocked<EventStore> = {
      appendToStream: jest.fn().mockResolvedValue({
        nextExpectedStreamVersion: BigInt(0),
        createdNewStream: true,
      }),
      readStream: jest.fn(),
      aggregateStream: jest.fn(),
    } as any;

    const wired = wireRealtimeDBProjections({
      eventStore: mockEventStore,
      database,
      projections: [counterProjection],
    });

    await wired.appendToStream('stream-wired', [
      {
        type: 'ItemAdded',
        data: { itemId: 'item-1', quantity: 1 },
      },
    ] as any);

    const state = await getProjectionState<PersistedCounterState>(
      database,
      'test-counter',
      'stream-wired',
    );

    expect(state).not.toBeNull();
    expect(state?.count).toBe(1);
  });
});
