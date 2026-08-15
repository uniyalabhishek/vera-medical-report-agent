import type { Intake } from "@/lib/contracts";
import { getMessages } from "@/lib/i18n";

export function ProgressStepper({
  activeStep,
  language,
}: {
  activeStep: 1 | 2 | 3 | 4;
  language: Intake["language"];
}) {
  const copy = getMessages(language);
  const steps = [copy.stepAbout, copy.stepDocuments, copy.stepSummary, copy.stepQuestions];
  return (
    <nav className="progress-bars" aria-label={copy.progressAria}>
      {steps.map((step, index) => {
        const number = index + 1;
        return (
          <span
            className={number <= activeStep ? "is-filled" : ""}
            key={step}
            aria-current={number === activeStep ? "step" : undefined}
          ><span className="sr-only">{step}</span></span>
        );
      })}
    </nav>
  );
}
