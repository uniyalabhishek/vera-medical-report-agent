import { describe, expect, it } from "vitest";
import { cleanCitationLabel, cleanDisplayText } from "@/lib/display-text";

describe("cleanDisplayText", () => {
  it("removes internal source IDs and their empty wrapper", () => {
    const first = "span_22e9181d-d0e8-4c88-97a7-a2a2a1f0828f";
    const second = "span_ab4ed2c1-351b-4b54-a3c7-e734cfaf11b9";

    expect(cleanDisplayText(`**रिपोर्ट की जाँच हुई।** [${first}, ${second}]`)).toBe(
      "रिपोर्ट की जाँच हुई।",
    );
  });

  it("turns machine-style upload names into readable citation labels", () => {
    expect(
      cleanCitationLabel(
        "e8bb8dc3-6461-4bc4-b96b-666fb1c043b2_TC-01__Uncontrolled_Type_2_Diabetes_with_early_complications_(Hindi).pdf · page 2",
      ),
    ).toBe("Uncontrolled Type 2 Diabetes with early compl… · page 2");
  });
});
