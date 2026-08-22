import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../components/ui/Button';
import { authClient } from '../../../lib/auth-client';
import { toAuthFailure } from '../errors';
import { currentUserKey } from '../useCurrentUser';

/**
 * Google sign-in.
 *
 * Server-side OAuth: this opens the system browser at our API, which performs
 * the exchange with Google and deep-links back via the `rms://` scheme. The
 * phone never holds a Google client secret, and only ONE Google credential
 * exists — a Web application client — because the API is the OAuth client, not
 * the app.
 *
 * A cancelled flow is not an error. The user closing the browser is a normal
 * outcome and must not produce an alarming message.
 */
export function GoogleButton({ onError }: { onError: (message: string | null) => void }) {
  const { t } = useTranslation(['auth']);
  const queryClient = useQueryClient();
  const [isBusy, setBusy] = useState(false);

  async function handlePress() {
    onError(null);
    setBusy(true);
    try {
      const result = await authClient.signIn.social({
        provider: 'google',
        // Where the API sends the browser once Google returns. The scheme must
        // be in the server's trustedOrigins or the redirect is rejected.
        callbackURL: 'rms://',
      });

      if (result.error) {
        onError(toAuthFailure(result.error, t).message);
        return;
      }

      await queryClient.invalidateQueries({ queryKey: currentUserKey });
    } catch (error) {
      // Dismissing the browser rejects; treat it as a no-op rather than a fault.
      const message = error instanceof Error ? error.message.toLowerCase() : '';
      if (message.includes('cancel') || message.includes('dismiss')) return;
      onError(toAuthFailure(error, t).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      label={t('auth:google.continue')}
      variant="secondary"
      onPress={() => void handlePress()}
      isBusy={isBusy}
      fullWidth
    />
  );
}
