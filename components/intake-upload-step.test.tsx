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
        processingProgress={null}
        processingStage={null}
        uploadsSaved={false}
        useSample
      />,
    );

    expect(screen.getByRole("button", { name: /explain these reports/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /add file or take a photo/i })).toBeDisabled();
    expect(screen.getByText(/2 reports · made-up data/i)).toBeInTheDocument();
  });

  it("offers a clear continue action after a refreshed saved upload fails", () => {
    render(
      <DocumentsStep
        busy={false}
        error="Vera couldn’t finish reading this report."
        files={[]}
        language="English"
        documentLanguage="English"
        liveUploadsEnabled
        onBack={vi.fn()}
        onContinue={vi.fn()}
        onDocumentLanguageChange={vi.fn()}
        onFilesChange={vi.fn()}
        onUseSample={vi.fn()}
        processingProgress={null}
        processingStage={null}
        recoveryAction="continue"
        uploadsSaved
        useSample={false}
      />,
    );

    expect(screen.getByRole("button", { name: /^continue reading$/i })).toBeEnabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Vera couldn’t finish reading this report.",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your file is still here. You do not need to upload it again.",
    );
    expect(screen.queryByText(/your file is saved/i)).not.toBeInTheDocument();
  });

  it("offers try again after a same-tab extraction failure", () => {
    const report = {
      id: "report-1",
      file: new File(["%PDF-1.4"], "report.pdf", { type: "application/pdf" }),
      category: "report" as const,
    };

    render(
      <DocumentsStep
        busy={false}
        error="Vera couldn’t finish reading this report."
        files={[report]}
        language="English"
        documentLanguage="English"
        liveUploadsEnabled
        onBack={vi.fn()}
        onContinue={vi.fn()}
        onDocumentLanguageChange={vi.fn()}
        onFilesChange={vi.fn()}
        onUseSample={vi.fn()}
        processingProgress={null}
        processingStage={null}
        recoveryAction="retry"
        uploadsSaved
        useSample={false}
      />,
    );

    expect(screen.getByRole("button", { name: /^try again$/i })).toBeEnabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/do not need to upload it again/i);
    expect(screen.queryByText(/your file is saved/i)).not.toBeInTheDocument();
  });

  it("shows checking and automatic retry only when the server reports them", () => {
    const commonProps = {
      busy: true,
      error: null,
      files: [],
      language: "English" as const,
      documentLanguage: "English" as const,
      liveUploadsEnabled: true,
      onBack: vi.fn(),
      onContinue: vi.fn(),
      onDocumentLanguageChange: vi.fn(),
      onFilesChange: vi.fn(),
      onUseSample: vi.fn(),
      processingStage: "reading" as const,
      uploadsSaved: true,
      useSample: false,
    };
    const { rerender } = render(
      <DocumentsStep
        {...commonProps}
        processingProgress={{ completedPages: 4, totalPages: 9, stage: "reading" }}
      />,
    );

    expect(screen.queryByText(/trying once more/i)).not.toBeInTheDocument();
    expect(screen.getByText("Reading every page").closest("li")).toHaveClass("is-active");

    rerender(
      <DocumentsStep
        {...commonProps}
        processingProgress={{
          completedPages: 9,
          totalPages: 9,
          retrying: true,
          stage: "checking",
        }}
      />,
    );

    expect(screen.getByText("This is taking longer than usual. Vera is trying once more."))
      .toBeInTheDocument();
    expect(screen.getByText("Checking details against the source").closest("li"))
      .toHaveClass("is-active");
  });
});
