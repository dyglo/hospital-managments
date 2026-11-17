"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasEmergencyKeywords = hasEmergencyKeywords;
exports.sanitizePlainText = sanitizePlainText;
exports.parseTriageOutput = parseTriageOutput;
exports.parseCareChatOutput = parseCareChatOutput;
exports.parseSummaryOutput = parseSummaryOutput;
const config_1 = require("./config");
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
/**
 * Deterministic keyword safety check on patient input or model text.
 */
function hasEmergencyKeywords(text) {
    if (!text)
        return false;
    const lower = text.toLowerCase();
    return EMERGENCY_KEYWORDS.some((kw) => lower.includes(kw));
}
/**
 * Strips <think> blocks, code fences, markdown symbols, and emojis from any model reply.
 */
function sanitizePlainText(raw) {
    if (!raw)
        return '';
    let cleaned = raw;
    // Remove <think>...</think> reasoning blocks (including unclosed trailing think blocks)
    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '');
    cleaned = cleaned.replace(/<think>[\s\S]*$/gi, '');
    // Remove code fences
    cleaned = cleaned.replace(/```[\s\S]*?```/g, (match) => match.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, ''));
    cleaned = cleaned.replace(/```/g, '');
    // Remove markdown headings, bold/italic markers, inline code, blockquotes, list bullets
    cleaned = cleaned.replace(/^[ \t]*#{1,6}[ \t]+/gm, '');
    cleaned = cleaned.replace(/^[ \t]*>[ \t]?/gm, '');
    cleaned = cleaned.replace(/(\*\*|__)(.*?)\1/g, '$2');
    cleaned = cleaned.replace(/(\*|_)(.*?)\1/g, '$2');
    cleaned = cleaned.replace(/`([^`]*)`/g, '$1');
    cleaned = cleaned.replace(/[*_`]/g, '');
    // Remove emojis and pictographs
    cleaned = cleaned.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}]/gu, '');
    // Collapse excessive blank lines and trim
    cleaned = cleaned.replace(/\r\n/g, '\n');
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
    return cleaned.trim();
}
function normalizeSpecialty(rawSpecialty) {
    const candidate = rawSpecialty.trim().toLowerCase();
    const match = config_1.ALLOWED_SPECIALTIES.find((s) => s.toLowerCase() === candidate);
    return match ?? 'General Practice';
}
function normalizeUrgency(rawUrgency) {
    const u = rawUrgency.trim().toLowerCase();
    if (u === 'emergency' || u === 'urgent' || u === 'soon' || u === 'routine') {
        return u;
    }
    return 'routine';
}
/**
 * Parses triage header `^[SPECIALTY: ... | URGENCY: ...]` on the first line,
 * removes it from visible text, validates specialty, and enforces emergency safety overrides.
 */
function parseTriageOutput(rawReply, patientInputText = '') {
    const sanitized = sanitizePlainText(rawReply);
    const lines = sanitized.split('\n');
    const firstLine = (lines[0] || '').trim();
    const headerMatch = firstLine.match(/^\[SPECIALTY:\s*(.+?)\s*\|\s*URGENCY:\s*(\w+)\]/i);
    let specialty = 'General Practice';
    let urgency = 'routine';
    let parseFailed = false;
    let visibleText = sanitized;
    if (headerMatch) {
        specialty = normalizeSpecialty(headerMatch[1]);
        urgency = normalizeUrgency(headerMatch[2]);
        // Remove first line from visible text
        visibleText = lines.slice(1).join('\n').trim();
    }
    else {
        parseFailed = true;
        // Also strip any stray square-bracket tags if model malformed them
        visibleText = sanitized.replace(/\[[^\]]*\]/g, '').trim();
    }
    // Force emergency if model flagged emergency OR deterministic keyword check matches
    const keywordTriggered = hasEmergencyKeywords(patientInputText) || hasEmergencyKeywords(visibleText);
    const forceEmergency = urgency === 'emergency' || keywordTriggered;
    if (forceEmergency) {
        urgency = 'emergency';
    }
    return {
        specialty,
        urgency,
        visibleText,
        parseFailed,
        openManualPicker: parseFailed && !forceEmergency,
        forceEmergency,
    };
}
/**
 * Parses optional `[RECOMMEND_DOCTOR: ... | URGENCY: ...]` from Care Assistant chat,
 * removes it from visible text, and enforces emergency safety overrides.
 */
function parseCareChatOutput(rawReply, patientInputText = '') {
    const sanitized = sanitizePlainText(rawReply);
    const lines = sanitized.split('\n');
    const firstLine = (lines[0] || '').trim();
    const recMatch = firstLine.match(/^\[RECOMMEND_DOCTOR:\s*(.+?)\s*\|\s*URGENCY:\s*(\w+)\]/i);
    let recommendedSpecialty = null;
    let urgency = 'routine';
    let visibleText = sanitized;
    if (recMatch) {
        recommendedSpecialty = normalizeSpecialty(recMatch[1]);
        urgency = normalizeUrgency(recMatch[2]);
        visibleText = lines.slice(1).join('\n').trim();
    }
    else {
        visibleText = sanitized.replace(/\[[^\]]*\]/g, '').trim();
    }
    const keywordTriggered = hasEmergencyKeywords(patientInputText) || hasEmergencyKeywords(visibleText);
    const forceEmergency = urgency === 'emergency' || keywordTriggered;
    if (forceEmergency) {
        urgency = 'emergency';
    }
    return {
        visibleText,
        recommendedSpecialty,
        urgency,
        forceEmergency,
    };
}
/**
 * Splits doctor summary text into the 8 required labeled lines, filling gaps with "Not stated"
 * (and "None" for Photos).
 */
function parseSummaryOutput(rawReply) {
    const sanitized = sanitizePlainText(rawReply);
    const result = {
        complaint: 'Not stated',
        duration: 'Not stated',
        severity: 'Not stated',
        medications: 'Not stated',
        allergies: 'Not stated',
        otherConditions: 'Not stated',
        concerns: 'Not stated',
        photos: 'None',
    };
    const labelMap = [
        { key: 'complaint', regex: /^Complaint\s*:\s*(.+)$/i },
        { key: 'duration', regex: /^Duration\s*:\s*(.+)$/i },
        { key: 'severity', regex: /^Severity\s*:\s*(.+)$/i },
        { key: 'medications', regex: /^Medications\s*:\s*(.+)$/i },
        { key: 'allergies', regex: /^Allergies\s*:\s*(.+)$/i },
        { key: 'otherConditions', regex: /^Other\s+conditions\s*:\s*(.+)$/i },
        { key: 'concerns', regex: /^Concerns\s*:\s*(.+)$/i },
        { key: 'photos', regex: /^Photos\s*:\s*(.+)$/i },
    ];
    for (const rawLine of sanitized.split('\n')) {
        const line = rawLine.trim();
        if (!line)
            continue;
        for (const { key, regex } of labelMap) {
            const m = line.match(regex);
            if (m && m[1]) {
                const val = m[1].trim();
                if (val) {
                    result[key] = val;
                }
                break;
            }
        }
    }
    return result;
}
//# sourceMappingURL=sanitizer.js.map