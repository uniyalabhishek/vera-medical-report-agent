AI Agent to Analyse Medical Reports

# Inputs

# Screen 1 (text input)

- Name
- Age
- Preferred language selection - English, Hindi, Tamil, Kannada, Marathi
- Current Symptoms (if any)
- Known medical history
- Optional - Voice input

# Screen 2 (file input)

- Medical reports (PDFs, images) - upto 10
- Doctor’s prescription (current)
- Doctor’s prescriptions (past)
- Optional - Additional input types like DICOM format for MRIs and software to extract information from such formats

# Outputs

# Screen 3

- 5 pointer summary of analysis
- Visually descriptive images of the analysis - important consideration - must be calming and reassuring, not alarming
- If doctor’s prescription uploaded - Analysis of doctor’s prescription, emphasis on dos and dont’s

# Screen 4

- Follow up questions - Q&A, via text or voice

# Business Logic Considerations for AI Model

- Consider medical history, research on available data on internet
- Consider common demographic info related to user’s age
- Research symptoms and link to medical history and age
- Consider Indian genetic conditions and common medical symptoms based on available public data
- DO NOT PROVIDE medical advice, do not generate any medical advice

Initial Claude Design for each screen - https://claude.ai/design/p/8fd7eb5e-9b6f-4763-bdea-d8d725215ab0?file=Medical+Report+Agent.dc.html&via=share

The Notion doc: https://app.notion.com/p/AI-Agent-to-Analyse-Medical-Reports-3bde90daba33802a9149cdd0f746f23e

Use computer use and chrome skill to read these.
