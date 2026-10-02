import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createRequire } from "node:module";

// node:sqlite is a Node 22 builtin; loaded via require so bundlers/vitest do not try to resolve it.
type DatabaseSyncT = import("node:sqlite").DatabaseSync;
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (p: string) => DatabaseSyncT };

/** SQLite via node:sqlite (Node 22+, no native build). Stores scoring records and the receipts index. */
export class Db {
  readonly db: DatabaseSyncT;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS quotes (
        hash TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        underlying TEXT,
        basket TEXT,
        json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS receipts (
        tx_hash TEXT NOT NULL,
        log_index INTEGER NOT NULL,
        block_number INTEGER NOT NULL,
        emitter TEXT NOT NULL,
        quote_hash TEXT NOT NULL,
        actor TEXT NOT NULL,
        underlying TEXT NOT NULL,
        token_in TEXT NOT NULL,
        amount_in TEXT NOT NULL,
        representation TEXT NOT NULL,
        tokens_out TEXT NOT NULL,
        shares_out TEXT NOT NULL,
        ratio TEXT NOT NULL,
        attested_at INTEGER NOT NULL,
        action TEXT NOT NULL,
        timestamp INTEGER,
        PRIMARY KEY (tx_hash, log_index)
      );
      CREATE INDEX IF NOT EXISTS receipts_actor ON receipts(actor);
      CREATE INDEX IF NOT EXISTS receipts_underlying ON receipts(underlying);
      CREATE INDEX IF NOT EXISTS receipts_emitter ON receipts(emitter);
      CREATE INDEX IF NOT EXISTS receipts_block ON receipts(block_number DESC);
      CREATE TABLE IF NOT EXISTS rebalances (
        tx_hash TEXT NOT NULL,
        log_index INTEGER NOT NULL,
        block_number INTEGER NOT NULL,
        basket TEXT NOT NULL,
        underlying_id TEXT NOT NULL,
        caller TEXT NOT NULL,
        share_gain TEXT NOT NULL,
        quote_hash TEXT NOT NULL,
        timestamp INTEGER,
        PRIMARY KEY (tx_hash, log_index)
      );
      CREATE INDEX IF NOT EXISTS rebalances_basket ON rebalances(lower(basket), block_number DESC);
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
  }

  putQuote(hash: string, kind: string, json: string, meta: { underlying?: string; basket?: string } = {}) {
    this.db
      .prepare("INSERT OR REPLACE INTO quotes(hash, kind, underlying, basket, json, created_at) VALUES (?,?,?,?,?,?)")
      .run(hash, kind, meta.underlying ?? null, meta.basket ?? null, json, Date.now());
  }
  getQuote(hash: string): { kind: string; json: string; created_at: number } | undefined {
    return this.db.prepare("SELECT kind, json, created_at FROM quotes WHERE hash = ?").get(hash) as any;
  }

  putReceipt(r: Record<string, string | number>) {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO receipts(tx_hash, log_index, block_number, emitter, quote_hash, actor, underlying, token_in, amount_in, representation, tokens_out, shares_out, ratio, attested_at, action, timestamp)
         VALUES (@tx_hash, @log_index, @block_number, @emitter, @quote_hash, @actor, @underlying, @token_in, @amount_in, @representation, @tokens_out, @shares_out, @ratio, @attested_at, @action, @timestamp)`,
      )
      .run(r as any);
  }
  listReceipts(f: { actor?: string; underlying?: string; emitter?: string; quoteHash?: string; txHash?: string; limit?: number }) {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (f.actor) { where.push("lower(actor) = ?"); args.push(f.actor.toLowerCase()); }
    if (f.underlying) { where.push("underlying = ?"); args.push(f.underlying); }
    if (f.emitter) { where.push("lower(emitter) = ?"); args.push(f.emitter.toLowerCase()); }
    if (f.quoteHash) { where.push("lower(quote_hash) = ?"); args.push(f.quoteHash.toLowerCase()); }
    if (f.txHash) { where.push("lower(tx_hash) = ?"); args.push(f.txHash.toLowerCase()); }
    const sql = `SELECT * FROM receipts ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY block_number DESC, log_index DESC LIMIT ?`;
    args.push(Math.min(f.limit ?? 100, 500));
    return this.db.prepare(sql).all(...args) as Record<string, string | number>[];
  }

  /** One executed `BasketVault.Migrated`: the vault's own record that a rebalance happened, and for which quote. */
  putRebalance(r: Record<string, string | number>) {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO rebalances(tx_hash, log_index, block_number, basket, underlying_id, caller, share_gain, quote_hash, timestamp)
         VALUES (@tx_hash, @log_index, @block_number, @basket, @underlying_id, @caller, @share_gain, @quote_hash, @timestamp)`,
      )
      .run(r as any);
  }
  listRebalances(f: { basket?: string; limit?: number }) {
    const where = f.basket ? "WHERE lower(basket) = ?" : "";
    const args: (string | number)[] = f.basket ? [f.basket.toLowerCase()] : [];
    args.push(Math.min(f.limit ?? 50, 200));
    return this.db.prepare(`SELECT * FROM rebalances ${where} ORDER BY block_number DESC, log_index DESC LIMIT ?`).all(...args) as Record<string, string | number>[];
  }

  getKv(key: string): string | undefined {
    const r = this.db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined;
    return r?.value;
  }
  setKv(key: string, value: string) {
    this.db.prepare("INSERT OR REPLACE INTO kv(key, value) VALUES (?,?)").run(key, value);
  }
}
