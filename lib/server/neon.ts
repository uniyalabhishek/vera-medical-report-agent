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
        category TEXT NOT NULL DEFAULT 'report',
        created_at BIGINT NOT NULL
      )
    `);
    await sql.query("ALTER TABLE uploads ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'report'");
    await sql.query(`
      CREATE TABLE IF NOT EXISTS extraction_work (
        case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        upload_id TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
        page_offset INTEGER NOT NULL CHECK (page_offset >= 0),
        page_count INTEGER NOT NULL CHECK (page_count > 0),
        status TEXT NOT NULL CHECK (status IN ('pending', 'submitted', 'results_pending', 'completed', 'failed')),
        provider_job_id TEXT,
        ocr_pages_json TEXT,
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        lease_expires_at BIGINT,
        model_status TEXT NOT NULL DEFAULT 'pending' CHECK (model_status IN ('pending', 'completed', 'failed')),
        model_facts_json TEXT,
        model_attempts INTEGER NOT NULL DEFAULT 0 CHECK (model_attempts >= 0),
        model_error_code TEXT,
        model_lease_expires_at BIGINT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (case_id, upload_id, chunk_index)
      )
    `);
    await sql.query(`
      ALTER TABLE extraction_work
        ADD COLUMN IF NOT EXISTS model_status TEXT NOT NULL DEFAULT 'pending'
          CHECK (model_status IN ('pending', 'completed', 'failed')),
        ADD COLUMN IF NOT EXISTS model_facts_json TEXT,
        ADD COLUMN IF NOT EXISTS model_attempts INTEGER NOT NULL DEFAULT 0
          CHECK (model_attempts >= 0),
        ADD COLUMN IF NOT EXISTS model_error_code TEXT,
        ADD COLUMN IF NOT EXISTS model_lease_expires_at BIGINT
    `);
    await sql.query(`
      CREATE TABLE IF NOT EXISTS provider_call_slots (
        provider TEXT PRIMARY KEY,
        next_allowed_at BIGINT NOT NULL
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
    await sql.query(
      "CREATE INDEX IF NOT EXISTS idx_extraction_work_case_status ON extraction_work(case_id, status, updated_at)",
    );
    await sql.query("CREATE INDEX IF NOT EXISTS idx_turns_case ON conversation_turns(case_id)");
  })().catch((error) => {
    schemaPromise = null;
    throw error;
  });
  return schemaPromise;
}
