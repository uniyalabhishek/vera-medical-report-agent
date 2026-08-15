import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AboutStep, DocumentsStep, type IntakeDraft } from "@/components/intake-upload-step";

const validDraft: IntakeDraft = {
  preferredName: "Asha",
  age: "42",
  language: "English",
  symptoms: "",
  medicalHistory: "",
};

describe("mobile-first intake flow", () => {
  it("enables the documents step only after valid adult context", () => {
    render(
      <AboutStep
        busy={false}
        draft={validDraft}
        error={null}
        onContinue={vi.fn()}
        onDraftChange={vi.fn()}
        liveLanguagesEnabled={false}
        sessionReady
      />,
    );

    expect(screen.getByRole("button", { name: /continue to documents/i })).toBeEnabled();
  });

  it("requires the synthetic-data confirmation before review", () => {
    render(
      <DocumentsStep
        busy={false}
        consented={false}
        error={null}
        files={[]}
        language="English"
        liveUploadsEnabled={false}
        onBack={vi.fn()}
        onConsentChange={vi.fn()}
        onContinue={vi.fn()}
        onFilesChange={vi.fn()}
        onUseSample={vi.fn()}
        useSample
      />,
    );

    expect(screen.getByRole("button", { name: /continue to review/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /choose files/i })).toBeDisabled();
    expect(screen.getByText(/2 blood reports \+ 1 prescription/i)).toBeInTheDocument();
  });
});
