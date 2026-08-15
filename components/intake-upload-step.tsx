"use client";

import { useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileText,
  Mic,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import { supportedLanguages, type Intake } from "@/lib/contracts";

export type IntakeDraft = Omit<Intake, "age"> & { age: string };

type AboutStepProps = {
  draft: IntakeDraft;
  busy: boolean;
  sessionReady: boolean;
  liveLanguagesEnabled: boolean;
  error: string | null;
  onDraftChange: (draft: IntakeDraft) => void;
  onContinue: () => void;
};

type DocumentsStepProps = {
  files: File[];
  useSample: boolean;
  consented: boolean;
  busy: boolean;
  liveUploadsEnabled: boolean;
  language: Intake["language"];
  error: string | null;
  onFilesChange: (files: File[]) => void;
  onUseSample: () => void;
  onConsentChange: (value: boolean) => void;
  onContinue: () => void;
  onBack: () => void;
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AboutStep({
  draft,
  busy,
  sessionReady,
  liveLanguagesEnabled,
  error,
  onDraftChange,
  onContinue,
}: AboutStepProps) {
  const update = <Key extends keyof IntakeDraft>(key: Key, value: IntakeDraft[Key]) => {
    onDraftChange({ ...draft, [key]: value });
  };
  const validContext =
    draft.preferredName.trim().length > 0 &&
    Number.isInteger(Number(draft.age)) &&
    Number(draft.age) >= 18 &&
    Number(draft.age) <= 120;

  return (
    <main className="page-content page-content--about motion-enter">
      <div className="page-kicker">About you</div>
      <div className="page-heading">
        <h1>A little about you</h1>
        <p>
          This context helps us explain the reports clearly. Your name stays separate from the
          medical analysis.
        </p>
      </div>

      <form
        className="context-form context-form--standalone"
        onSubmit={(event) => {
          event.preventDefault();
          if (validContext && sessionReady && !busy) onContinue();
        }}
      >
        <div className="form-row form-row--identity">
          <label className="field">
            <span>Preferred name</span>
            <input
              autoComplete="name"
              maxLength={80}
              onChange={(event) => update("preferredName", event.target.value)}
              placeholder="Enter your preferred name"
              required
              value={draft.preferredName}
            />
          </label>
          <label className="field field--age">
            <span>Age</span>
            <input
              inputMode="numeric"
              max="120"
              min="18"
              onChange={(event) => update("age", event.target.value.replace(/[^0-9]/g, ""))}
              placeholder="e.g., 34"
              required
              value={draft.age}
            />
          </label>
        </div>

        <fieldset className="language-field">
          <legend>Preferred language</legend>
          <div className="language-options">
            {supportedLanguages.map((language) => {
              const disabled = language !== "English" && !liveLanguagesEnabled;
              return (
                <button
                  aria-pressed={draft.language === language}
                  className={draft.language === language ? "is-selected" : ""}
                  disabled={disabled}
                  key={language}
                  onClick={() => update("language", language)}
                  title={disabled ? "Available when live providers are configured" : undefined}
                  type="button"
                >
                  {language}
                </button>
              );
            })}
          </div>
          <small>
            {liveLanguagesEnabled
              ? "Live explanations and answers use your selected language."
              : "The safe sample is available in English."}
          </small>
        </fieldset>

        <label className="field field--textarea">
          <span>Current symptoms <em>(optional)</em></span>
          <span className="field__control">
            <textarea
              maxLength={1_000}
              onChange={(event) => update("symptoms", event.target.value)}
              placeholder="Describe any current symptoms"
              rows={3}
              value={draft.symptoms}
            />
            <button
              aria-label="Voice input is not configured yet"
              className="field__mic"
              disabled
              title="Voice input follows after the text workflow is verified"
              type="button"
            >
              <Mic aria-hidden="true" />
            </button>
          </span>
          <small>{draft.symptoms.length} / 1,000</small>
        </label>

        <label className="field field--textarea">
          <span>Known medical history <em>(optional)</em></span>
          <span className="field__control">
            <textarea
              maxLength={1_000}
              onChange={(event) => update("medicalHistory", event.target.value)}
              placeholder="Share past conditions, surgeries, or ongoing care"
              rows={3}
              value={draft.medicalHistory}
            />
            <button
              aria-label="Voice input is not configured yet"
              className="field__mic"
              disabled
              title="Voice input follows after the text workflow is verified"
              type="button"
            >
              <Mic aria-hidden="true" />
            </button>
          </span>
          <small>{draft.medicalHistory.length} / 1,000</small>
        </label>

        {error ? <div className="inline-alert" role="alert">{error}</div> : null}

        <div className="bottom-action bottom-action--focused">
          <div className="bottom-action__note">
            <span className="privacy-icon"><ShieldCheck aria-hidden="true" /></span>
            <span>For adults 18 and older in this MVP.</span>
          </div>
          <button
            className="button button--primary button--wide"
            disabled={!validContext || busy || !sessionReady}
            type="submit"
          >
            Continue to documents
            <ArrowRight aria-hidden="true" />
          </button>
        </div>
      </form>
    </main>
  );
}

export function DocumentsStep({
  files,
  useSample,
  consented,
  busy,
  liveUploadsEnabled,
  language,
  error,
  onFilesChange,
  onUseSample,
  onConsentChange,
  onContinue,
  onBack,
}: DocumentsStepProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const addFiles = (incoming: File[]) => {
    if (!liveUploadsEnabled) return;
    const supported = incoming.filter((file) =>
      ["application/pdf", "image/jpeg", "image/png"].includes(file.type) &&
      file.size > 0 &&
      file.size <= 10 * 1024 * 1024,
    );
    if (supported.length !== incoming.length) {
      setFileError("Use only PDF, JPG, or PNG files up to 10 MB each.");
    } else {
      setFileError(null);
    }
    if (files.length + supported.length > 10) {
      setFileError("You can add at most 10 files to one case.");
    }
    onFilesChange([...files, ...supported].slice(0, 10));
  };
  const sampleAvailable = language === "English";
  const validDocuments = consented && ((sampleAvailable && useSample) || files.length > 0);

  return (
    <main className="page-content page-content--documents motion-enter">
      <div className="page-kicker">Your documents</div>
      <div className="page-heading">
        <h1>Add your reports</h1>
        <p>
          Add up to ten de-identified PDFs or clear photos. You will check every extracted value
          before an explanation is created.
        </p>
      </div>

      <section className="upload-section upload-section--standalone" aria-labelledby="upload-heading">
        <div className="section-heading">
          <h2 id="upload-heading">Medical reports and prescriptions</h2>
          <p>PDF, JPG or PNG · up to 10 files · 10 MB each</p>
        </div>

        <div className={`mode-notice ${liveUploadsEnabled ? "mode-notice--ready" : ""}`}>
            <ShieldCheck aria-hidden="true" />
            <div>
              <strong>{liveUploadsEnabled ? "Live analysis is ready" : "Safe sample mode"}</strong>
              <span>
                {liveUploadsEnabled
                  ? "Uploads are digitised by Sarvam, then checked and explained with OpenAI."
                  : "Live document analysis stays locked until approved provider keys are configured."}
              </span>
            </div>
        </div>

        <div
          aria-disabled={!liveUploadsEnabled}
          className={`drop-zone ${dragging ? "is-dragging" : ""} ${!liveUploadsEnabled ? "is-disabled" : ""}`}
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
            addFiles(Array.from(event.dataTransfer.files));
          }}
        >
          <Upload aria-hidden="true" className="drop-zone__icon" />
          <strong>{liveUploadsEnabled ? "Drag and drop files here" : "Live uploads are not active yet"}</strong>
          <span>{liveUploadsEnabled ? "or" : "Use the synthetic case below for the full flow"}</span>
          <button
            className="button button--secondary"
            disabled={!liveUploadsEnabled}
            onClick={() => inputRef.current?.click()}
            type="button"
          >
            Choose files
          </button>
          <input
            accept="application/pdf,image/jpeg,image/png"
            hidden
            multiple
            onChange={(event) => addFiles(Array.from(event.target.files ?? []))}
            ref={inputRef}
            type="file"
          />
        </div>

        <div className="file-list" aria-live="polite">
          {sampleAvailable && useSample ? (
            <div className="file-row file-row--sample">
              <FileText aria-hidden="true" />
              <div>
                <strong>Safe sample reports</strong>
                <span>2 blood reports + 1 prescription · synthetic data</span>
              </div>
              <span className="file-row__status"><CheckCircle2 aria-hidden="true" /> Ready</span>
            </div>
          ) : null}
          {files.map((file, index) => (
            <div className="file-row" key={`${file.name}-${file.lastModified}-${index}`}>
              <FileText aria-hidden="true" />
              <div>
                <strong>{file.name}</strong>
                <span>{file.type || "Unknown type"} · {formatBytes(file.size)}</span>
              </div>
              <button
                aria-label={`Remove ${file.name}`}
                className="icon-button"
                onClick={() => onFilesChange(files.filter((_, fileIndex) => fileIndex !== index))}
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>

        {fileError ? <div className="inline-alert" role="alert">{fileError}</div> : null}

        {sampleAvailable && !useSample ? (
          <button className="text-button" onClick={onUseSample} type="button">
            Use the safe sample reports instead
          </button>
        ) : null}

        <label className="consent-row">
          <input
            checked={consented}
            onChange={(event) => onConsentChange(event.target.checked)}
            type="checkbox"
          />
          <span>
            {sampleAvailable && useSample
              ? "I confirm that I am using the synthetic sample for this buildathon MVP."
              : "I confirm these files are synthetic or de-identified, and I consent to temporary private storage and processing by Vera’s configured providers for this MVP."}
          </span>
        </label>
      </section>

      {error ? <div className="inline-alert" role="alert">{error}</div> : null}

      <div className="bottom-action bottom-action--focused">
        <button className="button button--back" disabled={busy} onClick={onBack} type="button">
          <ArrowLeft aria-hidden="true" /> Back
        </button>
        <button
          className="button button--primary button--wide"
          disabled={!validDocuments || busy}
          onClick={onContinue}
          type="button"
        >
          {busy ? "Reading and checking reports…" : "Continue to review"}
          {!busy ? <ArrowRight aria-hidden="true" /> : <span className="spinner" aria-hidden="true" />}
        </button>
      </div>
    </main>
  );
}
