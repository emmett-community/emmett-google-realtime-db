import type {
  RealtimeDBReadEventMetadata,
  RealtimeDBReadModelMetadata,
} from '../../src/projections/types';
import { RealtimeDBDefaultInlineProjectionName } from '../../src/projections/realtimeDBInlineProjection';

describe('Types and constants', () => {
  describe('RealtimeDBDefaultInlineProjectionName', () => {
    it('exports default projection name constant', () => {
      expect(RealtimeDBDefaultInlineProjectionName).toBe('_default');
    });
  });

  describe('RealtimeDBReadEventMetadata', () => {
    it('has required streamPosition field', () => {
      const metadata: RealtimeDBReadEventMetadata = {
        streamName: 'test-stream',
        streamPosition: BigInt(0),
        messageId: 'msg-1',
      };

      expect(metadata.streamPosition).toBe(BigInt(0));
      expect(metadata.streamName).toBe('test-stream');
      expect(metadata.messageId).toBe('msg-1');
    });

    it('supports large BigInt values for streamPosition', () => {
      const largePosition = BigInt('9007199254740991'); // MAX_SAFE_INTEGER

      const metadata: RealtimeDBReadEventMetadata = {
        streamName: 'test-stream',
        streamPosition: largePosition,
        messageId: 'msg-1',
      };

      expect(metadata.streamPosition).toBe(largePosition);
    });
  });

  describe('RealtimeDBReadModelMetadata', () => {
    it('has all required fields', () => {
      const metadata: RealtimeDBReadModelMetadata = {
        streamId: 'stream-123',
        name: 'my-projection',
        schemaVersion: 1,
        streamPosition: '5',
      };

      expect(metadata.streamId).toBe('stream-123');
      expect(metadata.name).toBe('my-projection');
      expect(metadata.schemaVersion).toBe(1);
      expect(metadata.streamPosition).toBe('5');
    });

    it('supports custom schema versions', () => {
      const metadata: RealtimeDBReadModelMetadata = {
        streamId: 'stream-123',
        name: 'my-projection',
        schemaVersion: 42,
        streamPosition: '0',
      };

      expect(metadata.schemaVersion).toBe(42);
    });

    it('handles special characters in streamId and name', () => {
      const metadata: RealtimeDBReadModelMetadata = {
        streamId: 'stream-with-dashes-123',
        name: 'projection_with_underscores',
        schemaVersion: 1,
        streamPosition: '0',
      };

      expect(metadata.streamId).toBe('stream-with-dashes-123');
      expect(metadata.name).toBe('projection_with_underscores');
    });
  });

  describe('BigInt serialization', () => {
    it('serializes BigInt to JSON string', () => {
      const data = {
        position: BigInt(123),
        version: BigInt(456),
      };

      const serialized = JSON.stringify(data);
      const parsed = JSON.parse(serialized);

      // BigInt is serialized as string via toJSON()
      expect(parsed.position).toBe('123');
      expect(parsed.version).toBe('456');
    });

    it('serializes large BigInt values correctly', () => {
      const largeValue = BigInt('9007199254740992'); // MAX_SAFE_INTEGER + 1

      const data = {
        value: largeValue,
      };

      const serialized = JSON.stringify(data);
      const parsed = JSON.parse(serialized);

      expect(parsed.value).toBe('9007199254740992');
    });

    it('serializes BigInt in nested objects', () => {
      const data = {
        metadata: {
          streamPosition: BigInt(100),
          schemaVersion: 1,
        },
      };

      const serialized = JSON.stringify(data);
      const parsed = JSON.parse(serialized);

      expect(parsed.metadata.streamPosition).toBe('100');
      expect(parsed.metadata.schemaVersion).toBe(1);
    });
  });
});
