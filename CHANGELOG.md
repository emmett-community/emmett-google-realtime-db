# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.8.0] - 2026-10-24

### Added

- Idempotent application: a projection skips the events whose stream position is at or before the `_metadata.streamPosition` stored in the document, so a replayed or redelivered batch is applied once. Documents without a stored position apply every event, as before.
- `toRealtimeDBValue`: returns a copy of a value with every `Date` and Firestore `Timestamp` replaced by an ISO 8601 UTC string.
- `/testing`: `createInMemoryDatabase` and the `InMemoryRealtimeDatabase` class, an in-memory Realtime Database with tree semantics that follows the real database (absent data is `null`, `null` and `{}` remove, `undefined` throws), and supports `update`, `push`, `get`, snapshots with `exists`, `key`, `forEach` and the like, and `goOffline`/`goOnline` as no-ops. Listeners, queries, `transaction` and `onDisconnect` throw a clear error.
- A conformance suite that runs the same operations against the Firebase emulator and the in-memory database and requires the same results.
- README sections on idempotent application, dates, the internal `_metadata` field and the in-memory database.

### Changed

- Projection documents are written through `toRealtimeDBValue`: a `Date` or `Timestamp` in a document is now stored as an ISO 8601 UTC string. The Realtime Database has no date type and drops a `Date` without an error, so such a field used to be missing when the document was read. Code that reads the document gets a string.
- Integration tests use the in-memory database of `/testing` instead of a flat key-value helper. Their event store mocks return a version that advances per stream, as a real event store does: a fixed version gives every append the same position, which idempotent projections skip.
- The shopping cart example uses the in-memory database of `/testing` in its integration tests and checks that `openedAt` is stored as an ISO string.

### Notes

- When `evolve` returns `null` the document is removed together with its stored position, so older events replayed afterwards are applied again. Make `evolve` ignore events for a missing document when that matters.
- The `goOffline()`/`goOnline()` reset after a read timeout is unchanged. Against the Firebase emulator, a write made right after that pair did not complete within 10 seconds. It has not been checked against a real database.

## [0.7.0] - 2026-01-15

### Changed

- Shopping cart example now wires `@emmett-community/emmett-observability` logging into the API, event store, and projections so startup/shutdown events run through the shared logger with configurable log level and HTTP logging flags.
- The example's Docker Compose fixture pins the emulator to `linux/amd64` and injects `NODE_ENV`, `LOG_LEVEL`, and `LOG_HTTP_ENABLED` so the API and tests run with consistent observability defaults while the retry-testing changes are exercised.

## [0.6.0] - 2026-01-14

### Changed

- Realtime DB inline projections now wrap `once('value')` reads with a timeout/retry policy (5s, 8s, 12s) plus short backoff; timed-out reads reset the client via `goOffline()`/`goOnline()` before retrying to avoid stale connections.

## [0.5.0] - 2026-01-05

### Changed

- Updated `firebase-admin` peer dependency from `^12.0.0` to `^13.0.0`
- Minimum Node.js version remains `>=18.0.0` (already required)

### Notes

- firebase-admin v13 dropped support for Node.js 14 and 16
- No code changes required - only Realtime Database APIs are used, which remain compatible

## [0.4.0] - 2026-01-01

### Changed

- Logger interface now uses canonical `(context, message)` signature instead of `(message, data)`
- Logger methods are now required (not optional)
- Error objects are normalized with `err` key for Pino compatibility
- `safeLog` is no longer exported from the package (internal only)

### Added

- Formal Logger contract documentation with semantic rules
- `normalizeContext` and `normalizeErrorContext` internal functions
- Logger contract tests validating Pino and Winston compatibility
- Protection against mutation of context objects

## [0.3.0] - 2025-12-31

### Added

- Optional observability support with logging and tracing
- Logger interface compatible with Pino, Winston, and similar libraries
- Passive OpenTelemetry tracing at I/O boundaries
- `@opentelemetry/api` as a regular dependency
- New `observability` option in `wireRealtimeDBProjections`
- Unit and integration tests for observability
- README section documenting observability features

### Changed

- `InlineProjectionHandlerOptions` now accepts optional `observability` parameter

## [0.2.0] - 2025-12-27

### Added

- In-memory Realtime DB test helper for integration tests
- Testcontainers-based E2E coverage for Realtime DB projections
- Firebase emulator configs under `test/support/firebase`
- GitHub Actions workflows for build/test and publish

### Changed

- Integration tests now use in-memory Realtime DB
- Example E2E tests run against Firebase emulators via Testcontainers
- Example docker-compose uses `myfstartup/firebase-emulator-suite:15` image
- Example OpenAPI spec moved under `examples/shopping-cart/src`
- Example Firebase configs moved under `examples/shopping-cart/test/support/firebase`
- README and example docs aligned with new test strategy

### Removed

- `examples/shopping-cart/Dockerfile.firebase`
- `examples/shopping-cart/.env.example`

## [0.1.0] - 2025-12-14

### Added

- Initial release
- Inline projection support for Google Realtime Database
- `realtimeDBInlineProjection` for defining projections with evolve functions
- `wireRealtimeDBProjections` for integrating projections with any Emmett EventStore
- Testing utilities for projection validation
- Shopping cart example with Firestore + Realtime DB
- Comprehensive unit, integration, and E2E tests
- Full documentation and examples
- First public release
- Core projection functionality
- EventStore-agnostic design (works with any Emmett EventStore)
- Firebase Emulator support for local development
- Docker Compose setup with Firebase UI
