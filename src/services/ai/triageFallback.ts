import { Platform } from 'react-native';
import { File } from 'expo-file-system';
import { DeepSeekRiskLevel } from './deepseek';

export const ALLOWED_SPECIALTIES = [
  'General Practice',
  'Cardiology',
  'Dermatology',
  'Neurology',
  'Orthopedics',
  'Pediatrics',
  'ENT',
  'Ophthalmology',
  'Psychiatry',
  'Gynecology',
  'Gastroenterology',
  'Pulmonology',
  'Endocrinology',
  'Urology',
] as const;

export type TriageUrgency = 'routine' | 'soon' | 'urgent' | 'emergency';

const EMERGENCY_KEYWORDS = [
  'chest pain',
  'chest tightness',
  'chest pressure',
  'difficulty breathing',
  'shortness of breath',
  'cannot breathe',
  "can't breathe",
  'trouble breathing',
  'severe bleeding',
  'heavy bleeding',
  'deep wound',
  'unconscious',
  'passed out',
  'fainted',
  'stroke',
  'slurred speech',
  'face drooping',
  'arm weakness',
  'anaphylaxis',
  'throat swelling',
  'suicidal',
  'suicide',
  'self-harm',
  'overdose',
  'seizure',
];

export function hasEmergencyKeywords(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return EMERGENCY_KEYWORDS.some((kw) => lower.includes(kw));
}

export function normalizeSpecialty(rawSpecialty?: string | null): string {
  if (!rawSpecialty) return 'General Practice';
  const candidate = rawSpecialty.trim().toLowerCase();
  const exact = ALLOWED_SPECIALTIES.find((s) => s.toLowerCase() === candidate);
  if (exact) return exact;
  const partial = ALLOWED_SPECIALTIES.find(
    (s) => candidate.includes(s.toLowerCase()) || s.toLowerCase().includes(candidate)
  );
  return partial ?? 'General Practice';
}

export function riskToUrgency(
  risk: DeepSeekRiskLevel,
  isEmergency = false
): TriageUrgency {
  if (isEmergency) return 'emergency';
  if (risk === 'HIGH') return 'urgent';
  if (risk === 'MODERATE') return 'soon';
  return 'routine';
}

/**
 * Converts a local file URI to a base64 data URL for multimodal requests
 * without using React Native's Response.blob().
 */
export async function localUriToDataUrl(uri: string): Promise<string | undefined> {
  if (!uri) return undefined;
  if (uri.startsWith('data:')) return uri;

  try {
    if (Platform.OS !== 'web') {
      const base64 = await new File(uri).base64();
      return base64 ? `data:image/jpeg;base64,${base64}` : undefined;
    }

    const response = await fetch(uri);
    const blob = await response.blob();
    return await new Promise<string | undefined>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve(typeof reader.result === 'string' ? reader.result : undefined);
      };
      reader.onerror = () => resolve(undefined);
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}
