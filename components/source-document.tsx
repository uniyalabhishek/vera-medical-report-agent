import { ExternalLink } from "lucide-react";
import type { Fact, Intake } from "@/lib/contracts";
import { getMessages, message } from "@/lib/i18n";

type SourceDocumentProps = {
  caseId?: string;
  fact?: Fact;
  compact?: boolean;
  language?: Intake["language"];
};

export function SourceDocument({
  caseId,
  fact,
  compact = false,
  language = "English",
}: SourceDocumentProps) {
  const copy = getMessages(language);
  if (!fact) return null;

  const isSynthetic = fact.source.documentId.startsWith("demo_");
  const sourceUrl = caseId && !isSynthetic
    ? `/api/cases/${encodeURIComponent(caseId)}/uploads/${encodeURIComponent(fact.source.documentId)}`
    : null;
  return (
    <div className={`source-document ${compact ? "source-document--compact" : ""}`}>
      {sourceUrl ? (
        <div className="source-document__original">
          <iframe
            src={`${sourceUrl}#page=${fact.source.page}&view=FitH`}
            title={`${copy.sourceOriginal}: ${fact.source.documentName}`}
          />
          <a href={sourceUrl} rel="noreferrer" target="_blank">
            {copy.openOriginal} <ExternalLink aria-hidden="true" />
          </a>
        </div>
      ) : null}

      <div className="source-document__paper source-document__paper--ocr">
        <div className="source-document__masthead source-document__masthead--ocr">
          <div className="source-document__labmark" aria-hidden="true">+</div>
          <div>
            <strong>{fact.source.documentName}</strong>
            <span>{message(language, "page", { page: fact.source.page })}</span>
          </div>
        </div>
        <div className="source-document__ocr-note">
          {isSynthetic ? copy.sampleSourceHelp : copy.sourceHelp}
        </div>
        <h3>{copy.sourceExcerpt}</h3>
        <blockquote className="source-document__excerpt">{fact.source.excerpt}</blockquote>
      </div>
    </div>
  );
}
