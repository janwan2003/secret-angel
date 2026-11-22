// pb-secret-angel-db: one SQLite-backed Durable Object holding every Featherpost game.
// The Pages Functions forward /api/* and link-preview lookups here through a Durable
// Object binding. No public route (workers_dev = false; default fetch returns 404).
// Why not D1: the Cloudflare account is at the free plan's 10 D1 databases.
import { DurableObject } from 'cloudflare:workers';
import { handle, preview } from './api.js';
import { SCHEMA } from './schema.js';

// A small D1-style wrapper over ctx.storage.sql so api.js reads like D1 code.
// Numbered parameters (?1, ?2) become positional ones.
class Stmt {
  constructor(sql, q, args = []) { this.sql = sql; this.q = q; this.args = args; }
  bind(...args) { return new Stmt(this.sql, this.q, args); }
  exec() {
    const vals = [];
    const q = this.q.replace(/\?(\d+)/g, (_, n) => { const v = this.args[Number(n) - 1]; vals.push(v === undefined ? null : v); return '?'; });
    const cur = this.sql.exec(q, ...vals);
    const results = cur.toArray();
    return { results, meta: { changes: cur.rowsWritten } };
  }
  async first() { return this.exec().results[0] ?? null; }
  async all() { return this.exec(); }
  async run() { return this.exec(); }
}
class ShimDB {
  constructor(storage) { this.storage = storage; }
  prepare(q) { return new Stmt(this.storage.sql, q); }
  async batch(stmts) { return this.storage.transactionSync(() => stmts.map((s) => s.exec())); }
}

export class AngelDB extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      for (const stmt of SCHEMA.replace(/--.*$/gm, '').split(';').map((s) => s.trim()).filter(Boolean)) ctx.storage.sql.exec(stmt);
    });
    this.db = { DB: new ShimDB(ctx.storage) };
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/__preview/')) {
      const out = await preview(this.db, url.pathname.slice('/__preview/'.length));
      return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json' } });
    }
    return handle(request, this.db);
  }
}

export default {
  fetch() { return new Response('Not found', { status: 404 }); },
};
