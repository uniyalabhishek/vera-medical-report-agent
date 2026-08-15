"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CaseView, Intake, QuestionResponse } from "@/lib/contracts";
import { IntakeSchema } from "@/lib/contracts";
import { ClientApiError, medicalReportApi } from "@/lib/client/api";
import { ExplanationStep } from "@/components/explanation-step";
import {
  AboutStep,
  DocumentsStep,
  type IntakeDraft,
  type ProcessingStage,
  type SelectedDocument,
} from "@/components/intake-upload-step";
import { getMessages, languageMeta } from "@/lib/i18n";

type AppStep = "about" | "documents" | "explanation" | "questions";

const SAVED_CASE_KEY = "vera-active-case";
const initialDraft: IntakeDraft = {
  preferredName: "",
  age: "",
  language: "English",
  documentLanguage: "English",
  symptoms: "",
  medicalHistory: "",
};

function safeMessage(error: unknown, language: Intake["language"]) {
  const copy = getMessages(language);
  if (error instanceof ClientApiError) {
    if (error.status === 401 || error.status === 403) return copy.privateSessionExpired;
    if (
      error.code === "PROVIDER_PROCESSING_FAILED" ||
      error.code === "SAFETY_CHECK_FAILED" ||
      error.code === "EXTRACTION_FAILED"
    ) {
      return copy.analysisFailed;
    }
  }
  return copy.genericError;
}

function intakeFromDraft(draft: IntakeDraft): Intake {
  return IntakeSchema.parse({
    preferredName: draft.preferredName,
    age: Number(draft.age),
    language: draft.language,
    documentLanguage: draft.documentLanguage,
    symptoms: draft.symptoms,
    medicalHistory: draft.medicalHistory,
  });
}

export function MedicalReportApp() {
  const [step, setStep] = useState<AppStep>("about");
  const [draft, setDraft] = useState<IntakeDraft>(initialDraft);
  const [files, setFiles] = useState<SelectedDocument[]>([]);
  const [useSample, setUseSample] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [liveUploadsEnabled, setLiveUploadsEnabled] = useState(false);
  const [speechInputEnabled, setSpeechInputEnabled] = useState(false);
  const [speechOutputEnabled, setSpeechOutputEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [processingStage, setProcessingStage] = useState<ProcessingStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [caseView, setCaseView] = useState<CaseView | null>(null);
  const resumeAttempted = useRef(false);
  const languageRef = useRef(draft.language);

  const openReadyCase = useCallback((ready: CaseView) => {
    setCaseView(ready);
    setDraft({
      preferredName: ready.preferredName,
      age: String(ready.intake.age),
      language: ready.intake.language,
      documentLanguage: ready.intake.documentLanguage,
      symptoms: ready.intake.symptoms,
      medicalHistory: ready.intake.medicalHistory,
    });
    setStep("explanation");
    setError(null);
    sessionStorage.setItem(SAVED_CASE_KEY, ready.id);
  }, []);

  const initializeSession = useCallback(async (force = false) => {
    try {
      if (force) medicalReportApi.resetSession();
      const session = await medicalReportApi.initialize();
      setError(null);
      setLiveUploadsEnabled(session.dataMode === "live_enabled");
      setSpeechInputEnabled(session.speechInput);
      setSpeechOutputEnabled(session.speechOutput);
      setSessionReady(true);

      if (resumeAttempted.current) return;
      resumeAttempted.current = true;
      const savedCaseId = sessionStorage.getItem(SAVED_CASE_KEY);
      if (!savedCaseId) return;

      try {
        let saved = await medicalReportApi.getCase(savedCaseId);
        setDraft({
          preferredName: saved.preferredName,
          age: String(saved.intake.age),
          language: saved.intake.language,
          documentLanguage: saved.intake.documentLanguage,
          symptoms: saved.intake.symptoms,
          medicalHistory: saved.intake.medicalHistory,
        });

        if (saved.state === "READY" && saved.analysis) {
          openReadyCase(saved);
          return;
        }

        setStep("documents");
        setUseSample(saved.providerMode === "demo");
        setBusy(true);

        if (
          saved.state === "UPLOADED" ||
          saved.state === "EXTRACTION_FAILED" ||
          (saved.state === "DRAFT" && saved.providerMode === "demo")
        ) {
          setProcessingStage("reading");
          saved = await medicalReportApi.extract(
            saved.id,
            saved.providerMode === "demo" ? "demo" : "uploaded",
          );
        }
        if (
          saved.state === "NEEDS_REVIEW" ||
          saved.state === "CONFIRMED" ||
          saved.state === "SAFETY_FAILED"
        ) {
          setProcessingStage("writing");
          saved = await medicalReportApi.confirm(saved.id);
        }
        if (saved.state === "READY" && saved.analysis) openReadyCase(saved);
      } catch (caught) {
        sessionStorage.removeItem(SAVED_CASE_KEY);
        setError(safeMessage(caught, languageRef.current));
      } finally {
        setBusy(false);
        setProcessingStage(null);
      }
    } catch (caught) {
      setSessionReady(false);
      setError(safeMessage(caught, languageRef.current));
    }
  }, [openReadyCase]);

  useEffect(() => {
    const timer = window.setTimeout(() => void initializeSession(), 0);
    return () => window.clearTimeout(timer);
  }, [initializeSession]);

  useEffect(() => {
    languageRef.current = draft.language;
    document.documentElement.lang = languageMeta[draft.language].locale;
    document.title = getMessages(draft.language).brandLabel;
  }, [draft.language]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>("#main-content h1")?.focus({ preventScroll: true });
    });
  }, [step]);

  const continueToDocuments = () => {
    setError(null);
    if (!liveUploadsEnabled) setUseSample(true);
    setStep("documents");
  };

  const analyzeReports = async () => {
    setBusy(true);
    setError(null);
    setProcessingStage("uploading");
    let createdCaseId: string | null = null;
    let uploadComplete = false;
    const mode = useSample ? "demo" : "uploaded";

    try {
      const intake = intakeFromDraft(draft);
      const created = await medicalReportApi.createCase(intake, mode);
      createdCaseId = created.id;
      sessionStorage.setItem(SAVED_CASE_KEY, created.id);

      if (mode === "uploaded") {
        await medicalReportApi.uploadFiles(created.id, files);
      }
      uploadComplete = true;

      setProcessingStage("reading");
      const extracted = await medicalReportApi.extract(created.id, mode);
      setProcessingStage("writing");
      const ready = await medicalReportApi.confirm(extracted.id);
      openReadyCase(ready);
    } catch (caught) {
      if (mode === "uploaded" && createdCaseId && !uploadComplete) {
        await medicalReportApi.deleteCase(createdCaseId).catch(() => undefined);
        if (sessionStorage.getItem(SAVED_CASE_KEY) === createdCaseId) {
          sessionStorage.removeItem(SAVED_CASE_KEY);
        }
      }
      setError(safeMessage(caught, draft.language));
    } finally {
      setBusy(false);
      setProcessingStage(null);
    }
  };

  const askQuestion = async (question: string): Promise<QuestionResponse> => {
    if (!caseView) throw new Error("Case is not ready");
    return medicalReportApi.ask(caseView.id, question);
  };

  const startOver = async () => {
    if (!caseView) return;
    const copy = getMessages(draft.language);

    setBusy(true);
    setError(null);
    try {
      await medicalReportApi.deleteCase(caseView.id);
      sessionStorage.removeItem(SAVED_CASE_KEY);
      const { language, documentLanguage } = draft;
      setStep("about");
      setCaseView(null);
      setFiles([]);
      setUseSample(false);
      setDraft({ ...initialDraft, language, documentLanguage });
    } catch {
      setError(copy.deleteFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        {getMessages(draft.language).skipContent}
      </a>
      <div className="app-shell__inner">
        {step === "about" ? (
          <AboutStep
            busy={busy}
            draft={draft}
            error={error}
            onContinue={continueToDocuments}
            onDraftChange={setDraft}
            onRetrySession={() => void initializeSession(true)}
            sessionReady={sessionReady}
            speechInputEnabled={speechInputEnabled}
          />
        ) : null}

        {step === "documents" ? (
          <DocumentsStep
            busy={busy}
            documentLanguage={draft.documentLanguage}
            error={error}
            files={files}
            language={draft.language}
            liveUploadsEnabled={liveUploadsEnabled}
            onBack={() => {
              setError(null);
              setStep("about");
            }}
            onContinue={() => void analyzeReports()}
            onDocumentLanguageChange={(documentLanguage) =>
              setDraft((current) => ({ ...current, documentLanguage }))
            }
            onFilesChange={(nextFiles) => {
              setFiles(nextFiles);
              if (nextFiles.length > 0) {
                setUseSample(false);
              }
            }}
            onUseSample={() => {
              setFiles([]);
              setUseSample(true);
              setError(null);
            }}
            processingStage={processingStage}
            useSample={useSample}
          />
        ) : null}

        {(step === "explanation" || step === "questions") && caseView?.analysis ? (
          <ExplanationStep
            analysis={caseView.analysis}
            busy={busy}
            caseId={caseView.id}
            error={error}
            facts={caseView.facts}
            language={draft.language}
            onAsk={askQuestion}
            onBackToSummary={() => setStep("explanation")}
            onOpenQuestions={() => setStep("questions")}
            onStartOver={startOver}
            speechInputEnabled={speechInputEnabled}
            speechOutputEnabled={speechOutputEnabled}
            view={step === "questions" ? "questions" : "summary"}
          />
        ) : null}
      </div>
    </div>
  );
}
