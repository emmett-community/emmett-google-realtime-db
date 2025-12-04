# @emmett-community/emmett-google-realtime-db

Google Realtime Database inline projections for [Emmett](https://event-driven-io.github.io/emmett/) - Event Sourcing development made simple.

## Overview

This package provides **inline projection** support for Emmett using Google Firebase Realtime Database. It enables you to create real-time read models that are updated synchronously when events are appended to your event store.

### Key Features

- **Inline Projections**: Synchronously updated projections stored in Realtime Database
- **EventStore-Agnostic**: Works with any Emmett EventStore (Firestore, PostgreSQL, MongoDB, etc.)
- **Type-Safe**: Full TypeScript support
- **Real-time**: Leverage Firebase Realtime Database for real-time read models
- **Simple Integration**: Wire projections to your existing event store with one function call

## Installation

```bash
npm install @emmett-community/emmett-google-realtime-db firebase-admin
```

### Peer Dependencies

- `@event-driven-io/emmett` ^0.39.0
- `firebase-admin` ^12.0.0

## Quick Start

### 1. Define a Projection

```typescript
import { realtimeDBInlineProjection } from '@emmett-community/emmett-google-realtime-db';

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
```

### 2. Wire Projections to Event Store

```typescript
import { wireRealtimeDBProjections } from '@emmett-community/emmett-google-realtime-db';
import { getFirestoreEventStore } from '@emmett-community/emmett-google-firestore';
import * as admin from 'firebase-admin';

// Initialize Firebase
admin.initializeApp({ /* config */ });
const database = admin.database();
const firestore = admin.firestore();

// Create event store
const baseEventStore = getFirestoreEventStore(firestore);

// Wire projections
const eventStore = wireRealtimeDBProjections({
  eventStore: baseEventStore,
  database,
  projections: [shoppingCartSummaryProjection],
});

// Now when you append events, projections are automatically updated!
await eventStore.appendToStream(streamId, events);
```

### 3. Query Projections

```typescript
const getSummary = async (
  database: Database,
  cartId: string
): Promise<ShoppingCartSummary | null> => {
  const snapshot = await database
    .ref(`projections/shoppingCartSummary/${cartId}`)
    .once('value');
  return snapshot.val() ?? null;
};

// Use in your API
const summary = await getSummary(database, 'cart-123');
```

## How It Works

### Inline Projections

Inline projections are **updated synchronously** when events are appended to the event store. This guarantees:

- **Strong Consistency**: Projections are always up-to-date with the event stream
- **Atomic Updates**: Projection updates happen in the same operation as event append
- **Real-time**: Perfect for critical read models that need immediate consistency

### Data Structure

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
docker-compose up firebase

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

### Running Package Tests

The package has comprehensive test coverage with 123 tests (unit + integration).

**Prerequisites:**

- Firebase Realtime Database emulator running on port 9000

**Run all tests:**

```bash
npm test
```

**Run only unit tests:**

```bash
npm run test:unit
```

**Run only integration tests:**

```bash
npm run test:integration
```

**Generate coverage report:**

```bash
npm run test:coverage
```

**Start Firebase emulator for tests:**

```bash
# Option 1: Using Firebase CLI
firebase emulators:start --only database --project test-project

# Option 2: Using Docker
docker run -p 9000:9000 \
  --env "FIREBASE_DATABASE_EMULATOR_HOST=0.0.0.0:9000" \
  firebase-tools:latest \
  firebase emulators:start --only database --project test-project
```

**Test Coverage:**

- **123 total tests** (9 test suites)
- Unit tests: 55 tests covering core logic
- Integration tests: 68 tests with Firebase emulator
- Coverage threshold: 80% on all metrics (branches, functions, lines, statements)

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
docker-compose up firebase
```

## Comparison: Inline vs Async Projections

| Feature | Inline Projections (this package) | Async Projections |
|---------|-----------------------------------|-------------------|
| Update Timing | Synchronous with event append | Asynchronous (background) |
| Consistency | Strong (atomic with events) | Eventual |
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
