"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, ExternalLink } from "lucide-react";
import type { Fact, MedicationFact, ObservationFact } from "@/lib/contracts";
import { SourceDocument, sourceLabel } from "@/components/source-document";

type ReviewStepProps = {
  facts: Fact[];
  busy: boolean;
  error: string | null;
  onFactsChange: (facts: Fact[]) => void;
  onConfirm: () => void;
  onBack: () => void;
};

function ReviewCheckbox({
  fact,
  onToggle,
}: {
  fact: Fact;
  onToggle: () => void;
}) {
  return (
    <label className="review-check">
      <input checked={fact.confirmed} onChange={onToggle} type="checkbox" />
      <span aria-hidden="true" />
      <span className="sr-only">Confirm {fact.kind === "observation" ? fact.name : fact.medicine}</span>
    </label>
  );
}

function Flag({ fact }: { fact: ObservationFact }) {
  if (fact.flag === "not_provided") return <span className="status-text" data-label="Status">Not provided</span>;
  return (
    <span className={`status-text status-text--${fact.flag}`} data-label="Status">
      Marked {fact.flag} in report
    </span>
  );
}

export function ReviewStep({ facts, busy, error, onFactsChange, onConfirm, onBack }: ReviewStepProps) {
  const [selectedFactId, setSelectedFactId] = useState(facts[0]?.id);
  const observations = useMemo(
    () => facts.filter((fact): fact is ObservationFact => fact.kind === "observation"),
    [facts],
  );
  const medications = useMemo(
    () => facts.filter((fact): fact is MedicationFact => fact.kind === "medication"),
    [facts],
  );
  const allConfirmed = facts.length > 0 && facts.every((fact) => fact.confirmed);
  const selected = facts.find((fact) => fact.id === selectedFactId) ?? facts[0];

  const toggleFact = (factId: string) => {
    onFactsChange(
      facts.map((fact) =>
        fact.id === factId ? { ...fact, confirmed: !fact.confirmed } : fact,
      ),
    );
  };

  return (
    <main className="page-content page-content--review motion-enter">
      <div className="review-layout">
        <section className="review-main">
          <div className="page-heading page-heading--review">
            <h1>Review the details we found</h1>
            <p>
              Please check the highlighted details. We won’t explain the reports until the
              important information is confirmed.
            </p>
          </div>

          <section className="review-section" aria-labelledby="report-details-heading">
            <h2 id="report-details-heading">Report details</h2>
            <div className="report-summary-row">
              <span>Selected source</span>
              <strong>{selected ? sourceLabel(selected) : "Synthetic reports"}</strong>
              <button
                className="source-button"
                onClick={() => selected && setSelectedFactId(selected.id)}
                type="button"
              >
                View source <ExternalLink aria-hidden="true" />
              </button>
            </div>
          </section>

          <section className="review-section" aria-labelledby="results-heading">
            <h2 id="results-heading">Results</h2>
            <div className="review-table review-table--results" role="table">
              <div className="review-table__head" role="row">
                <span>Test</span><span>Your result</span><span>Unit</span><span>Reference range</span>
                <span>Status</span><span>Source</span><span>Confirmed</span>
              </div>
              {observations.map((fact) => (
                <div
                  className={`review-table__row ${selectedFactId === fact.id ? "is-selected" : ""}`}
                  key={fact.id}
                  role="row"
                >
                  <strong>{fact.name}</strong>
                  <span className="readonly-value" data-label="Result">{fact.value}</span>
                  <span data-label="Unit">{fact.unit}</span>
                  <span data-label="Report range">{fact.referenceRange}</span>
                  <Flag fact={fact} />
                  <button
                    aria-label={`View source for ${fact.name}`}
                    className="icon-button"
                    onClick={() => setSelectedFactId(fact.id)}
                    type="button"
                  >
                    <ExternalLink aria-hidden="true" />
                  </button>
                  <ReviewCheckbox fact={fact} onToggle={() => toggleFact(fact.id)} />
                </div>
              ))}
            </div>
          </section>

          <section className="review-section" aria-labelledby="instructions-heading">
            <h2 id="instructions-heading">Doctor’s instructions</h2>
            <div className="review-table review-table--medication" role="table">
              <div className="review-table__head" role="row">
                <span>Medication</span><span>Frequency</span><span>Duration</span><span>Source</span><span>Confirmed</span>
              </div>
              {medications.map((fact) => (
                <div
                  className={`review-table__row ${selectedFactId === fact.id ? "is-selected" : ""}`}
                  key={fact.id}
                  role="row"
                >
                  <strong>{fact.medicine} {fact.dose}</strong>
                  <span
                    className={fact.needsReview ? "readonly-value readonly-value--review" : "readonly-value"}
                    data-label="Frequency"
                  >
                    {fact.frequency}
                  </span>
                  <span data-label="Duration">{fact.duration}</span>
                  <button
                    aria-label={`View source for ${fact.medicine}`}
                    className="icon-button"
                    onClick={() => setSelectedFactId(fact.id)}
                    type="button"
                  >
                    <ExternalLink aria-hidden="true" />
                  </button>
                  <ReviewCheckbox fact={fact} onToggle={() => toggleFact(fact.id)} />
                </div>
              ))}
            </div>
            <p className="review-help">
              If a value does not match the source, do not confirm it. A correction flow will be
              added with the live extraction provider.
            </p>
          </section>
        </section>

        <aside className="source-rail" aria-label="Source document preview">
          <div className="source-rail__heading">
            <h2>Source document</h2>
            <p>{selected ? sourceLabel(selected) : "Synthetic reports"}</p>
          </div>
          <SourceDocument fact={selected} selectedFactId={selectedFactId} />
        </aside>
      </div>

      {error ? <div className="inline-alert" role="alert">{error}</div> : null}

      <div className="bottom-action bottom-action--review">
        <button className="button button--back" disabled={busy} onClick={onBack} type="button">
          <ArrowLeft aria-hidden="true" /> Back
        </button>
        <button
          className="button button--primary button--wide"
          disabled={!allConfirmed || busy}
          onClick={onConfirm}
          type="button"
        >
          {busy ? "Checking claims…" : "Confirm all checked details"}
          {!busy ? <ArrowRight aria-hidden="true" /> : <span className="spinner" aria-hidden="true" />}
        </button>
      </div>
    </main>
  );
}
