import { z } from 'zod';
import { UNIT_AVAILABILITIES, UNIT_TYPES } from '../domain';
import { nepaliAddressSchema, paginationQuerySchema } from './common';

/** Properties (CLAUDE.md §10, §30). */

export const createPropertySchema = nepaliAddressSchema.extend({
  name: z.string().trim().min(1, 'Give the property a name').max(120),
});

export const updatePropertySchema = createPropertySchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });

export const listPropertiesQuerySchema = paginationQuerySchema.extend({
  /** Free-text match on the property name (§35 — filter on the backend). */
  search: z.string().trim().min(1).max(120).optional(),
  includeArchived: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .default(false),
});

export type CreatePropertyInput = z.infer<typeof createPropertySchema>;
export type UpdatePropertyInput = z.infer<typeof updatePropertySchema>;
export type ListPropertiesQuery = z.infer<typeof listPropertiesQuerySchema>;

/** Units (CLAUDE.md §10, §22). */

export const createUnitSchema = z.object({
  label: z.string().trim().min(1, 'Give the unit a name, for example "Room 1"').max(80),
  type: z.enum(UNIT_TYPES),
  floor: z.string().trim().min(1).max(40).optional(),
  /**
   * Optional parent unit, for a room inside a flat. The service verifies the
   * parent belongs to the same property — a client-supplied id is a request,
   * never a permission (§30).
   */
  parentUnitId: z.uuid().optional(),
});

export const updateUnitSchema = z
  .object({
    label: z.string().trim().min(1).max(80).optional(),
    type: z.enum(UNIT_TYPES).optional(),
    floor: z.string().trim().min(1).max(40).optional(),
    /**
     * Owner-controlled state only. OCCUPIED is not accepted here because
     * occupancy is derived from active rentals, never set by hand (§22).
     */
    availability: z.enum(UNIT_AVAILABILITIES).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });

export const listUnitsQuerySchema = paginationQuerySchema.extend({
  availability: z.enum(UNIT_AVAILABILITIES).optional(),
  /** Filter to units with, or without, a current tenant. */
  occupied: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  includeArchived: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .default(false),
});

export type CreateUnitInput = z.infer<typeof createUnitSchema>;
export type UpdateUnitInput = z.infer<typeof updateUnitSchema>;
export type ListUnitsQuery = z.infer<typeof listUnitsQuerySchema>;
