import "server-only";

import { demoProvider } from "@/lib/model/demo-provider";
import { liveProvider, liveProviderConfigured } from "@/lib/model/live-provider";
import type { MedicalReportProvider } from "@/lib/model/provider";
import { ProviderConfigurationError } from "@/lib/model/provider";
import { sarvamSpeechReady } from "@/lib/server/sarvam-speech";

export function getProviderCapabilities() {
  const speechReady = sarvamSpeechReady();
  return {
    liveAnalysis: liveProviderConfigured(),
    speechInput: speechReady,
    speechOutput: speechReady,
  };
}

export function getProvider(mode: "demo" | "uploaded"): MedicalReportProvider {
  if (mode === "demo") {
    return demoProvider;
  }

  if (liveProviderConfigured()) {
    return liveProvider;
  }

  throw new ProviderConfigurationError(
    "Live report analysis needs both approved OpenAI and Sarvam credentials.",
  );
}
