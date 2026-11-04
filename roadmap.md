# Roadmap

Work planned for this library, driven by the rules of the my-f-startup reference architecture (read models: ADR-007). All changes must be backward compatible.

Legend: Done, Partial, Open.

| Item | Status | Evidence and note |
|---|---|---|
| Idempotent application using the stream position | Done (0.8.0) | `realtimeDBInlineProjection` drops the events at or before the `_metadata.streamPosition` stored in the document. A projection that removed its document has no stored position, so `evolve` must ignore events for a missing document when a replay of old events matters |
| Keep the existing `/testing` entry | Done | `src/testing/realtimeDBInlineProjectionSpec.ts` |
| Extend `/testing` with an in-memory database fake | Done (0.8.0) | `src/testing/inMemoryDatabase.ts` (`createInMemoryDatabase`), kept honest by `test/e2e/inMemoryDatabase.conformance.e2e.spec.ts`, which runs the same operations against the emulator. Listeners, queries, `transaction` and `onDisconnect` are not implemented and throw. Add them with a conformance case when a service needs them |
| Document that the library adds internal metadata to documents | Done (0.8.0) | README, "Internal Metadata" |
| Dates written by projections | Done (0.8.0) | The database has no date type and drops a `Date` without an error. `Date` and `Timestamp` values are written as ISO 8601 UTC strings (`toRealtimeDBValue`), and the README documents that they read back as strings |
| Check the `goOffline()`/`goOnline()` reset after a read timeout | Open | Against the emulator, a write made right after the pair did not complete within 10 seconds. Verify against a real database, then fix or remove the reset in `resetRealtimeDbConnection` |
| Asynchronous projection support | Open | See the roadmap of the Firestore event store library, which also describes where the runner may live |
| Listeners, queries and transactions in the in-memory database | Open | Only if a service needs them |
