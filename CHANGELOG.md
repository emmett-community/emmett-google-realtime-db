# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
