import * as admin from 'firebase-admin';
import type { Database } from 'firebase-admin/database';

/**
 * Creates a test Firebase Database instance connected to the emulator
 */
export const getTestDatabase = (): Database => {
  const projectId = process.env.FIRESTORE_PROJECT_ID || 'test-project';
  const emulatorHost =
    process.env.FIREBASE_DATABASE_EMULATOR_HOST || 'localhost:9000';

  // Create a unique app name to avoid conflicts in tests
  const appName = `test-${Date.now()}-${Math.random().toString(36).substring(7)}`;

  const app = admin.initializeApp(
    {
      projectId,
      databaseURL: `http://${emulatorHost}?ns=${projectId}`,
    },
    appName,
  );

  return admin.database(app);
};

/**
 * Clears all data from the database
 */
export const clearDatabase = async (database: Database): Promise<void> => {
  await database.ref().remove();
};

/**
 * Gets projection data from Realtime DB
 */
export const getProjectionData = async <T>(
  database: Database,
  projectionName: string,
  streamId: string,
): Promise<T | null> => {
  const snapshot = await database
    .ref(`projections/${projectionName}/${streamId}`)
    .once('value');
  return snapshot.val();
};

/**
 * Checks if a projection exists
 */
export const projectionExists = async (
  database: Database,
  projectionName: string,
  streamId: string,
): Promise<boolean> => {
  const snapshot = await database
    .ref(`projections/${projectionName}/${streamId}`)
    .once('value');
  return snapshot.exists();
};

/**
 * Deletes a specific projection
 */
export const deleteProjection = async (
  database: Database,
  projectionName: string,
  streamId: string,
): Promise<void> => {
  await database.ref(`projections/${projectionName}/${streamId}`).remove();
};

/**
 * Deletes all projections for a given projection name
 */
export const deleteAllProjectionsOfType = async (
  database: Database,
  projectionName: string,
): Promise<void> => {
  await database.ref(`projections/${projectionName}`).remove();
};

/**
 * Gets all projection data for a given projection name
 */
export const getAllProjectionsOfType = async <T>(
  database: Database,
  projectionName: string,
): Promise<Record<string, T>> => {
  const snapshot = await database
    .ref(`projections/${projectionName}`)
    .once('value');
  return snapshot.val() || {};
};

/**
 * Deletes a Firebase app instance (cleanup)
 */
export const cleanupApp = async (database: Database): Promise<void> => {
  await database.app.delete();
};

/**
 * Helper to create a test database with automatic cleanup
 */
export const withTestDatabase = async <T>(
  testFn: (database: Database) => Promise<T>,
): Promise<T> => {
  const database = getTestDatabase();
  try {
    return await testFn(database);
  } finally {
    await cleanupApp(database);
  }
};
