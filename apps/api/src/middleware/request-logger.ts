import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import pinoHttp from 'pino-http';
import { logger } from '../services/logger';

/**
 * A client-supplied request id is echoed into every log line, so it must be
 * validated before use. An unvalidated header is a log-injection vector and an
 * unbounded-length one at that.
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

const LIVENESS_PATH = '/api/v1/health';

/**
 * Request logging and correlation ids. CLAUDE.md §40, §65.
 *
 * Also the source of `req.id`, which the error handler returns to the client so
 * a user-reported failure can be traced to an exact log line.
 */
export const requestLogger = pinoHttp({
  logger,

  genReqId: (req: IncomingMessage, res: ServerResponse): string => {
    const incoming = req.headers['x-request-id'];
    const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
    const id = candidate && SAFE_REQUEST_ID.test(candidate) ? candidate : randomUUID();
    res.setHeader('x-request-id', id);
    return id;
  },

  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },

  // Render polls the liveness probe continuously; logging it would bury real
  // traffic. The readiness probe (/health/ready) is still logged because a
  // failure there is operationally meaningful.
  autoLogging: {
    ignore: (req: IncomingMessage) => req.url === LIVENESS_PATH,
  },

  // Deliberately narrow. The default serializer would log every header; request
  // and response bodies are never serialized at all (see services/logger.ts).
  serializers: {
    req: (req: IncomingMessage & { method?: string; url?: string }) => ({
      method: req.method,
      url: req.url,
    }),
    res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
  },
});
