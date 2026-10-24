import path from 'node:path';
import admin from 'firebase-admin';
import type { Database } from 'firebase-admin/database';
import { GenericContainer, Wait } from 'testcontainers';

const projectId = 'demo-project';

export type StartedDatabaseEmulator = {
  database: Database;
  stop: () => Promise<void>;
};

/** Starts the Firebase emulator suite in Docker and connects the Admin SDK to its Realtime Database. */
export const startDatabaseEmulator =
  async (): Promise<StartedDatabaseEmulator> => {
    const container = await new GenericContainer(
      'myfstartup/firebase-emulator-suite:15',
    )
      .withPlatform('linux/amd64')
      .withExposedPorts(4000, 8080, 9000)
      .withBindMounts([
        {
          source: path.join(
            process.cwd(),
            'test',
            'support',
            'firebase',
            'firebase.json',
          ),
          target: '/app/firebase.json',
          mode: 'ro' as const,
        },
        {
          source: path.join(
            process.cwd(),
            'test',
            'support',
            'firebase',
            '.firebaserc',
          ),
          target: '/app/.firebaserc',
          mode: 'ro' as const,
        },
      ])
      .withEnvironment({ PROJECT_ID: projectId })
      .withWaitStrategy(Wait.forHealthCheck())
      .start();

    const host = container.getHost();
    const databasePort = container.getMappedPort(9000);

    process.env.FIREBASE_DATABASE_EMULATOR_HOST = `${host}:${databasePort}`;
    process.env.GCLOUD_PROJECT = projectId;

    const app = admin.initializeApp(
      {
        projectId,
        databaseURL: `http://${host}:${databasePort}?ns=${projectId}`,
      },
      `realtime-db-emulator-${Date.now()}`,
    );

    return {
      database: admin.database(app),
      stop: async () => {
        await app.delete();
        await container.stop();
      },
    };
  };
