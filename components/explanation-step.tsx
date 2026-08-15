"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ExternalLink,
  FileText,
  Send,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import type {
  Analysis,
  Fact,
  MedicationFact,
  ObservationFact,
  QuestionResponse,
} from "@/lib/contracts";
import { SourceDocument } from "@/components/source-document";

type ExplanationStepProps = {
  analysis: Analysis;
  facts: Fact[];
  busy: boolean;
  error: string | null;
  onAsk: (question: string) => Promise<QuestionResponse>;
  onStartOver: () => Promise<void>;
};

function numericValue(value: string) {
  const match = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function printedRange(value: string) {
  const numbers = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/g)?.map(Number);
  if (!numbers || numbers.length < 2 || numbers[0] === numbers[1]) return null;
  return { low: Math.min(numbers[0], numbers[1]), high: Math.max(numbers[0], numbers[1]) };
}

function comparableObservations(observations: ObservationFact[]) {
  const groups = new Map<string, ObservationFact[]>();
  for (const observation of observations) {
    const key = observation.name.trim().toLocaleLowerCase("en-IN");
    groups.set(key, [...(groups.get(key) ?? []), observation]);
  }

  const group = Array.from(groups.values()).find((items) => items.length >= 2);
  if (!group) return null;
  const sorted = [...group].sort((left, right) => {
    const leftTime = Date.parse(left.effectiveDate);
    const rightTime = Date.parse(right.effectiveDate);
    return (Number.isNaN(leftTime) ? 0 : leftTime) - (Number.isNaN(rightTime) ? 0 : rightTime);
  });
  return { previous: sorted.at(-2)!, current: sorted.at(-1)! };
}

function dateLabel(value: string) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value || "Date not stated";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

function rangeGeometry(low: number, high: number, result: number) {
  const rawSpan = Math.max(high, result) - Math.min(low, result);
  const padding = Math.max(rawSpan * 0.22, Math.abs(high - low) * 0.12, 0.1);
  const displayLow = Math.min(low, result) - padding;
  const displayHigh = Math.max(high, result) + padding;
  const position = (value: number) =>
    Math.max(3, Math.min(97, ((value - displayLow) / (displayHigh - displayLow)) * 100));
  return {
    low: position(low),
    high: position(high),
    result: position(result),
  };
}

function CitationButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button className="citation-button" onClick={onClick} type="button">
      <FileText aria-hidden="true" /> {label} <ExternalLink aria-hidden="true" />
    </button>
  );
}

export function ExplanationStep({
  analysis,
  facts,
  busy,
  error,
  onAsk,
  onStartOver,
}: ExplanationStepProps) {
  const [question, setQuestion] = useState(analysis.suggestedQuestions[0] ?? "");
  const [answer, setAnswer] = useState<QuestionResponse | null>(null);
  const [questionBusy, setQuestionBusy] = useState(false);
  const [sourceFactId, setSourceFactId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const observations = useMemo(
    () => facts.filter((fact): fact is ObservationFact => fact.kind === "observation"),
    [facts],
  );
  const medications = useMemo(
    () => facts.filter((fact): fact is MedicationFact => fact.kind === "medication"),
    [facts],
  );
  const visualObservation = observations.find(
    (fact) => numericValue(fact.value) !== null && printedRange(fact.referenceRange),
  ) ?? observations[0];
  const visualRange = visualObservation ? printedRange(visualObservation.referenceRange) : null;
  const resultValue = visualObservation ? numericValue(visualObservation.value) : null;
  const geometry = visualRange && resultValue !== null
    ? rangeGeometry(visualRange.low, visualRange.high, resultValue)
    : null;
  const comparison = comparableObservations(observations);

  const sourceBySpan = useMemo(
    () => new Map(facts.map((fact) => [fact.source.id, fact])),
    [facts],
  );
  const selectedSourceFact = facts.find((fact) => fact.id === sourceFactId);

  useEffect(() => {
    if (!sourceFactId) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSourceFactId(null);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
        ),
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [sourceFactId]);

  const submitQuestion = async (event?: FormEvent) => {
    event?.preventDefault();
    if (question.trim().length < 2 || questionBusy) return;
    setQuestionBusy(true);
    setLocalError(null);
    try {
      setAnswer(await onAsk(question.trim()));
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : "The question could not be answered.");
    } finally {
      setQuestionBusy(false);
    }
  };

  const openSource = (sourceSpanId: string) => {
    const fact = sourceBySpan.get(sourceSpanId);
    if (fact) setSourceFactId(fact.id);
  };

  return (
    <main className="page-content page-content--explanation motion-enter">
      <div className="explanation-heading">
        <div className="page-heading">
          <h1>Your reports, explained</h1>
          <p>This explains what your documents say. It does not diagnose a condition or replace your doctor.</p>
        </div>
        <div className="checked-status">
          <ShieldCheck aria-hidden="true" />
          <span>Checked against {analysis.checkedDocumentCount} documents</span>
        </div>
      </div>

      <a className="mobile-qa-jump" href="#qa-heading">
        Ask a question about these reports <Send aria-hidden="true" />
      </a>

      <div className="explanation-layout">
        <section className="explanation-flow" aria-label="Five-point explanation">
          {analysis.cards.map((card) => (
            <section className={`explanation-section explanation-section--${card.id}`} key={card.id}>
              <h2>{card.title}</h2>

              {card.id === "documents" ? (
                <div className="document-citations">
                  <p>{card.body}</p>
                  <div className="citation-list">
                    {card.citations.map((citation) => (
                      <CitationButton
                        key={citation.sourceSpanId}
                        label={citation.label}
                        onClick={() => openSource(citation.sourceSpanId)}
                      />
                    ))}
                  </div>
                </div>
              ) : null}

              {card.id === "findings" ? (
                <>
                  <p>{card.body}</p>
                  {visualObservation ? (
                    <div className="finding-callout">
                      <span aria-hidden="true">
                        {visualObservation.flag === "high" ? "↗" : visualObservation.flag === "low" ? "↘" : "•"}
                      </span>
                      <strong>
                        {visualObservation.name} was recorded as {visualObservation.value} {visualObservation.unit}
                        {visualObservation.flag !== "not_provided" ? ` and marked ${visualObservation.flag}` : ""}
                      </strong>
                    </div>
                  ) : null}
                  {visualObservation && visualRange && resultValue !== null && geometry ? (
                    <div className="range-summary">
                      <dl>
                        <div><dt>Your result</dt><dd>{visualObservation.value} {visualObservation.unit}</dd></div>
                        <div><dt>Report range</dt><dd>{visualObservation.referenceRange} {visualObservation.unit}</dd></div>
                      </dl>
                      <div
                        className="range-visual"
                        aria-label={`${visualObservation.name} ${visualObservation.value} ${visualObservation.unit}; report range ${visualObservation.referenceRange} ${visualObservation.unit}`}
                      >
                        <span className="range-visual__track" />
                        <span
                          className="range-visual__normal"
                          style={{ left: `${geometry.low}%`, width: `${geometry.high - geometry.low}%` }}
                        />
                        <span className="range-visual__tick range-visual__tick--start" style={{ left: `${geometry.low}%` }}>
                          <b>{visualRange.low}</b>
                        </span>
                        <span className="range-visual__tick range-visual__tick--end" style={{ left: `${geometry.high}%` }}>
                          <b>{visualRange.high}</b>
                        </span>
                        <span className="range-visual__result" style={{ left: `${geometry.result}%` }}>
                          <b>{visualObservation.value}</b>
                        </span>
                      </div>
                    </div>
                  ) : null}
                  <div className="citation-list">
                    {card.citations.map((citation) => (
                      <CitationButton key={citation.sourceSpanId} label={citation.label} onClick={() => openSource(citation.sourceSpanId)} />
                    ))}
                  </div>
                </>
              ) : null}

              {card.id === "changes" ? (
                <>
                  <p>{card.body}</p>
                  {comparison ? (
                    <div
                      className="timeline"
                      aria-label={`${comparison.current.name} changed from ${comparison.previous.value} to ${comparison.current.value} ${comparison.current.unit}`}
                    >
                      <span className="timeline__line" />
                      <div className="timeline__point timeline__point--past">
                        <time>{dateLabel(comparison.previous.effectiveDate)}</time><span />
                        <strong>{comparison.previous.name} {comparison.previous.value} {comparison.previous.unit}</strong>
                      </div>
                      <div className="timeline__point timeline__point--current">
                        <time>{dateLabel(comparison.current.effectiveDate)}</time><span />
                        <strong>{comparison.current.name} {comparison.current.value} {comparison.current.unit}</strong>
                      </div>
                      <div className="timeline__point timeline__point--future">
                        <time>—</time><span /><strong>Next result</strong>
                      </div>
                    </div>
                  ) : null}
                  <div className="citation-list">
                    {card.citations.map((citation) => (
                      <CitationButton key={citation.sourceSpanId} label={citation.label} onClick={() => openSource(citation.sourceSpanId)} />
                    ))}
                  </div>
                </>
              ) : null}

              {card.id === "instructions" ? (
                <>
                  {medications.length > 0 ? medications.map((medicine) => (
                    <div className="instruction-row" key={medicine.id}>
                      <FileText aria-hidden="true" />
                      <span>{medicine.medicine} {medicine.dose} · {medicine.frequency} · {medicine.duration}</span>
                    </div>
                  )) : <p>{card.body}</p>}
                  {medications.length > 0 ? (
                    <p className="restatement-note">This repeats the uploaded prescription. It is not new medical advice.</p>
                  ) : null}
                  <div className="citation-list">
                    {card.citations.map((citation) => (
                      <CitationButton key={citation.sourceSpanId} label={citation.label} onClick={() => openSource(citation.sourceSpanId)} />
                    ))}
                  </div>
                </>
              ) : null}

              {card.id === "questions" ? (
                <ul className="question-list">
                  {analysis.suggestedQuestions.map((suggested) => <li key={suggested}>{suggested}</li>)}
                </ul>
              ) : null}
            </section>
          ))}
        </section>

        <aside className="qa-rail" aria-labelledby="qa-heading">
          <h2 id="qa-heading">Ask about these documents</h2>
          <p>Questions are answered using your confirmed reports.</p>
          <form className="qa-form" onSubmit={submitQuestion}>
            <label className="sr-only" htmlFor="report-question">Ask a question about your reports</label>
            <input
              id="report-question"
              maxLength={500}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask a question about your reports"
              value={question}
            />
            <button className="button button--primary" disabled={questionBusy || question.trim().length < 2} type="submit">
              <span>{questionBusy ? "Checking…" : "Ask"}</span>
              <Send aria-hidden="true" />
            </button>
          </form>

          <div className="qa-example">
            <span className="qa-example__label">Example question</span>
            <button onClick={() => setQuestion(analysis.suggestedQuestions[0] ?? "")} type="button">
              {analysis.suggestedQuestions[0]}
            </button>
          </div>

          {answer ? (
            <div className="answer-panel" aria-live="polite">
              <span className="answer-panel__label">Answer from these documents</span>
              <p>{answer.answer}</p>
              {answer.doctorQuestion ? (
                <p className="doctor-question"><strong>Question for your doctor:</strong> {answer.doctorQuestion}</p>
              ) : null}
              <div className="citation-list">
                {answer.citations.map((citation) => (
                  <CitationButton key={citation.sourceSpanId} label={citation.label} onClick={() => openSource(citation.sourceSpanId)} />
                ))}
              </div>
            </div>
          ) : (
            <div className="answer-panel answer-panel--empty">
              <CheckCircle2 aria-hidden="true" />
              <p>Ask about a value, range, change, or written instruction in these reports.</p>
            </div>
          )}

          {localError || error ? <div className="inline-alert" role="alert">{localError ?? error}</div> : null}

          <div className="qa-rail__grounding">
            <ShieldCheck aria-hidden="true" />
            <span>Answers use only confirmed facts from this case.</span>
          </div>
        </aside>
      </div>

      <div className="case-footer">
        <span>
          {analysis.providerMode === "demo" ? "Synthetic sample" : "De-identified MVP case"}
          {" · case access expires after 24 hours"}
        </span>
        <button className="text-button text-button--danger" disabled={busy} onClick={() => void onStartOver()} type="button">
          <Trash2 aria-hidden="true" /> Delete case and start over
        </button>
      </div>

      {sourceFactId ? (
        <div className="source-dialog-backdrop" role="presentation" onMouseDown={() => setSourceFactId(null)}>
          <section
            aria-labelledby="source-dialog-heading"
            aria-modal="true"
            className="source-dialog"
            onMouseDown={(event) => event.stopPropagation()}
            ref={dialogRef}
            role="dialog"
          >
            <div className="source-dialog__header">
              <div>
                <strong id="source-dialog-heading">Source evidence</strong>
                <span>
                  {selectedSourceFact?.source.documentId.startsWith("demo_")
                    ? "Synthetic demonstration"
                    : "Digitised excerpt from the uploaded file"}
                </span>
              </div>
              <button
                aria-label="Close source"
                className="icon-button"
                onClick={() => setSourceFactId(null)}
                ref={closeButtonRef}
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <SourceDocument fact={selectedSourceFact} selectedFactId={sourceFactId} />
          </section>
        </div>
      ) : null}
    </main>
  );
}
