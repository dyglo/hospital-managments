import {
  DeepSeekBookingPayload,
  DeepSeekHistoryMessage,
  DeepSeekRiskLevel,
  formatAssistantHistoryContent,
  requestDeepSeek,
} from './deepseek';
import {
  ALLOWED_SPECIALTIES,
  TriageUrgency,
  localUriToDataUrl,
  normalizeSpecialty,
  riskToUrgency,
} from './triageFallback';

function formatApiErrorNote(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('API key is not configured')) {
    return "DeepSeek API key not loaded — restart Expo with 'npx expo start -c'";
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return 'DeepSeek request timed out';
  }
  return message || 'DeepSeek API unavailable';
}

export interface TriageResponse {
  ok: boolean;
  specialty: string;
  urgency: TriageUrgency;
  text: string;
  openManualPicker: boolean;
  forceEmergency: boolean;
  imageFailed?: boolean;
  statusNote?: string;
  bookingProposal?: DeepSeekBookingPayload;
}

export interface PreVisitChatResponse {
  ok: boolean;
  text: string;
  recommendedSpecialty?: string | null;
  urgency?: TriageUrgency;
  forceEmergency?: boolean;
  imageFailed?: boolean;
  statusNote?: string;
  bookingProposal?: DeepSeekBookingPayload;
}

export interface DoctorSummaryResponse {
  ok: boolean;
  summary?: {
    complaint: string;
    duration: string;
    severity: string;
    medications: string;
    allergies: string;
    otherConditions: string;
    concerns: string;
    photos: string;
  };
  imageFailed?: boolean;
  statusNote?: string;
}

export interface ChatTurnInput {
  role: 'user' | 'assistant';
  text: string;
  recommendedSpecialty?: string | null;
  riskLevel?: DeepSeekRiskLevel;
  shouldBookDoctor?: boolean;
  bookingProposal?: DeepSeekBookingPayload;
  isNotice?: boolean;
}

const SPECIALTY_LIST = ALLOWED_SPECIALTIES.join(', ');

const JSON_CONTRACT_INSTRUCTIONS = `
Return ONLY a valid JSON object with this exact shape:
{
  "reply": "Helpful assistant response in plain text (no markdown, no emojis)",
  "risk_level": "LOW",
  "should_book_doctor": false,
  "booking_payload": {
    "doctor_name": "",
    "specialty": "General Practice",
    "slot": "",
    "chief_complaint": "Reason for the proposed booking",
    "ai_triage_notes": "Brief notes for clinician review"
  }
}

Rules:
- "risk_level" MUST be "LOW", "MODERATE", or "HIGH".
- "should_book_doctor" MUST be a boolean.
- When "should_book_doctor" is true, "booking_payload" is required and "specialty" MUST be one of: ${SPECIALTY_LIST}. If unsure, use "General Practice".
- Never state a definitive medical diagnosis or prescribe specific medication dosages.
- Clearly treat any booking details as a proposal for the patient to confirm, not a confirmed appointment.
- Keep "reply" warm, clear, practical, and easy to read (2 to 5 sentences).
`.trim();

const TRIAGE_SYSTEM_PROMPT = `
You are a calm, helpful hospital intake assistant helping a patient find the right doctor for an appointment.
Assess the patient's symptoms and recommend the most appropriate specialty from: ${SPECIALTY_LIST}.
Set "should_book_doctor" to true when recommending a specialty for their visit.

${JSON_CONTRACT_INSTRUCTIONS}
`.trim();

const CARE_ASSISTANT_SYSTEM_PROMPT = `
You are a warm, knowledgeable, and attentive hospital Care Assistant having a continuous multi-turn conversation with a patient.
Always respond directly and helpfully to what the patient just said, asked, or showed in their photo.

Conversation rules:
- Track the full conversation history carefully and NEVER repeat questions the patient already answered in earlier messages.
- Build naturally on previous turns as the patient shares more details or asks follow-up questions.
- Do NOT ask generic "what are your symptoms?" questions when the patient already described their issue, asked a specific question, or uploaded a photo.
- If the patient describes symptoms: acknowledge their specific details, provide practical and reassuring self-care or preparation guidance, explain what to watch for, and ask at most one focused follow-up question only if it helps narrow down care.
- If the patient asks a follow-up question, general health question, clinic question, or what to expect at their visit: answer it directly, thoroughly, and clearly.
- If the patient attaches a photo: describe what is clearly visible in plain language (for lab reports or prescriptions, read out the visible values/names and explain generally what they measure while noting their doctor will interpret them).
- If seeing a doctor is appropriate (or if the patient asks for a doctor recommendation or to book an appointment), set "should_book_doctor" to true and set "booking_payload.specialty" to the best match from: ${SPECIALTY_LIST}.
- If general guidance is enough for the current turn, set "should_book_doctor" to false.

${JSON_CONTRACT_INSTRUCTIONS}
`.trim();

const PREVISIT_CHAT_SYSTEM_PROMPT = `
You are a calm, reassuring hospital assistant collecting brief pre-visit notes for a patient's upcoming appointment.
Ask one simple, clear question at a time in 1 to 2 short sentences. Do not repeat questions already answered.
Set "should_book_doctor" to false during pre-visit intake.

${JSON_CONTRACT_INSTRUCTIONS}
`.trim();

async function requestWithImageFallback(params: {
  systemPrompt: string;
  history?: DeepSeekHistoryMessage[];
  userText: string;
  localImageUris?: string[];
  onNotice?: (notice: string) => void;
}) {
  let imageDataUrl: string | undefined;
  let imageFailed = false;

  if (params.localImageUris && params.localImageUris.length > 0) {
    imageDataUrl = await localUriToDataUrl(params.localImageUris[0]);
    if (!imageDataUrl) {
      imageFailed = true;
    }
  }

  try {
    const decision = await requestDeepSeek({
      systemPrompt: params.systemPrompt,
      history: params.history,
      userText: params.userText,
      imageDataUrl,
    });
    if (imageFailed) {
      params.onNotice?.("I couldn't view your photo, but let's continue.");
    }
    return { decision, imageFailed };
  } catch (error) {
    // If an image was attached and the model/endpoint rejected it, retry text-only once.
    if (imageDataUrl) {
      try {
        const decision = await requestDeepSeek({
          systemPrompt: params.systemPrompt,
          history: params.history,
          userText: params.userText,
        });
        imageFailed = true;
        params.onNotice?.("I couldn't view your photo, but let's continue.");
        return { decision, imageFailed };
      } catch {
        throw error;
      }
    }
    throw error;
  }
}

/**
 * Triages patient symptoms using the DeepSeek chat-completions API.
 */
export async function requestAiTriage(params: {
  text: string;
  imagePaths?: string[];
  localImageUris?: string[];
  onNotice?: (notice: string) => void;
}): Promise<TriageResponse> {
  const userText = params.text.trim() || 'Please review my attached photo.';

  const { decision, imageFailed } = await requestWithImageFallback({
    systemPrompt: TRIAGE_SYSTEM_PROMPT,
    userText,
    localImageUris: params.localImageUris,
    onNotice: params.onNotice,
  });

  const specialty = normalizeSpecialty(decision.booking_payload?.specialty);

  return {
    ok: true,
    specialty,
    urgency: riskToUrgency(decision.risk_level, false),
    text: decision.reply,
    openManualPicker: !decision.should_book_doctor,
    forceEmergency: false,
    imageFailed,
    statusNote: '',
    bookingProposal: decision.booking_payload,
  };
}

/**
 * Care Assistant / Pre-Visit chat backed by DeepSeek across multi-turn conversations.
 */
export async function requestPreVisitChat(params: {
  messages: ChatTurnInput[];
  imagePaths?: string[];
  localImageUris?: string[];
  mode?: 'general' | 'previsit';
  onDelta?: (partialText: string) => void;
  onNotice?: (notice: string) => void;
}): Promise<PreVisitChatResponse> {
  const allMessages = params.messages.filter(
    (m) => !m.isNotice && typeof m.text === 'string' && m.text.trim().length > 0
  );
  const lastUserMsg = [...allMessages].reverse().find((m) => m.role === 'user');
  const userText = lastUserMsg?.text?.trim() || 'Attached photo(s)';

  // Exclude the current user message from history and keep up to the last 20 non-empty messages.
  const lastIdx = lastUserMsg ? allMessages.lastIndexOf(lastUserMsg) : -1;
  const priorMessages = lastIdx > 0 ? allMessages.slice(0, lastIdx) : [];

  const history: DeepSeekHistoryMessage[] = priorMessages
    .slice(-20)
    .map((m) => {
      const cleanText = m.text
        .replace(/^I couldn't view your photo, but let's continue\.\s*/i, '')
        .trim();

      if (m.role === 'assistant') {
        const shouldBook = Boolean(m.shouldBookDoctor || m.recommendedSpecialty);
        const specialty = m.recommendedSpecialty
          ? normalizeSpecialty(m.recommendedSpecialty)
          : m.bookingProposal?.specialty
          ? normalizeSpecialty(m.bookingProposal.specialty)
          : 'General Practice';

        const structuredJson = JSON.stringify({
          reply: cleanText,
          risk_level: m.riskLevel ?? 'LOW',
          should_book_doctor: shouldBook,
          booking_payload: {
            doctor_name: m.bookingProposal?.doctor_name ?? '',
            specialty,
            slot: m.bookingProposal?.slot ?? '',
            chief_complaint: m.bookingProposal?.chief_complaint ?? '',
            ai_triage_notes: m.bookingProposal?.ai_triage_notes ?? '',
          },
        });
        return {
          role: 'assistant' as const,
          content: formatAssistantHistoryContent(structuredJson),
        };
      }

      return {
        role: 'user' as const,
        content: cleanText,
      };
    });

  const systemPrompt =
    params.mode === 'previsit'
      ? PREVISIT_CHAT_SYSTEM_PROMPT
      : CARE_ASSISTANT_SYSTEM_PROMPT;

  const { decision, imageFailed } = await requestWithImageFallback({
    systemPrompt,
    history,
    userText,
    localImageUris: params.localImageUris,
    onNotice: params.onNotice,
  });

  const recommendedSpecialty = decision.should_book_doctor
    ? normalizeSpecialty(decision.booking_payload?.specialty)
    : null;

  params.onDelta?.(decision.reply);

  return {
    ok: true,
    text: decision.reply,
    recommendedSpecialty,
    urgency: riskToUrgency(decision.risk_level, false),
    forceEmergency: false,
    imageFailed,
    statusNote: '',
    bookingProposal: decision.booking_payload,
  };
}

/**
 * Generates a structured pre-visit intake summary for clinicians.
 */
export async function requestDoctorIntakeSummary(params: {
  transcript: string;
  imagePaths?: string[];
  localImageUris?: string[];
}): Promise<DoctorSummaryResponse> {
  const systemPrompt = `
You are a clinical intake organizer preparing a concise pre-visit summary for a doctor.
Summarize only what the patient stated. Never invent details, never diagnose, and never suggest treatment.
Return JSON matching the required contract, putting a brief summary in "reply" and detailed notes in "booking_payload.ai_triage_notes".
${JSON_CONTRACT_INSTRUCTIONS}
`.trim();

  try {
    const { decision, imageFailed } = await requestWithImageFallback({
      systemPrompt,
      userText: params.transcript,
      localImageUris: params.localImageUris,
    });

    return {
      ok: true,
      summary: {
        complaint: decision.booking_payload?.chief_complaint || 'See intake notes',
        duration: 'Not stated',
        severity: decision.risk_level,
        medications: 'Not stated',
        allergies: 'Not stated',
        otherConditions: 'Not stated',
        concerns: decision.booking_payload?.ai_triage_notes || decision.reply,
        photos: params.localImageUris?.length ? 'Attached by patient' : 'None',
      },
      imageFailed,
      statusNote: '',
    };
  } catch (error) {
    return {
      ok: false,
      statusNote: formatApiErrorNote(error),
    };
  }
}
