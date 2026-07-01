'use client';

/**
 * Wizard step — delivery method ("전달 방법").
 *
 * The fork between the two ways a finished contract reaches its signer:
 * emailing a signature request, or generating a shareable link. Picking here
 * dispatches SET_DELIVERY_METHOD, which extends the step sequence with the
 * matching tail (see wizard-context).
 *
 * Slot placeholder — the method-choice cards land in a later grain. Until then
 * the step is intentionally empty and "다음" stays locked (canProceed gates on
 * an unset deliveryMethod).
 */

export function DeliveryStep() {
  return null;
}
