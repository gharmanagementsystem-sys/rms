import { describe, expect, it } from 'vitest';
import { buildDeepLinkData, composeContent, planPeriodNotifications } from './notification-policy';

const base = {
  periodId: 'period-1',
  rentalId: 'rental-1',
  dueDate: '2026-08-01',
  balancePaisa: 1500000,
  overdueAfterDays: 5,
  reminderDays: [7, 1, 0] as const,
};

const on = (asOf: string, overrides = {}) =>
  planPeriodNotifications({ ...base, ...overrides, asOf });

describe('upcoming rent', () => {
  it('reminds on each configured day before the due date', () => {
    expect(on('2026-07-25')[0]?.type).toBe('RENT_DUE_SOON'); // 7 days
    expect(on('2026-07-31')[0]?.type).toBe('RENT_DUE_SOON'); // 1 day
  });

  it('says nothing on days that were not configured', () => {
    expect(on('2026-07-28')).toEqual([]); // 4 days out
    expect(on('2026-07-20')).toEqual([]); // 12 days out
  });

  it('honours a user-configured reminder schedule', () => {
    expect(on('2026-07-29', { reminderDays: [3] })[0]?.type).toBe('RENT_DUE_SOON');
    expect(on('2026-07-25', { reminderDays: [3] })).toEqual([]);
  });
});

describe('due today', () => {
  it('fires on the due date', () => {
    const planned = on('2026-08-01');
    expect(planned[0]).toMatchObject({ type: 'RENT_DUE_TODAY', targetDate: '2026-08-01' });
  });

  it('sends exactly one notification, not a reminder as well', () => {
    expect(on('2026-08-01')).toHaveLength(1);
  });
});

describe('overdue', () => {
  it('stays silent during the grace period', () => {
    expect(on('2026-08-03')).toEqual([]);
    expect(on('2026-08-06')).toEqual([]); // last day of grace
  });

  it('fires once grace has passed', () => {
    // Grace ends 2026-08-06; the first chase is 7 days later.
    expect(on('2026-08-13')[0]?.type).toBe('RENT_OVERDUE');
  });

  it('repeats weekly rather than daily', () => {
    expect(on('2026-08-13')[0]?.type).toBe('RENT_OVERDUE');
    expect(on('2026-08-14')).toEqual([]);
    expect(on('2026-08-19')).toEqual([]);
    expect(on('2026-08-20')[0]?.type).toBe('RENT_OVERDUE'); // 14 days after grace
  });
});

describe('nothing owed', () => {
  it('never notifies about a settled period', () => {
    for (const asOf of ['2026-07-25', '2026-08-01', '2026-08-13', '2026-09-30']) {
      expect(on(asOf, { balancePaisa: 0 })).toEqual([]);
    }
  });
});

describe('deduplication (§18)', () => {
  it('produces a stable key for the same logical notification', () => {
    // The scheduler running hourly must not send "rent due" three times.
    const morning = on('2026-08-01')[0]!;
    const noon = on('2026-08-01')[0]!;
    const evening = on('2026-08-01')[0]!;

    expect(morning.dedupeKey).toBe(noon.dedupeKey);
    expect(noon.dedupeKey).toBe(evening.dedupeKey);
    expect(morning.dedupeKey).toBe('RENT_DUE_TODAY:period-1:2026-08-01');
  });

  it('gives each reminder day its own key so none is swallowed', () => {
    // Keying reminders to the DUE date would make the 7-day and 1-day
    // reminders identical, and the second would be discarded as a duplicate.
    const sevenDay = on('2026-07-25')[0]!.dedupeKey;
    const oneDay = on('2026-07-31')[0]!.dedupeKey;

    expect(sevenDay).toBe('RENT_DUE_SOON:period-1:2026-07-25');
    expect(oneDay).toBe('RENT_DUE_SOON:period-1:2026-07-31');
    expect(sevenDay).not.toBe(oneDay);
  });

  it('is still stable across repeated runs on the same day', () => {
    expect(on('2026-07-25')[0]?.dedupeKey).toBe(on('2026-07-25')[0]?.dedupeKey);
  });

  it('gives each overdue chase its own key so it can fire again', () => {
    const first = on('2026-08-13')[0]!;
    const second = on('2026-08-20')[0]!;
    expect(first.dedupeKey).not.toBe(second.dedupeKey);
    expect(first.dedupeKey).toBe('RENT_OVERDUE:period-1:2026-08-13');
  });

  it('keeps keys distinct across periods and types', () => {
    const keys = new Set<string>();
    for (const periodId of ['p1', 'p2', 'p3']) {
      for (const asOf of ['2026-07-25', '2026-07-31', '2026-08-01', '2026-08-13', '2026-08-20']) {
        for (const planned of on(asOf, { periodId })) keys.add(planned.dedupeKey);
      }
    }
    // 3 periods × (7-day + 1-day + due-today + 2 overdue chases) = 15.
    expect(keys.size).toBe(15);
  });

  it('is deterministic — a repeated run produces identical output', () => {
    for (const asOf of ['2026-07-25', '2026-08-01', '2026-08-13']) {
      expect(on(asOf)).toEqual(on(asOf));
    }
  });
});

describe('a full period lifecycle', () => {
  it('sends a bounded, predictable set of notifications', () => {
    const sent: string[] = [];
    // Simulate the scheduler running every day for two months.
    for (let day = 0; day < 60; day += 1) {
      const date = new Date(Date.UTC(2026, 6, 20 + day)).toISOString().slice(0, 10);
      for (const planned of on(date)) sent.push(planned.dedupeKey);
    }

    // Every key is unique — no duplicate ever reaches the user.
    expect(new Set(sent).size).toBe(sent.length);
    // 7-day, 1-day, due-today, then a weekly chase — not 60 messages.
    expect(sent.length).toBe(9);
    expect(sent.slice(0, 3)).toEqual([
      'RENT_DUE_SOON:period-1:2026-07-25',
      'RENT_DUE_SOON:period-1:2026-07-31',
      'RENT_DUE_TODAY:period-1:2026-08-01',
    ]);
  });
});

describe('message content', () => {
  it('reads as whole sentences, not assembled fragments (§27)', () => {
    expect(
      composeContent('RENT_DUE_SOON', {
        amountLabel: 'रु 15,000',
        placeLabel: 'Room 1',
        daysUntilDue: 7,
      }),
    ).toEqual({ title: 'Rent due soon', body: 'रु 15,000 for Room 1 is due in 7 days.' });
  });

  it('gets singular and plural right', () => {
    expect(
      composeContent('RENT_DUE_SOON', { amountLabel: 'रु 1', placeLabel: 'X', daysUntilDue: 1 })
        .body,
    ).toContain('1 day.');
    expect(
      composeContent('RENT_OVERDUE', { amountLabel: 'रु 1', placeLabel: 'X', daysUntilDue: -1 })
        .body,
    ).toContain('1 day overdue.');
  });
});

describe('deep link payload (§39)', () => {
  it('carries stable identifiers, never a UI route', () => {
    const planned = on('2026-08-01')[0]!;
    const data = buildDeepLinkData(planned);

    expect(data).toEqual({
      type: 'RENT_DUE_TODAY',
      rentalId: 'rental-1',
      periodId: 'period-1',
    });
    // No screen names or paths — the app resolves the destination itself.
    expect(JSON.stringify(data)).not.toMatch(/screen|route|\//i);
  });
});
