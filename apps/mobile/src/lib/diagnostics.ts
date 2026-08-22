/**
 * Client-side diagnostics. CLAUDE.md §32, §65.
 *
 * For failures the user cannot act on and must not be shown — a push
 * registration that did not complete, a best-effort revoke that failed. Those
 * still need to be visible to a developer, and the alternative is scattered
 * `console.log` calls that eventually leak something.
 *
 * Two rules this enforces:
 *
 *  1. **Development only.** Nothing is emitted in a release build, so a shipped
 *     app never writes to the device log.
 *  2. **Codes and scalars only.** The signature accepts numbers, booleans and
 *     short enum-like strings — never a free-form object, a response body, or a
 *     token. That is deliberate: a permissive signature is how a device push
 *     token or an auth header ends up in a log.
 */

type DiagnosticValue = string | number | boolean | null;

export function logDiagnostic(event: string, fields: Record<string, DiagnosticValue> = {}): void {
  if (!__DEV__) return;

  console.warn(`[rms] ${event}`, fields);
}
