import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { UseQueryResult } from '@tanstack/react-query';
import { ApiError } from '../../api/client';
import { Button } from './Button';
import { Skeleton } from './Skeleton';
import { Text } from './Text';

/** A generic stand-in shape for whatever the screen would otherwise show —
 *  one wider block (a hero or a header row) above a short list of rows. Most
 *  screens in this app are some variation of that shape, which is what makes
 *  a shared default worthwhile instead of every screen building its own. */
function DefaultSkeleton() {
  return (
    <View className="gap-3 p-5">
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-2/3" />
    </View>
  );
}

/**
 * The five states every network-driven screen must handle (CLAUDE.md §41, §42).
 *
 * Exists so that doing the right thing is easier than not: a screen that uses
 * this cannot accidentally ship a blank rectangle for its loading state or a
 * bare "No data" for its empty one.
 */

export interface QueryStateViewProps<T> {
  query: UseQueryResult<T, unknown>;
  /** True when the request succeeded but there is nothing to show. */
  isEmpty?: (data: T) => boolean;
  empty?: { title: string; body: string; actionLabel?: string; onAction?: () => void };
  /** Rendered while loading. A skeleton matching the real layout beats a spinner. */
  skeleton?: React.ReactNode;
  children: (data: T) => React.ReactNode;
}

export function QueryStateView<T>({
  query,
  isEmpty,
  empty,
  skeleton,
  children,
}: QueryStateViewProps<T>) {
  const { t } = useTranslation();

  if (query.isPending) {
    return <View className="flex-1">{skeleton ?? <DefaultSkeleton />}</View>;
  }

  if (query.isError) {
    const error = query.error;
    const retryable = !(error instanceof ApiError) || error.isRetryable;

    return (
      <View className="flex-1 items-center justify-center gap-2 p-6">
        <Text variant="h2">{t('states.errorTitle')}</Text>
        <Text variant="bodySm" tone="secondary" className="text-center">
          {t('states.errorBody')}
        </Text>
        {/* Retrying a validation failure would just fail again, so the action
            is only offered when it could actually help. */}
        {retryable ? (
          <Button
            label={t('actions.retry')}
            variant="secondary"
            onPress={() => void query.refetch()}
            className="mt-2"
          />
        ) : null}
        {error instanceof ApiError && error.requestId ? (
          <Text variant="caption" tone="secondary" className="mt-2">
            {error.requestId}
          </Text>
        ) : null}
      </View>
    );
  }

  const data = query.data as T;

  if (isEmpty?.(data) && empty) {
    // Never a bare "No data" — an empty state says what to do next (§42).
    return (
      <View className="flex-1 items-center justify-center gap-2 p-6">
        <Text variant="h2" className="text-center">
          {empty.title}
        </Text>
        <Text variant="bodySm" tone="secondary" className="text-center">
          {empty.body}
        </Text>
        {empty.actionLabel && empty.onAction ? (
          <Button label={empty.actionLabel} onPress={empty.onAction} className="mt-3" />
        ) : null}
      </View>
    );
  }

  return <>{children(data)}</>;
}
