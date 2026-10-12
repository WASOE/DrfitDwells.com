# Manual guest stays and availability blocks

## Record types

- A guest stay is a canonical `Booking`, including complimentary and zero-price stays. Do not represent a guest as an `AvailabilityBlock`.
- `AvailabilityBlock` represents non-guest inventory holds, maintenance, channel holds, and temporary checkout holds.
- A zero-price manual reservation is valid and does not require a payment record. Revolut or other payment administration is outside this workflow.
- `maintenance` remains a separate `blockType: "maintenance"`. Non-guest manual holds use `blockType: "manual_block"` with a registered purpose.
- Manual-block purpose is structured metadata, not a signal for guest, payment, cleaning, or messaging behavior. The `other` purpose requires an operator reason.

## Calendar workflow

- Use **Add guest stay** to open the existing manual-reservation form for a single cabin. The form creates a Booking; it does not create a temporary block.
- Use **Add manual block** for non-guest holds and choose a purpose.
- Use **Add maintenance** only for maintenance inventory.
- A manual block can be converted to a guest reservation from its calendar action menu. Conversion creates a canonical zero-price-capable Booking and tombstones (never deletes) the source block only after the replacement and inventory ownership are secured.
- For a parent-wide multi-unit hold, select the physical unit explicitly. Conversion does not silently allocate the first available unit.
- Guest confirmation email is opt-in for conversion. It is sent only on later confirmation when explicitly selected and allowed by the existing manual-reservation email policy.
- Location-wide block groups remain group operations and cannot be converted as a single reservation.

## Conversion safety

The conversion API requires both manual-reservation-create and manual-block-remove permissions. It reserves the source block with a compare-and-set lease, validates conflicts while excluding only that exact source block, persists a canonical Booking and (for a physical unit) its authoritative unit-night claims, then atomically tombstones and links the source block. Other overlapping blocks, bookings, channel warnings, and inventory claims remain in force. A failed conversion leaves the source active; if a Booking was already secured, retry completes the handoff rather than creating a second Booking.

The source block continues to occupy inventory until the Booking is durable and linked. The Booking stores `provenance.convertedFromAvailabilityBlockId` and `convertedAt`; the tombstoned block stores `reservationId` and `metadata.conversionReservationId`. The partial unique Booking provenance index is a safety fence for concurrent retries; production rollout must follow the repository's controlled index-management process. Do not rely on application startup to create it.

## Legacy blocks and reconciliation

Legacy blocks without a registered purpose remain readable and use the generic **Manual block** label. New block writes require a canonical active `Cabin` target; a `CabinType` identifier is not accepted as a new block's `cabinId`. Conversion alone may resolve a legacy block that stored a `CabinType` identifier, and only when that type maps unambiguously to one active parent cabin. Ambiguous or invalid records must be reviewed and corrected through the established operations process before conversion.

There is no automatic conversion or migration of existing production blocks. Reconciliation is an explicit operator review: compare active manual blocks with canonical Bookings and their provenance/link fields, confirm guest intent and dates, resolve target identity and conflicts, then use the conversion workflow only for verified stays. Never infer guest intent from a purpose label alone.
