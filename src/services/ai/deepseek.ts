import { WebSearchSource, isTavilyConfigured, searchTavily } from './tavily';

export type DeepSeekRiskLevel = 'LOW' | 'MODERATE' | 'HIGH';

export interface DeepSeekBookingPayload {
  doctor_name?: string;
  specialty?: string;
  slot?: string;
  chief_complaint?: string;
  ai_triage_notes?: string;
}

export interface DeepSeekDecision {
  reply: string;
  risk_level: DeepSeekRiskLevel;
  should_book_doctor: boolean;
  booking_payload?: DeepSeekBookingPayload;
  search_query?: string;
  search_preface?: string;
  used_web_search?: boolean;
  sources?: WebSearchSource[];
}

export interface DeepSeekHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface RequestDeepSeekParams {
  systemPrompt: string;
  history?: DeepSeekHistoryMessage[];
  userText: string;
  imageDataUrl?: string;
  maxTokens?: number;
  enableWebSearch?: boolean;
  onSearchStart?: (info: { query: string; spokenPreface: string }) => void;
}

interface RawDeepSeekChoice {
  index?: number;
  finish_reason?: string | null;
  message?: {
    role?: string;
    content?: string | null;
    reasoning_content?: string | null;
  };
}

interface RawDeepSeekResponse {
  id?: string;
  model?: string;
  choices?: RawDeepSeekChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    message?: string;
    type?: string;
    code?: string | number;
  };
}

const API_KEY = process.env.EXPO_PUBLIC_DEEPSEEK_API_KEY || '';
const BASE_URL =
  process.env.EXPO_PUBLIC_DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const MODEL = process.env.EXPO_PUBLIC_DEEPSEEK_MODEL || 'deepseek-flash';

const REQUEST_TIMEOUT_MS = 35000;
const DEFAULT_MAX_TOKENS = 1024;
const RETRY_MAX_TOKENS = 1536;

const KNOWN_ERROR_PLACEHOLDERS = [
  "we couldn't check that right now",
  'deepseek api unavailable',
  'deepseek request timed out',
];

export function isDeepSeekConfigured(): boolean {
  return Boolean(API_KEY.trim());
}

function normalizeRiskLevel(rawRisk?: unknown): DeepSeekRiskLevel {
  const normalized =
    typeof rawRisk === 'string' ? rawRisk.trim().toUpperCase() : 'LOW';
  if (normalized === 'HIGH' || normalized === 'MODERATE') {
    return normalized;
  }
  return 'LOW';
}

/**
 * Formats an assistant history message as a valid JSON string matching the
 * system prompt contract so `response_format: { type: 'json_object' }` never
 * degrades into whitespace-only outputs across multi-turn chats.
 */
export function formatAssistantHistoryContent(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return '';

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (typeof parsed.reply === 'string' && parsed.reply.trim()) {
        return JSON.stringify({
          search_query: '',
          search_preface: '',
          reply: parsed.reply.trim(),
          risk_level: normalizeRiskLevel(parsed.risk_level),
          should_book_doctor: Boolean(parsed.should_book_doctor),
          booking_payload:
            parsed.booking_payload &&
            typeof parsed.booking_payload === 'object' &&
            !Array.isArray(parsed.booking_payload)
              ? parsed.booking_payload
              : {
                  doctor_name: '',
                  specialty: 'General Practice',
                  slot: '',
                  chief_complaint: '',
                  ai_triage_notes: '',
                },
        });
      }
    } catch {
      // Fall through and wrap as plain text reply
    }
  }

  return JSON.stringify({
    search_query: '',
    search_preface: '',
    reply: trimmed,
    risk_level: 'LOW',
    should_book_doctor: false,
    booking_payload: {
      doctor_name: '',
      specialty: 'General Practice',
      slot: '',
      chief_complaint: '',
      ai_triage_notes: '',
    },
  });
}

/**
 * Cleans conversation history:
 * - Removes empty/placeholder or UI error messages
 * - Wraps plain-text assistant turns into the JSON contract shape
 * - Ensures messages start with `user` and strictly alternate `user`/`assistant`
 */
export function sanitizeConversationHistory(
  history: DeepSeekHistoryMessage[]
): DeepSeekHistoryMessage[] {
  const filtered: DeepSeekHistoryMessage[] = [];

  for (const msg of history) {
    if (!msg || typeof msg.content !== 'string') continue;
    const rawText = msg.content
      .replace(/^I couldn't view your photo, but let's continue\.\s*/i, '')
      .trim();
    if (!rawText) continue;

    const lower = rawText.toLowerCase();
    if (KNOWN_ERROR_PLACEHOLDERS.some((p) => lower.includes(p))) {
      continue;
    }

    const formattedContent =
      msg.role === 'assistant'
        ? formatAssistantHistoryContent(rawText)
        : rawText;
    if (!formattedContent) continue;

    const prev = filtered[filtered.length - 1];
    if (prev && prev.role === msg.role) {
      if (msg.role === 'user') {
        prev.content = `${prev.content}\n${formattedContent}`;
      } else {
        prev.content = formattedContent;
      }
    } else {
      filtered.push({
        role: msg.role,
        content: formattedContent,
      });
    }
  }

  while (filtered.length > 0 && filtered[0].role !== 'user') {
    filtered.shift();
  }

  while (filtered.length > 0 && filtered[filtered.length - 1].role === 'user') {
    filtered.pop();
  }

  return filtered;
}

/**
 * Extracts a balanced JSON object from a string that may contain markdown fences,
 * leading whitespace, or surrounding text.
 */
function extractJsonObjectString(input: string): string | null {
  const stripped = input
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim();

  const start = stripped.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return stripped.slice(start, i + 1);
      }
    }
  }

  const lastBrace = stripped.lastIndexOf('}');
  if (lastBrace > start) {
    return stripped.slice(start, lastBrace + 1);
  }
  return null;
}

/**
 * Attempts to recover a decision from a truncated JSON string (e.g., when
 * `finish_reason === 'length'` cut off the closing braces of `booking_payload`).
 */
function recoverTruncatedJsonDecision(text: string): DeepSeekDecision | null {
  const replyMatch = text.match(
    /"(?:reply|message|response|text|answer)"\s*:\s*"((?:[^"\\]|\\.)*)"/i
  );
  const partialReplyMatch = !replyMatch
    ? text.match(/"(?:reply|message|response|text|answer)"\s*:\s*"((?:[^"\\]|\\.)+)$/i)
    : null;

  const rawReply = replyMatch?.[1] ?? partialReplyMatch?.[1];
  if (!rawReply) return null;

  let decodedReply = rawReply;
  try {
    decodedReply = JSON.parse(`"${rawReply.replace(/"$/, '')}"`);
  } catch {
    decodedReply = rawReply
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }

  if (!decodedReply.trim()) return null;

  const searchQueryMatch = text.match(/"search_query"\s*:\s*"((?:[^"\\]|\\.)*)"/i);
  const searchPrefaceMatch = text.match(/"search_preface"\s*:\s*"((?:[^"\\]|\\.)*)"/i);
  const riskMatch = text.match(/"risk_level"\s*:\s*"(LOW|MODERATE|HIGH)"/i);
  const bookMatch = text.match(/"should_book_doctor"\s*:\s*(true|false)/i);
  const specialtyMatch = text.match(/"specialty"\s*:\s*"([^"]+)"/i);
  const complaintMatch = text.match(/"chief_complaint"\s*:\s*"((?:[^"\\]|\\.)*)"/i);
  const notesMatch = text.match(/"ai_triage_notes"\s*:\s*"((?:[^"\\]|\\.)*)"/i);

  const should_book_doctor = bookMatch ? bookMatch[1].toLowerCase() === 'true' : false;
  const specialty = specialtyMatch?.[1]?.trim() || 'General Practice';

  return {
    reply: decodedReply.trim(),
    risk_level: normalizeRiskLevel(riskMatch?.[1]),
    should_book_doctor,
    search_query: searchQueryMatch?.[1]?.trim() || undefined,
    search_preface: searchPrefaceMatch?.[1]?.trim() || undefined,
    booking_payload: should_book_doctor
      ? {
          specialty,
          chief_complaint: complaintMatch?.[1]?.trim() || '',
          ai_triage_notes: notesMatch?.[1]?.trim() || '',
        }
      : undefined,
  };
}

export function parseDecision(content: string): DeepSeekDecision {
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('DeepSeek returned an empty response.');
  }

  const trimmed = content.trim();
  const candidateJson = extractJsonObjectString(trimmed) ?? trimmed;

  try {
    const raw = JSON.parse(candidateJson) as Partial<DeepSeekDecision> & {
      risk_level?: string;
      message?: string;
      response?: string;
      text?: string;
      answer?: string;
    };

    const replyCandidate =
      typeof raw.reply === 'string' && raw.reply.trim()
        ? raw.reply
        : typeof raw.message === 'string' && raw.message.trim()
        ? raw.message
        : typeof raw.response === 'string' && raw.response.trim()
        ? raw.response
        : typeof raw.text === 'string' && raw.text.trim()
        ? raw.text
        : typeof raw.answer === 'string' && raw.answer.trim()
        ? raw.answer
        : '';

    const searchQuery =
      typeof raw.search_query === 'string' ? raw.search_query.trim() : '';
    const searchPreface =
      typeof raw.search_preface === 'string' ? raw.search_preface.trim() : '';

    if (!replyCandidate.trim() && !searchQuery) {
      throw new Error('DeepSeek returned a JSON object without a non-empty "reply" field.');
    }

    const risk_level = normalizeRiskLevel(raw.risk_level);
    const should_book_doctor = Boolean(raw.should_book_doctor);
    const booking_payload =
      raw.booking_payload &&
      typeof raw.booking_payload === 'object' &&
      !Array.isArray(raw.booking_payload)
        ? raw.booking_payload
        : should_book_doctor
        ? { specialty: 'General Practice' }
        : undefined;

    return {
      reply:
        replyCandidate.trim() ||
        'Let me check reliable medical sources to give you accurate guidance.',
      risk_level,
      should_book_doctor,
      booking_payload,
      search_query: searchQuery || undefined,
      search_preface: searchPreface || undefined,
    };
  } catch (parseErr) {
    const recovered = recoverTruncatedJsonDecision(trimmed);
    if (recovered) {
      return recovered;
    }

    if (!trimmed.startsWith('{')) {
      const cleanPlain = trimmed
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      if (cleanPlain && !cleanPlain.startsWith('{')) {
        return {
          reply: cleanPlain,
          risk_level: 'LOW',
          should_book_doctor: false,
        };
      }
    }

    const reason =
      parseErr instanceof Error ? parseErr.message : 'Invalid JSON structure';
    throw new Error(`DeepSeek returned an invalid response shape (${reason}).`);
  }
}

async function executeSingleDeepSeekCall(params: {
  systemPrompt: string;
  sanitizedHistory: DeepSeekHistoryMessage[];
  userContent:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string } }
      >;
  maxTokens: number;
}): Promise<DeepSeekDecision> {
  const endpoint = `${BASE_URL.replace(/\/+$/, '')}/chat/completions`;

  const attempts: Array<{
    useJsonObject: boolean;
    useThinkingDisabled: boolean;
    maxTokens: number;
  }> = [
    {
      useJsonObject: true,
      useThinkingDisabled: true,
      maxTokens: params.maxTokens,
    },
    {
      useJsonObject: false,
      useThinkingDisabled: true,
      maxTokens: Math.max(params.maxTokens, RETRY_MAX_TOKENS),
    },
  ];

  let lastError: Error | null = null;

  for (let attemptIdx = 0; attemptIdx < attempts.length; attemptIdx++) {
    const cfg = attempts[attemptIdx];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const requestBody: Record<string, unknown> = {
        model: MODEL,
        messages: [
          { role: 'system', content: params.systemPrompt },
          ...params.sanitizedHistory,
          { role: 'user', content: params.userContent },
        ],
        max_tokens: cfg.maxTokens,
      };

      if (cfg.useThinkingDisabled) {
        requestBody.thinking = { type: 'disabled' };
      }
      if (cfg.useJsonObject) {
        requestBody.response_format = { type: 'json_object' };
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      const rawBodyText = await response.text();
      let data: RawDeepSeekResponse | null = null;
      try {
        data = rawBodyText ? (JSON.parse(rawBodyText) as RawDeepSeekResponse) : null;
      } catch {
        data = null;
      }

      if (!response.ok) {
        const apiErrorMsg =
          data?.error?.message ||
          rawBodyText.slice(0, 200) ||
          `HTTP ${response.status}`;
        console.warn(
          `[DeepSeek] HTTP ${response.status} on attempt ${attemptIdx + 1}/${attempts.length} (model=${MODEL}): ${apiErrorMsg}`
        );

        if (response.status === 400 && attemptIdx === 0) {
          attempts[1].useThinkingDisabled = false;
          lastError = new Error(
            `DeepSeek request failed (HTTP ${response.status}): ${apiErrorMsg}`
          );
          continue;
        }

        if (response.status >= 500 && attemptIdx === 0) {
          lastError = new Error(
            `DeepSeek server error (HTTP ${response.status}): ${apiErrorMsg}`
          );
          continue;
        }

        throw new Error(
          `DeepSeek request failed (HTTP ${response.status}): ${apiErrorMsg}`
        );
      }

      if (data?.error?.message) {
        console.warn(
          `[DeepSeek] Error payload in 200 response on attempt ${attemptIdx + 1}: ${data.error.message}`
        );
        lastError = new Error(`DeepSeek API error: ${data.error.message}`);
        if (attemptIdx === 0) continue;
        throw lastError;
      }

      const choice = data?.choices?.[0];
      const rawContent = choice?.message?.content ?? '';
      const reasoningContent = choice?.message?.reasoning_content ?? '';
      const finishReason = choice?.finish_reason ?? 'unknown';

      if (!rawContent || !rawContent.trim()) {
        console.warn(
          `[DeepSeek] Empty or whitespace-only content on attempt ${attemptIdx + 1}/${attempts.length}: ` +
            `finish_reason=${finishReason}, raw_content_len=${rawContent.length}, ` +
            `reasoning_len=${reasoningContent.length}, completion_tokens=${data?.usage?.completion_tokens ?? 'n/a'}, ` +
            `history_turns=${params.sanitizedHistory.length}`
        );

        if (reasoningContent && reasoningContent.trim()) {
          try {
            return parseDecision(reasoningContent);
          } catch {
            // Continue to retry
          }
        }

        lastError = new Error(
          `DeepSeek returned empty content (finish_reason=${finishReason}, raw_length=${rawContent.length}).`
        );
        if (attemptIdx < attempts.length - 1) {
          continue;
        }
        throw lastError;
      }

      if (finishReason === 'length') {
        console.warn(
          `[DeepSeek] Output truncated at token limit on attempt ${attemptIdx + 1}/${attempts.length}: ` +
            `finish_reason=length, content_len=${rawContent.length}, completion_tokens=${data?.usage?.completion_tokens ?? 'n/a'}`
        );
      }

      try {
        return parseDecision(rawContent);
      } catch (parseError) {
        console.warn(
          `[DeepSeek] Failed to parse model output on attempt ${attemptIdx + 1}/${attempts.length}: ` +
            `finish_reason=${finishReason}, error=${parseError instanceof Error ? parseError.message : String(parseError)}, ` +
            `preview=${JSON.stringify(rawContent.trim().slice(0, 160))}`
        );
        lastError =
          parseError instanceof Error
            ? parseError
            : new Error('DeepSeek returned an unparseable response.');
        if (attemptIdx < attempts.length - 1) {
          continue;
        }
        throw lastError;
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        lastError = new Error('DeepSeek request timed out.');
      } else {
        lastError =
          err instanceof Error ? err : new Error('DeepSeek request failed.');
      }
      if (attemptIdx < attempts.length - 1) {
        continue;
      }
      throw lastError;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new Error('DeepSeek request failed.');
}

export async function requestDeepSeek({
  systemPrompt,
  history = [],
  userText,
  imageDataUrl,
  maxTokens = DEFAULT_MAX_TOKENS,
  enableWebSearch = true,
  onSearchStart,
}: RequestDeepSeekParams): Promise<DeepSeekDecision> {
  if (!API_KEY.trim()) {
    throw new Error('DeepSeek API key is not configured.');
  }

  const userContent = imageDataUrl
    ? [
        { type: 'text' as const, text: userText },
        { type: 'image_url' as const, image_url: { url: imageDataUrl } },
      ]
    : userText;

  const sanitizedHistory = sanitizeConversationHistory(history);

  const firstDecision = await executeSingleDeepSeekCall({
    systemPrompt,
    sanitizedHistory,
    userContent,
    maxTokens,
  });

  const searchQuery = firstDecision.search_query?.trim() || '';
  if (!enableWebSearch || !searchQuery || !isTavilyConfigured()) {
    return firstDecision;
  }

  const spokenPreface =
    firstDecision.search_preface?.trim() ||
    'Okay! Let me do a quick online search to validate that.';

  onSearchStart?.({
    query: searchQuery,
    spokenPreface,
  });

  const searchResult = await searchTavily(searchQuery);
  if (!searchResult) {
    return firstDecision;
  }

  const groundedPrompt = `${userText}\n\n[Verified Web Search Results for "${searchResult.query}"]\n${searchResult.formattedContext}\n\nInstruction: Use these verified web search findings to give a clear, accurate, reassuring response to the patient. Set "search_query" to "" in your JSON reply.`;

  const groundedUserContent = imageDataUrl
    ? [
        { type: 'text' as const, text: groundedPrompt },
        { type: 'image_url' as const, image_url: { url: imageDataUrl } },
      ]
    : groundedPrompt;

  try {
    const finalDecision = await executeSingleDeepSeekCall({
      systemPrompt,
      sanitizedHistory,
      userContent: groundedUserContent,
      maxTokens,
    });

    return {
      ...finalDecision,
      used_web_search: true,
      sources: searchResult.sources,
    };
  } catch (err) {
    console.warn(
      '[DeepSeek] Grounded synthesis call failed, returning initial decision:',
      err instanceof Error ? err.message : String(err)
    );
    return {
      ...firstDecision,
      used_web_search: true,
      sources: searchResult.sources,
    };
  }
}
