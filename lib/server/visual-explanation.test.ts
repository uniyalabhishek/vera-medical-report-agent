import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openaiMocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  generate: vi.fn(),
  parse: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("openai", () => ({
  default: class {
    readonly images = { generate: openaiMocks.generate };
    readonly responses = { parse: openaiMocks.parse };

    constructor(options: unknown) {
      openaiMocks.createClient(options);
    }
  },
}));
vi.mock("openai/helpers/zod", () => ({ zodTextFormat: vi.fn(() => ({})) }));

import { generateVisualExplanation } from "@/lib/server/visual-explanation";
import type { VisualSpec } from "@/lib/visual-explanation";

const spec: VisualSpec = {
  factId: "fact-1",
  concept: "average-blood-glucose",
  scene: "red blood cells and soft-gold glucose particles",
  emphasis: "Use a balanced, neutral visual presence for the marker concept.",
};

describe("visual explanation provider boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("logs only the error class and returns a sanitized provider failure", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    openaiMocks.generate.mockRejectedValue(
      new Error("test-openai-key and private provider response"),
    );

    await expect(generateVisualExplanation(spec)).rejects.toMatchObject({
      code: "PROVIDER_PROCESSING_FAILED",
      message: "The visual explanation could not be created safely. Please try again.",
    });
    expect(consoleError).toHaveBeenCalledWith("Visual explanation provider failed: Error");
    expect(consoleError.mock.calls.flat().join(" ")).not.toContain("test-openai-key");
    expect(consoleError.mock.calls.flat().join(" ")).not.toContain("private provider response");
    consoleError.mockRestore();
  });
});
