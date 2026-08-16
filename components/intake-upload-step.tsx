"use client";

import { useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  FileText,
  LoaderCircle,
  Plus,
  Upload,
  X,
} from "lucide-react";
import {
  supportedLanguages,
  type DocumentCategory,
  type ExtractionProgress,
  type Intake,
} from "@/lib/contracts";
import { getMessages, languageMeta, message } from "@/lib/i18n";
import { ProgressStepper } from "@/components/progress-stepper";
import { VoiceInputButton } from "@/components/voice-controls";

export type IntakeDraft = {
  preferredName: string;
  age: string;
  language: Intake["language"];
  documentLanguage: Intake["documentLanguage"];
  symptoms: string;
  medicalHistory: string;
};

export type SelectedDocument = {
  id: string;
  file: File;
  category: DocumentCategory;
};

export type ProcessingStage = "uploading" | "reading" | "writing";

type AboutStepProps = {
  draft: IntakeDraft;
  busy: boolean;
  sessionReady: boolean;
  speechInputEnabled: boolean;
  error: string | null;
  onDraftChange: (draft: IntakeDraft) => void;
  onContinue: () => void;
  onRetrySession: () => void;
};

type DocumentsStepProps = {
  files: SelectedDocument[];
  useSample: boolean;
  busy: boolean;
  liveUploadsEnabled: boolean;
  language: Intake["language"];
  documentLanguage: Intake["documentLanguage"];
  processingStage: ProcessingStage | null;
  processingProgress: ExtractionProgress | null;
  uploadsSaved: boolean;
  recoveryAction?: "retry" | "continue" | null;
  error: string | null;
  onDocumentLanguageChange: (language: Intake["documentLanguage"]) => void;
  onFilesChange: (files: SelectedDocument[]) => void;
  onUseSample: () => void;
  onContinue: () => void;
  onBack: () => void;
};

function formatBytes(bytes: number, locale: string) {
  if (bytes < 1024) return `${bytes.toLocaleString(locale)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024).toLocaleString(locale)} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString(locale, {
    maximumFractionDigits: 1,
  })} MB`;
}

function readableFileType(file: File, fallback: string) {
  if (file.type === "application/pdf") return "PDF";
  if (file.type === "image/png") return "PNG";
  if (file.type === "image/jpeg") return "JPG";
  return fallback;
}

function historyItems(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function AboutStep({
  draft,
  busy,
  sessionReady,
  speechInputEnabled,
  error,
  onDraftChange,
  onContinue,
  onRetrySession,
}: AboutStepProps) {
  const copy = getMessages(draft.language);
  const [historyEntry, setHistoryEntry] = useState("");
  const [detailsAttempted, setDetailsAttempted] = useState(false);
  const knownHistory = useMemo(() => historyItems(draft.medicalHistory), [draft.medicalHistory]);
  const parsedAge = Number(draft.age);
  const nameReady = draft.preferredName.trim().length > 0;
  const ageReady =
    Number.isInteger(parsedAge) &&
    parsedAge >= 18 &&
    parsedAge <= 120;
  const detailsReady =
    nameReady && ageReady;

  const addHistory = () => {
    const next = historyEntry.trim();
    if (!next) return;
    if (!knownHistory.some((item) => item.toLocaleLowerCase() === next.toLocaleLowerCase())) {
      onDraftChange({ ...draft, medicalHistory: [...knownHistory, next].join("\n") });
    }
    setHistoryEntry("");
  };

  return (
    <main className="vera-screen vera-screen--about motion-enter" id="main-content">
      <ProgressStepper activeStep={1} language={draft.language} />

      <fieldset className="language-field language-field--first">
        <legend>{copy.languageLegend}</legend>
        <div className="language-options">
          {supportedLanguages.map((language) => (
            <button
              aria-pressed={draft.language === language}
              className={draft.language === language ? "is-selected" : ""}
              key={language}
              lang={languageMeta[language].locale}
              onClick={() => onDraftChange({
                ...draft,
                language,
                documentLanguage: language,
              })}
              type="button"
            >
              {draft.language === language ? <Check aria-hidden="true" /> : null}
              {languageMeta[language].nativeName}
            </button>
          ))}
        </div>
      </fieldset>

      <header className="screen-heading">
        <h1 tabIndex={-1}>{copy.aboutTitle}</h1>
        <p>{copy.aboutBody}</p>
      </header>

      <form
        className="about-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setDetailsAttempted(true);
          if (detailsReady && sessionReady && !busy) onContinue();
        }}
      >
        <div className="person-fields">
          <label className="field">
            <span>{copy.nameLabel}</span>
            <input
              autoComplete="name"
              aria-describedby={detailsAttempted && !nameReady ? "name-error" : undefined}
              aria-invalid={detailsAttempted && !nameReady}
              maxLength={80}
              onChange={(event) => onDraftChange({ ...draft, preferredName: event.target.value })}
              placeholder={copy.namePlaceholder}
              required
              value={draft.preferredName}
            />
            {detailsAttempted && !nameReady ? (
              <small className="field-error" id="name-error">{copy.nameRequired}</small>
            ) : null}
          </label>
          <label className="field field--age">
            <span>{copy.ageLabel}</span>
            <input
              aria-describedby={detailsAttempted && !ageReady ? "age-error" : undefined}
              aria-invalid={detailsAttempted && !ageReady}
              inputMode="numeric"
              max={120}
              min={18}
              onChange={(event) => onDraftChange({ ...draft, age: event.target.value })}
              placeholder={copy.agePlaceholder}
              required
              type="number"
              value={draft.age}
            />
            {detailsAttempted && !ageReady ? (
              <small className="field-error" id="age-error">{copy.adultHelp}</small>
            ) : null}
          </label>
        </div>

        <label className="field symptom-field">
          <span className="field__split-label">
            <span>{copy.symptomsLabel}</span>
            <small>{copy.optional}</small>
          </span>
          <span className="symptom-box">
            <textarea
              maxLength={1_000}
              onChange={(event) => onDraftChange({ ...draft, symptoms: event.target.value })}
              placeholder={copy.symptomsPlaceholder}
              rows={3}
              value={draft.symptoms}
            />
            <span className="symptom-box__voice">
              <VoiceInputButton
                disabled={busy}
                enabled={speechInputEnabled}
                language={draft.language}
                onTranscript={(transcript) => onDraftChange({ ...draft, symptoms: transcript })}
                variant="inline"
              />
            </span>
          </span>
        </label>

        <div className="history-field">
          <span className="field-label">{copy.historyLabel}</span>
          {knownHistory.length > 0 ? (
            <div className="history-chips">
              {knownHistory.map((item) => (
                <span className="history-chip" key={item}>
                  {item}
                  <button
                    aria-label={message(draft.language, "removeHistory", { item })}
                    onClick={() =>
                      onDraftChange({
                        ...draft,
                        medicalHistory: knownHistory.filter((entry) => entry !== item).join("\n"),
                      })
                    }
                    type="button"
                  >
                    <X aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <div className="history-add">
            <input
              aria-label={copy.historyPlaceholder}
              maxLength={120}
              onChange={(event) => setHistoryEntry(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addHistory();
                }
              }}
              placeholder={copy.historyPlaceholder}
              value={historyEntry}
            />
            <button disabled={!historyEntry.trim()} onClick={addHistory} type="button">
              <Plus aria-hidden="true" /> {copy.add}
            </button>
          </div>
        </div>

        {error ? (
          <div className="inline-alert" role="alert">
            <span>{error}</span>
            <button className="text-button" onClick={onRetrySession} type="button">
              {copy.retry}
            </button>
          </div>
        ) : null}

        <div className="screen-actions">
          <button
            className="button button--primary button--wide"
            disabled={busy || !sessionReady}
            type="submit"
          >
            {sessionReady ? copy.continueDocuments : copy.sessionStarting}
            {!sessionReady ? <LoaderCircle className="spinner" aria-hidden="true" /> : null}
          </button>
          <p>{copy.medicalBoundaryShort}</p>
        </div>
      </form>
    </main>
  );
}

function ProcessingPanel({
  language,
  progress,
  stage,
}: {
  language: Intake["language"];
  progress: ExtractionProgress | null;
  stage: ProcessingStage;
}) {
  const copy = getMessages(language);
  const stages: Array<{ id: ProcessingStage | "checking"; label: string }> = [
    { id: "uploading", label: copy.stageUploading },
    { id: "reading", label: copy.stageReading },
    { id: "checking", label: copy.stageChecking },
    { id: "writing", label: copy.stageWriting },
  ];
  const visibleStage = stage === "reading" && progress?.stage === "checking"
    ? "checking"
    : stage;
  const activeIndex = stages.findIndex((item) => item.id === visibleStage);

  return (
    <section className="processing-panel" aria-live="polite" aria-busy="true">
      <span className="processing-panel__pulse"><LoaderCircle aria-hidden="true" /></span>
      <div>
        <h2>{copy.processingTitle}</h2>
        <p>{copy.processingHint}</p>
        {stage === "reading" && progress?.totalPages ? (
          <p>
            {message(language, "pagesRead", {
              completed: progress.completedPages.toLocaleString(languageMeta[language].locale),
              total: progress.totalPages.toLocaleString(languageMeta[language].locale),
            })}
          </p>
        ) : null}
        {progress?.retrying ? <p>{copy.automaticRetrying}</p> : null}
        <ol>
          {stages.map((item, index) => (
            <li
              className={index === activeIndex ? "is-active" : index < activeIndex ? "is-complete" : ""}
              key={item.id}
            >
              {index < activeIndex ? <CheckCircle2 aria-hidden="true" /> : <span aria-hidden="true">{index + 1}</span>}
              {item.label}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function DocumentsStep({
  files,
  useSample,
  busy,
  liveUploadsEnabled,
  language,
  documentLanguage,
  processingStage,
  processingProgress,
  uploadsSaved,
  recoveryAction = null,
  error,
  onDocumentLanguageChange,
  onFilesChange,
  onUseSample,
  onContinue,
  onBack,
}: DocumentsStepProps) {
  const copy = getMessages(language);
  const reportInputRef = useRef<HTMLInputElement>(null);
  const currentPrescriptionInputRef = useRef<HTMLInputElement>(null);
  const pastPrescriptionInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const addFiles = (incoming: File[], category: DocumentCategory) => {
    if (!liveUploadsEnabled || busy) return;
    const supported = incoming.filter(
      (file) =>
        ["application/pdf", "image/jpeg", "image/png"].includes(file.type) &&
        file.size > 0 &&
        file.size <= 10 * 1024 * 1024,
    );
    setFileError(supported.length === incoming.length ? null : copy.invalidFile);
    if (files.length + supported.length > 10) setFileError(copy.tooManyFiles);
    const additions = supported.map((file) => ({
      id: crypto.randomUUID(),
      file,
      category,
    }));
    onFilesChange([...files, ...additions].slice(0, 10));
  };

  const reports = files.filter((item) => item.category === "report");
  const currentPrescriptions = files.filter((item) => item.category === "current-prescription");
  const pastPrescriptions = files.filter((item) => item.category === "past-prescription");
  const validDocuments = uploadsSaved || useSample || files.length > 0;
  const savedRecoveryVisible = uploadsSaved && !useSample && recoveryAction !== null;

  const fileRow = (item: SelectedDocument) => (
    <div className="file-row" key={item.id}>
      <span className="file-row__preview"><FileText aria-hidden="true" /></span>
      <div>
        <strong>{item.file.name}</strong>
        <span>
          {readableFileType(item.file, copy.unknownFile)} · {formatBytes(item.file.size, languageMeta[language].locale)}
        </span>
      </div>
      <button
        aria-label={message(language, "removeFile", { name: item.file.name })}
        className="icon-button"
        onClick={() => onFilesChange(files.filter((candidate) => candidate.id !== item.id))}
        type="button"
      >
        <X aria-hidden="true" />
      </button>
    </div>
  );

  return (
    <main className="vera-screen vera-screen--documents motion-enter" id="main-content">
      <ProgressStepper activeStep={2} language={language} />

      <header className="screen-heading">
        <button className="back-link" disabled={busy} onClick={onBack} type="button">
          <ArrowLeft aria-hidden="true" /> {copy.back}
        </button>
        <h1 tabIndex={-1}>{copy.documentsTitle}</h1>
        <p>{copy.documentsBody}</p>
      </header>

      {busy && processingStage ? (
        <ProcessingPanel
          language={language}
          progress={processingProgress}
          stage={processingStage}
        />
      ) : (
        <div className="documents-form">
          <section className="document-section" aria-labelledby="reports-heading">
            <div className="document-section__heading">
              <div>
                <h2 id="reports-heading">{copy.medicalReports}</h2>
                <span>{message(language, "fileCount", { count: useSample ? 2 : reports.length })}</span>
              </div>
              <label className="report-language-compact">
                <span>{copy.reportLanguageShort}</span>
                <select
                  onChange={(event) =>
                    onDocumentLanguageChange(event.target.value as Intake["documentLanguage"])
                  }
                  value={documentLanguage}
                >
                  {supportedLanguages.map((option) => (
                    <option key={option} lang={languageMeta[option].locale} value={option}>
                      {languageMeta[option].nativeName}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="file-list" aria-live="polite">
              {useSample ? (
                <div className="file-row file-row--sample">
                  <span className="file-row__preview"><FileText aria-hidden="true" /></span>
                  <div>
                    <strong>{copy.sampleReportTitle}</strong>
                    <span>{copy.sampleReportDetail}</span>
                  </div>
                  <CheckCircle2 aria-label={copy.ready} className="file-row__ready" />
                </div>
              ) : reports.map(fileRow)}
            </div>

            <button
              className={`add-document ${dragging ? "is-dragging" : ""}`}
              disabled={!liveUploadsEnabled || busy}
              onClick={() => reportInputRef.current?.click()}
              onDragEnter={(event) => {
                event.preventDefault();
                if (liveUploadsEnabled) setDragging(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                setDragging(false);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                addFiles(Array.from(event.dataTransfer.files), "report");
              }}
              type="button"
            >
              <Upload aria-hidden="true" />
              <span>{copy.addReport}</span>
            </button>
            <input
              accept="application/pdf,image/jpeg,image/png"
              hidden
              multiple
              onChange={(event) => addFiles(Array.from(event.target.files ?? []), "report")}
              ref={reportInputRef}
              type="file"
            />
          </section>

          <section className="document-section" aria-labelledby="prescriptions-heading">
            <div className="document-section__heading">
              <div><h2 id="prescriptions-heading">{copy.prescriptions}</h2></div>
            </div>
            <div className="prescription-grid">
              <article className="prescription-upload prescription-upload--current">
                <strong>{copy.currentPrescription}</strong>
                {useSample ? (
                  <span>{copy.samplePrescriptionTitle}<small>{copy.oneFile}</small></span>
                ) : currentPrescriptions.length > 0 ? (
                  <div className="prescription-upload__files">{currentPrescriptions.map(fileRow)}</div>
                ) : <small>{copy.noFileAdded}</small>}
                <button
                  disabled={!liveUploadsEnabled || busy}
                  onClick={() => currentPrescriptionInputRef.current?.click()}
                  type="button"
                >
                  <Plus aria-hidden="true" /> {copy.add}
                </button>
              </article>
              <article className="prescription-upload prescription-upload--past">
                <strong>{copy.pastPrescription}</strong>
                {pastPrescriptions.length > 0 ? (
                  <div className="prescription-upload__files">{pastPrescriptions.map(fileRow)}</div>
                ) : <small>{copy.pastPrescriptionHelp}</small>}
                <button
                  disabled={!liveUploadsEnabled || busy}
                  onClick={() => pastPrescriptionInputRef.current?.click()}
                  type="button"
                >
                  <Plus aria-hidden="true" /> {copy.add}
                </button>
              </article>
            </div>
            <input
              accept="application/pdf,image/jpeg,image/png"
              hidden
              multiple
              onChange={(event) => addFiles(Array.from(event.target.files ?? []), "current-prescription")}
              ref={currentPrescriptionInputRef}
              type="file"
            />
            <input
              accept="application/pdf,image/jpeg,image/png"
              hidden
              multiple
              onChange={(event) => addFiles(Array.from(event.target.files ?? []), "past-prescription")}
              ref={pastPrescriptionInputRef}
              type="file"
            />
          </section>

          {!(error && savedRecoveryVisible) ? (
            <div className="document-note">
              {uploadsSaved ? copy.uploadSavedNotice : copy.deleteAnyTime}
            </div>
          ) : null}

          {!useSample ? (
            <button className="sample-link" onClick={onUseSample} type="button">
              {copy.useSample}
            </button>
          ) : (
            <span className="sample-active"><Check aria-hidden="true" /> {copy.sampleActive}</span>
          )}

          {!liveUploadsEnabled ? <p className="upload-unavailable">{copy.uploadUnavailable}</p> : null}
          {fileError ? <div className="inline-alert" role="alert">{fileError}</div> : null}
        </div>
      )}

      {error ? (
        <div className="inline-alert" role="alert">
          {savedRecoveryVisible ? (
            <span>
              <strong>{error}</strong>
              <br />
              {copy.savedFileStillHere}
            </span>
          ) : error}
        </div>
      ) : null}

      <div className="screen-actions screen-actions--documents">
        <button
          className="button button--primary button--wide"
          disabled={!validDocuments || busy}
          onClick={onContinue}
          type="button"
        >
          {busy
            ? copy.processingTitle
            : recoveryAction === "retry"
              ? copy.retry
              : recoveryAction === "continue"
                ? copy.continueReading
                : copy.analyseDocuments}
          {busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : null}
        </button>
      </div>
    </main>
  );
}
