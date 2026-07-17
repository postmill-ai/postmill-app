import { describe, it, expect } from 'vitest';
import dayjs from 'dayjs';
import { AnalyticsLiveFallbackService } from './analytics-live-fallback';

// convertLiveToSnapshots is a pure transform (no injected deps used), so a
// bare-constructed instance is enough to exercise the R4.1 hardening.
const svc = new AnalyticsLiveFallbackService(
  null as any,
  null as any,
  null as any
);

describe('convertLiveToSnapshots (R4.1)', () => {
  const from = new Date('2026-01-01T00:00:00.000Z');
  const to = new Date('2026-02-01T00:00:00.000Z');

  it('skips items without a usable label instead of throwing (label: undefined)', () => {
    const providerData = {
      int1: [
        { label: undefined, data: [{ date: '2026-01-15', total: 99 }] },
        { label: 'Likes', data: [{ date: '2026-01-15', total: 5 }] },
      ],
    } as any;

    let rows: any[] = [];
    expect(() => {
      rows = svc.convertLiveToSnapshots(
        providerData,
        'org-1',
        { int1: 'instagram' },
        from,
        to
      );
    }).not.toThrow();

    // only the valid item produced a row
    expect(rows).toHaveLength(1);
    expect(rows[0].metric).toBe('likes');
    expect(rows[0].value).toBe(5);
  });

  it('normalizes a timestamped datapoint onto the midnight date', () => {
    const providerData = {
      int1: [
        {
          label: 'Likes',
          data: [{ date: '2026-01-15T13:45:12.000Z', total: 7 }],
        },
      ],
    } as any;

    const rows = svc.convertLiveToSnapshots(
      providerData,
      'org-1',
      { int1: 'instagram' },
      from,
      to
    );

    expect(rows).toHaveLength(1);
    // persisted at local midnight so it collides with the daily-sweep key
    // instead of adding a second same-day row.
    expect(dayjs(rows[0].date).format('HH:mm:ss')).toBe('00:00:00');
    expect(dayjs(rows[0].date).isSame(dayjs('2026-01-15'), 'day')).toBe(true);
  });
});
