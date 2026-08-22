import { useQuery } from '@tanstack/react-query';
import type { DashboardResponse } from '@rms/shared';
import { api } from '../../api/client';

export const dashboardKey = ['dashboard'] as const;

/**
 * The home screen's data.
 *
 * One request rather than several, so the screen renders in a single pass
 * instead of assembling itself as calls resolve.
 *
 * `staleTime` is deliberately short: a landlord who has just recorded a payment
 * expects the figures to move. The default 60s would leave them looking at a
 * stale balance and wondering whether the payment saved.
 */
export function useDashboard() {
  return useQuery({
    queryKey: dashboardKey,
    queryFn: () => api.get<DashboardResponse>('/api/v1/dashboard'),
    staleTime: 15_000,
  });
}
