export {
  pickAndPreparePhoto,
  uploadStagedPhotos,
  MAX_ATTACHMENTS,
  MAX_FILE_SIZE_BYTES,
} from './imageUpload';
export type { StagedPhoto, PickPhotoResult } from './imageUpload';

export {
  requestDeepSeek,
  parseDecision,
  isDeepSeekConfigured,
  formatAssistantHistoryContent,
  sanitizeConversationHistory,
} from './deepseek';
export type {
  DeepSeekRiskLevel,
  DeepSeekBookingPayload,
  DeepSeekDecision,
  DeepSeekHistoryMessage,
  RequestDeepSeekParams,
} from './deepseek';

export {
  requestAiTriage,
  requestPreVisitChat,
  requestDoctorIntakeSummary,
} from './deepseekClient';
export type {
  TriageResponse,
  PreVisitChatResponse,
  DoctorSummaryResponse,
  ChatTurnInput,
} from './deepseekClient';
