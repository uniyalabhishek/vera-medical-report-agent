"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CaseView,
  ExtractionProgress,
  Intake,
  QuestionResponse,
} from "@/lib/contracts";
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
type RecoveryAction = "retry" | "continue" | null;

const SAVED_CASE_KEY = "vera-active-case";
const initialDraft: IntakeDraft = {
  preferredName: "",
  age: "",
  language: "English",
  documentLanguage: "English",
  symptoms: "",
  medicalHistory: "",
};

function safeMessage(
  error: unknown,
  language: Intake["language"],
  stage?: ProcessingStage | null,
  uploadSaved = false,
) {
  const copy = getMessages(language);
  if (error instanceof ClientApiError) {
    if (error.status === 401 || error.status === 403) return copy.privateSessionExpired;
    if (error.code === "DETAILS_CHANGED_REUPLOAD") return copy.detailsChangedReupload;
    if (stage === "uploading") return copy.uploadFailed;
    if (
      error.code === "PROVIDER_PROCESSING_FAILED" ||
      error.code === "SAFETY_CHECK_FAILED" ||
      error.code === "EXTRACTION_FAILED" ||
      error.code === "EXTRACTION_WAIT_TIMEOUT"
    ) {
      return uploadSaved ? copy.analysisSavedFailed : copy.analysisFailed;
    }
  }
  if (stage === "uploading") return copy.uploadFailed;
  if (uploadSaved && stage === "reading") return copy.analysisSavedFailed;
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

function analysisFingerprint(
  intake: Intake,
  mode: "demo" | "uploaded",
  files: SelectedDocument[],
) {
  return JSON.stringify({
    intake,
    mode,
    files: files.map(({ id, file, category }) => ({
      id,
      category,
      name: file.name,
      size: file.size,
      type: file.type,
      lastModified: file.lastModified,
    })),
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
  const [processingProgress, setProcessingProgress] = useState<ExtractionProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [caseView, setCaseView] = useState<CaseView | null>(null);
  const [caseFingerprint, setCaseFingerprint] = useState<string | null>(null);
  const [uploadsSaved, setUploadsSaved] = useState(false);
  const [recoveryAction, setRecoveryAction] = useState<RecoveryAction>(null);
  const analysisBusy = useRef(false);
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
    setRecoveryAction(null);
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

      let resumeCanContinue = false;
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
        setCaseView(saved);
        const hasSavedUpload = saved.providerMode === "live" && saved.state !== "DRAFT";
        resumeCanContinue = hasSavedUpload || saved.providerMode === "demo";
        setUploadsSaved(hasSavedUpload);
        setRecoveryAction(null);
        setCaseFingerprint(analysisFingerprint(
          { ...saved.intake, preferredName: saved.preferredName },
          saved.providerMode === "demo" ? "demo" : "uploaded",
          [],
        ));

        if (saved.state === "DRAFT" && saved.providerMode === "live") {
          await medicalReportApi.deleteCase(saved.id).catch(() => undefined);
          sessionStorage.removeItem(SAVED_CASE_KEY);
          setCaseView(null);
          setCaseFingerprint(null);
          setRecoveryAction(null);
          setError(getMessages(saved.intake.language).uploadInterrupted);
          return;
        }

        setBusy(true);

        if (
          saved.state === "UPLOADED" ||
          saved.state === "EXTRACTING" ||
          saved.state === "EXTRACTION_FAILED" ||
          (saved.state === "DRAFT" && saved.providerMode === "demo")
        ) {
          setProcessingStage("reading");
          saved = await medicalReportApi.extract(
            saved.id,
            saved.providerMode === "demo" ? "demo" : "uploaded",
            setProcessingProgress,
          );
          setCaseView(saved);
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
        const sessionUnavailable =
          caught instanceof ClientApiError &&
          (caught.status === 401 || caught.status === 403 || caught.status === 404);
        if (sessionUnavailable) {
          sessionStorage.removeItem(SAVED_CASE_KEY);
          setCaseView(null);
          setCaseFingerprint(null);
          setUploadsSaved(false);
        }
        const canContinue = resumeCanContinue && !sessionUnavailable;
        setRecoveryAction(canContinue ? "continue" : null);
        setError(safeMessage(caught, languageRef.current, "reading", canContinue));
      } finally {
        setBusy(false);
        setProcessingStage(null);
        setProcessingProgress(null);
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
    if (analysisBusy.current) return;
    analysisBusy.current = true;
    setBusy(true);
    setError(null);
    setRecoveryAction(null);
    setProcessingProgress(null);
    setProcessingStage("uploading");
    let activeStage: ProcessingStage = "uploading";
    let uploadIsSaved = uploadsSaved;
    const mode = useSample ? "demo" : "uploaded";

    try {
      const intake = intakeFromDraft(draft);
      const fingerprint = analysisFingerprint(intake, mode, files);
      const savedUploadDetailsChanged =
        caseView &&
        !caseView.analysis &&
        uploadsSaved &&
        files.length === 0 &&
        caseFingerprint !== null &&
        caseFingerprint !== fingerprint;
      if (savedUploadDetailsChanged) {
        setUploadsSaved(false);
        throw new ClientApiError(
          "DETAILS_CHANGED_REUPLOAD",
          "The details changed after this upload was saved.",
          409,
        );
      }
      let workingCase = caseView && !caseView.analysis &&
          caseFingerprint === fingerprint
        ? caseView
        : null;
      if (!workingCase) {
        if (caseView && !caseView.analysis) {
          await medicalReportApi.deleteCase(caseView.id).catch(() => undefined);
        }
        workingCase = await medicalReportApi.createCase(intake, mode);
        setCaseView(workingCase);
        setCaseFingerprint(fingerprint);
        setUploadsSaved(mode === "demo");
        uploadIsSaved = mode === "demo";
        sessionStorage.setItem(SAVED_CASE_KEY, workingCase.id);
      }

      if (mode === "uploaded" && !uploadIsSaved) {
        await medicalReportApi.uploadFiles(workingCase.id, files);
        uploadIsSaved = true;
        setUploadsSaved(true);
      }

      activeStage = "reading";
      setProcessingStage("reading");
      const extracted =
        workingCase.state === "NEEDS_REVIEW" ||
        workingCase.state === "CONFIRMED" ||
        workingCase.state === "SAFETY_FAILED"
          ? workingCase
          : await medicalReportApi.extract(
              workingCase.id,
              mode,
              setProcessingProgress,
            );
      setCaseView(extracted);
      activeStage = "writing";
      setProcessingStage("writing");
      const ready = await medicalReportApi.confirm(extracted.id);
      openReadyCase(ready);
    } catch (caught) {
      const detailsChanged =
        caught instanceof ClientApiError && caught.code === "DETAILS_CHANGED_REUPLOAD";
      const sessionUnavailable =
        caught instanceof ClientApiError &&
        (caught.status === 401 || caught.status === 403 || caught.status === 404);
      const canRetry = uploadIsSaved && !detailsChanged && !sessionUnavailable;
      if (sessionUnavailable) {
        sessionStorage.removeItem(SAVED_CASE_KEY);
        setUploadsSaved(false);
      }
      setRecoveryAction(canRetry ? "retry" : null);
      setError(safeMessage(caught, draft.language, activeStage, canRetry));
    } finally {
      analysisBusy.current = false;
      setBusy(false);
      setProcessingStage(null);
      setProcessingProgress(null);
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
      const { language } = draft;
      setStep("about");
      setCaseView(null);
      setCaseFingerprint(null);
      setUploadsSaved(false);
      setRecoveryAction(null);
      setFiles([]);
      setUseSample(false);
      setDraft({ ...initialDraft, language, documentLanguage: language });
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
              setError(null);
              setRecoveryAction(null);
              if (nextFiles.length > 0) {
                setUseSample(false);
              }
            }}
            onUseSample={() => {
              setFiles([]);
              setUseSample(true);
              setError(null);
              setRecoveryAction(null);
            }}
            processingProgress={processingProgress}
            processingStage={processingStage}
            recoveryAction={recoveryAction}
            uploadsSaved={uploadsSaved}
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
