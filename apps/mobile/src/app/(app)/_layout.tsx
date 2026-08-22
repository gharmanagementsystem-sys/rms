import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Bell, Building2, Home, Receipt, User } from '../../components/ui/icons';
import { useCurrentUser } from '../../features/auth/useCurrentUser';
import { useUnreadCount } from '../../features/notifications/api';
import { useDeviceRegistration } from '../../features/notifications/useDeviceRegistration';
import { useNotificationNavigation } from '../../features/notifications/useNotificationNavigation';
import { useSemanticColors } from '../../theme/colors';

/**
 * Signed-in navigation. CLAUDE.md §28.
 *
 * Role-aware: a renter has no Properties tab, because they own none and a tab
 * that always shows an empty state is worse than no tab. This is presentation
 * only — every endpoint behind it authorises independently, so hiding a tab is
 * never what keeps data safe (§31).
 */
export default function AppLayout() {
  const { t } = useTranslation(['common']);
  const { user } = useCurrentUser();
  const colors = useSemanticColors();

  /**
   * Push registration happens here, once the user is signed in.
   *
   * This layout is the first thing rendered behind the auth gate, so it is the
   * natural place: the session exists, and it re-runs when the signed-in user
   * changes, which is what reassigns a shared handset's token (§20).
   */
  useDeviceRegistration(user?.id ?? null);
  // Opens the relevant rental when a push is tapped (§39) — separate from
  // registration above, since it has nothing to do with the token itself.
  useNotificationNavigation();
  const unreadCount = useUnreadCount();

  const isOwner = user?.profile?.primaryRole === 'HOUSE_OWNER';

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        // Labels stay visible: an icon alone is ambiguous for a user who is not
        // technically confident, which is the primary audience (§3.1, §25).
        tabBarShowLabel: true,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.home'),
          tabBarIcon: ({ color, size }) => <Home size={size} color={color} strokeWidth={1.75} />,
        }}
      />

      <Tabs.Screen
        name="properties"
        listeners={({ navigation }) => ({
          // Each of these tabs owns a Stack (list + detail screens can be
          // pushed several levels deep). Without this, switching away and
          // back leaves whatever screen was last pushed on top — the tab
          // press should always return to that feature's starting point,
          // the way a fresh tap on it reads to the user.
          tabPress: (e) => {
            e.preventDefault();
            navigation.navigate('properties', { screen: 'index' });
          },
        })}
        options={{
          title: t('tabs.properties'),
          // Hidden rather than disabled — a renter never needs it.
          href: isOwner ? '/properties' : null,
          tabBarIcon: ({ color, size }) => (
            <Building2 size={size} color={color} strokeWidth={1.75} />
          ),
        }}
      />

      <Tabs.Screen
        name="rentals"
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            e.preventDefault();
            navigation.navigate('rentals', { screen: 'index' });
          },
        })}
        options={{
          title: isOwner ? t('tabs.rentals') : t('tabs.myRental'),
          tabBarIcon: ({ color, size }) => <Receipt size={size} color={color} strokeWidth={1.75} />,
        }}
      />

      <Tabs.Screen
        name="notifications"
        options={{
          title: t('tabs.notifications'),
          // The count is on the tab as well as in the screen: a reminder the
          // user never opens the app to see is a reminder that did not work.
          tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
          tabBarIcon: ({ color, size }) => <Bell size={size} color={color} strokeWidth={1.75} />,
        }}
      />

      <Tabs.Screen
        name="account"
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            e.preventDefault();
            navigation.navigate('account', { screen: 'index' });
          },
        })}
        options={{
          title: t('tabs.account'),
          tabBarIcon: ({ color, size }) => <User size={size} color={color} strokeWidth={1.75} />,
        }}
      />
    </Tabs>
  );
}
