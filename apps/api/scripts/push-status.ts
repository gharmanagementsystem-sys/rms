import { prisma, closeDatabase } from '../src/db/client';

/**
 * Shows the state of the push pipeline. Read-only.
 *
 * Run: npm run push:status -w @rms/api
 *
 * Push has four stages, and when a notification does not arrive it is almost
 * always obvious WHICH stage failed — if you can see them. This prints all
 * four, so the answer is a glance rather than a guess:
 *
 *   1. Is a device registered?          → the app reached /devices
 *   2. Was a notification created?      → the job ran and the policy fired
 *   3. Was a delivery row created?      → the notification was matched to a device
 *   4. Did FCM accept it?               → status SENT, or a real error to read
 *
 * Tokens are masked. A registration token is not a credential — it addresses a
 * device rather than authorising anything — but it identifies a specific
 * handset, and there is no reason to print it in full to diagnose a count.
 */

function maskToken(token: string): string {
  return token.length <= 12
    ? '***'
    : `${token.slice(0, 6)}…${token.slice(-4)} (${token.length} chars)`;
}

function ago(date: Date): string {
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

async function main(): Promise<void> {
  console.log('\n─── Push pipeline status ───\n');

  // ---- 1. Devices ---------------------------------------------------------
  const devices = await prisma.device.findMany({
    orderBy: { lastSeenAt: 'desc' },
    include: { user: { select: { email: true } } },
    take: 20,
  });

  console.log(`1. DEVICES (${devices.length})`);
  if (devices.length === 0) {
    console.log('   none registered.');
    console.log('   → The app never called POST /api/v1/devices. Causes, in order of');
    console.log('     likelihood: running in Expo Go (no native token), notification');
    console.log('     permission denied, or the app has not been signed into yet.');
  }
  for (const device of devices) {
    const state = device.revokedAt ? `REVOKED ${ago(device.revokedAt)}` : 'active';
    console.log(
      `   ${device.platform.padEnd(7)} ${state.padEnd(18)} ${device.user.email}` +
        `\n     token ${maskToken(device.token)}` +
        `\n     notificationsEnabled=${device.notificationsEnabled} · seen ${ago(device.lastSeenAt)}` +
        `${device.appVersion ? ` · v${device.appVersion}` : ''}`,
    );
  }

  // ---- 2. Notifications ---------------------------------------------------
  const notifications = await prisma.notification.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
    include: { user: { select: { email: true } }, deliveries: true },
  });

  console.log(`\n2. NOTIFICATIONS (latest ${notifications.length})`);
  if (notifications.length === 0) {
    console.log('   none created.');
    console.log('   → No job has produced one yet. Run the rent-reminders job, or');
    console.log('     record a payment, which creates PAYMENT_RECORDED.');
  }
  for (const notification of notifications) {
    const read = notification.readAt ? 'read' : 'unread';
    console.log(
      `   ${notification.type.padEnd(17)} ${read.padEnd(7)} ${ago(notification.createdAt)}  ${notification.user.email}` +
        `\n     "${notification.title}"` +
        `\n     deliveries: ${notification.deliveries.length}`,
    );
  }

  // ---- 3 & 4. Deliveries and what FCM said --------------------------------
  const deliveries = await prisma.notificationDelivery.findMany({
    orderBy: { createdAt: 'desc' },
    take: 15,
    include: {
      notification: { select: { type: true, title: true } },
      device: { select: { platform: true, token: true } },
    },
  });

  console.log(`\n3. DELIVERIES (latest ${deliveries.length})`);
  if (deliveries.length === 0) {
    console.log('   none.');
    console.log('   → Notifications exist but were never matched to a device. Either no');
    console.log('     active device for that user, or the dispatch-push job has not run.');
  }
  for (const delivery of deliveries) {
    console.log(
      `   ${delivery.status.padEnd(9)} ${delivery.notification.type.padEnd(17)} ` +
        `${delivery.device.platform} ${maskToken(delivery.device.token)}` +
        `\n     attempts=${delivery.attempts}${delivery.sentAt ? ` · sent ${ago(delivery.sentAt)}` : ''}` +
        `${delivery.messageId ? ` · fcm id ${delivery.messageId}` : ''}` +
        (delivery.lastError ? `\n     ERROR: ${delivery.lastError}` : ''),
    );
  }

  const pending = await prisma.notificationDelivery.count({ where: { status: 'PENDING' } });
  if (pending > 0) {
    console.log(`\n   ${pending} delivery row(s) still PENDING.`);
    console.log('   → Run the dispatch-push job to send them.');
  }

  // ---- Job runs -----------------------------------------------------------
  const runs = await prisma.jobRun.findMany({
    orderBy: { startedAt: 'desc' },
    take: 6,
  });

  console.log(`\n4. RECENT JOB RUNS (${runs.length})`);
  if (runs.length === 0) console.log('   none — no scheduled job has executed.');
  for (const run of runs) {
    console.log(
      `   ${run.jobName.padEnd(18)} ${run.status.padEnd(9)} ${ago(run.startedAt)}` +
        (run.error ? `\n     ERROR: ${run.error}` : ''),
    );
  }

  console.log('');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());
