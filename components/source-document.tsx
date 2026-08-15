import type { Fact } from "@/lib/contracts";

type SourceDocumentProps = {
  fact?: Fact;
  selectedFactId?: string;
  compact?: boolean;
};

function isSelected(selectedFactId: string | undefined, ids: string[]) {
  return selectedFactId ? ids.includes(selectedFactId) : false;
}

export function SourceDocument({ fact, selectedFactId, compact = false }: SourceDocumentProps) {
  const activeFactId = fact?.id ?? selectedFactId;
  const isSynthetic = !fact || fact.source.documentId.startsWith("demo_");

  if (fact && !isSynthetic) {
    return (
      <div className={`source-document ${compact ? "source-document--compact" : ""}`}>
        <div className="source-document__paper source-document__paper--ocr">
          <div className="source-document__masthead source-document__masthead--ocr">
            <div className="source-document__labmark" aria-hidden="true">+</div>
            <div>
              <strong>{fact.source.documentName}</strong>
              <span>Digitised source · page {fact.source.page}</span>
            </div>
          </div>
          <div className="source-document__ocr-note">
            This is the exact OCR excerpt used for this fact. Check it against your original file.
          </div>
          <blockquote className="source-document__excerpt">{fact.source.excerpt}</blockquote>
          <dl className="source-document__fact-summary">
            <div>
              <dt>Extracted detail</dt>
              <dd>
                {fact.kind === "observation"
                  ? `${fact.name}: ${fact.value} ${fact.unit}`.trim()
                  : `${fact.medicine} ${fact.dose} · ${fact.frequency} · ${fact.duration}`}
              </dd>
            </div>
            <div><dt>Location</dt><dd>Page {fact.source.page}</dd></div>
          </dl>
        </div>
      </div>
    );
  }

  const pastReport = activeFactId === "fact_hba1c_past";
  const prescription = activeFactId === "fact_metformin";

  return (
    <div className={`source-document ${compact ? "source-document--compact" : ""}`}>
      <div className="source-document__paper">
        <div className="source-document__masthead">
          <div className="source-document__labmark" aria-hidden="true">+</div>
          <div>
            <strong>{prescription ? "CITYCARE CLINIC" : "CITYCARE DIAGNOSTICS"}</strong>
            <span>{prescription ? "Synthetic demonstration prescription" : "Synthetic demonstration report"}</span>
          </div>
          <dl>
            <div><dt>Patient</dt><dd>Demo patient</dd></div>
            <div><dt>Date</dt><dd>{pastReport ? "15 May 2026" : "08 Aug 2026"}</dd></div>
          </dl>
        </div>

        {prescription ? (
          <>
            <h3>Prescription</h3>
            <div
              className={`source-document__instruction ${isSelected(activeFactId, ["fact_metformin"]) ? "is-highlighted" : ""}`}
            >
              <strong>Metformin 500 mg</strong>
              <span>After dinner · 30 days</span>
            </div>
          </>
        ) : (
          <>
            <h3>Laboratory report</h3>
            <div className="source-document__table" role="table" aria-label="Synthetic laboratory report">
              <div className="source-document__row source-document__row--head" role="row">
                <span>Test</span><span>Result</span><span>Unit</span><span>Reference range</span>
              </div>
              <div
                className={`source-document__row ${isSelected(activeFactId, ["fact_hba1c_current", "fact_hba1c_past"]) ? "is-highlighted" : ""}`}
                role="row"
              >
                <span>HbA1c</span><span>{pastReport ? "6.8" : "7.2"}</span><span>%</span><span>4.0–5.6</span>
              </div>
              {!pastReport ? (
                <div
                  className={`source-document__row ${isSelected(activeFactId, ["fact_haemoglobin"]) ? "is-highlighted" : ""}`}
                  role="row"
                >
                  <span>Haemoglobin</span><span>11.4</span><span>g/dL</span><span>12.0–15.0</span>
                </div>
              ) : null}
              <div className="source-document__ghost-row" />
              <div className="source-document__ghost-row source-document__ghost-row--short" />
            </div>
          </>
        )}
        <div className="source-document__signature" aria-hidden="true">
          <span>Demo clinician</span>
          <small>Synthetic source</small>
        </div>
      </div>
    </div>
  );
}

export function sourceLabel(fact: Fact) {
  return `${fact.source.documentName} · page ${fact.source.page}`;
}
