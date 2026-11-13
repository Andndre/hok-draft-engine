/**
 * Side resolution helper for the live draft advisor.
 *
 * SIDE SEMANTICS (important): on the HoK ranked board the operator's OWN team
 * is always rendered on the LEFT column and the opponent on the RIGHT; the
 * colour tint mirrors per session. The profile's `side` values describe the
 * CAPTURED session. When the operator declares the OTHER side,
 * `resolveSlotSides` mirrors every slot's absolute side (left column -> operator's
 * side, right -> opponent) while the geometry stays identical.
 */
import type { RegionProfile, SlotRegion, VisionSide } from './types';

export function resolveSlotSides(profile: RegionProfile, operatorSide: VisionSide): SlotRegion[] {
  const ownSide: VisionSide = profile.ownSide ?? 'red';
  const flip = operatorSide !== ownSide;
  return profile.slots.map(slot =>
    flip
      ? { ...slot, side: slot.side === 'red' ? 'blue' as const : 'red' as const }
      : { ...slot });
}
