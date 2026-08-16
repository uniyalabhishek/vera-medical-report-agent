import "server-only";

import { randomUUID } from "node:crypto";
import type {
  Analysis,
  CaseState,
  CaseView,
  DocumentCategory,
  Fact,
  Intake,
  QuestionResponse,
} from "@/lib/contracts";
import { DocumentCategorySchema, IntakeSchema } from "@/lib/contracts";
import { db } from "@/lib/server/db";
import { ApiError } from "@/lib/server/api-error";
import * as cloud from "@/lib/server/cloud-case-repository";
import {
  hasExactExtractionPlan,
  hasSameExtractionGeometry,
  serializeModelFacts,
  serializeOcrPages,
  toExtractionWorkRecord,
} from "@/lib/server/extraction-work";
import type {
  ExtractionWorkKey,
  ExtractionWorkRecord,
  ExtractionWorkRow,
  ExtractionWorkUpdate,
  ModelWorkUpdate,
  NewExtractionWork,
} from "@/lib/server/extraction-work";
import { getStorageMode } from "@/lib/server/storage-mode";

export type {
  ExtractionOcrPage,
  ExtractionWorkKey,
  ExtractionWorkRecord,
  ExtractionWorkStatus,
  ExtractionWorkUpdate,
  ModelWorkStatus,
  ModelWorkUpdate,
  NewExtractionWork,
} from "@/lib/server/extraction-work";

const CASE_RETENTION_MS = 24 * 60 * 60 * 1_000;

type CaseRow = {
  id: string;
  state: CaseState;
  provider_mode: "demo" | "live";
  intake_json: string;
  facts_json: string;
  analysis_json: string | null;
  preferred_name: string;
  created_at: number;
  expires_at: number;
};

export type UploadRecord = {
  id: string;
  caseId: string;
  displayName: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  sourceMode: "uploaded" | "demo";
  category: DocumentCategory;
};

function toView(row: CaseRow): CaseView {
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
    analysis: row.analysis_json ? (JSON.parse(row.analysis_json) as Analysis) : null,
    createdAt: new Date(row.created_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}

export async function createCase(sessionHash: string, intake: Intake, providerMode: "demo" | "live") {
  if (getStorageMode() === "cloud") return cloud.createCase(sessionHash, intake, providerMode);
  const id = randomUUID();
  const now = Date.now();
  const expiresAt = now + CASE_RETENTION_MS;
  const { preferredName, ...clinicalIntake } = intake;

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      `INSERT INTO cases
        (id, session_hash, state, provider_mode, intake_json, facts_json,
         analysis_json, created_at, updated_at, expires_at)
       VALUES (?, ?, 'DRAFT', ?, ?, '[]', NULL, ?, ?, ?)`,
    ).run(
      id,
      sessionHash,
      providerMode,
      JSON.stringify(clinicalIntake),
      now,
      now,
      expiresAt,
    );
    db.prepare("INSERT INTO case_identities (case_id, preferred_name) VALUES (?, ?)").run(
      id,
      preferredName,
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return getOwnedCase(id, sessionHash);
}

export async function countActiveCases(sessionHash: string) {
  if (getStorageMode() === "cloud") return cloud.countActiveCases(sessionHash);
  const row = db.prepare(
    "SELECT COUNT(*) AS count FROM cases WHERE session_hash = ? AND state != 'DELETED' AND expires_at > ?",
  ).get(sessionHash, Date.now()) as { count: number };
  return row.count;
}

export async function getOwnedCase(caseId: string, sessionHash: string) {
  if (getStorageMode() === "cloud") return cloud.getOwnedCase(caseId, sessionHash);
  const row = db
    .prepare(
      `SELECT c.id, c.state, c.provider_mode, c.intake_json, c.facts_json,
              c.analysis_json, c.created_at, c.expires_at, i.preferred_name
       FROM cases c
       JOIN case_identities i ON i.case_id = c.id
       WHERE c.id = ? AND c.session_hash = ? AND c.state != 'DELETED'`,
    )
    .get(caseId, sessionHash) as CaseRow | undefined;

  if (!row || row.expires_at <= Date.now()) {
    throw new ApiError(404, "CASE_NOT_FOUND", "This case was not found or has expired.");
  }

  return toView(row);
}

export async function setCaseFacts(
  caseId: string,
  sessionHash: string,
  facts: Fact[],
  state: CaseState,
) {
  if (getStorageMode() === "cloud") {
    return cloud.setCaseFacts(caseId, sessionHash, facts, state);
  }
  const result = db
    .prepare(
      `UPDATE cases SET facts_json = ?, state = ?, updated_at = ?
       WHERE id = ? AND session_hash = ? AND state != 'DELETED'`,
    )
    .run(JSON.stringify(facts), state, Date.now(), caseId, sessionHash);

  if (result.changes !== 1) {
    throw new ApiError(404, "CASE_NOT_FOUND", "This case was not found or has expired.");
  }
  return getOwnedCase(caseId, sessionHash);
}

export async function setCaseAnalysis(
  caseId: string,
  sessionHash: string,
  facts: Fact[],
  analysis: Analysis,
) {
  if (getStorageMode() === "cloud") {
    return cloud.setCaseAnalysis(caseId, sessionHash, facts, analysis);
  }
  const result = db
    .prepare(
      `UPDATE cases
       SET facts_json = ?, analysis_json = ?, state = 'READY', updated_at = ?
       WHERE id = ? AND session_hash = ? AND state != 'DELETED'`,
    )
    .run(JSON.stringify(facts), JSON.stringify(analysis), Date.now(), caseId, sessionHash);

  if (result.changes !== 1) {
    throw new ApiError(404, "CASE_NOT_FOUND", "This case was not found or has expired.");
  }
  return getOwnedCase(caseId, sessionHash);
}

export async function markCaseState(caseId: string, sessionHash: string, state: CaseState) {
  if (getStorageMode() === "cloud") return cloud.markCaseState(caseId, sessionHash, state);
  const result = db
    .prepare(
      `UPDATE cases SET state = ?, updated_at = ?
       WHERE id = ? AND session_hash = ? AND state != 'DELETED'`,
    )
    .run(state, Date.now(), caseId, sessionHash);

  if (result.changes !== 1) {
    throw new ApiError(404, "CASE_NOT_FOUND", "This case was not found or has expired.");
  }
}

export async function tryTransitionCaseState(
  caseId: string,
  sessionHash: string,
  fromStates: CaseState[],
  toState: CaseState,
) {
  if (getStorageMode() === "cloud") {
    return cloud.tryTransitionCaseState(caseId, sessionHash, fromStates, toState);
  }
  if (fromStates.length === 0) return false;
  const placeholders = fromStates.map(() => "?").join(", ");
  const result = db
    .prepare(
      `UPDATE cases SET state = ?, updated_at = ?
       WHERE id = ? AND session_hash = ? AND state IN (${placeholders}) AND expires_at > ?`,
    )
    .run(toState, Date.now(), caseId, sessionHash, ...fromStates, Date.now());
  return result.changes === 1;
}

export async function addUpload(
  caseId: string,
  sessionHash: string,
  upload: Omit<UploadRecord, "caseId">,
  complete = true,
) {
  if (getStorageMode() === "cloud") return cloud.addUpload(caseId, sessionHash, upload, complete);
  const caseView = await getOwnedCase(caseId, sessionHash);
  if (caseView.state !== "DRAFT") {
    throw new ApiError(409, "UPLOADS_CLOSED", "Uploads are closed after report reading starts.");
  }
  db.prepare(
    `INSERT INTO uploads
      (id, case_id, display_name, stored_name, mime_type, size_bytes, source_mode, category, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    upload.id,
    caseId,
    upload.displayName,
    upload.storedName,
    upload.mimeType,
    upload.sizeBytes,
    upload.sourceMode,
    upload.category,
    Date.now(),
  );
  if (complete) await markCaseState(caseId, sessionHash, "UPLOADED");
}

export async function removeUploads(
  caseId: string,
  sessionHash: string,
  uploadIds: string[],
) {
  if (uploadIds.length === 0) return;
  if (getStorageMode() === "cloud") {
    return cloud.removeUploads(caseId, sessionHash, uploadIds);
  }
  const caseView = await getOwnedCase(caseId, sessionHash);
  if (caseView.state !== "DRAFT") {
    throw new ApiError(409, "UPLOADS_CLOSED", "Uploads are closed after report reading starts.");
  }
  const placeholders = uploadIds.map(() => "?").join(", ");
  db.prepare(
    `DELETE FROM uploads WHERE case_id = ? AND id IN (${placeholders})`,
  ).run(caseId, ...uploadIds);
}

export async function listUploads(caseId: string, sessionHash: string): Promise<UploadRecord[]> {
  if (getStorageMode() === "cloud") return cloud.listUploads(caseId, sessionHash);
  await getOwnedCase(caseId, sessionHash);
  const rows = db
    .prepare(
      `SELECT id, case_id, display_name, stored_name, mime_type, size_bytes, source_mode, category
       FROM uploads WHERE case_id = ? ORDER BY created_at ASC`,
    )
    .all(caseId) as Array<{
    id: string;
    case_id: string;
    display_name: string;
    stored_name: string;
    mime_type: string;
    size_bytes: number;
    source_mode: "uploaded" | "demo";
    category: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    caseId: row.case_id,
    displayName: row.display_name,
    storedName: row.stored_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    sourceMode: row.source_mode,
    category: DocumentCategorySchema.parse(row.category),
  }));
}

function getLocalExtractionWork(
  caseId: string,
  uploadId: string,
  chunkIndex: number,
): ExtractionWorkRecord | null {
  const row = db.prepare(
    `SELECT case_id, upload_id, chunk_index, page_offset, page_count, status,
            provider_job_id, ocr_pages_json, attempts, lease_expires_at,
            model_status, model_facts_json, model_attempts, model_error_code,
            model_lease_expires_at,
            created_at, updated_at
     FROM extraction_work
     WHERE case_id = ? AND upload_id = ? AND chunk_index = ?`,
  ).get(caseId, uploadId, chunkIndex) as ExtractionWorkRow | undefined;
  return row ? toExtractionWorkRecord(row) : null;
}

export async function upsertExtractionWork(
  caseId: string,
  sessionHash: string,
  input: NewExtractionWork,
) {
  if (getStorageMode() === "cloud") {
    return cloud.upsertExtractionWork(caseId, sessionHash, input);
  }
  await getOwnedCase(caseId, sessionHash);
  const now = Date.now();
  db.prepare(
    `INSERT INTO extraction_work
       (case_id, upload_id, chunk_index, page_offset, page_count, status,
        provider_job_id, ocr_pages_json, attempts, lease_expires_at,
        created_at, updated_at)
     SELECT u.case_id, u.id, ?, ?, ?, 'pending', NULL, NULL, 0, NULL, ?, ?
     FROM uploads u
     WHERE u.id = ? AND u.case_id = ?
     ON CONFLICT (case_id, upload_id, chunk_index) DO NOTHING`,
  ).run(
    input.chunkIndex,
    input.pageOffset,
    input.pageCount,
    now,
    now,
    input.uploadId,
    caseId,
  );

  const record = getLocalExtractionWork(caseId, input.uploadId, input.chunkIndex);
  if (!record) {
    throw new ApiError(404, "UPLOAD_NOT_FOUND", "The upload for this extraction work was not found.");
  }
  if (!hasSameExtractionGeometry(record, input)) {
    throw new ApiError(
      409,
      "EXTRACTION_WORK_CONFLICT",
      "This extraction chunk conflicts with the saved extraction work.",
    );
  }
  return record;
}

export async function initializeExtractionWork(
  caseId: string,
  sessionHash: string,
  inputs: NewExtractionWork[],
): Promise<ExtractionWorkRecord[]> {
  if (getStorageMode() === "cloud") {
    return cloud.initializeExtractionWork(caseId, sessionHash, inputs);
  }
  await getOwnedCase(caseId, sessionHash);
  if (inputs.length === 0) {
    throw new ApiError(409, "EXTRACTION_PLAN_EMPTY", "No document pages were prepared.");
  }

  const now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    const insert = db.prepare(
      `INSERT INTO extraction_work
         (case_id, upload_id, chunk_index, page_offset, page_count, status,
          provider_job_id, ocr_pages_json, attempts, lease_expires_at,
          created_at, updated_at)
       SELECT u.case_id, u.id, ?, ?, ?, 'pending', NULL, NULL, 0, NULL, ?, ?
       FROM uploads u
       WHERE u.id = ? AND u.case_id = ?
       ON CONFLICT (case_id, upload_id, chunk_index) DO NOTHING`,
    );
    for (const input of inputs) {
      insert.run(
        input.chunkIndex,
        input.pageOffset,
        input.pageCount,
        now,
        now,
        input.uploadId,
        caseId,
      );
    }
    const rows = db.prepare(
      `SELECT ew.case_id, ew.upload_id, ew.chunk_index, ew.page_offset,
              ew.page_count, ew.status, ew.provider_job_id, ew.ocr_pages_json,
              ew.attempts, ew.lease_expires_at, ew.model_status,
              ew.model_facts_json, ew.model_attempts, ew.model_error_code,
              ew.model_lease_expires_at, ew.created_at, ew.updated_at
       FROM extraction_work ew
       JOIN uploads u ON u.id = ew.upload_id AND u.case_id = ew.case_id
       WHERE ew.case_id = ?
       ORDER BY u.created_at ASC, u.id ASC, ew.chunk_index ASC`,
    ).all(caseId) as ExtractionWorkRow[];
    const records = rows.map(toExtractionWorkRecord);
    if (!hasExactExtractionPlan(records, inputs)) {
      throw new ApiError(
        409,
        "EXTRACTION_WORK_CONFLICT",
        "The saved page plan does not match this report.",
      );
    }
    db.exec("COMMIT");
    return records;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export async function listExtractionWork(
  caseId: string,
  sessionHash: string,
): Promise<ExtractionWorkRecord[]> {
  if (getStorageMode() === "cloud") return cloud.listExtractionWork(caseId, sessionHash);
  await getOwnedCase(caseId, sessionHash);
  const rows = db.prepare(
    `SELECT ew.case_id, ew.upload_id, ew.chunk_index, ew.page_offset,
            ew.page_count, ew.status, ew.provider_job_id, ew.ocr_pages_json,
            ew.attempts, ew.lease_expires_at, ew.model_status,
            ew.model_facts_json, ew.model_attempts, ew.model_error_code,
            ew.model_lease_expires_at, ew.created_at, ew.updated_at
     FROM extraction_work ew
     JOIN uploads u ON u.id = ew.upload_id AND u.case_id = ew.case_id
     WHERE ew.case_id = ?
     ORDER BY u.created_at ASC, u.id ASC, ew.chunk_index ASC`,
  ).all(caseId) as ExtractionWorkRow[];
  return rows.map(toExtractionWorkRecord);
}

export async function updateExtractionWork(
  caseId: string,
  sessionHash: string,
  key: ExtractionWorkKey,
  update: ExtractionWorkUpdate,
): Promise<ExtractionWorkRecord | null> {
  if (getStorageMode() === "cloud") {
    return cloud.updateExtractionWork(caseId, sessionHash, key, update);
  }
  await getOwnedCase(caseId, sessionHash);
  const updatedAt = Math.max(Date.now(), update.expectedUpdatedAt + 1);
  const result = db.prepare(
    `UPDATE extraction_work
     SET status = ?, provider_job_id = ?, ocr_pages_json = ?, attempts = ?,
         lease_expires_at = ?, updated_at = ?
     WHERE case_id = ? AND upload_id = ? AND chunk_index = ? AND updated_at = ?`,
  ).run(
    update.status,
    update.providerJobId,
    serializeOcrPages(update.ocrPages),
    update.attempts,
    update.leaseExpiresAt,
    updatedAt,
    caseId,
    key.uploadId,
    key.chunkIndex,
    update.expectedUpdatedAt,
  );
  if (result.changes !== 1) return null;
  return getLocalExtractionWork(caseId, key.uploadId, key.chunkIndex);
}

export async function updateModelWork(
  caseId: string,
  sessionHash: string,
  key: ExtractionWorkKey,
  update: ModelWorkUpdate,
): Promise<ExtractionWorkRecord | null> {
  if (getStorageMode() === "cloud") {
    return cloud.updateModelWork(caseId, sessionHash, key, update);
  }
  await getOwnedCase(caseId, sessionHash);
  const updatedAt = Math.max(Date.now(), update.expectedUpdatedAt + 1);
  const result = db.prepare(
    `UPDATE extraction_work
     SET model_status = ?, model_facts_json = ?, model_attempts = ?,
         model_error_code = ?, model_lease_expires_at = ?, updated_at = ?
     WHERE case_id = ? AND upload_id = ? AND chunk_index = ?
       AND status = 'completed' AND updated_at = ?`,
  ).run(
    update.modelStatus,
    serializeModelFacts(update.modelFacts),
    update.modelAttempts,
    update.modelErrorCode,
    update.modelLeaseExpiresAt,
    updatedAt,
    caseId,
    key.uploadId,
    key.chunkIndex,
    update.expectedUpdatedAt,
  );
  if (result.changes !== 1) return null;
  return getLocalExtractionWork(caseId, key.uploadId, key.chunkIndex);
}

export async function resetFailedExtractionWork(
  caseId: string,
  sessionHash: string,
  key: ExtractionWorkKey,
  expectedUpdatedAt: number,
): Promise<ExtractionWorkRecord | null> {
  if (getStorageMode() === "cloud") {
    return cloud.resetFailedExtractionWork(
      caseId,
      sessionHash,
      key,
      expectedUpdatedAt,
    );
  }
  await getOwnedCase(caseId, sessionHash);
  const updatedAt = Math.max(Date.now(), expectedUpdatedAt + 1);
  const result = db.prepare(
    `UPDATE extraction_work
     SET status = 'pending', provider_job_id = NULL, ocr_pages_json = NULL,
         lease_expires_at = NULL, updated_at = ?
     WHERE case_id = ? AND upload_id = ? AND chunk_index = ?
       AND status = 'failed' AND updated_at = ?`,
  ).run(updatedAt, caseId, key.uploadId, key.chunkIndex, expectedUpdatedAt);
  if (result.changes !== 1) return null;
  return getLocalExtractionWork(caseId, key.uploadId, key.chunkIndex);
}

export async function resetFailedModelWork(
  caseId: string,
  sessionHash: string,
  key: ExtractionWorkKey,
  expectedUpdatedAt: number,
): Promise<ExtractionWorkRecord | null> {
  if (getStorageMode() === "cloud") {
    return cloud.resetFailedModelWork(
      caseId,
      sessionHash,
      key,
      expectedUpdatedAt,
    );
  }
  await getOwnedCase(caseId, sessionHash);
  const updatedAt = Math.max(Date.now(), expectedUpdatedAt + 1);
  const result = db.prepare(
    `UPDATE extraction_work
     SET model_status = 'pending', model_facts_json = NULL, model_attempts = 0,
         model_error_code = NULL, model_lease_expires_at = NULL, updated_at = ?
     WHERE case_id = ? AND upload_id = ? AND chunk_index = ?
       AND status = 'completed' AND model_status = 'failed' AND updated_at = ?`,
  ).run(updatedAt, caseId, key.uploadId, key.chunkIndex, expectedUpdatedAt);
  if (result.changes !== 1) return null;
  return getLocalExtractionWork(caseId, key.uploadId, key.chunkIndex);
}

export async function addConversationTurn(
  caseId: string,
  sessionHash: string,
  question: string,
  response: QuestionResponse,
) {
  if (getStorageMode() === "cloud") {
    return cloud.addConversationTurn(caseId, sessionHash, question, response);
  }
  await getOwnedCase(caseId, sessionHash);
  db.prepare(
    `INSERT INTO conversation_turns
      (id, case_id, question, response_json, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(randomUUID(), caseId, question, JSON.stringify(response), Date.now());
}

export async function countConversationTurns(caseId: string, sessionHash: string) {
  if (getStorageMode() === "cloud") return cloud.countConversationTurns(caseId, sessionHash);
  await getOwnedCase(caseId, sessionHash);
  const row = db.prepare(
    "SELECT COUNT(*) AS count FROM conversation_turns WHERE case_id = ?",
  ).get(caseId) as { count: number };
  return row.count;
}

export async function deleteCase(caseId: string, sessionHash: string) {
  if (getStorageMode() === "cloud") return cloud.deleteCase(caseId, sessionHash);
  const result = db
    .prepare("DELETE FROM cases WHERE id = ? AND session_hash = ?")
    .run(caseId, sessionHash);
  if (result.changes !== 1) {
    throw new ApiError(404, "CASE_NOT_FOUND", "This case was not found or has expired.");
  }
}
