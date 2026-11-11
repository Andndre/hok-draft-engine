import { HeroRoleIcons } from './ui/HeroRoleIcons';
import React, { useState, useEffect } from 'react';
import { BookOpen, LockKeyhole, ShieldBan, Sparkles, Swords, TrendingUp } from 'lucide-react';
import type { Hero } from '../types';
import type { DraftOutcomeProjection } from '../engine/tournamentInference';
import { HeroThumbnail } from './ui/AssetThumbnail';
import { plainText } from './ui/presentation';

export interface HeroCardProps {
  hero: Hero;
  isSelected?: boolean;
  isUnavailable?: boolean;
  unavailableLabel?: string;
  onClick: (hero: Hero) => void;
  onSelect?: (hero: Hero) => void;
  selectionDisabled?: boolean;
  action?: 'pick' | 'ban';
  quickBadge?: string;
  aiRank?: number;
  recommendationReason?: string;
  projection?: DraftOutcomeProjection;
}

export function HeroCardCompact({
  hero,
  isSelected,
  isUnavailable,
  unavailableLabel,
  onClick,
  onSelect,
  selectionDisabled,
  action = 'pick',
  quickBadge,
  aiRank,
  recommendationReason,
  projection,
}: HeroCardProps) {
  const ActionIcon = action === 'ban' ? ShieldBan : Swords;
  const [showHoverCard, setShowHoverCard] = useState(false);

  useEffect(() => {
    if (!showHoverCard) return;
    const handleOutside = () => setShowHoverCard(false);
    window.addEventListener('click', handleOutside);
    return () => window.removeEventListener('click', handleOutside);
  }, [showHoverCard]);

  return (
    <article className={'hero-card hero-card--compact' + (isSelected ? ' is-selected' : '') + (isUnavailable ? ' is-unavailable' : '') + (showHoverCard ? ' has-hovercard-open' : '')}>
      <button
        type="button"
        className="hero-card__profile"
        onClick={() => onClick(hero)}
        aria-label={`Buka wiki ${hero.name}; Role: ${hero.primary_role}; Lane: ${(hero.lanes.length ? hero.lanes : [hero.primary_lane]).join(', ')}`}
        title={'Lihat skill, build, dan counter ' + hero.name}
      >
        <HeroThumbnail hero={hero} className="hero-card__avatar" />
        <span className="hero-card__identity">
          <span className="hero-card__name">
            {hero.name}
            <BookOpen aria-hidden="true" />
          </span>
          <HeroRoleIcons hero={hero} />
          <span className="hero-card__stats">
            <TrendingUp aria-hidden="true" />
            {(hero.win_rate * 100).toFixed(1)}%
            <span className={'tier-label tier-' + hero.tier}>{hero.tier}</span>
            {hero.is_global_released === false && <span className="muted-badge">CN</span>}
          </span>
        </span>
      </button>

      <div className="hero-card__trailing">
        {quickBadge && (
          <div className="hero-card__ai-group">
            <button
              type="button"
              className="ai-badge"
              aria-expanded={showHoverCard}
              aria-label={`${quickBadge}: ${plainText(recommendationReason || 'Rekomendasi AI')}. Ketuk untuk melihat analisis.`}
              onClick={(e) => {
                e.stopPropagation();
                setShowHoverCard((v) => !v);
              }}
            >
              <Sparkles aria-hidden="true" />
              {quickBadge}
            </button>
            {(recommendationReason || projection) && (
              <div className={'tactical-hovercard' + (showHoverCard ? ' is-visible' : '')} role="tooltip">
                <div className="tactical-hovercard__header">
                  <span className="tactical-hovercard__rank">{quickBadge}</span>
                  <strong>{hero.name}</strong>
                  <span className={'tier-label tier-' + hero.tier}>{hero.tier}</span>
                </div>
                {recommendationReason && (
                  <p className="tactical-hovercard__reason">{plainText(recommendationReason)}</p>
                )}
                {projection && (
                  <div className="tactical-hovercard__projection">
                    <div className="hover-proj hover-proj--best">
                      <span className="hover-proj__label">Skenario Terbaik ({projection.bestCaseScore}%):</span>
                      <p>{plainText(projection.bestCaseScenario)}</p>
                    </div>
                    <div className="hover-proj hover-proj--worst">
                      <span className="hover-proj__label">Skenario Terburuk ({projection.worstCaseScore}%):</span>
                      <p>{plainText(projection.worstCaseScenario)}</p>
                    </div>
                    <div className={'hover-proj__risk hover-proj__risk--' + projection.riskLevel.toLowerCase()}>
                      Risiko {projection.riskLevel}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {onSelect && (
          <button
            type="button"
            className={'ui-button ui-button--small ' + (action === 'ban' ? 'ui-button--ban' : 'ui-button--primary')}
            disabled={isUnavailable || selectionDisabled}
            onClick={() => onSelect(hero)}
            aria-label={(action === 'ban' ? 'Ban ' : 'Pick ') + hero.name}
          >
            {isUnavailable ? <LockKeyhole aria-hidden="true" /> : <ActionIcon aria-hidden="true" />}
            <span>{isUnavailable ? (unavailableLabel ?? (action === 'ban' ? 'Terban' : 'Terpilih')) : action === 'ban' ? 'Ban' : 'Pick'}</span>
          </button>
        )}
      </div>
    </article>
  );
}
