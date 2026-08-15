import "server-only";

import { neon } from "@neondatabase/serverless";
import { ApiError } from "@/lib/server/api-error";

let schemaPromise: Promise<void> | null = null;

export function getCloudSql() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new ApiError(503, "DATABASE_CONFIGURATION_REQUIRED", "The cloud database is not configured.");
  }
  return neon(databaseUrl);
}

export async function ensureCloudSchema() {
  if (schemaPromise) return schemaPromise;
  const sql = getCloudSql();
  schemaPromise = (async () => {
    await sql.query(`
      CREATE TABLE IF NOT EXISTS auth_sessions (
        token_hash TEXT PRIMARY KEY,
        csrf_hash TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        last_seen_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL
      )
    `);
    await sql.query(`
      CREATE TABLE IF NOT EXISTS cases (
        id TEXT PRIMARY KEY,
        session_hash TEXT NOT NULL REFERENCES auth_sessions(token_hash) ON DELETE CASCADE,
        state TEXT NOT NULL,
        provider_mode TEXT NOT NULL,
        intake_json TEXT NOT NULL,
        facts_json TEXT NOT NULL DEFAULT '[]',
        analysis_json TEXT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL
      )
    `);
    await sql.query(`
      CREATE TABLE IF NOT EXISTS case_identities (
        case_id TEXT PRIMARY KEY REFERENCES cases(id) ON DELETE CASCADE,
        preferred_name TEXT NOT NULL
      )
    `);
    await sql.query(`
      CREATE TABLE IF NOT EXISTS uploads (
        id TEXT PRIMARY KEY,
        case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        display_name TEXT NOT NULL,
        stored_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes BIGINT NOT NULL,
        source_mode TEXT NOT NULL,
        created_at BIGINT NOT NULL
      )
    `);
    await sql.query(`
      CREATE TABLE IF NOT EXISTS conversation_turns (
        id TEXT PRIMARY KEY,
        case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        question TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at BIGINT NOT NULL
      )
    `);
    await sql.query("CREATE INDEX IF NOT EXISTS idx_cases_session ON cases(session_hash)");
    await sql.query("CREATE INDEX IF NOT EXISTS idx_cases_expiry ON cases(expires_at)");
    await sql.query("CREATE INDEX IF NOT EXISTS idx_uploads_case ON uploads(case_id)");
    await sql.query("CREATE INDEX IF NOT EXISTS idx_turns_case ON conversation_turns(case_id)");
  })().catch((error) => {
    schemaPromise = null;
    throw error;
  });
  return schemaPromise;
}
