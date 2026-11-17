"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiIntakeSummary = exports.aiPreVisitChat = exports.aiTriage = void 0;
const app_1 = require("firebase-admin/app");
const auth_1 = require("firebase-admin/auth");
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const deepseek_1 = require("./deepseek");
const prompts_1 = require("./prompts");
const sanitizer_1 = require("./sanitizer");
(0, app_1.initializeApp)({
    projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || 'hospital-managmentsystem',
});
const IMAGE_FALLBACK_NOTE = "I couldn't view your photo, but let's continue.";
const TRIAGE_FALLBACK_MESSAGE = "We couldn't check that right now. Let's find a doctor together.";
const CHAT_FALLBACK_MESSAGE = "We couldn't load the next question right now. You can skip ahead or type your notes for the doctor.";
async function verifyCaller(req) {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
        return null;
    }
    const idToken = authHeader.slice(7).trim();
    if (!idToken)
        return null;
    try {
        const decoded = await (0, auth_1.getAuth)().verifyIdToken(idToken);
        let isAdmin = false;
        try {
            const userDoc = await (0, firestore_1.getFirestore)().collection('users').doc(decoded.uid).get();
            isAdmin = userDoc.exists && userDoc.data()?.role === 'admin';
        }
        catch {
            // Local Spark-plan fallback: query Firestore REST API with caller's ID token
            try {
                const projectId = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || 'hospital-managmentsystem';
                const resp = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${decoded.uid}`, { headers: { Authorization: `Bearer ${idToken}` } });
                if (resp.ok) {
                    const doc = (await resp.json());
                    isAdmin = doc.fields?.role?.stringValue === 'admin';
                }
            }
            catch {
                isAdmin = false;
            }
        }
        return { uid: decoded.uid, isAdmin, idToken };
    }
    catch {
        return null;
    }
}
function setCorsHeaders(res) {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}
function buildUserMessageContent(text, imageBlocks) {
    if (imageBlocks.length === 0) {
        return text;
    }
    return [{ type: 'text', text: text || 'Please review the attached photo.' }, ...imageBlocks];
}
/**
 * Streams an OpenAI-compatible SSE response to the client while buffering and sanitizing
 * chunks so <think> tags, markdown, emojis, and the triage header never reach the user.
 */
async function pipeSanitizedStream(deepSeekRes, res, options) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    if (!deepSeekRes.body) {
        res.write(`data: ${JSON.stringify({
            type: 'error',
            fallbackMessage: options.isTriage ? TRIAGE_FALLBACK_MESSAGE : CHAT_FALLBACK_MESSAGE,
            openManualPicker: options.isTriage,
        })}\n\n`);
        res.end();
        return;
    }
    const reader = deepSeekRes.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let sseBuffer = '';
    let fullRawReply = '';
    let sentPrefix = false;
    if (options.imageFailed) {
        res.write(`data: ${JSON.stringify({ type: 'notice', text: IMAGE_FALLBACK_NOTE })}\n\n`);
        sentPrefix = true;
    }
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done)
                break;
            sseBuffer += decoder.decode(value, { stream: true });
            const lines = sseBuffer.split('\n');
            sseBuffer = lines.pop() || '';
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data:'))
                    continue;
                const dataStr = trimmed.slice(5).trim();
                if (dataStr === '[DONE]')
                    continue;
                try {
                    const parsed = JSON.parse(dataStr);
                    const delta = parsed?.choices?.[0]?.delta?.content || '';
                    if (delta) {
                        fullRawReply += delta;
                        // For non-triage chat, stream sanitized deltas once past any <think> block
                        if (!options.isTriage && !fullRawReply.includes('<think>')) {
                            const cleanDelta = (0, sanitizer_1.sanitizePlainText)(delta);
                            if (cleanDelta) {
                                res.write(`data: ${JSON.stringify({
                                    type: 'delta',
                                    text: sentPrefix ? cleanDelta : cleanDelta,
                                })}\n\n`);
                            }
                        }
                    }
                }
                catch {
                    // Ignore malformed SSE frame
                }
            }
        }
        if (options.isTriage) {
            const parsedTriage = (0, sanitizer_1.parseTriageOutput)(fullRawReply, options.patientText);
            const visibleText = options.imageFailed
                ? `${IMAGE_FALLBACK_NOTE} ${parsedTriage.visibleText}`.trim()
                : parsedTriage.visibleText;
            res.write(`data: ${JSON.stringify({
                type: 'done',
                specialty: parsedTriage.specialty,
                urgency: parsedTriage.urgency,
                text: visibleText || TRIAGE_FALLBACK_MESSAGE,
                openManualPicker: parsedTriage.openManualPicker,
                forceEmergency: parsedTriage.forceEmergency,
                imageFailed: options.imageFailed,
            })}\n\n`);
        }
        else {
            const parsedChat = (0, sanitizer_1.parseCareChatOutput)(fullRawReply, options.patientText);
            const finalText = options.imageFailed
                ? `${IMAGE_FALLBACK_NOTE} ${parsedChat.visibleText}`.trim()
                : parsedChat.visibleText;
            res.write(`data: ${JSON.stringify({
                type: 'done',
                text: finalText || CHAT_FALLBACK_MESSAGE,
                recommendedSpecialty: parsedChat.recommendedSpecialty,
                urgency: parsedChat.urgency,
                forceEmergency: parsedChat.forceEmergency,
                imageFailed: options.imageFailed,
            })}\n\n`);
        }
    }
    catch {
        res.write(`data: ${JSON.stringify({
            type: 'error',
            fallbackMessage: options.isTriage ? TRIAGE_FALLBACK_MESSAGE : CHAT_FALLBACK_MESSAGE,
            openManualPicker: options.isTriage,
        })}\n\n`);
    }
    finally {
        res.end();
    }
}
/**
 * 1. Patient Symptom Triage Cloud Function
 * Supports text + up to 3 private Storage image paths, streaming or JSON.
 */
exports.aiTriage = (0, https_1.onRequest)({ timeoutSeconds: 30, memory: '512MiB' }, async (req, res) => {
    setCorsHeaders(res);
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).json({ ok: false, fallbackMessage: TRIAGE_FALLBACK_MESSAGE });
        return;
    }
    const caller = await verifyCaller(req);
    if (!caller) {
        res.status(401).json({ ok: false, fallbackMessage: TRIAGE_FALLBACK_MESSAGE });
        return;
    }
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    const imagePaths = Array.isArray(req.body?.imagePaths) ? req.body.imagePaths : [];
    const stream = Boolean(req.body?.stream);
    // Immediate deterministic emergency check before calling model
    if ((0, sanitizer_1.hasEmergencyKeywords)(text)) {
        res.status(200).json({
            ok: true,
            specialty: 'General Practice',
            urgency: 'emergency',
            text: 'Please seek emergency medical care right away.',
            openManualPicker: false,
            forceEmergency: true,
            imageFailed: false,
        });
        return;
    }
    let tempFiles = [];
    try {
        const { imageBlocks, imageFailed, tempFiles: downloaded } = await (0, deepseek_1.prepareImageBlocks)(imagePaths, caller.uid, caller.isAdmin, caller.idToken);
        tempFiles = downloaded;
        const messages = [
            { role: 'system', content: prompts_1.TRIAGE_SYSTEM_PROMPT },
            { role: 'user', content: buildUserMessageContent(text, imageBlocks) },
        ];
        const deepSeekRes = await (0, deepseek_1.callDeepSeekChat)({
            messages,
            maxTokens: 300,
            hasImages: imageBlocks.length > 0,
            stream,
        });
        if (!deepSeekRes.ok) {
            res.status(200).json({
                ok: false,
                fallbackMessage: TRIAGE_FALLBACK_MESSAGE,
                openManualPicker: true,
            });
            return;
        }
        if (stream) {
            await pipeSanitizedStream(deepSeekRes, res, {
                isTriage: true,
                patientText: text,
                imageFailed,
            });
            return;
        }
        const json = (await deepSeekRes.json());
        const rawReply = json?.choices?.[0]?.message?.content || '';
        const parsed = (0, sanitizer_1.parseTriageOutput)(rawReply, text);
        const visibleText = imageFailed
            ? `${IMAGE_FALLBACK_NOTE} ${parsed.visibleText}`.trim()
            : parsed.visibleText;
        res.status(200).json({
            ok: true,
            specialty: parsed.specialty,
            urgency: parsed.urgency,
            text: visibleText || TRIAGE_FALLBACK_MESSAGE,
            openManualPicker: parsed.openManualPicker,
            forceEmergency: parsed.forceEmergency,
            imageFailed,
        });
    }
    catch {
        res.status(200).json({
            ok: false,
            fallbackMessage: TRIAGE_FALLBACK_MESSAGE,
            openManualPicker: true,
        });
    }
    finally {
        await (0, deepseek_1.cleanupTempFiles)(tempFiles);
    }
});
/**
 * 2. Patient Pre-Visit Questions Chat Cloud Function
 * Supports text + up to 3 private Storage image paths, streaming or JSON.
 */
exports.aiPreVisitChat = (0, https_1.onRequest)({ timeoutSeconds: 30, memory: '512MiB' }, async (req, res) => {
    setCorsHeaders(res);
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).json({ ok: false, fallbackMessage: CHAT_FALLBACK_MESSAGE });
        return;
    }
    const caller = await verifyCaller(req);
    if (!caller) {
        res.status(401).json({ ok: false, fallbackMessage: CHAT_FALLBACK_MESSAGE });
        return;
    }
    const history = Array.isArray(req.body?.messages)
        ? req.body.messages
        : [];
    const imagePaths = Array.isArray(req.body?.imagePaths) ? req.body.imagePaths : [];
    const stream = Boolean(req.body?.stream);
    const mode = req.body?.mode === 'general' ? 'general' : 'previsit';
    const systemPrompt = mode === 'general' ? prompts_1.CARE_ASSISTANT_CHAT_PROMPT : prompts_1.PREVISIT_CHAT_SYSTEM_PROMPT;
    const lastUserText = [...history].reverse().find((m) => m.role === 'user')?.text || '';
    if ((0, sanitizer_1.hasEmergencyKeywords)(lastUserText)) {
        res.status(200).json({
            ok: true,
            forceEmergency: true,
            text: 'Please seek emergency medical care right away.',
        });
        return;
    }
    let tempFiles = [];
    try {
        const { imageBlocks, imageFailed, tempFiles: downloaded } = await (0, deepseek_1.prepareImageBlocks)(imagePaths, caller.uid, caller.isAdmin, caller.idToken);
        tempFiles = downloaded;
        const messages = [
            { role: 'system', content: systemPrompt },
            ...history.map((msg, idx) => {
                const isLastUser = idx === history.length - 1 && msg.role === 'user';
                return {
                    role: msg.role,
                    content: isLastUser
                        ? buildUserMessageContent(msg.text, imageBlocks)
                        : msg.text,
                };
            }),
        ];
        const deepSeekRes = await (0, deepseek_1.callDeepSeekChat)({
            messages,
            maxTokens: 300,
            hasImages: imageBlocks.length > 0,
            stream,
        });
        if (!deepSeekRes.ok) {
            res.status(200).json({ ok: false, fallbackMessage: CHAT_FALLBACK_MESSAGE });
            return;
        }
        if (stream) {
            await pipeSanitizedStream(deepSeekRes, res, {
                isTriage: false,
                patientText: lastUserText,
                imageFailed,
            });
            return;
        }
        const json = (await deepSeekRes.json());
        const rawReply = json?.choices?.[0]?.message?.content || '';
        const parsedChat = (0, sanitizer_1.parseCareChatOutput)(rawReply, lastUserText);
        const finalText = imageFailed
            ? `${IMAGE_FALLBACK_NOTE} ${parsedChat.visibleText}`.trim()
            : parsedChat.visibleText;
        res.status(200).json({
            ok: true,
            text: finalText || CHAT_FALLBACK_MESSAGE,
            recommendedSpecialty: parsedChat.recommendedSpecialty,
            urgency: parsedChat.urgency,
            forceEmergency: parsedChat.forceEmergency,
            imageFailed,
        });
    }
    catch {
        res.status(200).json({ ok: false, fallbackMessage: CHAT_FALLBACK_MESSAGE });
    }
    finally {
        await (0, deepseek_1.cleanupTempFiles)(tempFiles);
    }
});
/**
 * 3. Doctor Intake Summary Cloud Function
 * Produces structured 8-line summary including "Photos: <plain description or None>".
 */
exports.aiIntakeSummary = (0, https_1.onRequest)({ timeoutSeconds: 30, memory: '512MiB' }, async (req, res) => {
    setCorsHeaders(res);
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).json({ ok: false });
        return;
    }
    const caller = await verifyCaller(req);
    if (!caller || !caller.isAdmin) {
        res.status(403).json({ ok: false });
        return;
    }
    const transcriptText = typeof req.body?.transcript === 'string' ? req.body.transcript.trim() : '';
    const imagePaths = Array.isArray(req.body?.imagePaths) ? req.body.imagePaths : [];
    let tempFiles = [];
    try {
        const { imageBlocks, imageFailed, tempFiles: downloaded } = await (0, deepseek_1.prepareImageBlocks)(imagePaths, caller.uid, true, caller.idToken);
        tempFiles = downloaded;
        const messages = [
            { role: 'system', content: prompts_1.DOCTOR_SUMMARY_SYSTEM_PROMPT },
            {
                role: 'user',
                content: buildUserMessageContent(transcriptText || 'No text transcript provided.', imageBlocks),
            },
        ];
        const deepSeekRes = await (0, deepseek_1.callDeepSeekChat)({
            messages,
            maxTokens: 250,
            hasImages: imageBlocks.length > 0,
            stream: false,
        });
        if (!deepSeekRes.ok) {
            res.status(200).json({ ok: false });
            return;
        }
        const json = (await deepSeekRes.json());
        const rawReply = json?.choices?.[0]?.message?.content || '';
        const summary = (0, sanitizer_1.parseSummaryOutput)(rawReply);
        if (imageFailed && summary.photos === 'None' && imagePaths.length > 0) {
            summary.photos = IMAGE_FALLBACK_NOTE;
        }
        res.status(200).json({
            ok: true,
            summary,
            imageFailed,
        });
    }
    catch {
        res.status(200).json({ ok: false });
    }
    finally {
        await (0, deepseek_1.cleanupTempFiles)(tempFiles);
    }
});
//# sourceMappingURL=index.js.map