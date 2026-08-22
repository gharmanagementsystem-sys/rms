import { describe, expect, it } from 'vitest';
import { cursorArgs, toPage } from './pagination';

const rows = (count: number) => Array.from({ length: count }, (_, i) => ({ id: `id-${i}` }));

describe('cursorArgs', () => {
  it('fetches one extra row so hasMore can be detected without a count query', () => {
    expect(cursorArgs(20)).toEqual({ take: 21 });
  });

  it('skips the cursor row itself', () => {
    expect(cursorArgs(20, 'abc')).toEqual({ take: 21, cursor: { id: 'abc' }, skip: 1 });
  });
});

describe('toPage', () => {
  it('reports no more pages when the result fits', () => {
    const { items, meta } = toPage(rows(5), 20);
    expect(items).toHaveLength(5);
    expect(meta).toEqual({ hasMore: false, nextCursor: null });
  });

  it('trims the sentinel row and returns a cursor', () => {
    const { items, meta } = toPage(rows(21), 20);
    expect(items).toHaveLength(20);
    expect(meta.hasMore).toBe(true);
    // The cursor is the last returned item, not the sentinel.
    expect(meta.nextCursor).toBe('id-19');
  });

  it('handles an exactly-full page as the final page', () => {
    const { items, meta } = toPage(rows(20), 20);
    expect(items).toHaveLength(20);
    expect(meta.hasMore).toBe(false);
  });

  it('handles an empty result', () => {
    const { items, meta } = toPage([], 20);
    expect(items).toEqual([]);
    expect(meta).toEqual({ hasMore: false, nextCursor: null });
  });
});
