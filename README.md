# @emmett-community/emmett-google-realtime-db

Google Realtime Database inline projections for [Emmett](https://event-driven-io.github.io/emmett/), the Node.js event sourcing framework.

[![npm version](https://img.shields.io/npm/v/@emmett-community/emmett-google-realtime-db.svg)](https://www.npmjs.com/package/@emmett-community/emmett-google-realtime-db) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- ✅ **Inline Projections** - Update projections in Realtime Database after each append
- ✅ **EventStore-Agnostic** - Works with any Emmett EventStore (Firestore, PostgreSQL, MongoDB, etc.)
- ✅ **Type-Safe** - Full TypeScript support with projection metadata
- ✅ **Real-time Read Models** - Queryable views stored in Firebase RTDB
- ✅ **Idempotent** - Events already applied (by stream position) are skipped, so a replay does not change the read model
- ✅ **Testing Utilities** - Helpers for projection validation and an in-memory Realtime Database for service tests
- ✅ **Simple Integration** - Wire projections with a single function call

## Installation

```bash
npm install @emmett-community/emmett-google-realtime-db firebase-admin
```

### Peer Dependencies

- `@event-driven-io/emmett` ^0.39.0
- `firebase-admin` ^12.0.0

## Quick Start

```typescript
import { realtimeDBInlineProjection, wireRealtimeDBProjections } from '@emmett-community/emmett-google-realtime-db';
import {
  getFirestoreEventStore,
  asEventStore,
} from '@emmett-community/emmett-google-firestore';
import * as admin from 'firebase-admin';

admin.initializeApp({ /* config */ });
const database = admin.database();
const firestore = admin.firestore();

type ShoppingCartSummary = {
  totalAmount: number;
  itemCount: number;
};

const shoppingCartSummaryProjection = realtimeDBInlineProjection<
  ShoppingCartSummary,
  ShoppingCartEvent
>({
  name: 'shoppingCartSummary',
  canHandle: ['ProductItemAdded', 'ProductItemRemoved'],
  initialState: () => ({ totalAmount: 0, itemCount: 0 }),
  evolve: (state, event) => {
    switch (event.type) {
      case 'ProductItemAdded':
        return {
          totalAmount: state.totalAmount + event.data.price,
          itemCount: state.itemCount + 1,
        };
      case 'ProductItemRemoved':
        return {
          totalAmount: state.totalAmount - event.data.price,
          itemCount: state.itemCount - 1,
        };
      default:
        return state;
    }
  },
});

const baseEventStore = getFirestoreEventStore(firestore);
const eventStore = wireRealtimeDBProjections({
  eventStore: asEventStore(baseEventStore),
  database,
  projections: [shoppingCartSummaryProjection],
});

await eventStore.appendToStream(streamId, events);
```

```typescript
const summary = await database
  .ref(`projections/shoppingCartSummary/${cartId}`)
  .once('value')
  .then((snapshot) => snapshot.val() ?? null);
```

## How It Works

### Inline Projections

Inline projections are **updated immediately after** `appendToStream` completes. Updates run sequentially for matching projections, which makes them predictable, but they are **not transactional** with the event write. Applying events is idempotent (see below), so a retry or a redelivery is safe.

### Idempotent Application

Every document stores the stream position of the last event it applied in `_metadata.streamPosition`. Before evolving the document, the projection drops the events whose position is at or before the stored one:

- A batch that was already applied changes nothing and writes nothing.
- A batch that overlaps the stored position applies only its new events.
- A document without `_metadata.streamPosition` (written by an older version) applies every event.

This assumes that events of a stream arrive in position order. A projection that deleted its document (its `evolve` returned `null`) has no stored position, so a replay of the older events would apply them again; make `evolve` ignore events for a missing document when that matters (the shopping cart example does this).

### Dates

The Realtime Database has no date type. It stores a `Date` as an object without children, which means the field **silently disappears**. To keep dates, the library writes every `Date` and Firestore `Timestamp` found in a document as an **ISO 8601 UTC string** (`2026-10-24T12:30:00.000Z`), at any depth. Your `evolve` can keep working with `Date` values; what you read back from the database is a string, so type the persisted read model with `string` (or convert it when you read it).

### Internal Metadata

Every document is written with a `_metadata` field (`streamId`, `name`, `schemaVersion`, `streamPosition`). It belongs to the library: it drives idempotency and schema versioning, and it is not part of your read model. If a service returns the document as it is, `_metadata` goes out in the API response, so remove it first:

```typescript
const { _metadata, ...readModel } = document;
```

### Realtime Database Structure

Projections are stored in Realtime Database at:

```
/projections/{projection-name}/{stream-id}
```

Example:

```json
{
  "projections": {
    "shoppingCartSummary": {
      "shopping_cart:client-123:current": {
        "totalAmount": 150,
        "itemCount": 3,
        "_metadata": {
          "streamId": "shopping_cart:client-123:current",
          "name": "shoppingCartSummary",
          "schemaVersion": 1,
          "streamPosition": "5"
        }
      }
    }
  }
}
```

## API Reference

### `realtimeDBInlineProjection`

Creates an inline projection definition.

```typescript
function realtimeDBInlineProjection<Doc, EventType>(
  options: RealtimeDBInlineProjectionOptions<Doc, EventType>
): RealtimeDBInlineProjectionDefinition;
```

**Options:**

- `name` (optional): Projection name (default: `'_default'`)
- `schemaVersion` (optional): Schema version for migration support (default: `1`)
- `canHandle`: Array of event types this projection handles
- `evolve`: Function that applies events to the projection state
- `initialState` (optional): Function that returns initial state (required for non-nullable evolve)

**Note on Realtime DB reads:**

`realtimeDBInlineProjection` wraps `ref(...).once('value')` with a timeout + retry mechanism to avoid hangs when the RTDB connection becomes stale. Current defaults: 3 attempts with timeouts of 5s, 8s, and 12s, with a short backoff between tries. When a timeout happens, the Realtime DB client is reset via `goOffline()` + `goOnline()` before retrying. If you need different timeout/retry behavior, you can still wrap RTDB reads in your application where needed.

Known limitation: against the Firebase emulator, a write made right after the `goOffline()` + `goOnline()` pair did not complete within 10 seconds. It has not been checked against a real database yet, so treat the reset as best effort.

**Example:**

```typescript
const projection = realtimeDBInlineProjection({
  name: 'myProjection',
  schemaVersion: 1,
  canHandle: ['EventA', 'EventB'],
  initialState: () => ({ count: 0 }),
  evolve: (state, event) => ({ count: state.count + 1 }),
});
```

### `wireRealtimeDBProjections`

Wires projections to an existing event store.

```typescript
function wireRealtimeDBProjections(
  options: WireRealtimeDBProjectionsOptions
): EventStore;
```

**Options:**

- `eventStore`: Your Emmett event store
- `database`: Firebase Realtime Database instance
- `projections`: Array of projection definitions

**Example:**

```typescript
const eventStore = wireRealtimeDBProjections({
  eventStore: myEventStore,
  database: admin.database(),
  projections: [projection1, projection2],
});
```

## Examples

See the [shopping cart example](./examples/shopping-cart) for a complete, production-ready implementation featuring:

- **Two projections**: `ShoppingCartDetails` (full data) and `ShoppingCartShortInfo` (summary)
- **Express.js API** with OpenAPI validation
- **Docker Compose** setup with Firebase emulators
- **Comprehensive tests**: unit, integration, and E2E

### Running the Example

```bash
cd examples/shopping-cart

# Install dependencies
npm install

# Start Firebase emulators
docker-compose up

# Start the application
npm start

# Run tests
npm test
```

Visit:

- API: http://localhost:3000
- Firebase UI: http://localhost:4000

## Testing

### Testing Your Projections

The package includes testing utilities for projection validation:

```typescript
import {
  testProjection,
  getProjectionState,
  clearProjection,
  clearAllProjections,
} from '@emmett-community/emmett-google-realtime-db/testing';

// Test a projection
await testProjection(
  myProjection,
  [event1, event2],
  { database, streamId: 'test-stream' }
);

// Get current state
const state = await getProjectionState(database, 'projectionName', 'streamId');

// Clear specific projection
await clearProjection(database, 'projectionName', 'streamId');

// Clear all projections
await clearAllProjections(database);
```

### In-Memory Realtime Database

Service tests can run the real projection, with no emulator, against an in-memory Realtime Database:

```typescript
import {
  createInMemoryDatabase,
  getProjectionState,
} from '@emmett-community/emmett-google-realtime-db/testing';

const database = createInMemoryDatabase();

const eventStore = wireRealtimeDBProjections({
  eventStore: myEventStore,
  database,
  projections: [myProjection],
});

await eventStore.appendToStream(streamId, events);

const state = await getProjectionState(database, 'projectionName', streamId);
```

The fake follows the real database where projections break, instead of being a plain key-value store:

- Data is a tree: a parent path reads back the nested object, and a child path reads the nested value.
- Absent data reads as `null`; `set(null)` and `set({})` remove, and `null` fields and empty objects are pruned.
- `set` throws on `undefined` (also inside arrays), `NaN`, `Infinity` and invalid keys, as the real SDK does.
- A `Date` that reaches the database is stored as nothing. Projections written with this library never hit it, because they write dates as strings.
- Arrays are read back as arrays when their keys are dense integers, and as objects otherwise.
- Supported: `ref`, `child`, `parent`, `root`, `key`, `set`, `update` (with path keys), `remove`, `push`, `once('value')`, `get`, `goOffline` and `goOnline` (no-ops), and snapshots with `val`, `exists`, `key`, `child`, `hasChild`, `hasChildren`, `numChildren`, `forEach` and `exportVal`.
- Not implemented, they throw a clear error: listeners (`on`, `off`), queries (`orderByChild` and the like), `transaction`, `onDisconnect` and priorities.

A conformance suite (`test/e2e/inMemoryDatabase.conformance.e2e.spec.ts`) runs the same operations against the Firebase emulator and the fake and requires the same results. When you need a behavior the fake does not have, add it together with a case in that suite.

### Running Package Tests

```bash
# Unit tests
npm run test:unit

# Integration tests (in-memory Realtime DB)
npm run test:int

# E2E tests (Firebase emulators via Testcontainers, requires Docker),
# including the conformance suite of the in-memory Realtime Database
npm run test:e2e

# All tests
npm test

# Coverage
npm run test:coverage
```

Test files live in `test/` and are selected by filename suffix:

- `*.unit.spec.ts` (unit tests, pure logic)
- `*.int.spec.ts` (integration tests, in-memory Realtime DB)
- `*.e2e.spec.ts` (E2E tests, Firebase emulators via Testcontainers)

Support fixtures live under `test/support` (including Firebase emulator configs in `test/support/firebase`).

### Using Firebase Emulator

For local development and manual testing:

```bash
firebase emulators:start --only database --project demo-project
```

Set environment variables:

```bash
export FIREBASE_DATABASE_EMULATOR_HOST=localhost:9000
```

E2E tests start the emulators automatically via Testcontainers.

## Observability

### Logging

Logging is optional and opt-in. To enable logging, provide a logger instance:

```typescript
import pino from 'pino';

const eventStore = wireRealtimeDBProjections({
  eventStore: asEventStore(baseEventStore),
  database,
  projections: [shoppingCartSummaryProjection],
  observability: {
    logger: pino(),
  },
});
```

The logger interface is compatible with Pino, Winston, and similar libraries:

```typescript
interface Logger {
  debug?(msg: string, data?: unknown): void;
  info?(msg: string, data?: unknown): void;
  warn?(msg: string, data?: unknown): void;
  error?(msg: string, err?: unknown): void;
}
```

Without a logger, the library operates silently.

### Tracing

This package emits OpenTelemetry spans at I/O boundaries. Tracing is passive:

- Spans are created using `@opentelemetry/api`
- If your application initializes OpenTelemetry, spans are captured
- If not initialized, spans are no-ops with zero overhead
- No configuration flags required

Span names follow the `emmett.realtime_db.*` pattern.

## Architecture

### EventStore-Agnostic Design

This package works with **any** Emmett event store:

- ✅ Firestore (as shown in examples)
- ✅ PostgreSQL (`@event-driven-io/emmett-postgresql`)
- ✅ MongoDB (`@event-driven-io/emmett-mongodb`)
- ✅ EventStoreDB (`@event-driven-io/emmett-esdb`)
- ✅ In-memory (for testing)

The projections are triggered by intercepting `appendToStream`, making them compatible with any storage backend.

### Integration with Firestore

While this package is EventStore-agnostic, the most common pattern is:

- **Events**: Stored in Firestore (using `@emmett-community/emmett-google-firestore`)
- **Projections**: Stored in Realtime Database (using this package)

This combination provides:

- Strong consistency for events (Firestore ACID transactions)
- Projection updates immediately after appends
- Real-time read models (Realtime Database synchronization)
- Optimal cost/performance balance

## Firebase Emulator Setup

For local development and testing:

```json
// firebase.json
{
  "emulators": {
    "ui": {
      "enabled": true,
      "host": "0.0.0.0",
      "port": 4000
    },
    "firestore": {
      "host": "0.0.0.0",
      "port": 8080
    },
    "database": {
      "host": "0.0.0.0",
      "port": 9000
    }
  }
}
```

```bash
# Start emulators
firebase emulators:start

# Or with Docker
docker-compose up
```

## Comparison: Inline vs Async Projections

| Feature | Inline Projections (this package) | Async Projections |
|---------|-----------------------------------|-------------------|
| Update Timing | Immediately after append | Asynchronous (background) |
| Consistency | Consistent after append (not transactional) | Eventual |
| Storage | Realtime Database | Separate collections/tables |
| Use Cases | Critical read models, current state | Analytics, reports, denormalized views |
| Complexity | Simple (no background workers) | Complex (requires consumers/subscriptions) |

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT

## Related Packages

- [@event-driven-io/emmett](https://github.com/event-driven-io/emmett) - Core Emmett framework
- [@emmett-community/emmett-google-firestore](https://github.com/emmett-community/emmett-google-firestore) - Firestore event store
- [@event-driven-io/emmett-mongodb](https://github.com/event-driven-io/emmett/tree/main/src/packages/emmett-mongodb) - MongoDB event store with inline projections (inspiration for this package)

## Support

- [GitHub Issues](https://github.com/emmett-community/emmett-google-realtime-db/issues)
- [Emmett Documentation](https://event-driven-io.github.io/emmett/)

---

Made with ❤️ by the Emmett Community
