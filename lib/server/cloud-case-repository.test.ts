import { beforeEach, describe, expect, it, vi } from "vitest";

const cloudMocks = vi.hoisted(() => ({
  ensureSchema: vi.fn(async () => undefined),
  query: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/neon", () => ({
  ensureCloudSchema: cloudMocks.ensureSchema,
  getCloudSql: () => ({ query: cloudMocks.query }),
}));

import {
  initializeExtractionWork,
  listExtractionWork,
  resetFailedExtractionWork,
  resetFailedModelWork,
  updateExtractionWork,
  updateModelWork,
  upsertExtractionWork,
} from "@/lib/server/cloud-case-repository";

const caseRow = {
  id: "case-1",
  state: "EXTRACTING",
  provider_mode: "live",
  intake_json: JSON.stringify({
    age: 42,
    language: "English",
    documentLanguage: "English",
    symptoms: "",
    medicalHistory: "",
  }),
  facts_json: "[]",
  analysis_json: null,
  preferred_name: "Test person",
  created_at: 1,
  expires_at: Date.now() + 60_000,
};

const pendingRow = {
  case_id: "case-1",
  upload_id: "upload-1",
  chunk_index: 0,
  page_offset: 0,
  page_count: 10,
  status: "pending",
  provider_job_id: null,
  ocr_pages_json: null,
  attempts: 0,
  lease_expires_at: null,
  model_status: "pending",
  model_facts_json: null,
  model_attempts: 0,
  model_error_code: null,
  model_lease_expires_at: null,
  created_at: 10,
  updated_at: 10,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("cloud extraction-work repository", () => {
  it("does not persist a valid subset when one planned upload is missing", async () => {
    const persisted: typeof pendingRow[] = [];
    cloudMocks.query.mockImplementation(async (statement: string, parameters?: unknown[]) => {
      if (statement.includes("FROM cases c")) return [caseRow];
      if (statement.includes("WITH requested AS")) {
        const requested = JSON.parse(String(parameters?.[0])) as Array<{ upload_id: string }>;
        if (requested.every((item) => item.upload_id === "upload-1")) {
          persisted.push(pendingRow);
        }
        return [];
      }
      if (statement.includes("FROM extraction_work ew")) return persisted;
      return [];
    });

    await expect(initializeExtractionWork("case-1", "session-1", [
      { uploadId: "upload-1", chunkIndex: 0, pageOffset: 0, pageCount: 10 },
      { uploadId: "missing-upload", chunkIndex: 0, pageOffset: 0, pageCount: 1 },
    ])).rejects.toMatchObject({ code: "EXTRACTION_WORK_CONFLICT", status: 409 });
    expect(persisted).toEqual([]);

    const guardedStatement = cloudMocks.query.mock.calls
      .map(([statement]) => String(statement))
      .find((statement) => statement.includes("WITH requested AS"));
    expect(guardedStatement).toContain("plan_is_valid");
    expect(guardedStatement).toContain("LEFT JOIN uploads");
    expect(guardedStatement).toContain("WHERE check_result.accepted");
  });

  it("uses idempotent insert and compare-and-set update SQL", async () => {
    cloudMocks.query.mockImplementation(async (statement: string) => {
      if (statement.includes("FROM cases c")) return [caseRow];
      if (statement.includes("INSERT INTO extraction_work")) return [pendingRow];
      if (statement.includes("UPDATE extraction_work")) {
        return [{
          ...pendingRow,
          status: "results_pending",
          provider_job_id: "job-1",
          attempts: 1,
          updated_at: 11,
        }];
      }
      return [];
    });

    const pending = await upsertExtractionWork("case-1", "session-1", {
      uploadId: "upload-1",
      chunkIndex: 0,
      pageOffset: 0,
      pageCount: 10,
    });
    expect(pending.status).toBe("pending");

    const updated = await updateExtractionWork(
      "case-1",
      "session-1",
      { uploadId: "upload-1", chunkIndex: 0 },
      {
        expectedUpdatedAt: pending.updatedAt,
        status: "results_pending",
        providerJobId: "job-1",
        ocrPages: null,
        attempts: 1,
        leaseExpiresAt: null,
      },
    );
    expect(updated).toMatchObject({ status: "results_pending", providerJobId: "job-1" });

    const statements = cloudMocks.query.mock.calls.map(([statement]) => String(statement));
    expect(statements.some((statement) =>
      statement.includes("ON CONFLICT (case_id, upload_id, chunk_index) DO NOTHING")
    )).toBe(true);
    expect(statements.some((statement) =>
      statement.includes("chunk_index = $9 AND updated_at = $10")
    )).toBe(true);
  });

  it("lists persisted OCR and resets only failed work", async () => {
    const failedRow = {
      ...pendingRow,
      status: "failed",
      provider_job_id: "job-failed",
      attempts: 2,
      updated_at: 20,
    };
    cloudMocks.query.mockImplementation(async (statement: string) => {
      if (statement.includes("FROM cases c")) return [caseRow];
      if (statement.includes("FROM extraction_work ew")) return [failedRow];
      if (statement.includes("SET status = 'pending'")) {
        return [{
          ...failedRow,
          status: "pending",
          provider_job_id: null,
          attempts: 2,
          updated_at: 21,
        }];
      }
      return [];
    });

    const [failed] = await listExtractionWork("case-1", "session-1");
    expect(failed).toMatchObject({ status: "failed", attempts: 2 });
    const reset = await resetFailedExtractionWork(
      "case-1",
      "session-1",
      { uploadId: "upload-1", chunkIndex: 0 },
      failed.updatedAt,
    );
    expect(reset).toMatchObject({ status: "pending", providerJobId: null, attempts: 2 });
  });

  it("uses a separate model CAS and resets it without changing completed OCR", async () => {
    let updatedAt = 30;
    const ocrCompletedRow = {
      ...pendingRow,
      status: "completed",
      provider_job_id: "ocr-job-1",
      ocr_pages_json: JSON.stringify([{ page: 1, text: "No supported facts." }]),
      attempts: 1,
      updated_at: updatedAt,
    };
    cloudMocks.query.mockImplementation(async (statement: string, parameters?: unknown[]) => {
      if (statement.includes("FROM cases c")) return [caseRow];
      if (statement.includes("SET model_status = $1")) {
        updatedAt += 1;
        return [{
          ...ocrCompletedRow,
          model_status: parameters?.[0],
          model_facts_json: parameters?.[1],
          model_attempts: parameters?.[2],
          model_error_code: parameters?.[3],
          model_lease_expires_at: parameters?.[4],
          updated_at: updatedAt,
        }];
      }
      if (statement.includes("SET model_status = 'pending'")) {
        updatedAt += 1;
        return [{
          ...ocrCompletedRow,
          model_status: "pending",
          model_facts_json: null,
          model_attempts: 0,
          model_error_code: null,
          model_lease_expires_at: null,
          updated_at: updatedAt,
        }];
      }
      return [];
    });

    const failed = await updateModelWork(
      "case-1",
      "session-1",
      { uploadId: "upload-1", chunkIndex: 0 },
      {
        expectedUpdatedAt: 30,
        modelStatus: "failed",
        modelFacts: null,
        modelAttempts: 2,
        modelErrorCode: "MODEL_OUTPUT_INCOMPLETE",
        modelLeaseExpiresAt: null,
      },
    );
    expect(failed).toMatchObject({
      status: "completed",
      ocrPages: [{ page: 1, text: "No supported facts." }],
      attempts: 1,
      modelStatus: "failed",
      modelAttempts: 2,
      modelErrorCode: "MODEL_OUTPUT_INCOMPLETE",
    });

    const reset = await resetFailedModelWork(
      "case-1",
      "session-1",
      { uploadId: "upload-1", chunkIndex: 0 },
      failed!.updatedAt,
    );
    expect(reset).toMatchObject({
      status: "completed",
      providerJobId: "ocr-job-1",
      ocrPages: [{ page: 1, text: "No supported facts." }],
      attempts: 1,
      modelStatus: "pending",
      modelFacts: null,
      modelAttempts: 0,
      modelErrorCode: null,
      modelLeaseExpiresAt: null,
    });

    const completed = await updateModelWork(
      "case-1",
      "session-1",
      { uploadId: "upload-1", chunkIndex: 0 },
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

    const statements = cloudMocks.query.mock.calls.map(([statement]) => String(statement));
    const modelUpdate = statements.find((statement) => statement.includes("SET model_status = $1"));
    const modelReset = statements.find((statement) =>
      statement.includes("SET model_status = 'pending'")
    );
    expect(modelUpdate).toContain("AND status = 'completed' AND updated_at = $10");
    expect(modelReset).toContain("model_attempts = 0");
    expect(modelReset).toContain("AND status = 'completed' AND model_status = 'failed'");
    expect(cloudMocks.query.mock.calls.some(([, parameters]) => parameters?.[1] === "[]")).toBe(true);
  });
});
