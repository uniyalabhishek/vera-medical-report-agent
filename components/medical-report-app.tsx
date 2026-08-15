"use client";

import { useEffect, useState } from "react";
import type { CaseView, Fact, Intake, QuestionResponse } from "@/lib/contracts";
import { IntakeSchema } from "@/lib/contracts";
import { medicalReportApi } from "@/lib/client/api";
import { AppHeader } from "@/components/app-header";
import { ExplanationStep } from "@/components/explanation-step";
import { AboutStep, DocumentsStep, type IntakeDraft } from "@/components/intake-upload-step";
import { ProgressStepper } from "@/components/progress-stepper";
import { ReviewStep } from "@/components/review-step";

type AppStep = "about" | "documents" | "review" | "explanation";

const initialDraft: IntakeDraft = {
  preferredName: "",
  age: "",
  language: "English",
  symptoms: "",
  medicalHistory: "",
};

export function MedicalReportApp() {
  const [step, setStep] = useState<AppStep>("about");
  const [draft, setDraft] = useState<IntakeDraft>(initialDraft);
  const [files, setFiles] = useState<File[]>([]);
  const [useSample, setUseSample] = useState(true);
  const [consented, setConsented] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [liveUploadsEnabled, setLiveUploadsEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [caseView, setCaseView] = useState<CaseView | null>(null);
  const [facts, setFacts] = useState<Fact[]>([]);

  useEffect(() => {
    let active = true;
    medicalReportApi
      .initialize()
      .then((session) => {
        if (active) {
          setLiveUploadsEnabled(session.dataMode === "live_enabled");
          setSessionReady(true);
        }
      })
      .catch((caught) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : "Could not start a secure session.");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const continueToDocuments = () => {
    setError(null);
    if (draft.language !== "English") setUseSample(false);
    setStep("documents");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const beginReview = async () => {
    setBusy(true);
    setError(null);
    let createdCaseId: string | null = null;

    try {
      const intake = IntakeSchema.parse({ ...draft, age: Number(draft.age) }) as Intake;
      const mode = useSample ? "demo" : "uploaded";
      const created = await medicalReportApi.createCase(intake, mode);
      createdCaseId = created.id;

      if (mode === "uploaded") {
        await medicalReportApi.uploadFiles(created.id, files);
      }

      const extracted = await medicalReportApi.extract(created.id, mode);
      setCaseView(extracted);
      setFacts(extracted.facts);
      setStep("review");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (caught) {
      if (createdCaseId) {
        await medicalReportApi.deleteCase(createdCaseId).catch(() => undefined);
      }
      setError(caught instanceof Error ? caught.message : "The case could not be prepared.");
    } finally {
      setBusy(false);
    }
  };

  const confirmFacts = async () => {
    if (!caseView) return;
    setBusy(true);
    setError(null);
    try {
      const ready = await medicalReportApi.confirm(caseView.id, facts);
      setCaseView(ready);
      setFacts(ready.facts);
      setStep("explanation");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The confirmed facts could not be checked.");
    } finally {
      setBusy(false);
    }
  };

  const backToDocuments = async () => {
    setBusy(true);
    if (caseView) await medicalReportApi.deleteCase(caseView.id).catch(() => undefined);
    setCaseView(null);
    setFacts([]);
    setStep("documents");
    setError(null);
    setBusy(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const askQuestion = async (question: string): Promise<QuestionResponse> => {
    if (!caseView) throw new Error("The case is not ready.");
    return medicalReportApi.ask(caseView.id, question);
  };

  const startOver = async () => {
    setBusy(true);
    if (caseView) await medicalReportApi.deleteCase(caseView.id).catch(() => undefined);
    setStep("about");
    setCaseView(null);
    setFacts([]);
    setFiles([]);
    setUseSample(true);
    setConsented(false);
    setDraft(initialDraft);
    setError(null);
    setBusy(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const activeStep = step === "about" ? 1 : step === "documents" ? 2 : step === "review" ? 3 : 4;

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-shell__inner">
        <ProgressStepper activeStep={activeStep} />

        {step === "about" ? (
          <AboutStep
            busy={busy}
            draft={draft}
            error={error}
            onContinue={continueToDocuments}
            onDraftChange={setDraft}
            liveLanguagesEnabled={liveUploadsEnabled}
            sessionReady={sessionReady}
          />
        ) : null}

        {step === "documents" ? (
          <DocumentsStep
            busy={busy}
            consented={consented}
            error={error}
            files={files}
            language={draft.language}
            liveUploadsEnabled={liveUploadsEnabled}
            onBack={() => {
              setError(null);
              setStep("about");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            onConsentChange={setConsented}
            onContinue={() => void beginReview()}
            onFilesChange={(nextFiles) => {
              setFiles(nextFiles);
              setUseSample(nextFiles.length === 0);
            }}
            onUseSample={() => {
              setFiles([]);
              setUseSample(true);
              setError(null);
            }}
            useSample={useSample}
          />
        ) : null}

        {step === "review" ? (
          <ReviewStep
            busy={busy}
            error={error}
            facts={facts}
            onBack={() => void backToDocuments()}
            onConfirm={() => void confirmFacts()}
            onFactsChange={setFacts}
          />
        ) : null}

        {step === "explanation" && caseView?.analysis ? (
          <ExplanationStep
            analysis={caseView.analysis}
            busy={busy}
            error={error}
            facts={facts}
            onAsk={askQuestion}
            onStartOver={startOver}
          />
        ) : null}
      </div>
    </div>
  );
}
