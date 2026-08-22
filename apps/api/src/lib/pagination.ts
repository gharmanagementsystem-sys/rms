import type { PageMeta } from '@rms/shared';

/**
 * Cursor pagination (CLAUDE.md §35).
 *
 * Ids are UUIDv7 and therefore time-ordered, so ordering by id is chronological
 * and a cursor is simply the last id seen. Unlike offset pagination, rows are
 * never duplicated or skipped when the list changes mid-scroll.
 */

/** Prisma arguments for a cursor page. Fetches one extra row to detect `hasMore`. */
export function cursorArgs(limit: number, cursor?: string) {
  return {
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  };
}

/** Trims the sentinel row and builds the page metadata. */
export function toPage<T extends { id: string }>(
  rows: T[],
  limit: number,
): { items: T[]; meta: PageMeta } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    items,
    meta: {
      hasMore,
      nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
    },
  };
}
