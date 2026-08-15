import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AboutStep, DocumentsStep, type IntakeDraft } from "@/components/intake-upload-step";

const validDraft: IntakeDraft = {
  preferredName: "Ananya",
  age: "42",
  language: "English",
  documentLanguage: "English",
  symptoms: "",
  medicalHistory: "",
};

describe("mobile-first intake flow", () => {
  it("shows the original context fields and enables continue for valid details", () => {
    render(
      <AboutStep
        busy={false}
        draft={validDraft}
        error={null}
        onContinue={vi.fn()}
        onDraftChange={vi.fn()}
        onRetrySession={vi.fn()}
        sessionReady
        speechInputEnabled={false}
      />,
    );

    expect(screen.getByRole("button", { name: /^continue/i })).toBeEnabled();
    expect(screen.getByLabelText(/^name/i)).toHaveValue("Ananya");
    expect(screen.getByLabelText(/^age/i)).toHaveValue(42);
    expect(screen.getByLabelText(/current symptoms/i)).toBeInTheDocument();
  });

  it("puts language first and keeps the initial report language in sync", () => {
    const onDraftChange = vi.fn();
    render(
      <AboutStep
        busy={false}
        draft={validDraft}
        error={null}
        onContinue={vi.fn()}
        onDraftChange={onDraftChange}
        onRetrySession={vi.fn()}
        sessionReady
        speechInputEnabled={false}
      />,
    );

    const language = screen.getByRole("group", { name: /preferred language/i });
    const heading = screen.getByRole("heading", { name: /a little about you/i });
    expect(language.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /தமிழ்/u }));
    expect(onDraftChange).toHaveBeenCalledWith(expect.objectContaining({
      language: "Tamil",
      documentLanguage: "Tamil",
    }));
  });

  it("explains the adult age limit after a user tries to continue", () => {
    const onContinue = vi.fn();
    render(
      <AboutStep
        busy={false}
        draft={{ ...validDraft, age: "17" }}
        error={null}
        onContinue={onContinue}
        onDraftChange={vi.fn()}
        onRetrySession={vi.fn()}
        sessionReady
        speechInputEnabled={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^continue/i }));
    expect(onContinue).not.toHaveBeenCalled();
    expect(screen.getByText(/only for adults/i)).toBeInTheDocument();
  });

  it("keeps the stable sample usable when live uploads are unavailable", () => {
    render(
      <DocumentsStep
        busy={false}
        error={null}
        files={[]}
        language="English"
        documentLanguage="English"
        liveUploadsEnabled={false}
        onBack={vi.fn()}
        onContinue={vi.fn()}
        onDocumentLanguageChange={vi.fn()}
        onFilesChange={vi.fn()}
        onUseSample={vi.fn()}
        processingStage={null}
        useSample
      />,
    );

    expect(screen.getByRole("button", { name: /analyse 3 documents/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /add file or take a photo/i })).toBeDisabled();
    expect(screen.getByText(/2 reports · made-up data/i)).toBeInTheDocument();
  });
});
