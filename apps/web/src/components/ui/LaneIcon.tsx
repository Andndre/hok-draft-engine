import React from 'react';
import { Layers } from 'lucide-react';
import type { Lane } from '../../types';

// Official lane emblems: https://www.honorofkings.com/img/hero_icon{1..5}_cur.png.
// Local lossless WebP copies preserve the original 68x53 pixels and transparency.
export function LaneIcon({ lane }: { lane: Lane | 'All' }) {
  if (lane === 'All') return <Layers aria-hidden="true" />;
  return <img className="lane-icon" src={`/assets/lanes/${lane.toLowerCase()}.webp`}
    width={68} height={53} alt="" aria-hidden="true" decoding="async" draggable={false} />;
}

export function LaneLabel({ lane }: { lane: Lane }) {
  return <span className="lane-label"><LaneIcon lane={lane} /><span>{lane}</span></span>;
}
