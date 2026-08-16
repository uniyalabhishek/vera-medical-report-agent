import { describe, expect, it } from "vitest";
import { supportedLanguages } from "@/lib/contracts";
import {
  formatAppDate,
  getMessages,
  languageMeta,
  message,
  type AppLanguage,
} from "@/lib/i18n";

const scriptPatterns: Record<Exclude<AppLanguage, "English">, RegExp> = {
  Hindi: /[\u0900-\u097f]/u,
  Tamil: /[\u0b80-\u0bff]/u,
  Kannada: /[\u0c80-\u0cff]/u,
  Marathi: /[\u0900-\u097f]/u,
};

const criticalKeys = [
  "aboutTitle",
  "nameLabel",
  "symptomsLabel",
  "historyLabel",
  "documentsTitle",
  "addReport",
  "processingTitle",
  "automaticRetrying",
  "analysisSavedFailed",
  "savedFileStillHere",
  "analyseDocuments",
  "continueReading",
  "summaryTitle",
  "pictureTitle",
  "whereNumbersSit",
  "sourceDialogTitle",
  "questionsKicker",
  "recordQuestion",
  "speakSymptoms",
  "listen",
  "medicalBoundaryShort",
] as const;

describe("localized user flow", () => {
  it("has the same complete, non-empty message set in every supported language", () => {
    const englishKeys = Object.keys(getMessages("English")).sort();

    for (const language of supportedLanguages) {
      const table = getMessages(language);
      expect(Object.keys(table).sort()).toEqual(englishKeys);
      expect(Object.values(table).every((value) => value.trim().length > 0)).toBe(true);
    }
  });

  it("localizes every critical screen and voice state into the selected script", () => {
    for (const language of supportedLanguages) {
      if (language === "English") continue;
      for (const key of criticalKeys) {
        expect(getMessages(language)[key]).toMatch(scriptPatterns[language]);
        expect(getMessages(language)[key]).not.toBe(getMessages("English")[key]);
      }
    }
  });

  it("keeps technical provider terms out of the primary document copy", () => {
    for (const language of supportedLanguages) {
      expect(getMessages(language).documentsBody).not.toMatch(
        /provider|de-identified|\bocr\b|transcript/iu,
      );
      for (const key of [
        "analysisSavedFailed",
        "savedFileStillHere",
        "automaticRetrying",
      ] as const) {
        expect(getMessages(language)[key]).not.toMatch(
          /provider|error code|chunk|\bocr\b/iu,
        );
      }
    }
  });

  it("uses simple recovery actions without count-dependent grammar", () => {
    expect(getMessages("English")).toMatchObject({
      analyseDocuments: "Explain these reports",
      continueReading: "Continue reading",
      retry: "Try again",
      analysisSavedFailed: "Vera couldn’t finish reading this report.",
      savedFileStillHere: "Your file is still here. You do not need to upload it again.",
    });

    for (const language of supportedLanguages) {
      expect(getMessages(language).analyseDocuments).not.toContain("{count}");
    }
  });

  it("formats placeholders and dates with the selected locale", () => {
    expect(message("Hindi", "stepOf", { current: 2, total: 4, name: "रिपोर्ट" }))
      .toBe("चरण 2/4: रिपोर्ट");
    expect(formatAppDate("Hindi", "2025-01-12")).not.toContain("Jan");
    expect(languageMeta.Tamil.locale).toBe("ta-IN");
  });
});
