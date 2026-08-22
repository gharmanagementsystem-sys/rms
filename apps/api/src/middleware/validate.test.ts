import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import { createTestApp } from '../testing/create-test-app';
import { validate, type ValidatedRequest, type ValidationSchemas } from './validate';

const bodySchema = z.object({
  name: z.string().min(1),
  amountPaisa: z.number().int().nonnegative(),
});

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const paramsSchema = z.object({
  id: z.uuid(),
});

describe('validate()', () => {
  it('passes parsed data to the handler on success', async () => {
    const schemas = { body: bodySchema } satisfies ValidationSchemas;
    const app = createTestApp((router) => {
      router.post('/items', validate(schemas), (req, res) => {
        const { body } = (req as ValidatedRequest<typeof schemas>).validated;
        res.json({ received: body });
      });
    });

    const response = await request(app)
      .post('/test/items')
      .send({ name: 'Flat A', amountPaisa: 1500000 });

    expect(response.status).toBe(200);
    expect(response.body.received).toEqual({ name: 'Flat A', amountPaisa: 1500000 });
  });

  it('applies schema coercion and defaults to the query string', async () => {
    const schemas = { query: querySchema } satisfies ValidationSchemas;
    const app = createTestApp((router) => {
      router.get('/items', validate(schemas), (req, res) => {
        const { query } = (req as ValidatedRequest<typeof schemas>).validated;
        res.json({ query });
      });
    });

    const coerced = await request(app).get('/test/items?limit=50');
    expect(coerced.body.query.limit).toBe(50);
    expect(typeof coerced.body.query.limit).toBe('number');

    const defaulted = await request(app).get('/test/items');
    expect(defaulted.body.query.limit).toBe(20);
  });

  it('rejects invalid input as VALIDATION_ERROR, not a 500', async () => {
    const schemas = { body: bodySchema } satisfies ValidationSchemas;
    const app = createTestApp((router) => {
      router.post('/items', validate(schemas), (_req, res) => res.json({ ok: true }));
    });

    const response = await request(app).post('/test/items').send({ amountPaisa: -5 });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('prefixes each field with its source so body/query/params never collide', async () => {
    const schemas = {
      body: bodySchema,
      query: querySchema,
      params: paramsSchema,
    } satisfies ValidationSchemas;

    const app = createTestApp((router) => {
      router.post('/items/:id', validate(schemas), (_req, res) => res.json({ ok: true }));
    });

    const response = await request(app)
      .post('/test/items/not-a-uuid?limit=999')
      .send({ amountPaisa: 'nope' });

    expect(response.status).toBe(422);

    const fields: string[] = response.body.error.details.map(
      (detail: { field: string }) => detail.field,
    );

    // Every source is reported in one response — the client should not have to
    // resubmit repeatedly to discover the next problem (CLAUDE.md §29).
    expect(fields).toContain('body.name');
    expect(fields).toContain('body.amountPaisa');
    expect(fields).toContain('query.limit');
    expect(fields).toContain('params.id');
  });

  it('reports every issue in one response rather than stopping at the first', async () => {
    const schemas = { body: bodySchema } satisfies ValidationSchemas;
    const app = createTestApp((router) => {
      router.post('/items', validate(schemas), (_req, res) => res.json({ ok: true }));
    });

    const response = await request(app).post('/test/items').send({});

    expect(response.body.error.details).toHaveLength(2);
  });

  it('does not attempt to assign req.query, which is read-only in Express 5', async () => {
    const schemas = { query: querySchema } satisfies ValidationSchemas;
    const app = createTestApp((router) => {
      router.get('/items', validate(schemas), (req, res) => {
        // The raw query must survive untouched alongside the parsed copy.
        res.json({ raw: req.query, parsed: (req as ValidatedRequest<typeof schemas>).validated });
      });
    });

    const response = await request(app).get('/test/items?limit=7');

    expect(response.status).toBe(200);
    expect(response.body.raw.limit).toBe('7');
    expect(response.body.parsed.query.limit).toBe(7);
  });
});
