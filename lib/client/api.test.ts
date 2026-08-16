import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const blobMocks = vi.hoisted(() => ({ upload: vi.fn() }));

vi.mock("@vercel/blob/client", () => ({ upload: blobMocks.upload }));

import { medicalReportApi } from "@/lib/client/api";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function session(storageMode: "local" | "cloud") {
  return {
    csrfToken: "csrf-token",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    dataMode: "live_enabled",
    storageMode,
    speechInput: false,
    speechOutput: false,
  };
}

function savedCase() {
  return {
    id: "case-1",
    state: "UPLOADED",
    providerMode: "live",
    intake: {
      age: 42,
      language: "English",
      documentLanguage: "English",
      symptoms: "",
      medicalHistory: "",
    },
    preferredName: "Ananya",
    facts: [],
    analysis: null,
    createdAt: new Date(0).toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  blobMocks.upload.mockReset();
  medicalReportApi.resetSession();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("upload reliability", () => {
  it("recognizes a committed local upload when only the response was lost", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/session") return jsonResponse(session("local"));
      if (url.endsWith("/uploads") && init?.method === "POST") {
        throw new TypeError("connection closed after commit");
      }
      if (url === "/api/cases/case-1" && init?.method === "GET") {
        return jsonResponse({ case: savedCase() });
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const file = new File(["%PDF-1.4"], "report.pdf", { type: "application/pdf" });
    await expect(medicalReportApi.uploadFiles("case-1", [{
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      file,
      category: "report",
    }])).resolves.toEqual({ uploads: [] });
  });

  it("uses a stable path and multipart transfer for a large cloud upload", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/session") return jsonResponse(session("cloud"));
      if (url.endsWith("/uploads")) {
        return jsonResponse({ uploads: [{ id: "upload-1" }] }, 201);
      }
      throw new Error(`Unexpected request: ${url}`);
    }));
    blobMocks.upload.mockResolvedValue({});

    const file = new File(
      [new Uint8Array(6 * 1024 * 1024)],
      "large-report.pdf",
      { type: "application/pdf" },
    );
    const id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await medicalReportApi.uploadFiles("case-1", [{ id, file, category: "report" }]);

    expect(blobMocks.upload).toHaveBeenCalledWith(
      `cases/case-1/${id}.pdf`,
      file,
      expect.objectContaining({ multipart: true }),
    );
  });
});
