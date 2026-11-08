/**
 * `appendToStream` mock that behaves like a real event store: each stream has
 * its own version, and every append moves it forward by the number of events.
 *
 * `wireRealtimeDBProjections` derives the stream position of each event from
 * `nextExpectedStreamVersion`. A mock that always returns the same version
 * gives every append the same position, which idempotent projections skip.
 */
export const createVersionedAppendMock = () => {
  const versions = new Map<string, bigint>();

  return jest
    .fn<
      Promise<{ nextExpectedStreamVersion: bigint; createdNewStream: boolean }>,
      [string, unknown[]]
    >()
    .mockImplementation((streamName: string, events: unknown[]) => {
      const current = versions.get(streamName) ?? BigInt(-1);
      const next = current + BigInt(events.length);
      versions.set(streamName, next);

      return Promise.resolve({
        nextExpectedStreamVersion: next,
        createdNewStream: current === BigInt(-1),
      });
    });
};
