import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ChevronLeft } from './icons';
import { useSemanticColors } from '../../theme/colors';
import { MIN_TOUCH_TARGET } from '../../theme/tokens';
import { Text } from './Text';

/**
 * Title row with an optional back control.
 *
 * The back arrow has a real touch target and a spoken label — an unlabelled
 * chevron is announced as "button" and nothing else, which is useless to a
 * screen-reader user (§43).
 */
export interface ScreenHeaderProps {
  title: string;
  subtitle?: string | undefined;
  showBack?: boolean;
  /** Rendered on the trailing edge, e.g. an add button. */
  action?: React.ReactNode;
}

export function ScreenHeader({ title, subtitle, showBack = false, action }: ScreenHeaderProps) {
  const { t } = useTranslation(['common']);
  const router = useRouter();
  const colors = useSemanticColors();

  return (
    <View className="flex-row items-center gap-2 px-5 pb-2 pt-4">
      {showBack ? (
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t('common:actions.back')}
          hitSlop={12}
          style={{ minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET }}
          className="-ml-2 items-start justify-center active:opacity-60"
        >
          <ChevronLeft size={26} color={colors.textSecondary} strokeWidth={2} />
        </Pressable>
      ) : null}

      <View className="flex-1 gap-0.5">
        <Text variant={showBack ? 'h1' : 'display'} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="secondary" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {action}
    </View>
  );
}
