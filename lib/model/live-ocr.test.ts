import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const sarvamMocks = vi.hoisted(() => ({
  getResults: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("sarvamai", () => {
  class SarvamAIError extends Error {
    statusCode?: number;
  }
  class SarvamAITimeoutError extends Error {}
  return {
    SarvamAIClient: class {
      docAi = {
        getResults: sarvamMocks.getResults,
      };
    },
    SarvamAIError,
    SarvamAITimeoutError,
  };
});

import { fetchOcrChunkPages } from "@/lib/model/live-ocr";

beforeAll(() => {
  vi.stubEnv("SARVAM_API_KEY", "test-key");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  sarvamMocks.getResults.mockReset();
});

describe("OCR result coverage", () => {
  it("keeps a valid blank separator page in the completed page set", async () => {
    sarvamMocks.getResults.mockResolvedValue({
      type: "digitise",
      status: "completed",
      usage: {
        pages_total: 2,
        pages_processed: 2,
        pages_succeeded: 2,
        pages_failed: 0,
      },
      documents: [{
        pages: [
          { page_number: 1, content: "HbA1c 7.2 %" },
          { page_number: 2, content: "   " },
        ],
      }],
    });

    await expect(fetchOcrChunkPages("job-1", 10, 2)).resolves.toEqual([
      { page: 11, text: "HbA1c 7.2 %" },
      { page: 12, text: "" },
    ]);
  });
});
