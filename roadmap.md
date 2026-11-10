# Roadmap

Work planned for this library. All changes must be backward compatible.

Legend: Done, Partial, Open.

| Item | Status | Evidence and note |
|---|---|---|
| Idempotent application using the stream position | Done (0.8.0) | `realtimeDBInlineProjection` drops the events at or before the `_metadata.streamPosition` stored in the document. A projection that removed its document has no stored position, so `evolve` must ignore events for a missing document when a replay of old events matters |
| Projections see the identity and metadata the event store gave the event | Done (0.9.0) | `wireRealtimeDBProjections` uses the `messageIds` of the append result when there is one per event, and keeps the metadata given on append. Otherwise the derived `<streamName>-<streamPosition>` stays |
| Keep the existing `/testing` entry | Done | `src/testing/realtimeDBInlineProjectionSpec.ts` |
| Extend `/testing` with an in-memory database fake | Done (0.8.0) | `src/testing/inMemoryDatabase.ts` (`createInMemoryDatabase`), kept honest by `test/e2e/inMemoryDatabase.conformance.e2e.spec.ts`, which runs the same operations against the emulator. Listeners, queries, `transaction` and `onDisconnect` are not implemented and throw. Add them with a conformance case when a service needs them |
| Document that the library adds internal metadata to documents | Done (0.8.0) | README, "Internal Metadata" |
| Dates written by projections | Done (0.8.0) | The database has no date type and drops a `Date` without an error. `Date` and `Timestamp` values are written as ISO 8601 UTC strings (`toRealtimeDBValue`), and the README documents that they read back as strings |
| Check the `goOffline()`/`goOnline()` reset after a read timeout | Open | Against the emulator, a write made right after the pair did not complete within 10 seconds. Verify against a real database, then fix or remove the reset in `resetRealtimeDbConnection` |
| Asynchronous projection support | Open | Needs a runner that follows an event store in global order, applies events to read models in the Realtime Database, keeps a checkpoint per projection and can be reset to rebuild. Where the runner lives is not decided |
| Listeners, queries and transactions in the in-memory database | Open | Only if a service needs them |
| Lint and format check in CI | Done (0.10.0) | `build_and_test` runs `lint` and `format:check`, and a pull request that changes only documentation still reports the check |
| Catch up the read models of a stream | Done (0.10.0) | `projectStream` applies the stored events of a stream to the projections, which skip what they already applied |
| Events missed by a projection | Done (0.10.0) | A document left behind by a stopped process applies the missed events with the next append of its stream, reading only the missed range, so the gap is never permanent. Until that append the document stays behind; bringing it up to date without a new append is left to the code that composes the libraries |
| Reads after appends a projection does not handle | Open, known limit | A projection is called only for appends that contain a type it handles, so its stored position does not move with appends of other types, and the next append of a type it handles reads that range (and ignores it). Projections that handle every type of their stream never read. Calling every projection on every append to move the position would cost one write per projection per append, more than the read |
