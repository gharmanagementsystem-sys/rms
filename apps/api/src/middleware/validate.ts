import type { Request, RequestHandler } from 'express';
import type { ZodError, ZodType, z } from 'zod';
import type { ApiErrorDetail } from '@rms/shared';
import { AppError } from '../errors/app-error';

/**
 * Request validation. CLAUDE.md §30 — validate every external input.
 *
 * Note for Express 5: `req.query` is a getter-only property, so the common
 * Express 4 pattern of overwriting `req.query` with the parsed result throws.
 * Parsed output is therefore written to `req.validated`, which also keeps the
 * raw and coerced values distinguishable.
 */

const SOURCES = ['body', 'query', 'params'] as const;
type Source = (typeof SOURCES)[number];

export interface ValidationSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

export type ValidatedData<S extends ValidationSchemas> = {
  [K in keyof S & Source]: S[K] extends ZodType ? z.output<S[K]> : never;
};

/**
 * Request type for a controller sitting behind `validate(schemas)`.
 *
 * Usage:
 *   const schemas = { body: createPropertySchema } satisfies ValidationSchemas;
 *   router.post('/', validate(schemas), (req: ValidatedRequest<typeof schemas>) => …)
 */
export type ValidatedRequest<S extends ValidationSchemas> = Omit<Request, 'validated'> & {
  validated: ValidatedData<S>;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Populated by `validate()`. Typed per-route via `ValidatedRequest`. */
      validated?: unknown;
    }
  }
}

function toDetails(source: Source, error: ZodError): ApiErrorDetail[] {
  return error.issues.map((issue) => ({
    field: [source, ...issue.path.map((segment) => String(segment))].join('.'),
    message: issue.message,
  }));
}

/**
 * Validates the named request parts against their schemas.
 *
 * All sources are checked before failing, so the client receives every problem
 * at once rather than discovering them one round-trip at a time (§29 — never
 * make the user re-submit repeatedly).
 */
export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req, _res, next) => {
    const details: ApiErrorDetail[] = [];
    const validated: Record<string, unknown> = {};

    for (const source of SOURCES) {
      const schema = schemas[source];
      if (!schema) continue;

      const result = schema.safeParse(req[source]);
      if (result.success) {
        validated[source] = result.data;
      } else {
        details.push(...toDetails(source, result.error));
      }
    }

    if (details.length > 0) {
      next(AppError.validation(details));
      return;
    }

    req.validated = validated;
    next();
  };
}
