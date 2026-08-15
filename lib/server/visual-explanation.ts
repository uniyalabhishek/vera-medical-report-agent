import "server-only";

import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { ProviderConfigurationError, ProviderProcessingError } from "@/lib/model/provider";
import type { VisualSpec } from "@/lib/visual-explanation";

const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-2";
const VALIDATION_MODEL = process.env.OPENAI_IMAGE_VALIDATION_MODEL?.trim() ||
  process.env.OPENAI_SYNTHESIS_MODEL?.trim() ||
  "gpt-5.6-terra";
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

const VisualValidationSchema = z.object({
  passed: z.boolean(),
  issues: z.array(z.string().max(200)).max(8),
});

let client: OpenAI | null = null;

function getClient() {
  if (client) return client;
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new ProviderConfigurationError("The visual explanation service is not configured.");
  }
  client = new OpenAI({ apiKey, maxRetries: 0, timeout: 150_000 });
  return client;
}

export function buildVisualPrompt(spec: VisualSpec) {
  return [
    "Create one square patient-education medical illustration.",
    "The image is a calm visual explanation of what a blood-test marker represents in the body. It is not a diagnosis and not a scan of this patient.",
    `Scene: ${spec.scene}.`,
    spec.emphasis,
    "Use a warm editorial medical-illustration style with softly dimensional rounded forms, an ivory paper background, sage green, muted amber, soft coral, and pale blue.",
    "Keep the composition spacious, gentle, easy to understand, and suitable for a person with low health literacy.",
    "Show only the allowed biological concept. Do not add a second disease, cause, treatment, medicine, food, exercise, doctor, patient, or before-and-after outcome.",
    "Do not show pain, injury, needles, blood splashes, blocked vessels, damaged organs, frightening anatomy, warning symbols, or alarming red.",
    "Do not include any text, letters, words, numbers, labels, captions, logos, watermarks, charts, arrows, or interface elements. The app will add exact localized facts separately.",
  ].join(" ");
}

function decodeJpeg(value: string | undefined) {
  const compact = value?.replace(/\s+/gu, "") ?? "";
  if (
    !compact ||
    compact.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(compact)
  ) {
    throw new ProviderProcessingError("The visual explanation could not be created.");
  }

  const bytes = Buffer.from(compact, "base64");
  if (
    bytes.byteLength < 4 ||
    bytes.byteLength > MAX_IMAGE_BYTES ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[2] !== 0xff
  ) {
    throw new ProviderProcessingError("The visual explanation could not be created.");
  }
  return bytes;
}

function rethrowSanitized(error: unknown): never {
  if (
    error instanceof ProviderConfigurationError ||
    error instanceof ProviderProcessingError
  ) {
    throw error;
  }
  const providerErrorName = error instanceof Error ? error.name : "UnknownError";
  console.error(`Visual explanation provider failed: ${providerErrorName}`);
  throw new ProviderProcessingError(
    "The visual explanation could not be created safely. Please try again.",
  );
}

async function validateVisual(openai: OpenAI, spec: VisualSpec, imageBase64: string) {
  const response = await openai.responses.parse({
    model: VALIDATION_MODEL,
    reasoning: { effort: "low" },
    store: false,
    max_output_tokens: 600,
    instructions: [
      "You are the final validator for a patient-facing medical illustration.",
      "Pass only if the image clearly matches the allowed scene and remains a neutral educational concept.",
      "Fail if it contains any text, letters, numbers, watermark, diagnosis, named disease, treatment, medicine, advice, damaged organ, blocked vessel, injury, pain, warning symbol, alarming imagery, or a different biological concept.",
      "Do not repair the image. Return only the validation result.",
    ].join(" "),
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify({
              allowedScene: spec.scene,
              allowedEmphasis: spec.emphasis,
            }),
          },
          {
            type: "input_image",
            detail: "low",
            image_url: `data:image/jpeg;base64,${imageBase64}`,
          },
        ],
      },
    ],
    text: { format: zodTextFormat(VisualValidationSchema, "medical_visual_validation") },
  });

  if (!response.output_parsed?.passed) {
    throw new ProviderProcessingError("The visual explanation did not pass its final check.");
  }
}

export async function generateVisualExplanation(spec: VisualSpec) {
  try {
    const openai = getClient();
    const result = await openai.images.generate({
      model: IMAGE_MODEL,
      prompt: buildVisualPrompt(spec),
      n: 1,
      size: "1024x1024",
      quality: "medium",
      output_format: "jpeg",
      output_compression: 88,
      background: "opaque",
    });
    const imageBase64 = result.data?.[0]?.b64_json;
    const bytes = decodeJpeg(imageBase64);
    await validateVisual(openai, spec, imageBase64!);
    return bytes;
  } catch (error) {
    rethrowSanitized(error);
  }
}
