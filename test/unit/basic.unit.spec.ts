import { realtimeDBInlineProjection } from '../../src/projections';

describe('Basic package tests', () => {
  it('should export realtimeDBInlineProjection', () => {
    expect(typeof realtimeDBInlineProjection).toBe('function');
  });

  it('should create a projection definition', () => {
    const projection = realtimeDBInlineProjection({
      name: 'test',
      canHandle: ['TestEvent'],
      evolve: () => ({ count: 1 }),
    });

    expect(projection.name).toBe('test');
    expect(projection.canHandle).toEqual(['TestEvent']);
  });
});
