"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Send,
  Trash2,
} from "lucide-react";
import type {
  Analysis,
  Fact,
  Intake,
  MedicationFact,
  ObservationFact,
  QuestionResponse,
} from "@/lib/contracts";
import { cleanDisplayText } from "@/lib/display-text";
import { PictureSummary } from "@/components/picture-summary";
import { ListenButton, VoiceInputButton } from "@/components/voice-controls";
import { formatAppDate, getMessages, languageMeta, message } from "@/lib/i18n";
import { parseMedicalNumber } from "@/lib/medical-range";

type ExplanationStepProps = {
  analysis: Analysis;
  facts: Fact[];
  busy: boolean;
  caseId: string;
  error: string | null;
  language: Intake["language"];
  speechInputEnabled: boolean;
  speechOutputEnabled: boolean;
  view: "summary" | "questions";
  onAsk: (question: string) => Promise<QuestionResponse>;
  onBackToSummary: () => void;
  onOpenQuestions: () => void;
  onStartOver: () => Promise<void>;
};

type ConversationTurn = { id: string; question: string; response: QuestionResponse };

function observationGroupKey(observation: ObservationFact) {
  return [observation.name, observation.unit, observation.referenceRange]
    .map((value) => value.trim().toLocaleLowerCase("en-IN"))
    .join("::");
}

function strictDateValue(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return date.getTime();
}

function latestObservations(observations: ObservationFact[]) {
  const latestDated = new Map<string, ObservationFact>();
  const undated: ObservationFact[] = [];
  for (const observation of observations) {
    const date = strictDateValue(observation.effectiveDate);
    if (date === null) {
      undated.push(observation);
      continue;
    }
    const key = observationGroupKey(observation);
    const existing = latestDated.get(key);
    const existingDate = existing ? strictDateValue(existing.effectiveDate) : null;
    if (existingDate === null || date > existingDate) latestDated.set(key, observation);
  }
  return [...latestDated.values(), ...undated];
}

function comparableObservations(observations: ObservationFact[]) {
  const groups = new Map<string, ObservationFact[]>();
  for (const observation of observations) {
    if (
      strictDateValue(observation.effectiveDate) === null ||
      parseMedicalNumber(observation.value) === null ||
      !observation.unit.trim()
    ) continue;
    const key = observationGroupKey(observation);
    groups.set(key, [...(groups.get(key) ?? []), observation]);
  }
  for (const group of groups.values()) {
    const byDate = new Map(group.map((item) => [item.effectiveDate, item]));
    if (byDate.size < 2) continue;
    const sorted = [...byDate.values()].sort(
      (left, right) => strictDateValue(left.effectiveDate)! - strictDateValue(right.effectiveDate)!,
    );
    return { previous: sorted.at(-2)!, current: sorted.at(-1)! };
  }
  return null;
}

function rangeGeometry(low: number, high: number, result: number) {
  const rawSpan = Math.max(high, result) - Math.min(low, result);
  const padding = Math.max(rawSpan * 0.22, Math.abs(high - low) * 0.12, 0.1);
  const displayLow = Math.min(low, result) - padding;
  const displayHigh = Math.max(high, result) + padding;
  const position = (value: number) =>
    Math.max(3, Math.min(97, ((value - displayLow) / (displayHigh - displayLow)) * 100));
  return { low: position(low), high: position(high), result: position(result) };
}

function summaryMonth(language: Intake["language"], isoDate: string) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(languageMeta[language].locale, {
    month: "long",
    year: "numeric",
  }).format(date);
}

function ObservationCard({
  fact,
  language,
}: {
  fact: ObservationFact;
  language: Intake["language"];
}) {
  const copy = getMessages(language);
  const measured = parseMedicalNumber(fact.value);
  const range = fact.numericRange?.kind === "closed" ? fact.numericRange : null;
  const geometry = measured !== null && range
    ? rangeGeometry(range.lower, range.upper, measured)
    : null;

  return (
    <article className={`result-card result-card--${fact.flag}`}>
      <div className="result-card__heading">
        <h3>{fact.name}</h3>
        <strong>{fact.value} {fact.unit}</strong>
      </div>
      {geometry && range ? (
        <div
          aria-label={`${fact.name}: ${fact.value} ${fact.unit}; ${copy.printedRange}: ${fact.referenceRange} ${fact.unit}`}
          className="range-visual"
        >
          <span className="range-visual__track" />
          <span
            className="range-visual__normal"
            style={{ left: `${geometry.low}%`, width: `${geometry.high - geometry.low}%` }}
          />
          <span className="range-visual__result" style={{ left: `${geometry.result}%` }} />
        </div>
      ) : (
        <p className="result-card__no-range">{copy.rangeNotClear}</p>
      )}
      <div className="range-labels">
        <span>{copy.lowLabel}</span>
        <span>{fact.referenceRange ? `${copy.typicalLabel} ${fact.referenceRange}` : copy.rangeNotClear}</span>
        <span>{copy.highLabel}</span>
      </div>
    </article>
  );
}

function TrendCard({
  comparison,
  language,
}: {
  comparison: { previous: ObservationFact; current: ObservationFact };
  language: Intake["language"];
}) {
  const copy = getMessages(language);
  const previousValue = parseMedicalNumber(comparison.previous.value) ?? 0;
  const currentValue = parseMedicalNumber(comparison.current.value) ?? 0;
  const max = Math.max(Math.abs(previousValue), Math.abs(currentValue), 1);
  const barHeight = (value: number) => `${Math.max(28, Math.min(72, (Math.abs(value) / max) * 72))}px`;

  return (
    <article className="trend-card">
      <div className="trend-card__bars" aria-hidden="true">
        <span>
          <i style={{ height: barHeight(previousValue) }} />
          <small>{formatAppDate(language, comparison.previous.effectiveDate)}</small>
        </span>
        <span>
          <i className="is-current" style={{ height: barHeight(currentValue) }} />
          <small>{formatAppDate(language, comparison.current.effectiveDate)}</small>
        </span>
      </div>
      <div className="trend-card__copy">
        <strong>{comparison.previous.value} → {comparison.current.value} {comparison.current.unit}</strong>
        <p>{copy.changeBetweenReports}</p>
      </div>
    </article>
  );
}

function PrescriptionCard({
  medications,
  analysis,
  language,
}: {
  medications: MedicationFact[];
  analysis: Analysis;
  language: Intake["language"];
}) {
  const copy = getMessages(language);
  const instructions = analysis.cards.find((card) => card.id === "instructions");
  if (!instructions || medications.length === 0) return null;
  return (
    <article className="prescription-card">
      <div className="prescription-card__medicines">
        {medications.map((medication) => (
          <strong key={medication.id}>
            {medication.medicine}{medication.dose ? ` ${medication.dose}` : ""}
          </strong>
        ))}
      </div>
      <span className="prescription-card__label">{copy.asWritten}</span>
      <p>{cleanDisplayText(instructions.body)}</p>
      <small>{copy.prescriptionBoundary}</small>
    </article>
  );
}

export function ExplanationStep({
  analysis,
  facts,
  busy,
  caseId,
  error,
  language,
  speechInputEnabled,
  speechOutputEnabled,
  view,
  onAsk,
  onBackToSummary,
  onOpenQuestions,
  onStartOver,
}: ExplanationStepProps) {
  const copy = getMessages(language);
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [questionBusy, setQuestionBusy] = useState(false);
  const [showAllResults, setShowAllResults] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const questionInputRef = useRef<HTMLInputElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);

  const observations = useMemo(
    () => facts.filter((fact): fact is ObservationFact => fact.kind === "observation"),
    [facts],
  );
  const currentMedications = useMemo(
    () => facts.filter((fact): fact is MedicationFact =>
      fact.kind === "medication" && fact.source.documentCategory === "current-prescription"
    ),
    [facts],
  );
  const currentObservations = useMemo(() => latestObservations(observations), [observations]);
  const withinCount = currentObservations.filter((fact) => fact.flag === "normal").length;
  const outsideCount = currentObservations.filter(
    (fact) => fact.flag === "high" || fact.flag === "low",
  ).length;
  const comparison = comparableObservations(observations);
  const displayObservations = useMemo(() => {
    return [...currentObservations].sort((left, right) => {
      const leftPriority = left.flag === "high" || left.flag === "low" ? 0 : 1;
      const rightPriority = right.flag === "high" || right.flag === "low" ? 0 : 1;
      return leftPriority - rightPriority;
    });
  }, [currentObservations]);
  const shownObservations = showAllResults ? displayObservations : displayObservations.slice(0, 2);
  const summaryAudioText = analysis.cards
    .map((card) => `${cleanDisplayText(card.title)}. ${cleanDisplayText(card.body)}`)
    .join(" ")
    .slice(0, 2_500);

  useEffect(() => {
    if (confirmDelete) deleteButtonRef.current?.focus();
  }, [confirmDelete]);

  useEffect(() => {
    if (view === "questions") questionInputRef.current?.focus({ preventScroll: true });
  }, [view]);

  const submitQuestion = async (event?: FormEvent) => {
    event?.preventDefault();
    const submitted = question.trim();
    if (submitted.length < 2 || questionBusy) return;
    setQuestionBusy(true);
    setLocalError(null);
    try {
      const response = await onAsk(submitted);
      setTurns((current) => [
        ...current,
        { id: crypto.randomUUID(), question: submitted, response },
      ]);
      setQuestion("");
    } catch {
      setLocalError(copy.genericError);
    } finally {
      setQuestionBusy(false);
    }
  };

  if (view === "questions") {
    return (
      <main className="vera-screen vera-screen--questions motion-enter" id="main-content">
        <header className="qa-header">
          <button className="icon-button" aria-label={copy.back} onClick={onBackToSummary} type="button">
            <ArrowLeft aria-hidden="true" />
          </button>
          <span className="qa-header__mark" aria-hidden="true"><i /></span>
          <div>
            <h1 tabIndex={-1}>{copy.questionsKicker}</h1>
            <p>{message(language, "aboutYourReports", { count: analysis.checkedDocumentCount })}</p>
          </div>
          <span className="qa-header__language" lang={languageMeta[language].locale}>
            {languageMeta[language].nativeName}
          </span>
        </header>

        <section className="chat-thread" aria-live="polite" aria-busy={questionBusy}>
          {turns.length === 0 && !questionBusy ? (
            <div className="chat-intro">
              <span className="qa-header__mark" aria-hidden="true"><i /></span>
              <p>{copy.noAnswerYet}</p>
            </div>
          ) : null}

          {turns.map((turn) => (
            <article className="chat-turn" key={turn.id}>
              <p className="chat-bubble chat-bubble--user">{turn.question}</p>
              <div className="chat-bubble chat-bubble--assistant">
                <p>{cleanDisplayText(turn.response.answer)}</p>
                {turn.response.doctorQuestion ? (
                  <p className="doctor-question">
                    <strong>{copy.doctorQuestion}:</strong> {cleanDisplayText(turn.response.doctorQuestion)}
                  </p>
                ) : null}
                <ListenButton
                  caseId={caseId}
                  enabled={speechOutputEnabled}
                  language={language}
                  text={cleanDisplayText(turn.response.answer)}
                  variant="answer"
                />
              </div>
            </article>
          ))}

          {questionBusy ? (
            <div className="typing-bubble" role="status" aria-label={copy.checkingAnswer}>
              <i /><i /><i />
            </div>
          ) : null}
        </section>

        <section className="qa-bottom">
          {analysis.suggestedQuestions.length > 0 ? (
            <div className="qa-suggested">
              <span className="qa-suggested__label">{copy.suggestions}</span>
              <div className="qa-suggested__list">
                {analysis.suggestedQuestions.slice(0, 3).map((suggested) => (
                  <button
                    key={suggested}
                    onClick={() => {
                      setQuestion(cleanDisplayText(suggested));
                      questionInputRef.current?.focus();
                    }}
                    type="button"
                  >
                    {cleanDisplayText(suggested)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <form className="qa-composer" onSubmit={submitQuestion}>
            <label className="sr-only" htmlFor="report-question">{copy.questionLabel}</label>
            <input
              id="report-question"
              maxLength={500}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={copy.questionPlaceholderShort}
              ref={questionInputRef}
              value={question}
            />
            {question.trim().length >= 2 ? (
              <button
                aria-label={questionBusy ? copy.checkingAnswer : copy.askButton}
                className="qa-send"
                disabled={questionBusy}
                type="submit"
              >
                <Send aria-hidden="true" />
              </button>
            ) : (
              <VoiceInputButton
                caseId={caseId}
                disabled={questionBusy}
                enabled={speechInputEnabled}
                language={language}
                onTranscript={(transcript) => {
                  setQuestion(transcript);
                  questionInputRef.current?.focus();
                }}
                variant="composer"
              />
            )}
          </form>
          {localError || error ? <div className="inline-alert" role="alert">{localError ?? error}</div> : null}
          <p className="qa-boundary">{copy.medicalBoundaryShort}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="vera-screen vera-screen--summary motion-enter" id="main-content">
      <header className="summary-heading">
        <p>{message(language, "summaryMeta", {
          date: summaryMonth(language, analysis.generatedAt),
          count: analysis.checkedDocumentCount.toLocaleString(languageMeta[language].locale),
        })}</p>
        <h1 tabIndex={-1}>{copy.summaryTitle}</h1>
      </header>

      <section className="summary-overview" aria-labelledby="summary-overview-heading">
        <div className="summary-overview__topline">
          <div>
            <span>{withinCount} · {copy.withinRangeShort}</span>
            <span className="is-discuss">{outsideCount} · {copy.toDiscuss}</span>
          </div>
          <ListenButton
            caseId={caseId}
            enabled={speechOutputEnabled}
            language={language}
            text={summaryAudioText}
            variant="round"
          />
        </div>
        <h2 className="sr-only" id="summary-overview-heading">{copy.fivePointSummary}</h2>
        <ol>
          {analysis.cards.map((card) => <li key={card.id}>{cleanDisplayText(card.body)}</li>)}
        </ol>
      </section>

      {shownObservations.length > 0 ? (
        <section className="summary-section" aria-labelledby="results-heading">
          <h2 id="results-heading">{copy.whereNumbersSit}</h2>
          <div className="result-grid">
            {shownObservations.map((fact) => (
              <ObservationCard
                fact={fact}
                key={fact.id}
                language={language}
              />
            ))}
          </div>
          {displayObservations.length > 2 ? (
            <button className="show-results" onClick={() => setShowAllResults((current) => !current)} type="button">
              {showAllResults
                ? copy.showFewerResults
                : message(language, "showAllResults", { count: displayObservations.length })}
            </button>
          ) : null}
        </section>
      ) : null}

      {comparison ? (
        <section className="summary-section" aria-labelledby="trend-heading">
          <h2 id="trend-heading">{message(language, "overTime", { name: comparison.current.name })}</h2>
          <TrendCard comparison={comparison} language={language} />
        </section>
      ) : null}

      {currentMedications.length > 0 ? (
        <section className="summary-section" aria-labelledby="prescription-heading">
          <h2 id="prescription-heading">{copy.currentPrescriptionSummary}</h2>
          <PrescriptionCard
            analysis={analysis}
            language={language}
            medications={currentMedications}
          />
        </section>
      ) : null}

      <div className="summary-boundary">{copy.medicalBoundaryShort}</div>

      <div className="summary-actions">
        <button className="button button--primary button--wide" onClick={onOpenQuestions} type="button">
          {copy.askQuestions}
        </button>
        <PictureSummary caseId={caseId} facts={facts} key={caseId} language={language} />
      </div>

      {confirmDelete ? (
        <section aria-label={copy.deleteConfirm} className="delete-confirm" role="alertdialog">
          <p>{copy.deleteConfirm}</p>
          <div>
            <button className="button" onClick={() => setConfirmDelete(false)} type="button">
              {copy.back}
            </button>
            <button
              className="button button--primary"
              disabled={busy}
              onClick={() => void onStartOver()}
              ref={deleteButtonRef}
              type="button"
            >
              <Trash2 aria-hidden="true" /> {copy.startOver}
            </button>
          </div>
        </section>
      ) : (
        <button
          className="start-over"
          disabled={busy}
          onClick={() => setConfirmDelete(true)}
          type="button"
        >
          <Trash2 aria-hidden="true" /> {copy.startOver}
        </button>
      )}

      {error ? <div className="inline-alert" role="alert">{error}</div> : null}
    </main>
  );
}
