import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Intake } from "@/lib/contracts";

vi.mock("server-only", () => ({}));

import {
  addUpload,
  createCase,
  deleteCase,
  initializeExtractionWork,
  listExtractionWork,
  resetFailedExtractionWork,
  resetFailedModelWork,
  updateExtractionWork,
  updateModelWork,
  upsertExtractionWork,
} from "@/lib/server/case-repository";
import { db } from "@/lib/server/db";

const dataDirectory = mkdtempSync(path.join(tmpdir(), "vera-extraction-work-"));
const intake: Intake = {
  preferredName: "Test person",
  age: 42,
  language: "English",
  documentLanguage: "English",
  symptoms: "",
  medicalHistory: "",
};

async function createCaseWithUpload() {
  const sessionHash = `session-${randomUUID()}`;
  const now = Date.now();
  db.prepare(
    `INSERT INTO auth_sessions
       (token_hash, csrf_hash, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(sessionHash, `csrf-${randomUUID()}`, now, now, now + 60_000);
  const caseView = await createCase(sessionHash, intake, "live");
  const uploadId = randomUUID();
  await addUpload(
    caseView.id,
    sessionHash,
    {
      id: uploadId,
      displayName: "report.pdf",
      storedName: `${uploadId}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 1_024,
      sourceMode: "uploaded",
      category: "report",
    },
    false,
  );
  return { caseId: caseView.id, sessionHash, uploadId };
}

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  vi.stubEnv("VERA_DATA_DIR", dataDirectory);
  const legacyDatabase = new DatabaseSync(path.join(dataDirectory, "mvp.sqlite"));
  legacyDatabase.exec(`
    CREATE TABLE extraction_work (
      case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      upload_id TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
      page_offset INTEGER NOT NULL CHECK (page_offset >= 0),
      page_count INTEGER NOT NULL CHECK (page_count > 0),
      status TEXT NOT NULL CHECK (status IN ('pending', 'submitted', 'results_pending', 'completed', 'failed')),
      provider_job_id TEXT,
      ocr_pages_json TEXT,
      attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      lease_expires_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (case_id, upload_id, chunk_index)
    )
  `);
  legacyDatabase.close();
});

afterAll(() => {
  globalThis.__medicalReportDb?.close();
  globalThis.__medicalReportDb = undefined;
  vi.unstubAllEnvs();
  rmSync(dataDirectory, { recursive: true, force: true });
});

describe("local extraction-work repository", () => {
  it("migrates legacy OCR work and applies safe model defaults", async () => {
    const columns = db.prepare("PRAGMA table_info(extraction_work)").all() as Array<{
      name: string;
      dflt_value: string | null;
    }>;
    const defaults = new Map(columns.map((column) => [column.name, column.dflt_value]));
    expect(defaults.get("model_status")).toBe("'pending'");
    expect(defaults.get("model_facts_json")).toBeNull();
    expect(defaults.get("model_attempts")).toBe("0");
    expect(defaults.get("model_error_code")).toBeNull();
    expect(defaults.get("model_lease_expires_at")).toBeNull();

    const owner = await createCaseWithUpload();
    const pending = await upsertExtractionWork(owner.caseId, owner.sessionHash, {
      uploadId: owner.uploadId,
      chunkIndex: 0,
      pageOffset: 0,
      pageCount: 1,
    });
    expect(pending).toMatchObject({
      modelStatus: "pending",
      modelFacts: null,
      modelAttempts: 0,
      modelErrorCode: null,
      modelLeaseExpiresAt: null,
    });
  });

  it("creates the whole page plan atomically", async () => {
    const owner = await createCaseWithUpload();
    await expect(initializeExtractionWork(owner.caseId, owner.sessionHash, [
      { uploadId: owner.uploadId, chunkIndex: 0, pageOffset: 0, pageCount: 10 },
      { uploadId: "missing-upload", chunkIndex: 0, pageOffset: 0, pageCount: 1 },
    ])).rejects.toMatchObject({ code: "EXTRACTION_WORK_CONFLICT", status: 409 });
    await expect(listExtractionWork(owner.caseId, owner.sessionHash)).resolves.toEqual([]);

    const records = await initializeExtractionWork(owner.caseId, owner.sessionHash, [
      { uploadId: owner.uploadId, chunkIndex: 0, pageOffset: 0, pageCount: 10 },
      { uploadId: owner.uploadId, chunkIndex: 1, pageOffset: 10, pageCount: 3 },
    ]);
    expect(records.map((record) => [record.chunkIndex, record.pageOffset, record.pageCount]))
      .toEqual([[0, 0, 10], [1, 10, 3]]);
  });

  it("idempotently creates immutable chunks and reads them in stable order", async () => {
    const owner = await createCaseWithUpload();
    await upsertExtractionWork(owner.caseId, owner.sessionHash, {
      uploadId: owner.uploadId,
      chunkIndex: 1,
      pageOffset: 10,
      pageCount: 10,
    });
    const first = await upsertExtractionWork(owner.caseId, owner.sessionHash, {
      uploadId: owner.uploadId,
      chunkIndex: 0,
      pageOffset: 0,
      pageCount: 10,
    });
    const repeated = await upsertExtractionWork(owner.caseId, owner.sessionHash, {
      uploadId: owner.uploadId,
      chunkIndex: 0,
      pageOffset: 0,
      pageCount: 10,
    });

    expect(repeated).toEqual(first);
    await expect(
      upsertExtractionWork(owner.caseId, owner.sessionHash, {
        uploadId: owner.uploadId,
        chunkIndex: 0,
        pageOffset: 1,
        pageCount: 10,
      }),
    ).rejects.toMatchObject({ code: "EXTRACTION_WORK_CONFLICT", status: 409 });

    const records = await listExtractionWork(owner.caseId, owner.sessionHash);
    expect(records.map((record) => [record.chunkIndex, record.pageOffset, record.pageCount]))
      .toEqual([[0, 0, 10], [1, 10, 10]]);
    expect(records.every((record) => record.status === "pending")).toBe(true);
  });

  it("uses updatedAt as a compare-and-set token across every external-call boundary", async () => {
    const owner = await createCaseWithUpload();
    const pending = await upsertExtractionWork(owner.caseId, owner.sessionHash, {
      uploadId: owner.uploadId,
      chunkIndex: 0,
      pageOffset: 0,
      pageCount: 3,
    });
    const leaseExpiresAt = Date.now() + 30_000;
    const submitted = await updateExtractionWork(
      owner.caseId,
      owner.sessionHash,
      { uploadId: owner.uploadId, chunkIndex: 0 },
      {
        expectedUpdatedAt: pending.updatedAt,
        status: "submitted",
        providerJobId: "job-1",
        ocrPages: null,
        attempts: 1,
        leaseExpiresAt,
      },
    );
    expect(submitted).toMatchObject({
      status: "submitted",
      providerJobId: "job-1",
      attempts: 1,
      leaseExpiresAt,
    });
    expect(submitted!.updatedAt).toBeGreaterThan(pending.updatedAt);

    await expect(
      updateExtractionWork(
        owner.caseId,
        owner.sessionHash,
        { uploadId: owner.uploadId, chunkIndex: 0 },
        {
          expectedUpdatedAt: pending.updatedAt,
          status: "submitted",
          providerJobId: "duplicate-job",
          ocrPages: null,
          attempts: 1,
          leaseExpiresAt,
        },
      ),
    ).resolves.toBeNull();

    const resultsPending = await updateExtractionWork(
      owner.caseId,
      owner.sessionHash,
      { uploadId: owner.uploadId, chunkIndex: 0 },
      {
        expectedUpdatedAt: submitted!.updatedAt,
        status: "results_pending",
        providerJobId: "job-1",
        ocrPages: null,
        attempts: 1,
        leaseExpiresAt: null,
      },
    );
    const completed = await updateExtractionWork(
      owner.caseId,
      owner.sessionHash,
      { uploadId: owner.uploadId, chunkIndex: 0 },
      {
        expectedUpdatedAt: resultsPending!.updatedAt,
        status: "completed",
        providerJobId: "job-1",
        ocrPages: [{ page: 1, text: "HbA1c 7.2%" }],
        attempts: 1,
        leaseExpiresAt: null,
      },
    );
    expect(completed).toMatchObject({
      status: "completed",
      ocrPages: [{ page: 1, text: "HbA1c 7.2%" }],
    });
  });

  it("resets only the exact failed version and preserves its attempt count", async () => {
    const owner = await createCaseWithUpload();
    const pending = await upsertExtractionWork(owner.caseId, owner.sessionHash, {
      uploadId: owner.uploadId,
      chunkIndex: 0,
      pageOffset: 0,
      pageCount: 1,
    });
    const failed = await updateExtractionWork(
      owner.caseId,
      owner.sessionHash,
      { uploadId: owner.uploadId, chunkIndex: 0 },
      {
        expectedUpdatedAt: pending.updatedAt,
        status: "failed",
        providerJobId: "failed-job",
        ocrPages: null,
        attempts: 2,
        leaseExpiresAt: Date.now() - 1,
      },
    );

    const reset = await resetFailedExtractionWork(
      owner.caseId,
      owner.sessionHash,
      { uploadId: owner.uploadId, chunkIndex: 0 },
      failed!.updatedAt,
    );
    expect(reset).toMatchObject({
      status: "pending",
      providerJobId: null,
      ocrPages: null,
      attempts: 2,
      leaseExpiresAt: null,
    });
    await expect(
      resetFailedExtractionWork(
        owner.caseId,
        owner.sessionHash,
        { uploadId: owner.uploadId, chunkIndex: 0 },
        failed!.updatedAt,
      ),
    ).resolves.toBeNull();
  });

  it("updates and resets model work without changing completed OCR", async () => {
    const owner = await createCaseWithUpload();
    const pending = await upsertExtractionWork(owner.caseId, owner.sessionHash, {
      uploadId: owner.uploadId,
      chunkIndex: 0,
      pageOffset: 0,
      pageCount: 1,
    });
    const ocrCompleted = await updateExtractionWork(
      owner.caseId,
      owner.sessionHash,
      { uploadId: owner.uploadId, chunkIndex: 0 },
      {
        expectedUpdatedAt: pending.updatedAt,
        status: "completed",
        providerJobId: "ocr-job-1",
        ocrPages: [{ page: 1, text: "No supported facts on this page." }],
        attempts: 1,
        leaseExpiresAt: null,
      },
    );
    const modelLeaseExpiresAt = Date.now() + 30_000;
    const claimed = await updateModelWork(
      owner.caseId,
      owner.sessionHash,
      { uploadId: owner.uploadId, chunkIndex: 0 },
      {
        expectedUpdatedAt: ocrCompleted!.updatedAt,
        modelStatus: "pending",
        modelFacts: null,
        modelAttempts: 1,
        modelErrorCode: null,
        modelLeaseExpiresAt,
      },
    );
    expect(claimed).toMatchObject({
      status: "completed",
      providerJobId: "ocr-job-1",
      ocrPages: [{ page: 1, text: "No supported facts on this page." }],
      attempts: 1,
      modelStatus: "pending",
      modelAttempts: 1,
      modelLeaseExpiresAt,
    });
    await expect(updateModelWork(
      owner.caseId,
      owner.sessionHash,
      { uploadId: owner.uploadId, chunkIndex: 0 },
      {
        expectedUpdatedAt: ocrCompleted!.updatedAt,
        modelStatus: "failed",
        modelFacts: null,
        modelAttempts: 2,
        modelErrorCode: "MODEL_OUTPUT_INCOMPLETE",
        modelLeaseExpiresAt: null,
      },
    )).resolves.toBeNull();

    const failed = await updateModelWork(
      owner.caseId,
      owner.sessionHash,
      { uploadId: owner.uploadId, chunkIndex: 0 },
      {
        expectedUpdatedAt: claimed!.updatedAt,
        modelStatus: "failed",
        modelFacts: null,
        modelAttempts: 2,
        modelErrorCode: "MODEL_OUTPUT_INCOMPLETE",
        modelLeaseExpiresAt: null,
      },
    );
    const reset = await resetFailedModelWork(
      owner.caseId,
      owner.sessionHash,
      { uploadId: owner.uploadId, chunkIndex: 0 },
      failed!.updatedAt,
    );
    expect(reset).toMatchObject({
      status: "completed",
      providerJobId: "ocr-job-1",
      ocrPages: [{ page: 1, text: "No supported facts on this page." }],
      attempts: 1,
      modelStatus: "pending",
      modelFacts: null,
      modelAttempts: 0,
      modelErrorCode: null,
      modelLeaseExpiresAt: null,
    });

    const completed = await updateModelWork(
      owner.caseId,
      owner.sessionHash,
      { uploadId: owner.uploadId, chunkIndex: 0 },
      {
        expectedUpdatedAt: reset!.updatedAt,
        modelStatus: "completed",
        modelFacts: [],
        modelAttempts: 1,
        modelErrorCode: null,
        modelLeaseExpiresAt: null,
      },
    );
    expect(completed).toMatchObject({ modelStatus: "completed", modelFacts: [] });
    await expect(resetFailedModelWork(
      owner.caseId,
      owner.sessionHash,
      { uploadId: owner.uploadId, chunkIndex: 0 },
      completed!.updatedAt,
    )).resolves.toBeNull();
  });

  it("removes extraction work through the existing case deletion cascade", async () => {
    const owner = await createCaseWithUpload();
    await upsertExtractionWork(owner.caseId, owner.sessionHash, {
      uploadId: owner.uploadId,
      chunkIndex: 0,
      pageOffset: 0,
      pageCount: 1,
    });
    expect(
      (db.prepare("SELECT COUNT(*) AS count FROM extraction_work WHERE case_id = ?")
        .get(owner.caseId) as { count: number }).count,
    ).toBe(1);

    await deleteCase(owner.caseId, owner.sessionHash);

    expect(
      (db.prepare("SELECT COUNT(*) AS count FROM extraction_work WHERE case_id = ?")
        .get(owner.caseId) as { count: number }).count,
    ).toBe(0);
  });
});
