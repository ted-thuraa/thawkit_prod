// path: src/drizzle/db.ts

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { relations } from "./relations";

/**
 * ─── Database Client ────────────────────────────────────────────────────────
 *
 * PostgreSQL, local today and in production. This file is the only module
 * that may import `pg` directly — everything else imports `db` from here.
 *
 * Migrated from MySQL/mysql2. What moved:
 *   drizzle-orm/mysql2      → drizzle-orm/node-postgres
 *   mysql2/promise          → pg
 *   mysqlTable / mysqlEnum  → pgTable / pgEnum       (schemas/*.ts)
 *   datetime / timestamp    → timestamp({ withTimezone: true })
 *   json                    → jsonb
 *   int                     → integer
 *
 * `relations.ts` required ZERO changes: under Relational Queries v2 the
 * graph addresses columns through the schema namespace rather than through
 * dialect-specific table objects. Same for schema.ts, tenant-scope.ts and
 * the relational reads in publishFunnel.ts.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Connection pool — sized and configured explicitly rather than relying on
// pg defaults. This runs in a Docker container on a self-hosted Coolify VPS
// (architecture roadmap Module 13), where the DB is frequently a separate
// container reachable only over the internal Docker network — silently
// dropped idle connections there surface as opaque, hard-to-debug query
// timeouts rather than a clear reconnect.
function createPool() {
  return new Pool({
    connectionString: process.env.DATABASE_URL!,
    max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
    // pg's default idleTimeoutMillis is 10s; raised so the pool isn't
    // constantly re-dialing across the Docker network under light load.
    idleTimeoutMillis: 30_000,
    // Fail fast with a real error instead of hanging when the DB container
    // is down or the internal hostname doesn't resolve.
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    // The Postgres equivalent of mysql2's `timezone: "Z"`. With
    // `timestamptz` columns pg already hands back correct absolute Date
    // objects regardless of this, but pinning the session TZ keeps any raw
    // SQL (now(), date_trunc, generated reports) unambiguous no matter what
    // the host container's TZ is set to.
    options: "-c timezone=UTC",
  });
}

/**
 * Next.js dev-server HMR re-evaluates modules on every edit. Without this
 * guard each reload leaks a fresh pool of up to DATABASE_POOL_SIZE
 * connections, and a local Postgres (default max_connections = 100) starts
 * refusing connections after a dozen or so saves. Production runs a single
 * evaluation, so the branch is dev-only in effect.
 */
const globalForDb = globalThis as unknown as { pool?: Pool };

const pool = globalForDb.pool ?? createPool();
if (process.env.NODE_ENV !== "production") globalForDb.pool = pool;

export const db = drizzle({ client: pool, relations });

// NOTE ON MIGRATIONS: Drizzle recommends a single (non-pooled) connection
// for the built-in `migrate()` function. If you ever run migrations
// in-process rather than via `drizzle-kit migrate`, open a dedicated
// `new Client()` for it and end it afterwards, rather than reusing this pool.
