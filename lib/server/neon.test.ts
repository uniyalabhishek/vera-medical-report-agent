import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const neonMocks = vi.hoisted(() => ({
  query: vi.fn(async (statement: string) => {
    void statement;
    return [];
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("@neondatabase/serverless", () => ({
  neon: vi.fn(() => ({ query: neonMocks.query })),
}));

import { ensureCloudSchema } from "@/lib/server/neon";

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "postgresql://test.invalid/vera");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("cloud schema migration", () => {
  it("creates durable extraction work with cascade cleanup and a progress index", async () => {
    await ensureCloudSchema();
    const statements = neonMocks.query.mock.calls
      .map(([statement]) => String(statement))
      .join("\n");

    expect(statements).toContain("CREATE TABLE IF NOT EXISTS extraction_work");
    expect(statements).toContain("results_pending");
    expect(statements).toContain("REFERENCES cases(id) ON DELETE CASCADE");
    expect(statements).toContain("REFERENCES uploads(id) ON DELETE CASCADE");
    expect(statements).toContain("idx_extraction_work_case_status");
    expect(statements).toContain("model_status TEXT NOT NULL DEFAULT 'pending'");
    expect(statements).toContain("model_facts_json TEXT");
    expect(statements).toContain("model_attempts INTEGER NOT NULL DEFAULT 0");
    expect(statements).toContain("model_error_code TEXT");
    expect(statements).toContain("model_lease_expires_at BIGINT");
    expect(statements).toContain("ALTER TABLE extraction_work");
    expect(statements).toContain("ADD COLUMN IF NOT EXISTS model_status");
  });
});
