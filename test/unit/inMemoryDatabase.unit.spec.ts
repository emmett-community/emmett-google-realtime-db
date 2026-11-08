import {
  InMemoryRealtimeDatabase,
  createInMemoryDatabase,
} from '../../src/testing';

const read = async (
  database: ReturnType<typeof createInMemoryDatabase>,
  path?: string,
) => (await database.ref(path).once('value')).val() as unknown;

describe('In-memory Realtime Database', () => {
  let database: ReturnType<typeof createInMemoryDatabase>;

  beforeEach(() => {
    database = createInMemoryDatabase();
  });

  describe('tree semantics', () => {
    it('reads null for absent data', async () => {
      expect(await read(database, 'missing')).toBeNull();
      expect(await read(database)).toBeNull();
    });

    it('reads nested data through parent and child paths', async () => {
      await database.ref('a/b').set({ c: 1 });

      expect(await read(database, 'a')).toEqual({ b: { c: 1 } });
      expect(await read(database, 'a/b/c')).toBe(1);
      expect(await read(database, 'a/b/c/d')).toBeNull();
    });

    it('removes with null and {} and prunes empty parents', async () => {
      await database.ref('a/b').set({ c: 1 });
      await database.ref('a/b').set({});

      expect(await read(database, 'a')).toBeNull();

      await database.ref('x/y').set(1);
      await database.ref('x/y').set(null);
      expect(await read(database)).toBeNull();
    });

    it('drops null fields and empty nested objects', async () => {
      await database.ref('a').set({ keep: 1, gone: null, empty: { deep: {} } });

      expect(await read(database, 'a')).toEqual({ keep: 1 });
    });

    it('removes the children when the parent is removed', async () => {
      await database.ref('p/a').set(1);
      await database.ref('p').remove();

      expect(await read(database, 'p/a')).toBeNull();
    });

    it('replaces a leaf when writing below it and ignores a remove below it', async () => {
      await database.ref('l').set(1);
      await database.ref('l/x').remove();
      expect(await read(database, 'l')).toBe(1);

      await database.ref('l/x').set(2);
      expect(await read(database, 'l')).toEqual({ x: 2 });
    });

    it('replaces the whole tree when the root is set and clears it on remove', async () => {
      await database.ref().set({ a: 1 });
      expect(await read(database)).toEqual({ a: 1 });

      await database.ref().remove();
      expect(await read(database)).toBeNull();
    });
  });

  describe('values', () => {
    it('throws on undefined, including in arrays', () => {
      expect(() => database.ref('a').set({ x: undefined })).toThrow(
        'undefined',
      );
      expect(() => database.ref('a').set([1, undefined])).toThrow('undefined');
    });

    it('throws on NaN, Infinity, functions and symbols', () => {
      expect(() => database.ref('a').set(NaN)).toThrow();
      expect(() => database.ref('a').set(Infinity)).toThrow();
      expect(() => database.ref('a').set(() => 1)).toThrow();
      expect(() => database.ref('a').set(Symbol('s'))).toThrow();
    });

    it('stores a Date as nothing, like the real database', async () => {
      await database.ref('a').set({ n: 1, d: new Date() });
      expect(await read(database, 'a')).toEqual({ n: 1 });

      await database.ref('b').set({ d: new Date() });
      expect(await read(database, 'b')).toBeNull();
    });

    it('keeps zero, false and the empty string', async () => {
      await database.ref('t').set({ z: 0, b: false, e: '' });

      expect(await read(database, 't')).toEqual({ z: 0, b: false, e: '' });
    });

    it('rejects invalid keys and paths', () => {
      expect(() => database.ref('a').set({ 'a.b': 1 })).toThrow('Invalid key');
      expect(() => database.ref('a').set({ '': 1 })).toThrow('Invalid key');
      expect(() => database.ref('a.b')).toThrow('Invalid path');
      expect(() => database.ref('')).toThrow('non-empty');
      expect(() => database.ref('a').child('')).toThrow('non-empty');
    });

    it('reads dense arrays back as arrays and sparse ones as objects', async () => {
      await database.ref('dense').set([1, null, 3]);
      await database.ref('sparse').set({ 0: 'a', 5: 'b' });

      // The null hole keeps its position and reads as undefined, like the real SDK.
      const dense = (await read(database, 'dense')) as unknown[];
      expect(dense).toHaveLength(3);
      expect(dense[0]).toBe(1);
      expect(dense[1]).toBeUndefined();
      expect(dense[2]).toBe(3);
      expect(await read(database, 'sparse')).toEqual({ 0: 'a', 5: 'b' });
    });

    it('does not share state with the value that was set or the snapshot that was read', async () => {
      const value = { a: { b: 1 } };
      await database.ref('c').set(value);
      value.a.b = 2;

      const snapshot = await database.ref('c').once('value');
      (snapshot.val() as typeof value).a.b = 3;
      await database.ref('c/a/b').set(4);

      expect(snapshot.val()).toEqual({ a: { b: 1 } });
      expect(await read(database, 'c')).toEqual({ a: { b: 4 } });
    });
  });

  describe('update', () => {
    it('merges children, supports path keys and null removal', async () => {
      await database.ref('u').set({ a: 1, b: 2 });
      await database.ref('u').update({ b: 3, 'x/y': 4, a: null });

      expect(await read(database, 'u')).toEqual({ b: 3, x: { y: 4 } });
    });

    it('throws for conflicting paths, undefined and non objects', () => {
      expect(() => database.ref('u').update({ a: 1, 'a/b': 2 })).toThrow(
        'conflicts',
      );
      expect(() => database.ref('u').update({ a: undefined })).toThrow(
        'undefined',
      );
      expect(() => database.ref('u').update([])).toThrow();
      expect(() => database.ref('u').update({ '': 1 })).toThrow();
    });

    it('does nothing for an empty object', async () => {
      await database.ref('u').set({ a: 1 });
      await database.ref('u').update({});

      expect(await read(database, 'u')).toEqual({ a: 1 });
    });
  });

  describe('push', () => {
    it('stores the value under a generated, ordered key and resolves to the reference', async () => {
      const pushed = database.ref('list').push({ n: 1 });
      const reference = await pushed;

      expect(pushed.key).toHaveLength(20);
      expect(reference.key).toBe(pushed.key);
      expect(await read(database, 'list')).toEqual({
        [String(pushed.key)]: { n: 1 },
      });

      const keys = Array.from({ length: 50 }, () =>
        String(database.ref('list').push().key),
      );
      expect([...keys].sort()).toEqual(keys);
      expect(new Set(keys).size).toBe(50);
    });

    it('stores nothing without a value', async () => {
      await database.ref('list').push();

      expect(await read(database, 'list')).toBeNull();
    });

    it('rejects when the value is invalid', () => {
      expect(() => database.ref('list').push({ x: undefined })).toThrow(
        'undefined',
      );
    });

    it('supports catch on the returned reference', async () => {
      await expect(
        database
          .ref('list')
          .push({ n: 1 })
          .catch(() => null),
      ).resolves.not.toBeNull();
    });
  });

  describe('references and snapshots', () => {
    it('exposes key, parent, root and string form', () => {
      const ref = database.ref('a/b/c');

      expect(ref.key).toBe('c');
      expect(ref.parent?.key).toBe('b');
      expect(ref.root.key).toBeNull();
      expect(database.ref().parent).toBeNull();
      expect(ref.toString()).toBe('/a/b/c');
    });

    it('answers exists, key, hasChildren, numChildren, hasChild and child', async () => {
      await database.ref('s').set({ a: { b: 1 }, c: 2 });
      const snapshot = await database.ref('s').once('value');
      const missing = await database.ref('nothing').once('value');

      expect(snapshot.exists()).toBe(true);
      expect(snapshot.key).toBe('s');
      expect(snapshot.hasChildren()).toBe(true);
      expect(snapshot.numChildren()).toBe(2);
      expect(snapshot.hasChild('a')).toBe(true);
      expect(snapshot.hasChild('z')).toBe(false);
      expect(snapshot.child('a/b').val()).toBe(1);
      expect(snapshot.child('c').hasChildren()).toBe(false);
      expect(snapshot.child('c').numChildren()).toBe(0);
      expect(missing.exists()).toBe(false);
      expect(missing.val()).toBeNull();
      expect(snapshot.exportVal()).toEqual(snapshot.val());
      expect(snapshot.toJSON()).toEqual(snapshot.val());
      expect(snapshot.getPriority()).toBeNull();
    });

    it('iterates integer keys first and stops when the callback returns true', async () => {
      await database.ref('o').set({ b: 1, a: 2, 10: 3, 2: 4 });
      const snapshot = await database.ref('o').once('value');

      const keys: Array<string | null> = [];
      expect(snapshot.forEach((child) => void keys.push(child.key))).toBe(
        false,
      );
      expect(keys).toEqual(['2', '10', 'a', 'b']);

      const visited: Array<string | null> = [];
      const stopped = snapshot.forEach((child) => {
        visited.push(child.key);
        return child.key === '10';
      });
      expect(stopped).toBe(true);
      expect(visited).toEqual(['2', '10']);

      const leaf = await database.ref('o/a').once('value');
      expect(leaf.forEach(() => true)).toBe(false);
    });

    it('reads with get() like once()', async () => {
      await database.ref('g').set({ a: 1 });

      expect((await database.ref('g').get()).val()).toEqual({ a: 1 });
    });
  });

  describe('not implemented', () => {
    it('throws a clear error for listeners, queries and other event types', () => {
      expect(() => database.ref('a').on('value', () => undefined)).toThrow(
        'not implemented',
      );
      expect(() => database.ref('a').orderByChild('x')).toThrow(
        'not implemented',
      );
      expect(() => database.ref('a').transaction((v: unknown) => v)).toThrow(
        'not implemented',
      );
      expect(() => database.ref('a').once('child_added')).toThrow(
        'not implemented',
      );
    });
  });

  describe('connection', () => {
    it('accepts goOffline and goOnline as no-ops', async () => {
      await database.ref('a').set(1);

      database.goOffline();
      database.goOnline();

      expect(await read(database, 'a')).toBe(1);
    });

    it('is independent per instance', async () => {
      const other = new InMemoryRealtimeDatabase();
      await database.ref('a').set(1);

      expect((await other.ref('a').once('value')).val()).toBeNull();
    });
  });
});
