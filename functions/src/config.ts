import * as path from 'path';
import * as dotenv from 'dotenv';

// Load root .env when running locally or in emulators without overwriting existing process.env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

export interface DeepSeekConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/**
 * Reads DeepSeek configuration exclusively from server-side environment variables.
 * Never hardcode keys or expose them to the mobile client.
 */
export function getDeepSeekConfig(): DeepSeekConfig {
  const apiKey = (process.env.DEEPSEEK_API_KEY || '').trim();
  const rawBaseUrl = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').trim();
  const baseUrl = rawBaseUrl.replace(/\/+$/, '');
  const model = (process.env.DEEPSEEK_MODEL || 'deepseek-flash').trim();

  return {
    apiKey,
    baseUrl,
    model,
  };
}

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

export type AllowedSpecialty = (typeof ALLOWED_SPECIALTIES)[number];
