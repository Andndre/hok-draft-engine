import { HeroRoleIcons } from './ui/HeroRoleIcons';
import React from 'react';
import { BookOpen, LockKeyhole, ShieldBan, Sparkles, Swords, TrendingUp } from 'lucide-react';
import type { Hero } from '../types';
import { HeroThumbnail } from './ui/AssetThumbnail';

export interface HeroCardProps {
  hero: Hero;
  isSelected?: boolean;
  isUnavailable?: boolean;
  onClick: (hero: Hero) => void;
  onSelect?: (hero: Hero) => void;
  selectionDisabled?: boolean;
  action?: 'pick' | 'ban';
  quickBadge?: string;
  aiRank?: number;
}
export function HeroCardCompact({ hero, isSelected, isUnavailable, onClick, onSelect, selectionDisabled, action = 'pick', quickBadge }: HeroCardProps) {
  const ActionIcon = action === 'ban' ? ShieldBan : Swords;
  return <article className={'hero-card hero-card--compact' + (isSelected ? ' is-selected' : '') + (isUnavailable ? ' is-unavailable' : '')}>
    <button type="button" className="hero-card__profile" onClick={() => onClick(hero)} aria-label={`Buka wiki ${hero.name}; Role: ${hero.primary_role}; Lane: ${(hero.lanes.length ? hero.lanes : [hero.primary_lane]).join(', ')}`} title={'Lihat skill, build, dan counter ' + hero.name}>
      <HeroThumbnail hero={hero} className="hero-card__avatar" />
      <span className="hero-card__identity"><span className="hero-card__name">{hero.name}<BookOpen aria-hidden="true" /></span><HeroRoleIcons hero={hero} />
        <span className="hero-card__stats"><TrendingUp aria-hidden="true" />{(hero.win_rate * 100).toFixed(1)}%<span className={'tier-label tier-' + hero.tier}>{hero.tier}</span>{hero.is_global_released === false && <span className="muted-badge">CN</span>}</span>
      </span>
    </button>
    <div className="hero-card__trailing">{quickBadge && <span className="ai-badge"><Sparkles aria-hidden="true" />{quickBadge}</span>}
      {onSelect && <button type="button" className={'ui-button ui-button--small ' + (action === 'ban' ? 'ui-button--ban' : 'ui-button--primary')} disabled={isUnavailable || selectionDisabled} onClick={() => onSelect(hero)} aria-label={(action === 'ban' ? 'Ban ' : 'Pick ') + hero.name}>{isUnavailable ? <LockKeyhole aria-hidden="true" /> : <ActionIcon aria-hidden="true" />}<span>{isUnavailable ? 'Terpakai' : action === 'ban' ? 'Ban' : 'Pick'}</span></button>}
    </div>
  </article>;
}
