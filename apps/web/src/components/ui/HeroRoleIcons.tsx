import React from 'react';
import type { Hero } from '../../types';
import { LaneIcon } from './LaneIcon';
import { RoleIcon } from './RoleIcon';

export function HeroRoleIcons({ hero }: { hero: Pick<Hero, 'primary_role' | 'primary_lane' | 'lanes'> }) {
  const lanes = [...new Set(hero.lanes.length ? hero.lanes : [hero.primary_lane])];
  return <span className="hero-role-icons" role="img" aria-label={`Role: ${hero.primary_role}; Lane: ${lanes.join(', ')}`}>
    <span title={`Role: ${hero.primary_role}`}><RoleIcon role={hero.primary_role} /></span>
    <span className="hero-role-icons__divider" aria-hidden="true" />
    <span className="hero-role-icons__lanes">{lanes.map(lane => <span key={lane} title={`Lane: ${lane}`}><LaneIcon lane={lane} /></span>)}</span>
  </span>;
}
