import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { claimProviderCallSlot } from "@/lib/server/provider-call-slots";

const dataDirectory = mkdtempSync(path.join(tmpdir(), "vera-provider-slots-"));

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  vi.stubEnv("VERA_DATA_DIR", dataDirectory);
});

afterAll(() => {
  globalThis.__medicalReportDb?.close();
  globalThis.__medicalReportDb = undefined;
  vi.unstubAllEnvs();
  rmSync(dataDirectory, { recursive: true, force: true });
});

describe("provider call slots", () => {
  it("allows one call per interval and reports the remaining delay", async () => {
    await expect(claimProviderCallSlot("doc-ai-test", 6_500, 10_000)).resolves.toEqual({
      claimed: true,
      retryAfterMs: 0,
    });
    await expect(claimProviderCallSlot("doc-ai-test", 6_500, 12_000)).resolves.toEqual({
      claimed: false,
      retryAfterMs: 4_500,
    });
    await expect(claimProviderCallSlot("doc-ai-test", 6_500, 16_500)).resolves.toEqual({
      claimed: true,
      retryAfterMs: 0,
    });
  });
});
