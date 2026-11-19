import { HeroRoleIcons } from './ui/HeroRoleIcons';
import React, { useId } from 'react';
import { BookOpen, LockKeyhole, ShieldBan, Sparkles, Swords } from 'lucide-react';
import type { HeroCardProps } from './HeroCardCompact';
import { HeroThumbnail } from './ui/AssetThumbnail';
import { plainText } from './ui/presentation';

export const HeroCardDetailed = React.memo(function HeroCardDetailed({
  hero,
  isSelected,
  isUnavailable,
  unavailableLabel,
  onClick,
  onSelect,
  selectionDisabled,
  action = 'pick',
  aiRank,
  recommendationReason,
  projection,
  imagePriority,
}: HeroCardProps) {
  const ActionIcon = action === 'ban' ? ShieldBan : Swords;
  const hovercardId = useId();
  const hasTooltip = Boolean(recommendationReason || projection);

  return (
    <article className={'hero-card hero-card--detailed' + (isSelected ? ' is-selected' : '') + (isUnavailable ? ' is-unavailable' : '')}>
      <div className="hero-card__cover">
        <button type="button" className="hero-card__cover-btn" onClick={() => onClick(hero)} aria-label={'Buka wiki ' + hero.name}>
          <HeroThumbnail hero={hero} className="hero-card__portrait" priority={imagePriority} />
          <span
            className={'tier-label tier-' + (hero.popularity_band ?? 'C')}
            title="Popularitas di HoK Camp (seberapa sering dipilih/dibanned) — bukan tier kekuatan"
          >
            {hero.popularity_band ?? '—'}
          </span>
          <span className="hero-card__cover-hint"><BookOpen aria-hidden="true" />Buka wiki</span>
        </button>
        {aiRank !== undefined && aiRank <= 5 && (
          <div className="hero-card__ai-group">
            <button
              type="button"
              className="ai-badge"
              aria-expanded={hasTooltip ? false : undefined}
              aria-label={`Rekomendasi AI #${aiRank}: ${plainText(recommendationReason || '')}. Ketuk untuk melihat analisis.`}
              {...(hasTooltip
                ? ({
                    interestfor: hovercardId,
                    popoverTarget: hovercardId,
                    popoverTargetAction: 'show',
                  } as Record<string, string>)
                : {})}
            >
              <Sparkles aria-hidden="true" />#{aiRank}
            </button>
            {hasTooltip && (
              <div id={hovercardId} className="tactical-hovercard" role="tooltip" popover="hint">
                <div className="tactical-hovercard__header">
                  <span className="tactical-hovercard__rank">AI #{aiRank}</span>
                  <strong>{hero.name}</strong>
                  <span
                    className={'tier-label tier-' + (hero.popularity_band ?? 'C')}
                    title="Popularitas di HoK Camp (seberapa sering dipilih/dibanned) — bukan tier kekuatan"
                  >
                    {hero.popularity_band ?? '—'}
                  </span>
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
      </div>

      <div className="hero-card__body">
        <h3>{hero.name}</h3>
        <HeroRoleIcons hero={hero} />
        <dl>
          <div><dt>Win rate</dt><dd>{(hero.win_rate * 100).toFixed(1)}%</dd></div>
          <div><dt>Pick rate</dt><dd>{(hero.pick_rate * 100).toFixed(1)}%</dd></div>
        </dl>
        {onSelect && (
          <button
            type="button"
            className={'ui-button ' + (action === 'ban' ? 'ui-button--ban' : 'ui-button--primary')}
            disabled={isUnavailable || selectionDisabled}
            onClick={() => onSelect(hero)}
            aria-label={(action === 'ban' ? 'Ban ' : 'Pick ') + hero.name}
          >
            {isUnavailable ? <LockKeyhole aria-hidden="true" /> : <ActionIcon aria-hidden="true" />}
            {isUnavailable ? (unavailableLabel ?? (action === 'ban' ? 'Terban' : 'Terpilih')) : action === 'ban' ? 'Ban hero' : 'Pick hero'}
          </button>
        )}
      </div>
    </article>
  );
});
