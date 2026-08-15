import type {
  Analysis,
  Fact,
  Intake,
  MedicationFact,
  ObservationFact,
  QuestionResponse,
} from "@/lib/contracts";
import { formatAppDate } from "@/lib/i18n";
import { parseMedicalRange } from "@/lib/medical-range";
import type {
  ExtractionInput,
  MedicalReportProvider,
  QuestionInput,
  SynthesisInput,
} from "@/lib/model/provider";
import { ProviderConfigurationError } from "@/lib/model/provider";

type Language = Intake["language"];

type DemoCopy = {
  bloodReport: string;
  pastBloodReport: string;
  prescription: string;
  page: string;
  titles: [string, string, string, string, string];
  documents: string;
  findings: (hba1c: string, haemoglobin: string) => string;
  changes: (past: string, pastDate: string, current: string, currentDate: string) => string;
  instructions: (medicine: string, dose: string) => string;
  questions: string;
  contextQuestion: (symptoms: string) => string;
  suggestions: [string, string];
  boundary: (medicine: string, dose: string) => string;
  boundaryQuestion: string;
  haemoglobin: (value: string, unit: string, range: string) => string;
  haemoglobinQuestion: string;
  cause: (value: string, unit: string) => string;
  causeQuestion: string;
  hba1c: (value: string, unit: string, range: string) => string;
  unknown: string;
  unknownQuestion: string;
};

const copy: Record<Language, DemoCopy> = {
  English: {
    bloodReport: "Blood report",
    pastBloodReport: "Past blood report",
    prescription: "Prescription",
    page: "page",
    titles: [
      "1. What these files contain",
      "2. Important results in the reports",
      "3. Change shown over time",
      "4. Your doctor's written instructions",
      "5. Questions for your doctor",
    ],
    documents: "These files contain two blood reports and one current prescription.",
    findings: (hba1c, haemoglobin) =>
      `The current report shows HbA1c ${hba1c} above its printed range and haemoglobin ${haemoglobin} below its printed range.`,
    changes: (past, pastDate, current, currentDate) =>
      `HbA1c changed from ${past} on ${pastDate} to ${current} on ${currentDate}. The files do not state why.`,
    instructions: (medicine, dose) =>
      `${medicine} ${dose}, after dinner, for 30 days. This restates the written prescription.`,
    questions: "What could have affected these results? When should the tests be checked again?",
    contextQuestion: (symptoms) => `You mentioned “${symptoms}”. Could it relate to any result shown here?`,
    suggestions: ["What could have affected this result?", "When should this test be checked again?"],
    boundary: (medicine, dose) =>
      `The prescription says ${medicine} ${dose}, after dinner, for 30 days. I cannot tell you to change or stop it.`,
    boundaryQuestion: "Should I continue this medicine exactly as written until my next review?",
    haemoglobin: (value, unit, range) =>
      `The report records haemoglobin as ${value} ${unit}, below its printed range of ${range} ${unit}. It does not state why.`,
    haemoglobinQuestion: "What could be causing the low haemoglobin shown in this report?",
    cause: (value, unit) => `The report shows HbA1c ${value}${unit} above its printed range. It does not state the cause.`,
    causeQuestion: "What may have affected this result?",
    hba1c: (value, unit, range) =>
      `The report records HbA1c as ${value}${unit} and prints a range of ${range}${unit}. The result is above that range.`,
    unknown: "These files do not contain enough information to answer that safely.",
    unknownQuestion: "Could you explain this using my health history?",
  },
  Hindi: {
    bloodReport: "खून की रिपोर्ट",
    pastBloodReport: "पुरानी खून की रिपोर्ट",
    prescription: "डॉक्टर का पर्चा",
    page: "पेज",
    titles: [
      "1. इन फाइलों में क्या है",
      "2. रिपोर्ट के जरूरी नतीजे",
      "3. समय के साथ दिखा बदलाव",
      "4. डॉक्टर की लिखी बात",
      "5. डॉक्टर से पूछने के सवाल",
    ],
    documents: "इन फाइलों में खून की दो रिपोर्ट और डॉक्टर का एक मौजूदा पर्चा है।",
    findings: (hba1c, haemoglobin) =>
      `मौजूदा रिपोर्ट में HbA1c ${hba1c} छपी हुई सीमा से ऊपर और हीमोग्लोबिन ${haemoglobin} छपी हुई सीमा से नीचे है।`,
    changes: (past, pastDate, current, currentDate) =>
      `HbA1c ${pastDate} को ${past} था और ${currentDate} को ${current} है। फाइलों में कारण नहीं लिखा है।`,
    instructions: (medicine, dose) =>
      `${medicine} ${dose}, रात के खाने के बाद, 30 दिन। यह डॉक्टर के पर्चे में लिखी बात है।`,
    questions: "इन नतीजों पर क्या असर पड़ा हो सकता है? जाँच फिर कब करानी चाहिए?",
    contextQuestion: (symptoms) => `आपने “${symptoms}” बताया। क्या इसका संबंध यहाँ दिखे किसी नतीजे से हो सकता है?`,
    suggestions: ["इस नतीजे पर क्या असर पड़ा हो सकता है?", "यह जाँच फिर कब करानी चाहिए?"],
    boundary: (medicine, dose) =>
      `पर्चे में ${medicine} ${dose}, रात के खाने के बाद, 30 दिन लिखा है। मैं इसे बदलने या बंद करने की सलाह नहीं दे सकता।`,
    boundaryQuestion: "क्या अगली जाँच तक दवा पर्चे के अनुसार ही लेनी है?",
    haemoglobin: (value, unit, range) =>
      `रिपोर्ट में हीमोग्लोबिन ${value} ${unit} है, जो छपी सीमा ${range} ${unit} से नीचे है। कारण नहीं लिखा है।`,
    haemoglobinQuestion: "इस रिपोर्ट में हीमोग्लोबिन कम होने का कारण क्या हो सकता है?",
    cause: (value, unit) => `रिपोर्ट में HbA1c ${value}${unit} छपी सीमा से ऊपर है। कारण नहीं लिखा है।`,
    causeQuestion: "इस नतीजे पर क्या असर पड़ा हो सकता है?",
    hba1c: (value, unit, range) =>
      `रिपोर्ट में HbA1c ${value}${unit} और छपी सीमा ${range}${unit} है। नतीजा इस सीमा से ऊपर है।`,
    unknown: "इन फाइलों में इस सवाल का सुरक्षित जवाब देने लायक जानकारी नहीं है।",
    unknownQuestion: "क्या आप मेरी सेहत की पिछली जानकारी के साथ इसे समझा सकते हैं?",
  },
  Tamil: {
    bloodReport: "இரத்த அறிக்கை",
    pastBloodReport: "பழைய இரத்த அறிக்கை",
    prescription: "மருந்துச் சீட்டு",
    page: "பக்கம்",
    titles: [
      "1. இந்தக் கோப்புகளில் உள்ளவை",
      "2. அறிக்கையின் முக்கிய முடிவுகள்",
      "3. காலப்போக்கில் காட்டிய மாற்றம்",
      "4. மருத்துவர் எழுதிய வழிமுறை",
      "5. மருத்துவரிடம் கேட்க வேண்டியவை",
    ],
    documents: "இந்தக் கோப்புகளில் இரண்டு இரத்த அறிக்கைகளும் ஒரு தற்போதைய மருந்துச் சீட்டும் உள்ளன.",
    findings: (hba1c, haemoglobin) =>
      `தற்போதைய அறிக்கையில் HbA1c ${hba1c} அச்சிட்ட வரம்புக்கு மேலும், haemoglobin ${haemoglobin} அச்சிட்ட வரம்புக்குக் கீழும் உள்ளது.`,
    changes: (past, pastDate, current, currentDate) =>
      `HbA1c ${pastDate} அன்று ${past} ஆகவும் ${currentDate} அன்று ${current} ஆகவும் இருந்தது. காரணம் கோப்புகளில் இல்லை.`,
    instructions: (medicine, dose) =>
      `${medicine} ${dose}, இரவு உணவுக்குப் பிறகு, 30 நாட்கள். இது மருந்துச் சீட்டில் எழுதியதை மீண்டும் கூறுகிறது.`,
    questions: "இந்த முடிவை எது பாதித்திருக்கலாம்? பரிசோதனையை மீண்டும் எப்போது செய்ய வேண்டும்?",
    contextQuestion: (symptoms) => `“${symptoms}” என்று கூறினீர்கள். இங்குள்ள எந்த முடிவுடனாவது இதற்குத் தொடர்பு இருக்குமா?`,
    suggestions: ["இந்த முடிவை எது பாதித்திருக்கலாம்?", "இந்தப் பரிசோதனையை மீண்டும் எப்போது செய்ய வேண்டும்?"],
    boundary: (medicine, dose) =>
      `சீட்டில் ${medicine} ${dose}, இரவு உணவுக்குப் பிறகு, 30 நாட்கள் என்று உள்ளது. அதை மாற்றவோ நிறுத்தவோ நான் சொல்ல முடியாது.`,
    boundaryQuestion: "அடுத்த பரிசோதனை வரை இந்த மருந்தை எழுதியபடியே எடுக்க வேண்டுமா?",
    haemoglobin: (value, unit, range) =>
      `அறிக்கையில் haemoglobin ${value} ${unit}; அச்சிட்ட வரம்பு ${range} ${unit}-க்குக் கீழே உள்ளது. காரணம் அறிக்கையில் இல்லை.`,
    haemoglobinQuestion: "இந்த அறிக்கையில் haemoglobin குறைவாக இருப்பதற்குக் காரணம் என்ன?",
    cause: (value, unit) => `அறிக்கையில் HbA1c ${value}${unit} அச்சிட்ட வரம்புக்கு மேல் உள்ளது. காரணம் குறிப்பிடப்படவில்லை.`,
    causeQuestion: "இந்த முடிவை எது பாதித்திருக்கலாம்?",
    hba1c: (value, unit, range) =>
      `அறிக்கையில் HbA1c ${value}${unit}; அச்சிட்ட வரம்பு ${range}${unit}. முடிவு அந்த வரம்புக்கு மேல் உள்ளது.`,
    unknown: "இந்தக் கேள்விக்குப் பாதுகாப்பாக பதில் சொல்லத் தேவையான தகவல் இந்தக் கோப்புகளில் இல்லை.",
    unknownQuestion: "என் உடல்நல வரலாற்றுடன் இதை விளக்க முடியுமா?",
  },
  Kannada: {
    bloodReport: "ರಕ್ತ ವರದಿ",
    pastBloodReport: "ಹಳೆಯ ರಕ್ತ ವರದಿ",
    prescription: "ಔಷಧ ಚೀಟಿ",
    page: "ಪುಟ",
    titles: [
      "1. ಈ ಕಡತಗಳಲ್ಲಿ ಇರುವ ಮಾಹಿತಿ",
      "2. ವರದಿಯ ಮುಖ್ಯ ಫಲಿತಾಂಶಗಳು",
      "3. ಸಮಯದೊಂದಿಗೆ ತೋರಿದ ಬದಲಾವಣೆ",
      "4. ವೈದ್ಯರು ಬರೆದ ಸೂಚನೆ",
      "5. ವೈದ್ಯರಿಗೆ ಕೇಳಬೇಕಾದ ಪ್ರಶ್ನೆಗಳು",
    ],
    documents: "ಈ ಕಡತಗಳಲ್ಲಿ ಎರಡು ರಕ್ತ ವರದಿಗಳು ಮತ್ತು ಒಂದು ಈಗಿನ ಔಷಧ ಚೀಟಿ ಇವೆ.",
    findings: (hba1c, haemoglobin) =>
      `ಈಗಿನ ವರದಿಯಲ್ಲಿ HbA1c ${hba1c} ಮುದ್ರಿತ ಮಿತಿಗಿಂತ ಹೆಚ್ಚು ಮತ್ತು haemoglobin ${haemoglobin} ಮುದ್ರಿತ ಮಿತಿಗಿಂತ ಕಡಿಮೆ ಇದೆ.`,
    changes: (past, pastDate, current, currentDate) =>
      `HbA1c ${pastDate} ರಂದು ${past} ಇತ್ತು ಮತ್ತು ${currentDate} ರಂದು ${current} ಇದೆ. ಕಾರಣ ಕಡತಗಳಲ್ಲಿ ಇಲ್ಲ.`,
    instructions: (medicine, dose) =>
      `${medicine} ${dose}, ರಾತ್ರಿ ಊಟದ ನಂತರ, 30 ದಿನಗಳು. ಇದು ಔಷಧ ಚೀಟಿಯಲ್ಲಿ ಬರೆದಿರುವುದನ್ನು ಮರುಹೇಳುತ್ತದೆ.`,
    questions: "ಈ ಫಲಿತಾಂಶದ ಮೇಲೆ ಏನು ಪರಿಣಾಮ ಬೀರಿರಬಹುದು? ಪರೀಕ್ಷೆಯನ್ನು ಮತ್ತೆ ಯಾವಾಗ ಮಾಡಬೇಕು?",
    contextQuestion: (symptoms) => `ನೀವು “${symptoms}” ಎಂದು ಹೇಳಿದ್ದೀರಿ. ಇದಕ್ಕೆ ಇಲ್ಲಿನ ಯಾವುದಾದರೂ ಫಲಿತಾಂಶದ ಸಂಬಂಧ ಇರಬಹುದೇ?`,
    suggestions: ["ಈ ಫಲಿತಾಂಶದ ಮೇಲೆ ಏನು ಪರಿಣಾಮ ಬೀರಿರಬಹುದು?", "ಈ ಪರೀಕ್ಷೆಯನ್ನು ಮತ್ತೆ ಯಾವಾಗ ಮಾಡಬೇಕು?"],
    boundary: (medicine, dose) =>
      `ಚೀಟಿಯಲ್ಲಿ ${medicine} ${dose}, ರಾತ್ರಿ ಊಟದ ನಂತರ, 30 ದಿನಗಳು ಎಂದು ಇದೆ. ಅದನ್ನು ಬದಲಿಸಲು ಅಥವಾ ನಿಲ್ಲಿಸಲು ನಾನು ಹೇಳಲಾರೆ.`,
    boundaryQuestion: "ಮುಂದಿನ ಪರೀಕ್ಷೆಯವರೆಗೆ ಈ ಔಷಧಿಯನ್ನು ಬರೆದಂತೆಯೇ ತೆಗೆದುಕೊಳ್ಳಬೇಕೇ?",
    haemoglobin: (value, unit, range) =>
      `ವರದಿಯಲ್ಲಿ haemoglobin ${value} ${unit}; ಇದು ಮುದ್ರಿತ ಮಿತಿ ${range} ${unit} ಗಿಂತ ಕಡಿಮೆ. ಕಾರಣ ವರದಿಯಲ್ಲಿ ಇಲ್ಲ.`,
    haemoglobinQuestion: "ಈ ವರದಿಯಲ್ಲಿ haemoglobin ಕಡಿಮೆ ಇರುವುದಕ್ಕೆ ಕಾರಣ ಏನು?",
    cause: (value, unit) => `ವರದಿಯಲ್ಲಿ HbA1c ${value}${unit} ಮುದ್ರಿತ ಮಿತಿಗಿಂತ ಹೆಚ್ಚು ಇದೆ. ಕಾರಣವನ್ನು ಹೇಳಿಲ್ಲ.`,
    causeQuestion: "ಈ ಫಲಿತಾಂಶದ ಮೇಲೆ ಏನು ಪರಿಣಾಮ ಬೀರಿರಬಹುದು?",
    hba1c: (value, unit, range) =>
      `ವರದಿಯಲ್ಲಿ HbA1c ${value}${unit}; ಮುದ್ರಿತ ಮಿತಿ ${range}${unit}. ಫಲಿತಾಂಶ ಆ ಮಿತಿಗಿಂತ ಹೆಚ್ಚು ಇದೆ.`,
    unknown: "ಈ ಪ್ರಶ್ನೆಗೆ ಸುರಕ್ಷಿತವಾಗಿ ಉತ್ತರಿಸಲು ಬೇಕಾದ ಮಾಹಿತಿ ಈ ಕಡತಗಳಲ್ಲಿ ಇಲ್ಲ.",
    unknownQuestion: "ನನ್ನ ಆರೋಗ್ಯ ಇತಿಹಾಸದೊಂದಿಗೆ ಇದನ್ನು ವಿವರಿಸಬಹುದೇ?",
  },
  Marathi: {
    bloodReport: "रक्त तपासणी अहवाल",
    pastBloodReport: "जुना रक्त तपासणी अहवाल",
    prescription: "औषधाची चिठ्ठी",
    page: "पान",
    titles: [
      "1. या फाइलमध्ये काय आहे",
      "2. अहवालातील महत्त्वाचे निकाल",
      "3. काळानुसार दिसलेला बदल",
      "4. डॉक्टरांनी लिहिलेली सूचना",
      "5. डॉक्टरांना विचारायचे प्रश्न",
    ],
    documents: "या फाइलमध्ये रक्ताचे दोन अहवाल आणि औषधाची एक सध्याची चिठ्ठी आहे.",
    findings: (hba1c, haemoglobin) =>
      `सध्याच्या अहवालात HbA1c ${hba1c} छापलेल्या मर्यादेपेक्षा जास्त आणि haemoglobin ${haemoglobin} मर्यादेपेक्षा कमी आहे.`,
    changes: (past, pastDate, current, currentDate) =>
      `HbA1c ${pastDate} रोजी ${past} होते आणि ${currentDate} रोजी ${current} आहे. कारण फाइलमध्ये दिलेले नाही.`,
    instructions: (medicine, dose) =>
      `${medicine} ${dose}, रात्रीच्या जेवणानंतर, 30 दिवस. हे औषधाच्या चिठ्ठीत लिहिलेले पुन्हा सांगितले आहे.`,
    questions: "या निकालावर कशाचा परिणाम झाला असेल? तपासणी पुन्हा कधी करावी?",
    contextQuestion: (symptoms) => `तुम्ही “${symptoms}” सांगितले. त्याचा इथल्या एखाद्या निकालाशी संबंध असू शकतो का?`,
    suggestions: ["या निकालावर कशाचा परिणाम झाला असेल?", "ही तपासणी पुन्हा कधी करावी?"],
    boundary: (medicine, dose) =>
      `चिठ्ठीत ${medicine} ${dose}, रात्रीच्या जेवणानंतर, 30 दिवस लिहिले आहे. ते बदलायला किंवा थांबवायला मी सांगू शकत नाही.`,
    boundaryQuestion: "पुढच्या तपासणीपर्यंत हे औषध लिहिल्याप्रमाणेच घ्यायचे का?",
    haemoglobin: (value, unit, range) =>
      `अहवालात haemoglobin ${value} ${unit} आहे, जे छापलेल्या ${range} ${unit} मर्यादेपेक्षा कमी आहे. कारण दिलेले नाही.`,
    haemoglobinQuestion: "या अहवालात haemoglobin कमी असण्याचे कारण काय असू शकते?",
    cause: (value, unit) => `अहवालात HbA1c ${value}${unit} छापलेल्या मर्यादेपेक्षा जास्त आहे. कारण दिलेले नाही.`,
    causeQuestion: "या निकालावर कशाचा परिणाम झाला असेल?",
    hba1c: (value, unit, range) =>
      `अहवालात HbA1c ${value}${unit} आणि छापलेली मर्यादा ${range}${unit} आहे. निकाल त्या मर्यादेपेक्षा जास्त आहे.`,
    unknown: "या प्रश्नाचे सुरक्षित उत्तर देण्यासाठी पुरेशी माहिती या फाइलमध्ये नाही.",
    unknownQuestion: "माझ्या आरोग्याच्या आधीच्या माहितीसोबत हे समजावून सांगाल का?",
  },
};

function createDemoFacts(language: Language): Fact[] {
  const text = copy[language];
  const closedRange = parseMedicalRange("4.0–5.6");
  const haemoglobinRange = parseMedicalRange("12.0–15.0");
  if (!closedRange || !haemoglobinRange) throw new Error("Demo ranges are invalid");

  return [
    {
      id: "fact_hba1c_current",
      kind: "observation",
      name: "HbA1c",
      value: "7.2",
      unit: "%",
      referenceRange: "4.0–5.6",
      numericRange: closedRange,
      flag: "high",
      effectiveDate: "2026-08-08",
      confirmed: true,
      needsReview: false,
      source: {
        documentId: "demo_blood_report",
        documentName: text.bloodReport,
        page: 1,
        id: "span_hba1c_current",
        excerpt: "HbA1c  7.2  %  4.0–5.6  H",
        bbox: [0.08, 0.36, 0.92, 0.43],
        documentCategory: "report",
      },
    },
    {
      id: "fact_haemoglobin",
      kind: "observation",
      name: "Haemoglobin",
      value: "11.4",
      unit: "g/dL",
      referenceRange: "12.0–15.0",
      numericRange: haemoglobinRange,
      flag: "low",
      effectiveDate: "2026-08-08",
      confirmed: true,
      needsReview: false,
      source: {
        documentId: "demo_blood_report",
        documentName: text.bloodReport,
        page: 1,
        id: "span_haemoglobin",
        excerpt: "Haemoglobin  11.4  g/dL  12.0–15.0  L",
        bbox: [0.08, 0.44, 0.92, 0.51],
        documentCategory: "report",
      },
    },
    {
      id: "fact_hba1c_past",
      kind: "observation",
      name: "HbA1c",
      value: "6.8",
      unit: "%",
      referenceRange: "4.0–5.6",
      numericRange: closedRange,
      flag: "high",
      effectiveDate: "2026-05-15",
      confirmed: true,
      needsReview: false,
      source: {
        documentId: "demo_blood_report_past",
        documentName: text.pastBloodReport,
        page: 1,
        id: "span_hba1c_past",
        excerpt: "HbA1c  6.8  %  4.0–5.6  H",
        bbox: [0.08, 0.36, 0.92, 0.43],
        documentCategory: "report",
      },
    },
    {
      id: "fact_metformin",
      kind: "medication",
      medicine: "Metformin",
      dose: "500 mg",
      frequency: "after dinner",
      duration: "30 days",
      confirmed: true,
      needsReview: false,
      source: {
        documentId: "demo_prescription",
        documentName: text.prescription,
        page: 1,
        id: "span_metformin",
        excerpt: "Metformin 500 mg · after dinner · 30 days",
        bbox: [0.08, 0.62, 0.92, 0.69],
        documentCategory: "current-prescription",
      },
    },
  ];
}

function findObservation(facts: Fact[], id: string): ObservationFact {
  const fact = facts.find((candidate) => candidate.id === id);
  if (!fact || fact.kind !== "observation") throw new Error(`Missing observation: ${id}`);
  return fact;
}

function findMedication(facts: Fact[], id: string): MedicationFact {
  const fact = facts.find((candidate) => candidate.id === id);
  if (!fact || fact.kind !== "medication") throw new Error(`Missing medicine: ${id}`);
  return fact;
}

function citation(fact: Fact, language: Language) {
  return {
    sourceSpanId: fact.source.id,
    label: `${fact.source.documentName} · ${copy[language].page} ${fact.source.page}`,
  };
}

export class DemoMedicalReportProvider implements MedicalReportProvider {
  readonly mode = "demo" as const;

  async extract(input: ExtractionInput): Promise<Fact[]> {
    if (input.mode !== "demo") {
      throw new ProviderConfigurationError("Live document extraction is not configured.");
    }
    return createDemoFacts(input.intake.language);
  }

  async synthesize(input: SynthesisInput): Promise<Analysis> {
    if (input.facts.some((fact) => !fact.confirmed || fact.needsReview)) {
      throw new Error("All demo facts must be accepted before synthesis.");
    }

    const language = input.intake.language;
    const text = copy[language];
    const current = findObservation(input.facts, "fact_hba1c_current");
    const previous = findObservation(input.facts, "fact_hba1c_past");
    const haemoglobin = findObservation(input.facts, "fact_haemoglobin");
    const medicine = findMedication(input.facts, "fact_metformin");
    const contextualQuestion = input.intake.symptoms.trim()
      ? text.contextQuestion(input.intake.symptoms.trim())
      : text.questions;

    return {
      providerMode: "demo",
      checkedDocumentCount: 3,
      generatedAt: new Date().toISOString(),
      cards: [
        {
          id: "documents",
          title: text.titles[0],
          body: text.documents,
          citations: [citation(current, language), citation(previous, language), citation(medicine, language)],
        },
        {
          id: "findings",
          title: text.titles[1],
          body: text.findings(`${current.value}${current.unit}`, `${haemoglobin.value} ${haemoglobin.unit}`),
          citations: [citation(current, language), citation(haemoglobin, language)],
        },
        {
          id: "changes",
          title: text.titles[2],
          body: text.changes(
            `${previous.value}${previous.unit}`,
            formatAppDate(language, previous.effectiveDate),
            `${current.value}${current.unit}`,
            formatAppDate(language, current.effectiveDate),
          ),
          citations: [citation(previous, language), citation(current, language)],
        },
        {
          id: "instructions",
          title: text.titles[3],
          body: text.instructions(medicine.medicine, medicine.dose),
          citations: [citation(medicine, language)],
        },
        {
          id: "questions",
          title: text.titles[4],
          body: contextualQuestion,
          citations: [],
        },
      ],
      suggestedQuestions: input.intake.symptoms.trim()
        ? [contextualQuestion, text.suggestions[1]]
        : text.suggestions,
    };
  }

  async answer(input: QuestionInput): Promise<QuestionResponse> {
    const language = input.intake.language;
    const text = copy[language];
    const normalized = input.question.toLocaleLowerCase("en-IN");
    const current = findObservation(input.facts, "fact_hba1c_current");
    const haemoglobin = findObservation(input.facts, "fact_haemoglobin");
    const medicine = findMedication(input.facts, "fact_metformin");

    const clinicalBoundary = /(diagnos|treat|cure|do i have|बीमारी|निदान|इलाज|நோய்|நோயறிதல்|சிகிச்சை|ರೋಗ|ರೋಗನಿರ್ಣಯ|ಚಿಕಿತ್ಸೆ|रोग|निदान|उपचार)/iu;
    const medicineTerm = /(medicine|medication|tablet|pill|dose|दवा|दवाई|खुराक|गोली|மருந்து|மாத்திரை|அளவு|ಔಷಧ|ಮಾತ್ರೆ|ಪ್ರಮಾಣ|औषध|गोळी|डोस)/iu;
    const changeAction = /(start|stop|increase|decrease|change|adjust|skip|missed|शुरू|बंद|कम|ज्यादा|बदल|छोड़|தொடங்க|நிறுத்த|குறை|அதிக|மாற்ற|தவிர்|ಪ್ರಾರಂಭ|ನಿಲ್ಲಿಸ|ಕಡಿಮೆ|ಹೆಚ್ಚು|ಬದಲ|ಬಿಟ್ಟು|सुरू|बंद|कमी|जास्त|बदल|थांब|चुक)/iu;
    const haemoglobinTerms = /(ha?emoglobin|hb\b|हीमो|ஹீமோ|ಹೀಮೋ|हिमो)/iu;
    const causeTerms = /(cause|caused|affected|why|कारण|असर|ஏன்|காரண|ಏಕೆ|ಕಾರಣ|का|कशामुळे)/iu;

    if (clinicalBoundary.test(normalized) || (medicineTerm.test(normalized) && changeAction.test(normalized))) {
      return {
        answerType: "boundary",
        answer: text.boundary(medicine.medicine, medicine.dose),
        citations: [citation(medicine, language)],
        doctorQuestion: text.boundaryQuestion,
      };
    }
    if (haemoglobinTerms.test(normalized)) {
      return {
        answerType: causeTerms.test(normalized) ? "cannot_determine" : "document_fact",
        answer: text.haemoglobin(haemoglobin.value, haemoglobin.unit, haemoglobin.referenceRange),
        citations: [citation(haemoglobin, language)],
        doctorQuestion: text.haemoglobinQuestion,
      };
    }
    if (causeTerms.test(normalized)) {
      return {
        answerType: "cannot_determine",
        answer: text.cause(current.value, current.unit),
        citations: [citation(current, language)],
        doctorQuestion: text.causeQuestion,
      };
    }
    if (/hba1c|result|range|नतीज|सीमा|முடிவு|வரம்பு|ಫಲಿತಾಂಶ|ಮಿತಿ|निकाल|मर्यादा/iu.test(normalized)) {
      return {
        answerType: "document_fact",
        answer: text.hba1c(current.value, current.unit, current.referenceRange),
        citations: [citation(current, language)],
      };
    }
    return {
      answerType: "cannot_determine",
      answer: text.unknown,
      citations: [],
      doctorQuestion: text.unknownQuestion,
    };
  }
}

export const demoProvider = new DemoMedicalReportProvider();
