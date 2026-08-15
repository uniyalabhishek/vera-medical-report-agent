"use client";

import { useEffect, useState } from "react";
import type { CaseView, Fact, Intake, QuestionResponse } from "@/lib/contracts";
import { IntakeSchema } from "@/lib/contracts";
import { medicalReportApi } from "@/lib/client/api";
import { AppHeader } from "@/components/app-header";
import { ExplanationStep } from "@/components/explanation-step";
import { AboutStep, DocumentsStep, type IntakeDraft } from "@/components/intake-upload-step";
import { ProgressStepper } from "@/components/progress-stepper";

type AppStep = "about" | "documents" | "explanation" | "questions";

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

  const analyzeReports = async () => {
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
      const acceptedFacts = extracted.facts.map((fact) => ({ ...fact, confirmed: true }));
      const ready = await medicalReportApi.confirm(extracted.id, acceptedFacts);
      setCaseView(ready);
      setFacts(ready.facts);
      setStep("explanation");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (caught) {
      if (createdCaseId) {
        await medicalReportApi.deleteCase(createdCaseId).catch(() => undefined);
      }
      setError(caught instanceof Error ? caught.message : "The reports could not be analysed.");
    } finally {
      setBusy(false);
    }
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

  const activeStep = step === "about" ? 1 : step === "documents" ? 2 : step === "explanation" ? 3 : 4;

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
            onContinue={() => void analyzeReports()}
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

        {(step === "explanation" || step === "questions") && caseView?.analysis ? (
          <ExplanationStep
            analysis={caseView.analysis}
            busy={busy}
            error={error}
            facts={facts}
            onAsk={askQuestion}
            onBackToSummary={() => {
              setStep("explanation");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            onOpenQuestions={() => {
              setStep("questions");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            onStartOver={startOver}
            view={step === "questions" ? "questions" : "summary"}
          />
        ) : null}
      </div>
    </div>
  );
}
