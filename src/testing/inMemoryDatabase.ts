import type { Database } from 'firebase-admin/database';

/**
 * In-memory fake of the Firebase Admin Realtime Database, for service tests
 * that run the real projection code.
 *
 * It follows the behavior of the real database where projections can break:
 * data is a tree, absent data reads as `null`, `null` and `{}` remove,
 * `undefined` throws, and a `Date` is stored as nothing. A conformance suite
 * (`test/e2e/inMemoryDatabase.conformance.e2e.spec.ts`) runs the same
 * operations against the emulator and the fake and compares the results.
 *
 * Not implemented (they throw): listeners, queries, transactions, priorities
 * and `onDisconnect`.
 */

type Tree = Map<string, StoredNode>;
type StoredNode = string | number | boolean | Tree;

// The control characters are part of what the real database rejects in keys.
// eslint-disable-next-line no-control-regex
const INVALID_KEY = /[[\].#$/\u0000-\u001F\u007F]/;
const INTEGER_KEY = /^(0|[1-9]\d{0,14})$/;

const parsePath = (path = ''): string[] => {
  const segments = path.split('/').filter((segment) => segment.length > 0);
  for (const segment of segments) {
    if (INVALID_KEY.test(segment)) {
      throw new Error(
        `Invalid path '${path}': keys must not contain ".", "#", "$", "[", "]" or control characters`,
      );
    }
  }
  return segments;
};

// `ref(path)` and `child(path)` reject an empty path, `ref()` is the root.
const parseChildPath = (path: string): string[] => {
  if (path.length === 0) {
    throw new Error('Invalid path: it must be a non-empty string');
  }
  return parsePath(path);
};

const normalizeValue = (value: unknown, where: string): StoredNode | null => {
  if (value === null) return null;
  if (value === undefined) {
    throw new Error(`Value contains undefined in property '${where}'`);
  }

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      if (!Number.isFinite(value)) {
        throw new Error(`Value contains ${value} in property '${where}'`);
      }
      return value;
    case 'object': {
      const entries: Array<[string, unknown]> = Array.isArray(value)
        ? value.map((item, index) => [String(index), item])
        : Object.entries(value);
      const tree: Tree = new Map();
      for (const [key, child] of entries) {
        if (key.length === 0 || INVALID_KEY.test(key)) {
          throw new Error(
            `Invalid key '${key}' in property '${where}': keys must not be empty or contain ".", "#", "$", "[", "]", "/" or control characters`,
          );
        }
        const normalized = normalizeValue(child, `${where}/${key}`);
        if (normalized !== null) tree.set(key, normalized);
      }
      return tree.size === 0 ? null : tree;
    }
    default:
      throw new Error(
        `Value contains a ${typeof value} in property '${where}'`,
      );
  }
};

const orderedKeys = (tree: Tree): string[] => {
  const integers: string[] = [];
  const others: string[] = [];
  for (const key of tree.keys()) {
    (INTEGER_KEY.test(key) ? integers : others).push(key);
  }
  integers.sort((a, b) => Number(a) - Number(b));
  others.sort();
  return [...integers, ...others];
};

const cloneNode = (node: StoredNode): StoredNode => {
  if (!(node instanceof Map)) return node;
  const copy: Tree = new Map();
  for (const [key, child] of node) copy.set(key, cloneNode(child));
  return copy;
};

// Like the real database, a node whose keys are the integers 0..n with fewer
// than half of them missing is read back as an array.
const toValue = (node: StoredNode): unknown => {
  if (!(node instanceof Map)) return node;

  const keys = orderedKeys(node);
  if (keys.every((key) => INTEGER_KEY.test(key))) {
    const max = Number(keys[keys.length - 1]);
    if (max < 2 * keys.length) {
      // The missing positions stay empty, so they read as undefined.
      const array: unknown[] = new Array(max + 1);
      for (const key of keys) array[Number(key)] = toValue(node.get(key)!);
      return array;
    }
  }

  const object: Record<string, unknown> = {};
  for (const key of keys) object[key] = toValue(node.get(key)!);
  return object;
};

const isPrefix = (prefix: string[], segments: string[]): boolean =>
  prefix.length <= segments.length &&
  prefix.every((segment, index) => segment === segments[index]);

const unsupported = (name: string) => (): never => {
  throw new Error(
    `${name} is not implemented by the in-memory Realtime Database fake`,
  );
};

const PUSH_CHARS =
  '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
let lastPushTime = 0;
const lastRandomChars: number[] = [];

const generatePushId = (): string => {
  let now = Date.now();
  const duplicateTime = now === lastPushTime;
  lastPushTime = now;

  const timeChars: string[] = [];
  for (let index = 7; index >= 0; index -= 1) {
    timeChars[index] = PUSH_CHARS.charAt(now % 64);
    now = Math.floor(now / 64);
  }

  if (!duplicateTime) {
    for (let index = 0; index < 12; index += 1) {
      lastRandomChars[index] = Math.floor(Math.random() * 64);
    }
  } else {
    let index = 11;
    while (index >= 0 && lastRandomChars[index] === 63) {
      lastRandomChars[index] = 0;
      index -= 1;
    }
    if (index >= 0) lastRandomChars[index] = lastRandomChars[index] + 1;
  }

  return (
    timeChars.join('') +
    lastRandomChars.map((value) => PUSH_CHARS.charAt(value)).join('')
  );
};

export class InMemoryDataSnapshot {
  private readonly node: StoredNode | undefined;

  constructor(
    node: StoredNode | undefined,
    readonly ref: InMemoryReference,
  ) {
    this.node = node === undefined ? undefined : cloneNode(node);
  }

  get key(): string | null {
    return this.ref.key;
  }

  val(): unknown {
    return this.node === undefined ? null : toValue(this.node);
  }

  exportVal(): unknown {
    return this.val();
  }

  toJSON(): unknown {
    return this.val();
  }

  exists(): boolean {
    return this.node !== undefined;
  }

  hasChildren(): boolean {
    return this.node instanceof Map;
  }

  numChildren(): number {
    return this.node instanceof Map ? this.node.size : 0;
  }

  hasChild(path: string): boolean {
    return this.child(path).exists();
  }

  child(path: string): InMemoryDataSnapshot {
    let node: StoredNode | undefined = this.node;
    for (const segment of parseChildPath(path)) {
      node = node instanceof Map ? node.get(segment) : undefined;
    }
    return new InMemoryDataSnapshot(node, this.ref.child(path));
  }

  // Returns true when the callback stopped the iteration by returning true.
  forEach(callback: (child: InMemoryDataSnapshot) => boolean | void): boolean {
    if (!(this.node instanceof Map)) return false;
    for (const key of orderedKeys(this.node)) {
      if (callback(this.child(key)) === true) return true;
    }
    return false;
  }

  getPriority(): null {
    return null;
  }
}

export class InMemoryReference {
  constructor(
    protected readonly database: InMemoryRealtimeDatabase,
    protected readonly segments: string[],
  ) {}

  get key(): string | null {
    return this.segments[this.segments.length - 1] ?? null;
  }

  get parent(): InMemoryReference | null {
    return this.segments.length === 0
      ? null
      : new InMemoryReference(this.database, this.segments.slice(0, -1));
  }

  get root(): InMemoryReference {
    return new InMemoryReference(this.database, []);
  }

  child(path: string): InMemoryReference {
    return new InMemoryReference(this.database, [
      ...this.segments,
      ...parseChildPath(path),
    ]);
  }

  // Validation errors are thrown synchronously, as the real SDK does.
  set(value: unknown): Promise<void> {
    const node = normalizeValue(value, this.segments.join('/') || '/');
    this.database.write(this.segments, node);
    return Promise.resolve();
  }

  update(values: Record<string, unknown>): Promise<void> {
    if (
      values === null ||
      typeof values !== 'object' ||
      Array.isArray(values)
    ) {
      throw new Error('update() requires an object of children to replace');
    }

    const writes = Object.entries(values).map(([path, value]) => {
      const relative = parsePath(path);
      if (relative.length === 0) {
        throw new Error(`Invalid update path '${path}'`);
      }
      return {
        segments: [...this.segments, ...relative],
        node: normalizeValue(value, path),
      };
    });

    for (const a of writes) {
      for (const b of writes) {
        if (a !== b && isPrefix(a.segments, b.segments)) {
          throw new Error(
            `update() contains a path that conflicts with another path: '${a.segments.join('/')}' and '${b.segments.join('/')}'`,
          );
        }
      }
    }

    for (const { segments, node } of writes)
      this.database.write(segments, node);
    return Promise.resolve();
  }

  remove(): Promise<void> {
    this.database.write(this.segments, null);
    return Promise.resolve();
  }

  push(value?: unknown): InMemoryThenableReference {
    const child = this.child(generatePushId());
    const completion =
      value === undefined ? Promise.resolve() : child.set(value);
    return new InMemoryThenableReference(
      this.database,
      child.segments,
      completion.then(
        () => new InMemoryReference(this.database, child.segments),
      ),
    );
  }

  once(eventType: string = 'value'): Promise<InMemoryDataSnapshot> {
    if (eventType !== 'value') {
      throw new Error(
        `once('${eventType}') is not implemented by the in-memory Realtime Database fake`,
      );
    }
    return Promise.resolve(
      new InMemoryDataSnapshot(this.database.read(this.segments), this),
    );
  }

  get(): Promise<InMemoryDataSnapshot> {
    return this.once('value');
  }

  toString(): string {
    return `/${this.segments.join('/')}`;
  }

  on = unsupported('on()');
  off = unsupported('off()');
  transaction = unsupported('transaction()');
  orderByChild = unsupported('orderByChild()');
  orderByKey = unsupported('orderByKey()');
  orderByValue = unsupported('orderByValue()');
  limitToFirst = unsupported('limitToFirst()');
  limitToLast = unsupported('limitToLast()');
  startAt = unsupported('startAt()');
  endAt = unsupported('endAt()');
  equalTo = unsupported('equalTo()');
  onDisconnect = unsupported('onDisconnect()');
}

// What `push()` returns: a reference that is also a promise of the reference.
export class InMemoryThenableReference extends InMemoryReference {
  readonly then: Promise<InMemoryReference>['then'];
  readonly catch: Promise<InMemoryReference>['catch'];

  constructor(
    database: InMemoryRealtimeDatabase,
    segments: string[],
    completion: Promise<InMemoryReference>,
  ) {
    super(database, segments);
    this.then = completion.then.bind(completion);
    this.catch = completion.catch.bind(completion);
  }
}

export class InMemoryRealtimeDatabase {
  private root: Tree = new Map();

  ref(path?: string): InMemoryReference {
    return new InMemoryReference(
      this,
      path === undefined ? [] : parseChildPath(path),
    );
  }

  // The real calls drop and reopen the connection, there is none here.
  goOffline(): void {}
  goOnline(): void {}

  /** @internal */
  read(segments: string[]): StoredNode | undefined {
    let node: StoredNode | undefined = this.root;
    for (const segment of segments) {
      node = node instanceof Map ? node.get(segment) : undefined;
    }
    return node instanceof Map && node.size === 0 ? undefined : node;
  }

  /** @internal */
  write(segments: string[], node: StoredNode | null): void {
    if (segments.length === 0) {
      this.root = node instanceof Map ? node : new Map<string, StoredNode>();
      return;
    }
    this.writeInto(this.root, segments, node);
  }

  private writeInto(
    tree: Tree,
    segments: string[],
    node: StoredNode | null,
  ): void {
    const [head, ...rest] = segments as [string, ...string[]];

    if (rest.length === 0) {
      if (node === null) tree.delete(head);
      else tree.set(head, node);
      return;
    }

    let child = tree.get(head);
    if (!(child instanceof Map)) {
      // Removing below a leaf or a missing path changes nothing, writing
      // below a leaf replaces the leaf.
      if (node === null) return;
      child = new Map();
      tree.set(head, child);
    }

    this.writeInto(child, rest, node);
    if (child.size === 0) tree.delete(head);
  }
}

/** Creates an empty in-memory Realtime Database typed as the Admin SDK `Database`. */
export const createInMemoryDatabase = (): Database =>
  new InMemoryRealtimeDatabase() as unknown as Database;
