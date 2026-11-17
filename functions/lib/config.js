"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALLOWED_SPECIALTIES = void 0;
exports.getDeepSeekConfig = getDeepSeekConfig;
const path = __importStar(require("path"));
const dotenv = __importStar(require("dotenv"));
// Load root .env when running locally or in emulators without overwriting existing process.env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });
/**
 * Reads DeepSeek configuration exclusively from server-side environment variables.
 * Never hardcode keys or expose them to the mobile client.
 */
function getDeepSeekConfig() {
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
exports.ALLOWED_SPECIALTIES = [
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
];
//# sourceMappingURL=config.js.map