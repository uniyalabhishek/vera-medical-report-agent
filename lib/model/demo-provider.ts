import type {
  Analysis,
  Fact,
  MedicationFact,
  ObservationFact,
  QuestionResponse,
} from "@/lib/contracts";
import type {
  ExtractionInput,
  MedicalReportProvider,
  QuestionInput,
  SynthesisInput,
} from "@/lib/model/provider";
import { ProviderConfigurationError } from "@/lib/model/provider";

const bloodSource = {
  documentId: "demo_blood_report",
  documentName: "Blood report",
  page: 1,
} as const;

const prescriptionSource = {
  documentId: "demo_prescription",
  documentName: "Prescription",
  page: 1,
} as const;

function createDemoFacts(): Fact[] {
  return [
    {
      id: "fact_hba1c_current",
      kind: "observation",
      name: "HbA1c",
      value: "7.2",
      unit: "%",
      referenceRange: "4.0–5.6",
      flag: "high",
      effectiveDate: "2026-08-08",
      confirmed: false,
      needsReview: false,
      source: {
        ...bloodSource,
        id: "span_hba1c_current",
        excerpt: "HbA1c  7.2  %  4.0–5.6  H",
        bbox: [0.08, 0.36, 0.92, 0.43],
      },
    },
    {
      id: "fact_haemoglobin",
      kind: "observation",
      name: "Haemoglobin",
      value: "11.4",
      unit: "g/dL",
      referenceRange: "12.0–15.0",
      flag: "low",
      effectiveDate: "2026-08-08",
      confirmed: false,
      needsReview: false,
      source: {
        ...bloodSource,
        id: "span_haemoglobin",
        excerpt: "Haemoglobin  11.4  g/dL  12.0–15.0  L",
        bbox: [0.08, 0.44, 0.92, 0.51],
      },
    },
    {
      id: "fact_hba1c_past",
      kind: "observation",
      name: "HbA1c",
      value: "6.8",
      unit: "%",
      referenceRange: "4.0–5.6",
      flag: "high",
      effectiveDate: "2026-05-15",
      confirmed: false,
      needsReview: false,
      source: {
        documentId: "demo_blood_report_past",
        documentName: "Past blood report",
        page: 1,
        id: "span_hba1c_past",
        excerpt: "HbA1c  6.8  %  4.0–5.6  H",
        bbox: [0.08, 0.36, 0.92, 0.43],
      },
    },
    {
      id: "fact_metformin",
      kind: "medication",
      medicine: "Metformin",
      dose: "500 mg",
      frequency: "after dinner",
      duration: "30 days",
      confirmed: false,
      needsReview: true,
      source: {
        ...prescriptionSource,
        id: "span_metformin",
        excerpt: "Metformin 500 mg · after dinner · 30 days",
        bbox: [0.08, 0.62, 0.92, 0.69],
      },
    },
  ];
}

function findObservation(facts: Fact[], id: string): ObservationFact {
  const fact = facts.find((candidate) => candidate.id === id);
  if (!fact || fact.kind !== "observation") {
    throw new Error(`Missing confirmed observation: ${id}`);
  }
  return fact;
}

function findMedication(facts: Fact[], id: string): MedicationFact {
  const fact = facts.find((candidate) => candidate.id === id);
  if (!fact || fact.kind !== "medication") {
    throw new Error(`Missing confirmed medication: ${id}`);
  }
  return fact;
}

function citation(fact: Fact) {
  return {
    sourceSpanId: fact.source.id,
    label: `${fact.source.documentName} · page ${fact.source.page}`,
  };
}

export class DemoMedicalReportProvider implements MedicalReportProvider {
  readonly mode = "demo" as const;

  async extract(input: ExtractionInput): Promise<Fact[]> {
    if (input.mode !== "demo") {
      throw new ProviderConfigurationError(
        "Live document extraction needs approved OpenAI and Sarvam credentials. The uploaded file was not analysed.",
      );
    }

    return createDemoFacts();
  }

  async synthesize(input: SynthesisInput): Promise<Analysis> {
    if (input.facts.some((fact) => !fact.confirmed)) {
      throw new Error("All critical facts must be confirmed before synthesis.");
    }

    const current = findObservation(input.facts, "fact_hba1c_current");
    const previous = findObservation(input.facts, "fact_hba1c_past");
    const haemoglobin = findObservation(input.facts, "fact_haemoglobin");
    const medicine = findMedication(input.facts, "fact_metformin");

    return {
      providerMode: "demo",
      checkedDocumentCount: 3,
      generatedAt: new Date().toISOString(),
      cards: [
        {
          id: "documents",
          title: "1. What these documents cover",
          body: "Two blood reports and one current prescription were reviewed.",
          citations: [citation(current), citation(previous), citation(medicine)],
        },
        {
          id: "findings",
          title: "2. Important findings in the reports",
          body: `The current report marks HbA1c ${current.value}${current.unit} as high and haemoglobin ${haemoglobin.value} ${haemoglobin.unit} as low, using the ranges printed by the laboratory.`,
          citations: [citation(current), citation(haemoglobin)],
        },
        {
          id: "changes",
          title: "3. What changed over time",
          body: `HbA1c changed from ${previous.value}${previous.unit} on 15 May 2026 to ${current.value}${current.unit} on 8 August 2026. The reports do not state the reason for the change.`,
          citations: [citation(previous), citation(current)],
        },
        {
          id: "instructions",
          title: "4. Your doctor’s written instructions",
          body: `${medicine.medicine} ${medicine.dose}, ${medicine.frequency}, for ${medicine.duration}. This is a restatement of the uploaded prescription.`,
          citations: [citation(medicine)],
        },
        {
          id: "questions",
          title: "5. Questions for your next visit",
          body: "What could have affected these results? When should the tests be checked again?",
          citations: [],
        },
      ],
      suggestedQuestions: [
        "What could have affected this result?",
        "When should this test be checked again?",
      ],
    };
  }

  async answer(input: QuestionInput): Promise<QuestionResponse> {
    const normalized = input.question.toLowerCase();
    const current = findObservation(input.facts, "fact_hba1c_current");
    const medicine = findMedication(input.facts, "fact_metformin");

    if (/stop|change|increase|decrease|should i take|missed dose/.test(normalized)) {
      return {
        answerType: "boundary",
        answer: `The prescription says ${medicine.medicine} ${medicine.dose}, ${medicine.frequency}, for ${medicine.duration}. I cannot tell you to change or stop it.`,
        citations: [citation(medicine)],
        doctorQuestion: "Should I continue this medicine exactly as written until my next review?",
      };
    }

    if (/cause|caused|affected|why/.test(normalized)) {
      return {
        answerType: "cannot_determine",
        answer: `The report marks HbA1c as high at ${current.value}${current.unit}. It does not state the cause.`,
        citations: [citation(current)],
        doctorQuestion: "What may have affected this result?",
      };
    }

    if (/hba1c|high|result|range/.test(normalized)) {
      return {
        answerType: "document_fact",
        answer: `The report records HbA1c as ${current.value}${current.unit} and prints a reference range of ${current.referenceRange}${current.unit}. It marks the result high.`,
        citations: [citation(current)],
      };
    }

    return {
      answerType: "cannot_determine",
      answer: "These documents do not contain enough information to answer that safely.",
      citations: [],
      doctorQuestion: "Could you help me understand this in the context of my health history?",
    };
  }
}

export const demoProvider = new DemoMedicalReportProvider();

