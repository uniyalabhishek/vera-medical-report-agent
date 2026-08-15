import "server-only";

import { randomUUID } from "node:crypto";
import type { Analysis, CaseState, CaseView, DocumentCategory, Fact, Intake, QuestionResponse } from "@/lib/contracts";
import { DocumentCategorySchema, IntakeSchema } from "@/lib/contracts";
import { ApiError } from "@/lib/server/api-error";
import { ensureCloudSchema, getCloudSql } from "@/lib/server/neon";

const CASE_RETENTION_MS = 24 * 60 * 60 * 1_000;

type CloudCaseRow = {
  id: string;
  state: CaseState;
  provider_mode: "demo" | "live";
  intake_json: string;
  facts_json: string;
  analysis_json: string | null;
  preferred_name: string;
  created_at: string | number;
  expires_at: string | number;
};

export type CloudUploadRecord = {
  id: string;
  caseId: string;
  displayName: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  sourceMode: "uploaded" | "demo";
  category: DocumentCategory;
};

function toView(row: CloudCaseRow): CaseView {
  const parsedIntake = IntakeSchema.parse({
    ...JSON.parse(row.intake_json) as Record<string, unknown>,
    preferredName: row.preferred_name,
  });
  const { preferredName, ...intake } = parsedIntake;
  return {
    id: row.id,
    state: row.state,
    providerMode: row.provider_mode,
    intake,
    preferredName,
    facts: JSON.parse(row.facts_json) as Fact[],
    analysis: row.analysis_json ? JSON.parse(row.analysis_json) as Analysis : null,
    createdAt: new Date(Number(row.created_at)).toISOString(),
    expiresAt: new Date(Number(row.expires_at)).toISOString(),
  };
}

export async function createCase(sessionHash: string, intake: Intake, providerMode: "demo" | "live") {
  await ensureCloudSchema();
  const sql = getCloudSql();
  const id = randomUUID();
  const now = Date.now();
  const expiresAt = now + CASE_RETENTION_MS;
  const { preferredName, ...clinicalIntake } = intake;
  await sql.transaction([
    sql.query(
      `INSERT INTO cases
        (id, session_hash, state, provider_mode, intake_json, facts_json,
         analysis_json, created_at, updated_at, expires_at)
       VALUES ($1, $2, 'DRAFT', $3, $4, '[]', NULL, $5, $5, $6)`,
      [id, sessionHash, providerMode, JSON.stringify(clinicalIntake), now, expiresAt],
    ),
    sql.query(
      "INSERT INTO case_identities (case_id, preferred_name) VALUES ($1, $2)",
      [id, preferredName],
    ),
  ]);
  return getOwnedCase(id, sessionHash);
}

export async function countActiveCases(sessionHash: string) {
  await ensureCloudSchema();
  const rows = await getCloudSql().query(
    "SELECT COUNT(*)::int AS count FROM cases WHERE session_hash = $1 AND state != 'DELETED' AND expires_at > $2",
    [sessionHash, Date.now()],
  ) as Array<{ count: number }>;
  return Number(rows[0]?.count ?? 0);
}

export async function getOwnedCase(caseId: string, sessionHash: string) {
  await ensureCloudSchema();
  const rows = await getCloudSql().query(
    `SELECT id, state, provider_mode, intake_json, facts_json, analysis_json,
            preferred_name, created_at, expires_at
     FROM cases c
     JOIN case_identities i ON i.case_id = c.id
     WHERE c.id = $1 AND c.session_hash = $2 AND c.state != 'DELETED' AND c.expires_at > $3`,
    [caseId, sessionHash, Date.now()],
  ) as CloudCaseRow[];
  if (!rows[0]) throw new ApiError(404, "CASE_NOT_FOUND", "This case was not found or has expired.");
  return toView(rows[0]);
}

export async function setCaseFacts(
  caseId: string,
  sessionHash: string,
  facts: Fact[],
  state: CaseState,
) {
  await ensureCloudSchema();
  const rows = await getCloudSql().query(
    `UPDATE cases SET facts_json = $1, state = $2, updated_at = $3
     WHERE id = $4 AND session_hash = $5 AND state != 'DELETED' AND expires_at > $3
     RETURNING id`,
    [JSON.stringify(facts), state, Date.now(), caseId, sessionHash],
  ) as Array<{ id: string }>;
  if (!rows[0]) throw new ApiError(404, "CASE_NOT_FOUND", "This case was not found or has expired.");
  return getOwnedCase(caseId, sessionHash);
}

export async function setCaseAnalysis(
  caseId: string,
  sessionHash: string,
  facts: Fact[],
  analysis: Analysis,
) {
  await ensureCloudSchema();
  const now = Date.now();
  const rows = await getCloudSql().query(
    `UPDATE cases SET facts_json = $1, analysis_json = $2, state = 'READY', updated_at = $3
     WHERE id = $4 AND session_hash = $5 AND state != 'DELETED' AND expires_at > $3
     RETURNING id`,
    [JSON.stringify(facts), JSON.stringify(analysis), now, caseId, sessionHash],
  ) as Array<{ id: string }>;
  if (!rows[0]) throw new ApiError(404, "CASE_NOT_FOUND", "This case was not found or has expired.");
  return getOwnedCase(caseId, sessionHash);
}

export async function markCaseState(caseId: string, sessionHash: string, state: CaseState) {
  await ensureCloudSchema();
  const rows = await getCloudSql().query(
    `UPDATE cases SET state = $1, updated_at = $2
     WHERE id = $3 AND session_hash = $4 AND state != 'DELETED' AND expires_at > $2
     RETURNING id`,
    [state, Date.now(), caseId, sessionHash],
  ) as Array<{ id: string }>;
  if (!rows[0]) throw new ApiError(404, "CASE_NOT_FOUND", "This case was not found or has expired.");
}

export async function tryTransitionCaseState(
  caseId: string,
  sessionHash: string,
  fromStates: CaseState[],
  toState: CaseState,
) {
  if (fromStates.length === 0) return false;
  await ensureCloudSchema();
  const rows = await getCloudSql().query(
    `UPDATE cases SET state = $1, updated_at = $2
     WHERE id = $3 AND session_hash = $4 AND state = ANY($5::text[]) AND expires_at > $2
     RETURNING id`,
    [toState, Date.now(), caseId, sessionHash, fromStates],
  ) as Array<{ id: string }>;
  return Boolean(rows[0]);
}

export async function addUpload(
  caseId: string,
  sessionHash: string,
  upload: Omit<CloudUploadRecord, "caseId">,
  complete = true,
) {
  await ensureCloudSchema();
  const now = Date.now();
  const rows = await getCloudSql().query(
    `WITH inserted AS (
       INSERT INTO uploads
         (id, case_id, display_name, stored_name, mime_type, size_bytes, source_mode, category, created_at)
       SELECT $1, c.id, $4, $5, $6, $7, $8, $9, $10
       FROM cases c
       WHERE c.id = $2 AND c.session_hash = $3 AND c.state = 'DRAFT' AND c.expires_at > $10
         AND (SELECT COUNT(*) FROM uploads u WHERE u.case_id = c.id) < 10
       RETURNING case_id
     )
     UPDATE cases SET state = CASE WHEN $11 THEN 'UPLOADED' ELSE state END, updated_at = $10
     WHERE id IN (SELECT case_id FROM inserted)
     RETURNING id`,
    [upload.id, caseId, sessionHash, upload.displayName, upload.storedName, upload.mimeType,
      upload.sizeBytes, upload.sourceMode, upload.category, now, complete],
  ) as Array<{ id: string }>;
  if (!rows[0]) {
    throw new ApiError(409, "UPLOAD_NOT_RECORDED", "The case is unavailable or already has 10 files.");
  }
}

export async function removeUploads(
  caseId: string,
  sessionHash: string,
  uploadIds: string[],
) {
  if (uploadIds.length === 0) return;
  await ensureCloudSchema();
  await getCloudSql().query(
    `DELETE FROM uploads
     WHERE case_id = $1 AND id = ANY($2::text[])
       AND EXISTS (
         SELECT 1 FROM cases c
         WHERE c.id = $1 AND c.session_hash = $3 AND c.state = 'DRAFT' AND c.expires_at > $4
       )`,
    [caseId, uploadIds, sessionHash, Date.now()],
  );
}

export async function listUploads(caseId: string, sessionHash: string): Promise<CloudUploadRecord[]> {
  await getOwnedCase(caseId, sessionHash);
  const rows = await getCloudSql().query(
    `SELECT id, case_id, display_name, stored_name, mime_type, size_bytes, source_mode, category
     FROM uploads WHERE case_id = $1 ORDER BY created_at ASC`,
    [caseId],
  ) as Array<{
    id: string;
    case_id: string;
    display_name: string;
    stored_name: string;
    mime_type: string;
    size_bytes: string | number;
    source_mode: "uploaded" | "demo";
    category: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    caseId: row.case_id,
    displayName: row.display_name,
    storedName: row.stored_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    sourceMode: row.source_mode,
    category: DocumentCategorySchema.parse(row.category),
  }));
}

export async function addConversationTurn(
  caseId: string,
  sessionHash: string,
  question: string,
  response: QuestionResponse,
) {
  await getOwnedCase(caseId, sessionHash);
  await getCloudSql().query(
    `INSERT INTO conversation_turns (id, case_id, question, response_json, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [randomUUID(), caseId, question, JSON.stringify(response), Date.now()],
  );
}

export async function countConversationTurns(caseId: string, sessionHash: string) {
  await getOwnedCase(caseId, sessionHash);
  const rows = await getCloudSql().query(
    "SELECT COUNT(*)::int AS count FROM conversation_turns WHERE case_id = $1",
    [caseId],
  ) as Array<{ count: number }>;
  return Number(rows[0]?.count ?? 0);
}

export async function deleteCase(caseId: string, sessionHash: string) {
  await ensureCloudSchema();
  const rows = await getCloudSql().query(
    "DELETE FROM cases WHERE id = $1 AND session_hash = $2 RETURNING id",
    [caseId, sessionHash],
  ) as Array<{ id: string }>;
  if (!rows[0]) throw new ApiError(404, "CASE_NOT_FOUND", "This case was not found or has expired.");
}

export async function expiredUploadNames(now: number, idleCutoff: number) {
  await ensureCloudSchema();
  const rows = await getCloudSql().query(
    `SELECT u.stored_name
     FROM uploads u
     JOIN cases c ON c.id = u.case_id
     JOIN auth_sessions s ON s.token_hash = c.session_hash
     WHERE c.expires_at <= $1 OR s.expires_at <= $1 OR s.last_seen_at <= $2`,
    [now, idleCutoff],
  ) as Array<{ stored_name: string }>;
  return rows.map((row) => row.stored_name);
}

export async function deleteExpiredRows(now: number, idleCutoff: number) {
  await ensureCloudSchema();
  const sql = getCloudSql();
  await sql.transaction([
    sql.query(
      `DELETE FROM cases
       WHERE expires_at <= $1 OR session_hash IN (
         SELECT token_hash FROM auth_sessions WHERE expires_at <= $1 OR last_seen_at <= $2
       )`,
      [now, idleCutoff],
    ),
    sql.query(
      "DELETE FROM auth_sessions WHERE expires_at <= $1 OR last_seen_at <= $2",
      [now, idleCutoff],
    ),
  ]);
}
