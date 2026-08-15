const steps = ["About you", "Your documents", "Your summary", "Follow-up questions"] as const;

export function ProgressStepper({ activeStep }: { activeStep: 1 | 2 | 3 | 4 }) {
  return (
    <nav className="stepper" aria-label="Analysis progress">
      <span className="stepper__mobile-status">
        Step {activeStep} of {steps.length} · {steps[activeStep - 1]}
      </span>
      {steps.map((step, index) => {
        const number = index + 1;
        const complete = number < activeStep;
        const active = number === activeStep;
        return (
          <div
            className={`stepper__item ${complete ? "is-complete" : ""} ${active ? "is-active" : ""}`}
            key={step}
            aria-current={active ? "step" : undefined}
          >
            <div className="stepper__rail" aria-hidden="true">
              <span className="stepper__number">{number}</span>
              {number < steps.length ? <span className="stepper__line" /> : null}
            </div>
            <span className="stepper__label">{step}</span>
          </div>
        );
      })}
    </nav>
  );
}
