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
const http = __importStar(require("http"));
const index_1 = require("./index");
const PORT = Number(process.env.AI_SERVER_PORT || 5001);
const PROJECT_ID = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || 'hospital-managmentsystem';
const BASE_PREFIX = `/${PROJECT_ID}/us-central1`;
const ROUTES = {
    '/aiTriage': index_1.aiTriage,
    '/aiPreVisitChat': index_1.aiPreVisitChat,
    '/aiIntakeSummary': index_1.aiIntakeSummary,
};
function enhanceResponse(res) {
    const enhanced = res;
    enhanced.status = (code) => {
        res.statusCode = code;
        return enhanced;
    };
    enhanced.set = (name, value) => {
        res.setHeader(name, value);
    };
    enhanced.send = (body) => {
        if (body === undefined || body === '') {
            res.end();
        }
        else if (typeof body === 'string') {
            res.end(body);
        }
        else {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(body));
        }
    };
    enhanced.json = (body) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(body));
    };
    return enhanced;
}
const server = http.createServer((req, res) => {
    const rawUrl = (req.url || '/').split('?')[0];
    const normalizedPath = rawUrl.startsWith(BASE_PREFIX)
        ? rawUrl.slice(BASE_PREFIX.length) || '/'
        : rawUrl;
    const handler = ROUTES[normalizedPath];
    if (!handler) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: false, error: 'Not found' }));
        return;
    }
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
        let parsedBody = {};
        if (chunks.length > 0) {
            try {
                parsedBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            }
            catch {
                parsedBody = {};
            }
        }
        const enhancedReq = Object.assign(req, { body: parsedBody });
        const enhancedRes = enhanceResponse(res);
        Promise.resolve(handler(enhancedReq, enhancedRes)).catch(() => {
            if (!res.headersSent) {
                res.statusCode = 500;
                res.end(JSON.stringify({ ok: false }));
            }
        });
    });
});
server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Spark Prototype AI Server] Listening on http://0.0.0.0:${PORT}${BASE_PREFIX}`);
});
//# sourceMappingURL=localServer.js.map