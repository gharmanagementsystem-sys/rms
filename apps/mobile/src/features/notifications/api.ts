import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationType, PageMeta } from '@rms/shared';
import { api } from '../../api/client';

/**
 * Notification history. CLAUDE.md §17, §39.
 *
 * The database is the source of truth, not FCM. A user who denied push
 * permission, or whose phone was off when a reminder fired, still sees
 * everything here — which is why this screen exists at all rather than relying
 * on the OS notification tray.
 */

export const notificationKeys = {
  all: ['notifications'] as const,
  list: () => [...notificationKeys.all, 'list'] as const,
};

export interface NotificationResponse {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Stable identifiers only — the app resolves the destination itself (§39). */
  data: Record<string, unknown> | null;
  rentalId: string | null;
  periodId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPage {
  data: NotificationResponse[];
  meta: PageMeta & { unreadCount: number };
}

export function useNotifications() {
  return useQuery({
    queryKey: notificationKeys.list(),
    queryFn: () => api.get<NotificationPage>('/api/v1/notifications?limit=50'),
  });
}

/**
 * The unread badge.
 *
 * Reads the list query's own cache rather than issuing a second request — the
 * count already arrives in that response's meta, and a separate endpoint would
 * be a second source of truth that could disagree with the list on screen.
 */
export function useUnreadCount(): number {
  const query = useNotifications();
  return query.data?.meta.unreadCount ?? 0;
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.patch<void>(`/api/v1/notifications/${id}/read`),

    /**
     * Optimistic, because tapping a notification navigates away immediately and
     * waiting for a round trip would leave the row looking unread on the way
     * out. The snapshot is restored on failure so the UI never keeps a state
     * the server rejected.
     */
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: notificationKeys.list() });
      const previous = queryClient.getQueryData<NotificationPage>(notificationKeys.list());

      if (previous) {
        const now = new Date().toISOString();
        queryClient.setQueryData<NotificationPage>(notificationKeys.list(), {
          ...previous,
          data: previous.data.map((item) =>
            item.id === id && item.readAt === null ? { ...item, readAt: now } : item,
          ),
          meta: {
            ...previous.meta,
            unreadCount: Math.max(
              0,
              previous.meta.unreadCount -
                (previous.data.find((item) => item.id === id)?.readAt === null ? 1 : 0),
            ),
          },
        });
      }

      return { previous };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(notificationKeys.list(), context.previous);
      }
    },
    // Reconcile with the server either way: the optimistic count is an estimate.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ markedRead: number }>('/api/v1/notifications/read-all'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}

export interface TestNotificationResult {
  notificationId: string;
  /** Devices with a non-revoked token registered for this user. */
  registeredDevices: number;
  delivered: number;
  failed: number;
}

/**
 * Sends the signed-in user a real push through the real pipeline, so a
 * screen can answer "is push actually working on this device?" without
 * needing database access (CLAUDE.md §39).
 */
export function useSendTestNotification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<TestNotificationResult>('/api/v1/notifications/test'),
    onSuccess: () => {
      // It should show up in history immediately, like any other notification.
      void queryClient.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}
