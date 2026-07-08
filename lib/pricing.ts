/**
 * The per-month figure shown on plan cards, formatted to match exactly what
 * Stripe charges. Annual plans bill yearly, so their monthly-equivalent
 * (annual / 12) can carry cents (€290/yr = €24.17/mo). We show those cents
 * rather than rounding, so the number never disagrees with the amount on the
 * Stripe checkout page — a rounded "€24" that becomes "€24.17" at checkout
 * reads as a bait-and-switch.
 */
export function perMonthLabel(
  monthly: number,
  annual: number,
  isAnnual: boolean
): string {
  const value = isAnnual ? annual / 12 : monthly;
  // Two decimals, but keep whole amounts clean (no trailing ".00").
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
