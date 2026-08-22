import { useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronRight, LogOut, Pencil, ShieldCheck } from '../../../components/ui/icons';
import type { DateFormatPreference, Language, ThemePreference } from '@rms/shared';
import { ApiError } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Screen } from '../../../components/ui/Screen';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { Text } from '../../../components/ui/Text';
import { currentLanguage } from '../../../i18n';
import { authClient } from '../../../lib/auth-client';
import { useDateFormat } from '../../../lib/calendar/DateFormatProvider';
import { useSemanticColors } from '../../../theme/colors';
import { MIN_TOUCH_TARGET } from '../../../theme/tokens';
import { useTheme } from '../../../theme/ThemeProvider';
import { useCurrentUser } from '../../auth/useCurrentUser';
import { useSendTestNotification } from '../../notifications/api';
import {
  currentDeviceId,
  forgetDeviceId,
  revokeDevice,
} from '../../notifications/useDeviceRegistration';
import { useSignOutOtherDevices } from '../api';
import { usePreferenceSync } from '../usePreferenceSync';

/**
 * Profile and preferences (CLAUDE.md §23).
 *
 * Preferences apply immediately on screen and are then written to the server,
 * which owns them. A failed write is reverted and reported rather than left
 * looking successful (§38).
 */
export function AccountScreen() {
  const { t } = useTranslation(['account', 'common']);
  const router = useRouter();
  const { user } = useCurrentUser();
  const { preference } = useTheme();
  const { preference: dateFormat } = useDateFormat();
  const queryClient = useQueryClient();
  const preferences = usePreferenceSync();
  const signOutOthers = useSignOutOtherDevices();
  const sendTestNotification = useSendTestNotification();
  const colors = useSemanticColors();

  const language = currentLanguage();
  const [otherDevicesNote, setOtherDevicesNote] = useState<string | null>(null);
  const [testNote, setTestNote] = useState<string | null>(null);

  function handleSendTestNotification() {
    setTestNote(null);
    sendTestNotification.mutate(undefined, {
      onSuccess: (result) => {
        if (result.registeredDevices === 0) {
          setTestNote(t('account:notifications.testNoDevice'));
        } else if (result.delivered > 0) {
          setTestNote(t('account:notifications.testSent'));
        } else {
          setTestNote(t('account:notifications.testFailed'));
        }
      },
      onError: (error) => {
        setTestNote(
          error instanceof ApiError && error.isRetryable
            ? t('common:states.errorBody')
            : t('account:notifications.testError'),
        );
      },
    });
  }

  async function handleSignOut() {
    // Best-effort device revoke BEFORE the session goes away — afterwards the
    // request would be unauthenticated. Never blocks sign-out (§20).
    const deviceId = currentDeviceId();
    if (deviceId) await revokeDevice(deviceId);
    forgetDeviceId();

    await authClient.signOut();
    // Clear every cached response: the next person to use this phone must not
    // see the previous user's financial data, even for a frame.
    queryClient.clear();
  }

  function confirmSignOutOthers() {
    Alert.alert(t('account:otherDevices.confirmTitle'), t('account:otherDevices.confirmBody'), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      {
        text: t('account:otherDevices.action'),
        style: 'destructive',
        onPress: () => {
          setOtherDevicesNote(null);
          signOutOthers.mutate(undefined, {
            onSuccess: (result) =>
              setOtherDevicesNote(
                t('account:otherDevices.done', { count: result.revokedSessions }),
              ),
            onError: (error) =>
              setOtherDevicesNote(
                error instanceof ApiError && error.isRetryable
                  ? t('common:states.errorBody')
                  : t('account:otherDevices.failed'),
              ),
          });
        },
      },
    ]);
  }

  return (
    <Screen padded={false}>
      <ScreenHeader title={t('account:title')} />

      <ScrollView contentContainerClassName="px-5 pb-6 gap-3">
        {/* Identity, and the way into editing it. */}
        <Pressable
          onPress={() => router.push('/account/profile')}
          accessibilityRole="button"
          accessibilityLabel={t('account:editProfile')}
          style={{ minHeight: MIN_TOUCH_TARGET }}
        >
          <Card className="flex-row items-center gap-3">
            <View className="flex-1 gap-1">
              <Text variant="h2">{user?.profile?.fullName ?? user?.name ?? ''}</Text>
              <Text variant="bodySm" tone="secondary">
                {user?.email}
              </Text>
              <Text variant="caption" tone="secondary">
                {user?.profile?.primaryRole === 'HOUSE_OWNER'
                  ? t('account:roleOwner')
                  : t('account:roleRenter')}
                {user?.profile?.phone ? ` · ${user.profile.phone}` : ''}
              </Text>
            </View>
            <Pencil size={18} color={colors.textSecondary} strokeWidth={1.75} />
          </Card>
        </Pressable>

        {/* One banner for every preference failure, with a retry (§41). */}
        {preferences.error ? (
          <View className="bg-danger/10 gap-2 rounded-xl p-3" accessibilityLiveRegion="polite">
            <Text variant="bodySm" tone="danger">
              {preferences.error === 'OFFLINE'
                ? t('account:preferences.offline')
                : t('account:preferences.failed')}
            </Text>
            <View className="flex-row gap-2">
              <Button
                label={t('common:actions.retry')}
                size="sm"
                variant="secondary"
                isBusy={preferences.isSaving}
                onPress={preferences.retry}
              />
              <Button
                label={t('common:actions.close')}
                size="sm"
                variant="ghost"
                onPress={preferences.dismissError}
              />
            </View>
          </View>
        ) : null}

        <Card className="gap-3">
          <Text variant="h2">{t('common:settings.language')}</Text>
          <View className="flex-row gap-2">
            {(['en', 'ne'] as Language[]).map((code) => (
              <Button
                key={code}
                label={code === 'en' ? 'English' : 'नेपाली'}
                size="sm"
                variant={language === code ? 'primary' : 'secondary'}
                onPress={() => preferences.changeLanguage(code)}
              />
            ))}
          </View>
          <Text variant="caption" tone="secondary">
            {t('account:preferences.syncedNote')}
          </Text>
        </Card>

        <Card className="gap-3">
          <Text variant="h2">{t('common:settings.theme')}</Text>
          <View className="flex-row gap-2">
            {(['light', 'dark', 'system'] as ThemePreference[]).map((option) => (
              <Button
                key={option}
                label={t(
                  option === 'light'
                    ? 'common:settings.themeLight'
                    : option === 'dark'
                      ? 'common:settings.themeDark'
                      : 'common:settings.themeSystem',
                )}
                size="sm"
                variant={preference === option ? 'primary' : 'secondary'}
                onPress={() => preferences.changeTheme(option)}
              />
            ))}
          </View>
        </Card>

        <Card className="gap-3">
          <Text variant="h2">{t('common:settings.dateFormat')}</Text>
          <View className="flex-row gap-2">
            {(['BS', 'AD'] as DateFormatPreference[]).map((option) => (
              <Button
                key={option}
                label={t(
                  option === 'BS' ? 'common:settings.dateFormatBs' : 'common:settings.dateFormatAd',
                )}
                size="sm"
                variant={dateFormat === option ? 'primary' : 'secondary'}
                onPress={() => preferences.changeDateFormat(option)}
              />
            ))}
          </View>
          <Text variant="caption" tone="secondary">
            {t('common:settings.dateFormatHint')}
          </Text>
        </Card>

        <Card className="gap-2">
          <View className="flex-row items-center justify-between gap-3">
            <View className="flex-1">
              <Text variant="h2">{t('account:notifications.title')}</Text>
              <Text variant="caption" tone="secondary">
                {t('account:notifications.hint')}
              </Text>
            </View>
            <Switch
              // Null until /users/me resolves; defaults on, matching the server.
              value={preferences.notificationsEnabled ?? true}
              disabled={preferences.notificationsEnabled === null}
              onValueChange={preferences.changeNotificationsEnabled}
              accessibilityLabel={t('account:notifications.title')}
              accessibilityRole="switch"
            />
          </View>
          <Text variant="caption" tone="secondary">
            {t('account:notifications.osNote')}
          </Text>
          <Button
            label={t('account:notifications.testAction')}
            variant="secondary"
            size="sm"
            isBusy={sendTestNotification.isPending}
            onPress={handleSendTestNotification}
            fullWidth
          />
          {testNote ? (
            <Text variant="caption" tone="secondary" accessibilityLiveRegion="polite">
              {testNote}
            </Text>
          ) : null}
        </Card>

        <Card className="gap-3">
          <View className="flex-row items-center gap-2">
            <ShieldCheck size={18} color={colors.textSecondary} strokeWidth={1.75} />
            <Text variant="h2">{t('account:security')}</Text>
          </View>
          <Button
            label={t('account:otherDevices.action')}
            variant="secondary"
            size="sm"
            isBusy={signOutOthers.isPending}
            onPress={confirmSignOutOthers}
            fullWidth
          />
          {otherDevicesNote ? (
            <Text variant="caption" tone="secondary" accessibilityLiveRegion="polite">
              {otherDevicesNote}
            </Text>
          ) : null}
        </Card>

        <Pressable
          onPress={() => void handleSignOut()}
          accessibilityRole="button"
          accessibilityLabel={t('account:signOut')}
          style={{ minHeight: MIN_TOUCH_TARGET }}
          className="mt-2"
        >
          <Card className="flex-row items-center gap-3">
            <LogOut size={18} color={colors.danger} strokeWidth={1.75} />
            <Text variant="body" weight="600" tone="danger" className="flex-1">
              {t('account:signOut')}
            </Text>
            <ChevronRight size={18} color={colors.muted} />
          </Card>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}
