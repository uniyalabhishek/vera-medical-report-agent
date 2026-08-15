import type { Fact, ObservationFact } from "@/lib/contracts";

export type VisualConcept =
  | "average-blood-glucose"
  | "blood-glucose"
  | "red-blood-cells"
  | "white-blood-cells"
  | "platelets"
  | "blood-lipids"
  | "liver-marker"
  | "kidney-filtration"
  | "thyroid-hormone"
  | "vitamin-nutrient"
  | "inflammation"
  | "blood-marker";

export type VisualSpec = {
  factId: string;
  concept: VisualConcept;
  scene: string;
  emphasis: string;
};

const CONCEPTS: Array<{
  concept: VisualConcept;
  pattern: RegExp;
  scene: string;
}> = [
  {
    concept: "average-blood-glucose",
    pattern: /(?:hba1c|a1c|glycated\s*h(?:a?e)?moglobin)/iu,
    scene: "red blood cells moving gently through a translucent blood vessel, with small soft-gold glucose particles attaching to some cells to explain average blood glucose over time",
  },
  {
    concept: "blood-glucose",
    pattern: /(?:glucose|blood\s*sugar|fasting\s*sugar|postprandial|ppbs|fbs)/iu,
    scene: "red blood cells and small soft-gold glucose particles moving together through a translucent blood vessel to explain glucose circulating in blood",
  },
  {
    concept: "red-blood-cells",
    pattern: /(?:h(?:a?e)?moglobin|red\s*blood|rbc|packed\s*cell|hematocrit|haematocrit|mcv|mch|iron|ferritin)/iu,
    scene: "soft red blood cells carrying small pale-blue oxygen spheres through a translucent blood vessel to explain oxygen transport",
  },
  {
    concept: "white-blood-cells",
    pattern: /(?:white\s*blood|wbc|leucocyte|leukocyte|neutrophil|lymphocyte|eosinophil|monocyte|basophil)/iu,
    scene: "a small group of rounded white blood cells among red blood cells in a translucent vessel to explain the immune-cell part of blood",
  },
  {
    concept: "platelets",
    pattern: /(?:platelet|thrombocyte)/iu,
    scene: "small rounded platelets gathering gently beside red blood cells inside a translucent blood vessel to explain their role in clot formation",
  },
  {
    concept: "blood-lipids",
    pattern: /(?:cholesterol|triglyceride|\bhdl\b|\bldl\b|\bvldl\b|lipid)/iu,
    scene: "small smooth lipid particles travelling freely beside red blood cells in a wide translucent vessel, with no blockage or damaged artery",
  },
  {
    concept: "liver-marker",
    pattern: /(?:(?<![\p{L}\p{N}])(?:alt|ast|sgpt|sgot)(?![\p{L}\p{N}])|bilirubin|alkaline\s*phosphatase|albumin|liver)/iu,
    scene: "a calm simplified liver beside a translucent blood vessel, connected only by a soft flowing ribbon to explain that this blood marker relates to liver function",
  },
  {
    concept: "kidney-filtration",
    pattern: /(?:creatinine|egfr|urea|bun|kidney|renal)/iu,
    scene: "two calm simplified kidneys filtering a gentle stream of small particles from blood into clear fluid, with no damage or disease",
  },
  {
    concept: "thyroid-hormone",
    pattern: /(?:thyroid|\btsh\b|\bt3\b|\bt4\b|thyroxine)/iu,
    scene: "a calm simplified thyroid shape releasing a few soft messenger particles into a translucent blood vessel",
  },
  {
    concept: "vitamin-nutrient",
    pattern: /(?:vitamin|folate|folic|b12|25-oh|nutrient)/iu,
    scene: "small softly glowing nutrient particles moving through a translucent blood vessel toward healthy rounded body cells",
  },
  {
    concept: "inflammation",
    pattern: /(?:crp|c-reactive|esr|inflammation)/iu,
    scene: "a calm whole-body circulation concept with a few warm messenger particles moving through a translucent blood vessel, without showing injury or a diseased organ",
  },
];

function safeDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return 0;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function selectVisualObservation(facts: Fact[]) {
  return facts
    .filter((fact): fact is ObservationFact =>
      fact.kind === "observation" && fact.confirmed && !fact.needsReview
    )
    .map((fact, index) => ({ fact, index }))
    .sort((left, right) => {
      const priority = (fact: ObservationFact) =>
        fact.flag === "high" || fact.flag === "low" ? 0 : fact.flag === "normal" ? 1 : 2;
      return safeDate(right.fact.effectiveDate) - safeDate(left.fact.effectiveDate) ||
        priority(left.fact) - priority(right.fact) ||
        left.index - right.index;
    })[0]?.fact ?? null;
}

export function buildVisualSpec(fact: ObservationFact): VisualSpec {
  const matched = CONCEPTS.find((entry) => entry.pattern.test(fact.name));
  const concept = matched ?? {
    concept: "blood-marker" as const,
    scene: "a calm translucent blood vessel with red blood cells and one softly highlighted laboratory marker particle, shown as a general blood-test concept",
  };
  const emphasis = fact.flag === "high"
    ? "Use a slightly greater visual presence for the marker concept, without implying severity or damage."
    : fact.flag === "low"
      ? "Use a slightly reduced visual presence for the marker concept, without implying severity or damage."
      : "Use a balanced, neutral visual presence for the marker concept.";

  return {
    factId: fact.id,
    concept: concept.concept,
    scene: concept.scene,
    emphasis,
  };
}
