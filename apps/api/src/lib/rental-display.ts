/**
 * Resolves the human-readable place a rental refers to.
 *
 * A rental attached to a unit is labelled by that unit; a renter-recorded
 * rental (§58 — the system must work when only one side uses the app) has no
 * unit at all, so it falls back to the free-text place the renter typed in.
 * `fallback` covers the rare row with neither, so a display string is never
 * empty.
 */
export function resolvePlaceLabel(
  rental: { unit?: { label: string } | null; placeLabel: string | null },
  fallback: string,
): string {
  return rental.unit?.label ?? rental.placeLabel ?? fallback;
}
