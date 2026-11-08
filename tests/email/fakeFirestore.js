/**
 * A small in-memory stand-in for the Firebase Admin SDK — just the parts
 * the email functions use — so their unit tests exercise the real
 * handlers with no credentials and no network.
 *
 * Supports: doc get/set(merge)/create/update/delete, collection add/doc/where
 * ('==', 'in', '>=', '<=', '<')/orderBy/limit/select/get, subcollections, batch(),
 * runTransaction(). Not a general Firestore emulator.
 */

const crypto = require('crypto');

function clone(v) {
  if (v instanceof Date) return new Date(v.getTime());
  if (Array.isArray(v)) return v.map(clone);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = clone(x);
    return o;
  }
  return v;
}

function createFakeDb() {
  const store = new Map(); // path → data
  const writes = []; // [op, path] — for asserting nothing was written

  function docSnap(path) {
    const data = store.get(path);
    return {
      id: path.split('/').pop(),
      exists: data !== undefined,
      ref: docRef(path),
      data: () => (data === undefined ? undefined : clone(data)),
    };
  }

  function docRef(path) {
    return {
      id: path.split('/').pop(),
      path,
      async get() { return docSnap(path); },
      async set(data, opts = {}) {
        writes.push(['set', path]);
        const prev = store.get(path);
        store.set(path, opts.merge && prev ? { ...prev, ...clone(data) } : clone(data));
      },
      // Like the real create(): fails with code 6 (ALREADY_EXISTS) if the
      // document is there, which is what the followed-band job's dedup
      // relies on.
      async create(data) {
        if (store.has(path)) {
          const err = new Error(`6 ALREADY_EXISTS: Document already exists: ${path}`);
          err.code = 6;
          throw err;
        }
        writes.push(['create', path]);
        store.set(path, clone(data));
      },
      async update(data) {
        if (!store.has(path)) throw new Error(`No document to update: ${path}`);
        writes.push(['update', path]);
        store.set(path, { ...store.get(path), ...clone(data) });
      },
      async delete() { writes.push(['delete', path]); store.delete(path); },
      collection(name) { return collectionRef(`${path}/${name}`); },
    };
  }

  function query(colPath, filters = [], order = null, max = null) {
    const q = {
      where(field, op, value) { return query(colPath, [...filters, { field, op, value }], order, max); },
      orderBy(field, dir = 'asc') { return query(colPath, filters, { field, dir }, max); },
      limit(n) { return query(colPath, filters, order, n); },
      select() { return q; },
      async get() {
        const depth = colPath.split('/').length + 1;
        let docs = [...store.keys()]
          .filter((p) => p.startsWith(`${colPath}/`) && p.split('/').length === depth)
          .map(docSnap);
        for (const f of filters) {
          docs = docs.filter((d) => {
            const v = f.field === '__name__' ? d.id : d.data()[f.field];
            if (f.op === '==') return v === f.value;
            if (f.op === 'in') return f.value.includes(v);
            if (f.op === '>=') return v != null && v >= f.value;
            if (f.op === '<=') return v != null && v <= f.value;
            if (f.op === '<') return v != null && v < f.value;
            throw new Error(`fake: unsupported op ${f.op}`);
          });
        }
        if (order) {
          const key = (d) => { const v = d.data()[order.field]; return v instanceof Date ? v.getTime() : v; };
          docs = docs.filter((d) => d.data()[order.field] !== undefined);
          docs.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) * (order.dir === 'desc' ? -1 : 1));
        }
        if (max != null) docs = docs.slice(0, max);
        return { docs, empty: docs.length === 0, size: docs.length };
      },
    };
    return q;
  }

  function collectionRef(path) {
    return {
      ...query(path),
      id: path.split('/').pop(),
      doc(id) { return docRef(`${path}/${id || crypto.randomBytes(10).toString('hex')}`); },
      async add(data) {
        const ref = docRef(`${path}/${crypto.randomBytes(10).toString('hex')}`);
        await ref.set(data);
        return ref;
      },
    };
  }

  const db = {
    doc: docRef,
    collection: collectionRef,
    batch() {
      const ops = [];
      return {
        set(ref, data, opts) { ops.push(() => ref.set(data, opts)); },
        delete(ref) { ops.push(() => ref.delete()); },
        async commit() { for (const op of ops) await op(); },
      };
    },
    async runTransaction(fn) {
      return fn({
        get: (ref) => ref.get(),
        set: (ref, data, opts) => { ref.set(data, opts); },
      });
    },
    // Test helpers
    _store: store,
    _writes: writes,
    _get: (path) => (store.has(path) ? clone(store.get(path)) : undefined),
    _put: (path, data) => store.set(path, clone(data)),
    _list: (colPath) => {
      const depth = colPath.split('/').length + 1;
      return [...store.entries()]
        .filter(([p]) => p.startsWith(`${colPath}/`) && p.split('/').length === depth)
        .map(([p, d]) => ({ id: p.split('/').pop(), ...clone(d) }));
    },
  };
  return db;
}

/** tokens: { [idToken]: { uid, email } }, users: [{ uid, email }] */
function createFakeAuth({ tokens = {}, users = [] } = {}) {
  return {
    async verifyIdToken(t) {
      if (!tokens[t]) throw new Error('invalid token');
      return { ...tokens[t] };
    },
    async getUserByEmail(email) {
      const u = users.find((x) => x.email === email);
      if (!u) { const e = new Error('not found'); e.code = 'auth/user-not-found'; throw e; }
      return u;
    },
    async getUser(uid) {
      const u = users.find((x) => x.uid === uid);
      if (!u) throw new Error('not found');
      return u;
    },
  };
}

module.exports = { createFakeDb, createFakeAuth };
