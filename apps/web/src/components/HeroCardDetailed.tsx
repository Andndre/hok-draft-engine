import { HeroRoleIcons } from './ui/HeroRoleIcons';
import React from 'react';
import { BookOpen, LockKeyhole, ShieldBan, Sparkles, Swords } from 'lucide-react';
import type { HeroCardProps } from './HeroCardCompact';
import { HeroThumbnail } from './ui/AssetThumbnail';
export function HeroCardDetailed({ hero, isSelected, isUnavailable, onClick, onSelect, selectionDisabled, action = 'pick', aiRank }: HeroCardProps) {
  const ActionIcon = action === 'ban' ? ShieldBan : Swords;
  return <article className={'hero-card hero-card--detailed' + (isSelected ? ' is-selected' : '') + (isUnavailable ? ' is-unavailable' : '')}>
    <button type="button" className="hero-card__cover" onClick={() => onClick(hero)} aria-label={'Buka wiki ' + hero.name}>
      <HeroThumbnail hero={hero} className="hero-card__portrait" /><span className={'tier-label tier-' + hero.tier}>{hero.tier}</span>
      {aiRank !== undefined && aiRank <= 5 && <span className="ai-badge"><Sparkles aria-hidden="true" />#{aiRank}</span>}
      <span className="hero-card__cover-hint"><BookOpen aria-hidden="true" />Buka wiki</span>
    </button>
    <div className="hero-card__body"><h3>{hero.name}</h3><HeroRoleIcons hero={hero} /><dl><div><dt>Win rate</dt><dd>{(hero.win_rate * 100).toFixed(1)}%</dd></div><div><dt>Pick rate</dt><dd>{(hero.pick_rate * 100).toFixed(1)}%</dd></div></dl>
      {onSelect && <button type="button" className={'ui-button ' + (action === 'ban' ? 'ui-button--ban' : 'ui-button--primary')} disabled={isUnavailable || selectionDisabled} onClick={() => onSelect(hero)} aria-label={(action === 'ban' ? 'Ban ' : 'Pick ') + hero.name}>{isUnavailable ? <LockKeyhole aria-hidden="true" /> : <ActionIcon aria-hidden="true" />}{isUnavailable ? 'Terpakai' : action === 'ban' ? 'Ban hero' : 'Pick hero'}</button>}
    </div>
  </article>;
}
