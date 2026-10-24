import type { Database } from 'firebase-admin/database';
import { createInMemoryDatabase } from '../../src/testing';
import {
  startDatabaseEmulator,
  type StartedDatabaseEmulator,
} from '../support/emulator';

jest.setTimeout(120000);

/**
 * Runs the same operations against the Firebase emulator and the in-memory
 * fake and expects the same observable result. When the fake gains a
 * behavior, add a case here.
 *
 * A case returns what a caller can observe. When it throws, only the fact that
 * it threw is compared: the messages of the real SDK are not a contract.
 */
type Outcome = { value: unknown } | { threw: true };

const observe = async (run: () => Promise<unknown>): Promise<Outcome> => {
  try {
    return { value: await run() };
  } catch {
    return { threw: true };
  }
};

const read = async (database: Database, path?: string) =>
  (await database.ref(path).once('value')).val();

const cases: Array<{ name: string; run: (db: Database) => Promise<unknown> }> =
  [
    {
      name: 'set then read',
      run: async (db) => {
        await db.ref('a').set({ x: 1 });
        return read(db, 'a');
      },
    },
    {
      name: 'set(null) removes',
      run: async (db) => {
        await db.ref('a').set({ x: 1 });
        await db.ref('a').set(null);
        return read(db, 'a');
      },
    },
    {
      name: 'ref() without a path, then remove()',
      run: async (db) => {
        await db.ref('a').set(1);
        await db.ref().remove();
        return read(db);
      },
    },
    {
      name: 'val() of a missing path is null',
      run: (db) => read(db, 'missing/path'),
    },
    {
      name: 'read the parent after set on a child path',
      run: async (db) => {
        await db.ref('p/c').set(1);
        return read(db, 'p');
      },
    },
    {
      name: 'read a child path after set on the parent',
      run: async (db) => {
        await db.ref('p').set({ c: 1 });
        return read(db, 'p/c');
      },
    },
    {
      name: 'set with an undefined field throws',
      run: (db) => db.ref('a').set({ x: undefined }),
    },
    {
      name: 'set with an undefined array item throws',
      run: (db) => db.ref('a').set([1, undefined]),
    },
    {
      name: 'set with a Date field drops it',
      run: async (db) => {
        await db.ref('a').set({ n: 1, d: new Date() });
        return read(db, 'a');
      },
    },
    {
      name: 'set with only a Date field removes the document',
      run: async (db) => {
        await db.ref('a').set({ d: new Date() });
        return read(db, 'a');
      },
    },
    {
      name: 'set({}) removes',
      run: async (db) => {
        await db.ref('a').set({ x: 1 });
        await db.ref('a').set({});
        return read(db, 'a');
      },
    },
    {
      name: 'nested empty objects and null fields are pruned',
      run: async (db) => {
        await db.ref('e').set({ a: { b: {} }, c: 1, d: null });
        return read(db, 'e');
      },
    },
    {
      name: 'remove() of a parent removes its children',
      run: async (db) => {
        await db.ref('p/a').set(1);
        await db.ref('p/b').set(2);
        await db.ref('p').remove();
        return { parent: await read(db, 'p'), child: await read(db, 'p/a') };
      },
    },
    {
      name: 'child(...).set() then read the parent',
      run: async (db) => {
        await db.ref('p').child('c').child('d').set('v');
        return read(db, 'p');
      },
    },
    {
      name: 'set below a leaf replaces the leaf',
      run: async (db) => {
        await db.ref('l').set(1);
        await db.ref('l/x').set(2);
        return read(db, 'l');
      },
    },
    {
      name: 'a path with slashes creates the nesting',
      run: async (db) => {
        await db.ref('a/b/c').set(1);
        return read(db, 'a');
      },
    },
    {
      name: 'strings, numbers, booleans, zero and empty string are kept',
      run: async (db) => {
        await db.ref('t').set({ s: 'x', n: 1.5, b: false, z: 0, e: '' });
        return read(db, 't');
      },
    },
    {
      name: 'a dense array reads back as an array',
      run: async (db) => {
        await db.ref('arr').set([1, 2, 3]);
        return read(db, 'arr');
      },
    },
    {
      name: 'an array with a null hole keeps the position and reads the hole as undefined',
      run: async (db) => {
        await db.ref('arr').set([1, null, 3]);
        return read(db, 'arr');
      },
    },
    {
      name: 'a sparse integer-keyed object stays an object',
      run: async (db) => {
        await db.ref('sp').set({ 0: 'a', 5: 'b' });
        return read(db, 'sp');
      },
    },
    {
      name: 'an invalid key throws',
      run: (db) => db.ref('k').set({ 'a.b': 1 }),
    },
    {
      name: 'an invalid path throws',
      run: async (db) => db.ref('a.b').set(1),
    },
    {
      name: 'an empty path throws',
      run: async (db) => db.ref('').set(1),
    },
    {
      name: 'an empty child path throws',
      run: async (db) => db.ref('a').child('').set(1),
    },
    {
      name: 'NaN throws',
      run: (db) => db.ref('n').set(NaN),
    },
    {
      name: 'Infinity throws',
      run: (db) => db.ref('n').set(Infinity),
    },
    {
      name: 'update merges children',
      run: async (db) => {
        await db.ref('u').set({ a: 1, b: 2 });
        await db.ref('u').update({ b: 3, c: 4 });
        return read(db, 'u');
      },
    },
    {
      name: 'update with path keys',
      run: async (db) => {
        await db.ref('u').update({ 'x/y': 1, z: 2 });
        return read(db, 'u');
      },
    },
    {
      name: 'update with null removes the child',
      run: async (db) => {
        await db.ref('u').set({ a: 1, b: 2 });
        await db.ref('u').update({ a: null });
        return read(db, 'u');
      },
    },
    {
      name: 'update with conflicting paths throws',
      run: (db) => db.ref('u').update({ a: 1, 'a/b': 2 }),
    },
    {
      name: 'update with an undefined value throws',
      run: (db) => db.ref('u').update({ a: undefined }),
    },
    {
      name: 'update({}) does nothing',
      run: async (db) => {
        await db.ref('u').set({ a: 1 });
        await db.ref('u').update({});
        return read(db, 'u');
      },
    },
    {
      name: 'push with a value stores it under a 20 character key',
      run: async (db) => {
        const ref = db.ref('list').push({ n: 1 });
        await ref;
        return {
          keyLength: ref.key?.length,
          values: Object.values((await read(db, 'list')) as object),
        };
      },
    },
    {
      name: 'push keys are ordered by creation',
      run: async (db) => {
        const first = db.ref('list').push();
        const second = db.ref('list').push();
        return (first.key as string) < (second.key as string);
      },
    },
    {
      name: 'push without a value stores nothing',
      run: async (db) => {
        db.ref('list').push();
        return read(db, 'list');
      },
    },
    {
      name: 'snapshot exists() and key',
      run: async (db) => {
        await db.ref('s/present').set(1);
        const present = await db.ref('s/present').once('value');
        const missing = await db.ref('s/missing').once('value');
        const root = await db.ref().once('value');
        return {
          present: [present.exists(), present.key],
          missing: [missing.exists(), missing.key],
          rootKey: root.key,
        };
      },
    },
    {
      name: 'snapshot hasChildren, numChildren, hasChild and child',
      run: async (db) => {
        await db.ref('s').set({ a: { b: 1 }, c: 2 });
        const snapshot = await db.ref('s').once('value');
        return {
          hasChildren: snapshot.hasChildren(),
          leafHasChildren: snapshot.child('c').hasChildren(),
          numChildren: snapshot.numChildren(),
          hasA: snapshot.hasChild('a'),
          hasZ: snapshot.hasChild('z'),
          nested: snapshot.child('a/b').val(),
        };
      },
    },
    {
      name: 'snapshot forEach visits integer keys first, then the others in order',
      run: async (db) => {
        await db.ref('o').set({ b: 1, a: 2, 10: 3, 2: 4 });
        const keys: Array<string | null> = [];
        (await db.ref('o').once('value')).forEach((child) => {
          keys.push(child.key);
        });
        return keys;
      },
    },
    {
      name: 'snapshot forEach stops when the callback returns true',
      run: async (db) => {
        await db.ref('o').set({ a: 1, b: 2, c: 3 });
        const keys: Array<string | null> = [];
        const stopped = (await db.ref('o').once('value')).forEach((child) => {
          keys.push(child.key);
          return child.key === 'b';
        });
        return { keys, stopped };
      },
    },
    {
      name: 'a snapshot is a copy: later writes and edits do not change it',
      run: async (db) => {
        await db.ref('c').set({ a: 1 });
        const snapshot = await db.ref('c').once('value');
        await db.ref('c').set({ a: 2 });
        const value = snapshot.val() as { a: number };
        value.a = 99;
        return { snapshot: snapshot.val(), current: await read(db, 'c') };
      },
    },
    {
      name: 'get() returns the same as once()',
      run: async (db) => {
        await db.ref('g').set({ a: 1 });
        return (await db.ref('g').get()).val();
      },
    },
    {
      name: 'ref().parent, root and key',
      run: async (db) => {
        const ref = db.ref('a/b/c');
        return {
          key: ref.key,
          parent: ref.parent?.key,
          grandparent: ref.parent?.parent?.key,
          rootParent: db.ref().parent,
        };
      },
    },
    {
      name: 'goOffline and goOnline exist',
      run: async (db) => ({
        goOffline: typeof db.goOffline,
        goOnline: typeof db.goOnline,
      }),
    },
  ];

describe('In-memory Realtime Database conformance with the emulator', () => {
  let emulator: StartedDatabaseEmulator;
  let fake: Database;

  beforeAll(async () => {
    emulator = await startDatabaseEmulator();
  });

  afterAll(async () => {
    await emulator?.stop();
  });

  beforeEach(async () => {
    await emulator.database.ref().remove();
    fake = createInMemoryDatabase();
  });

  it.each(cases)('$name', async ({ run }) => {
    const expected = await observe(() => run(emulator.database));
    const actual = await observe(() => run(fake));

    expect(actual).toEqual(expected);
  });
});
