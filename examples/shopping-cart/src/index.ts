import {
  getInMemoryMessageBus,
  IllegalStateError,
} from '@event-driven-io/emmett';
import { getFirestoreEventStore } from '@emmett-community/emmett-google-firestore';
import { wireRealtimeDBProjections } from '@emmett-community/emmett-google-realtime-db';
import {
  createOpenApiValidatorOptions,
  getApplication,
  startAPI,
  type ErrorToProblemDetailsMapping,
  type ImportedHandlerModules,
  type SecurityHandlers,
} from '@emmett-community/emmett-expressjs-with-openapi';
import { createLogger } from '@emmett-community/emmett-observability';
import type { Application } from 'express';
import admin from 'firebase-admin';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ShoppingCartError } from './shoppingCarts/businessLogic';
import type { ShoppingCartConfirmed } from './shoppingCarts/shoppingCart';
import {
  shoppingCartDetailsProjection,
  shoppingCartShortInfoProjection,
} from './shoppingCarts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const FIRESTORE_PROJECT_ID = process.env.FIRESTORE_PROJECT_ID || 'demo-project';
const FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const DATABASE_EMULATOR_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST;

// Logger initialization
const logger = createLogger({
  serviceName: 'shopping-cart',
  environment: process.env.NODE_ENV,
  logLevel: process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error',
});

// Initialize Firebase Admin
admin.initializeApp({
  projectId: FIRESTORE_PROJECT_ID,
  ...(DATABASE_EMULATOR_HOST && {
    databaseURL: `http://${DATABASE_EMULATOR_HOST}?ns=${FIRESTORE_PROJECT_ID}`,
  }),
});

// Get Firestore and Realtime Database instances
const firestore = admin.firestore();
const database = admin.database();

// Configure emulators if needed
if (FIRESTORE_EMULATOR_HOST) {
  firestore.settings({
    host: FIRESTORE_EMULATOR_HOST,
    ssl: false,
  });
}

if (DATABASE_EMULATOR_HOST) {
  const [host, port] = DATABASE_EMULATOR_HOST.split(':');
  process.env.FIREBASE_DATABASE_EMULATOR_HOST = `${host}:${port}`;
}

// Create Firestore event store
const baseEventStore = getFirestoreEventStore(firestore, {
  observability: { logger },
});

// Wire Realtime DB projections to the event store
const eventStore = wireRealtimeDBProjections<typeof baseEventStore>({
  eventStore: baseEventStore,
  database,
  projections: [
    shoppingCartDetailsProjection,
    shoppingCartShortInfoProjection,
  ],
  observability: { logger }
});

const messageBus = getInMemoryMessageBus();
const getUnitPrice = (_productId: string) => Promise.resolve(100);
const getCurrentTime = () => new Date();

messageBus.subscribe((event: ShoppingCartConfirmed) => {
  if (event.type === 'ShoppingCartConfirmed') {
    console.info(
      `Shopping cart confirmed: ${event.data.shoppingCartId} at ${event.data.confirmedAt.toISOString()}`,
    );
  }
}, 'ShoppingCartConfirmed');

const users = new Map([
  ['token-writer', { id: 'writer', scopes: ['cart:write'] }],
  [
    'token-admin',
    { id: 'admin', scopes: ['cart:write', 'cart:read', 'admin'] },
  ],
]);

const securityHandlers: SecurityHandlers = {
  bearerAuth: async (req, scopes) => {
    const authHeader = req.headers.authorization as string | undefined;

    if (!authHeader?.startsWith('Bearer ')) return false;

    const token = authHeader.substring('Bearer '.length);
    const user = users.get(token);
    if (!user) return false;

    req.user = user;

    if (scopes.length === 0) return true;

    return scopes.every((scope) => user.scopes.includes(scope));
  },
};

const openApiFilePath = path.join(__dirname, 'openapi.yml');

const errorStatusMap: Record<string, number> = {
  [ShoppingCartError.CART_CLOSED]: 403,
  [ShoppingCartError.CART_NOT_OPENED]: 403,
  [ShoppingCartError.INSUFFICIENT_QUANTITY]: 403,
  [ShoppingCartError.CART_ALREADY_EXISTS]: 409,
  [ShoppingCartError.CART_EMPTY]: 400,
};

const mapErrorToProblemDetails: ErrorToProblemDetailsMapping = (error) => {
  if (!(error instanceof IllegalStateError)) {
    return undefined; // Use default error handling
  }

  const statusCode = errorStatusMap[error.message] ?? 500;

  return {
    status: statusCode,
    title:
      statusCode === 403
        ? 'Forbidden'
        : statusCode === 409
          ? 'Conflict'
          : 'Bad Request',
    detail: error.message,
    type: 'about:blank',
  } as any;
};

export const app: Application = await getApplication({
  mapError: mapErrorToProblemDetails,
  observability: { logger },
  openApiValidator: createOpenApiValidatorOptions(openApiFilePath, {
    validateRequests: true,
    validateResponses: process.env.NODE_ENV !== 'production',
    validateFormats: 'fast',
    serveSpec: '/api-docs/openapi.yml',
    validateSecurity: { handlers: securityHandlers },
    operationHandlers: path.join(__dirname, './handlers'),
    initializeHandlers: async (handlers?: ImportedHandlerModules) => {
      // Framework auto-imports handler modules!
      handlers!.shoppingCarts.initializeHandlers(
        eventStore,
        database,
        messageBus,
        getUnitPrice,
        getCurrentTime,
      );
    },
  }),
});

const gracefulShutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutting down gracefully');  
  await firestore.terminate();
  await admin.app().delete();
  process.exit(0);
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 3000);
  startAPI(app, { port });
  logger.info(
    {
      port,
      apiDocsUrl: '/api-docs/openapi.yml',
      firebaseEmulatorUrl: 'http://localhost:4000'      
    },
    'Shopping Cart API started',
  );
}

// Graceful shutdown
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
