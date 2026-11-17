import * as http from 'http';
import { aiTriage, aiPreVisitChat, aiIntakeSummary } from './index';

const PORT = Number(process.env.AI_SERVER_PORT || 5001);
const PROJECT_ID = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || 'hospital-managmentsystem';
const BASE_PREFIX = `/${PROJECT_ID}/us-central1`;

type HandlerFn = (req: any, res: any) => void | Promise<void>;

const ROUTES: Record<string, HandlerFn> = {
  '/aiTriage': aiTriage as unknown as HandlerFn,
  '/aiPreVisitChat': aiPreVisitChat as unknown as HandlerFn,
  '/aiIntakeSummary': aiIntakeSummary as unknown as HandlerFn,
};

function enhanceResponse(res: http.ServerResponse) {
  const enhanced = res as http.ServerResponse & {
    status: (code: number) => typeof enhanced;
    send: (body?: unknown) => void;
    json: (body: unknown) => void;
    set: (name: string, value: string) => void;
  };

  enhanced.status = (code: number) => {
    res.statusCode = code;
    return enhanced;
  };
  enhanced.set = (name: string, value: string) => {
    res.setHeader(name, value);
  };
  enhanced.send = (body?: unknown) => {
    if (body === undefined || body === '') {
      res.end();
    } else if (typeof body === 'string') {
      res.end(body);
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    }
  };
  enhanced.json = (body: unknown) => {
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

  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    let parsedBody: unknown = {};
    if (chunks.length > 0) {
      try {
        parsedBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
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
  console.log(
    `[Spark Prototype AI Server] Listening on http://0.0.0.0:${PORT}${BASE_PREFIX}`
  );
});
