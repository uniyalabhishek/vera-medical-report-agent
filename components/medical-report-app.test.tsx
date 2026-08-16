import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Analysis, CaseView, Fact } from "@/lib/contracts";

const apiMocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  resetSession: vi.fn(),
  getCase: vi.fn(),
  createCase: vi.fn(),
  uploadFiles: vi.fn(),
  extract: vi.fn(),
  confirm: vi.fn(),
  ask: vi.fn(),
  deleteCase: vi.fn(),
}));

vi.mock("@/lib/client/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client/api")>();
  return { ...actual, medicalReportApi: apiMocks };
});

import { ClientApiError } from "@/lib/client/api";
import { MedicalReportApp } from "@/components/medical-report-app";

const fact: Fact = {
  id: "fact-1",
  kind: "observation",
  name: "HbA1c",
  value: "7.2",
  unit: "%",
  referenceRange: "4-6",
  numericRange: { kind: "closed", lower: 4, upper: 6 },
  flag: "high",
  effectiveDate: "",
  confirmed: true,
  needsReview: false,
  source: {
    id: "span-1",
    documentId: "upload-1",
    documentName: "report.pdf",
    page: 1,
    excerpt: "HbA1c 7.2 %",
    bbox: [0, 0, 1, 1],
    documentCategory: "report",
  },
};

const analysis: Analysis = {
  providerMode: "live",
  checkedDocumentCount: 1,
  cards: ["documents", "findings", "changes", "instructions", "questions"].map((id) => ({
    id: id as Analysis["cards"][number]["id"],
    title: id,
    body: `Simple ${id}`,
    citations: id === "documents" || id === "findings"
      ? [{ sourceSpanId: fact.source.id, label: "report.pdf · page 1" }]
      : [],
  })),
  suggestedQuestions: ["What does HbA1c mean?", "What can I ask my doctor?"],
  generatedAt: new Date(0).toISOString(),
};

function caseWith(state: CaseView["state"], result: Analysis | null = null): CaseView {
  return {
    id: "case-1",
    state,
    providerMode: "live",
    intake: {
      age: 42,
      language: "English",
      documentLanguage: "English",
      symptoms: "",
      medicalHistory: "",
    },
    preferredName: "Ananya",
    facts: state === "DRAFT" ? [] : [fact],
    analysis: result,
    createdAt: new Date(0).toISOString(),
    expiresAt: new Date(60_000).toISOString(),
  };
}

beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
  window.scrollTo = vi.fn();
  apiMocks.initialize.mockResolvedValue({
    csrfToken: "csrf",
    expiresAt: new Date(60_000).toISOString(),
    dataMode: "live_enabled",
    storageMode: "cloud",
    speechInput: false,
    speechOutput: false,
  });
  apiMocks.createCase.mockResolvedValue(caseWith("DRAFT"));
  apiMocks.uploadFiles.mockResolvedValue({ uploads: [] });
  apiMocks.extract
    .mockRejectedValueOnce(new ClientApiError(
      "PROVIDER_PROCESSING_FAILED",
      "Provider failed",
      502,
    ))
    .mockResolvedValueOnce(caseWith("NEEDS_REVIEW"));
  apiMocks.confirm.mockResolvedValue(caseWith("READY", analysis));
});

describe("report retry flow", () => {
  it("reuses the saved case and upload when processing fails", async () => {
    const user = userEvent.setup();
    const { container } = render(<MedicalReportApp />);

    await user.type(await screen.findByLabelText(/^name/i), "Ananya");
    await user.type(screen.getByLabelText(/^age/i), "42");
    await user.click(screen.getByRole("button", { name: /^continue$/i }));

    const reportInput = container.querySelector<HTMLInputElement>(
      'input[type="file"][accept="application/pdf,image/jpeg,image/png"]',
    );
    expect(reportInput).not.toBeNull();
    await user.upload(
      reportInput!,
      new File(["%PDF-1.4 test"], "report.pdf", { type: "application/pdf" }),
    );
    await user.click(screen.getByRole("button", { name: /explain these reports/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn’t finish reading/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/do not need to upload it again/i);
    await user.click(screen.getByRole("button", { name: /^try again$/i }));
    await screen.findByRole("heading", { name: /here’s what your reports say/i });

    await waitFor(() => {
      expect(apiMocks.createCase).toHaveBeenCalledTimes(1);
      expect(apiMocks.uploadFiles).toHaveBeenCalledTimes(1);
      expect(apiMocks.extract).toHaveBeenCalledTimes(2);
    });
  });

  it("does not silently reuse a saved upload after intake details change", async () => {
    const user = userEvent.setup();
    sessionStorage.setItem("vera-active-case", "case-1");
    apiMocks.getCase.mockResolvedValue(caseWith("EXTRACTION_FAILED"));
    apiMocks.extract.mockReset();
    apiMocks.extract.mockRejectedValue(new ClientApiError(
      "PROVIDER_PROCESSING_FAILED",
      "Provider failed",
      502,
    ));

    render(<MedicalReportApp />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn’t finish reading/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/do not need to upload it again/i);

    await user.click(screen.getByRole("button", { name: /^back$/i }));
    const age = screen.getByLabelText(/^age/i);
    fireEvent.change(age, { target: { value: "43" } });
    await user.click(screen.getByRole("button", { name: /^continue$/i }));
    await user.click(screen.getByRole("button", { name: /^continue reading$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /details changed.*add the report again/i,
    );
    expect(apiMocks.uploadFiles).not.toHaveBeenCalled();
    expect(apiMocks.createCase).not.toHaveBeenCalled();
    expect(apiMocks.deleteCase).not.toHaveBeenCalled();
  });
});
