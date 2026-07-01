export const MANUAL_RESERVATION_PURPOSE_OPTIONS = [
  { value: 'paid_guest', label: 'Paid guest' },
  { value: 'creator_influencer', label: 'Creator / influencer' },
  { value: 'friends_family', label: 'Friends / family' },
  { value: 'owner_use', label: 'Owner use' },
  { value: 'staff_stay', label: 'Staff stay' },
  { value: 'comp_other', label: 'Other comp' },
  { value: 'manual_other', label: 'Other manual' }
];

export function defaultSendGuestConfirmationForPurpose(purpose) {
  return purpose === 'paid_guest';
}

export function manualReservationPurposeLabel(purpose) {
  const match = MANUAL_RESERVATION_PURPOSE_OPTIONS.find((opt) => opt.value === purpose);
  return match?.label || null;
}

export function guestConfirmationEmailPolicyLabel(sendGuestConfirmationEmail) {
  if (sendGuestConfirmationEmail === true) {
    return 'Automatic on confirm';
  }
  if (sendGuestConfirmationEmail === false) {
    return 'Manual only (no automatic confirmation)';
  }
  return 'Legacy (automatic on confirm)';
}
