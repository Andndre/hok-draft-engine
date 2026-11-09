import React from 'react';
import { Hero } from '../types';

interface HeroCardDetailedProps {
  hero: Hero;
  isSelected?: boolean;
  isUnavailable?: boolean;
  onClick: (hero: Hero) => void;
  aiRank?: number;
}

const TIER_COLORS: Record<string, string> = {
  S: 'bg-[#EF4444]',
  A: 'bg-[#F59E0B]',
  B: 'bg-[#EAB308]',
  C: 'bg-[#84CC16]',
  D: 'bg-[#64748B]',
};

export const HeroCardDetailed: React.FC<HeroCardDetailedProps> = ({
  hero,
  isSelected,
  isUnavailable,
  onClick,
  aiRank,
}) => {
  const winPercent = (hero.win_rate * 100).toFixed(1);
  const pickPercent = (hero.pick_rate * 100).toFixed(1);
  const winColor =
    hero.win_rate >= 0.5
      ? 'text-[#10B981]'
      : hero.win_rate >= 0.49
      ? 'text-slate-300'
      : 'text-[#F43F5E]';

  const tierColor = TIER_COLORS[hero.tier] || TIER_COLORS.B;

  return (
    <div
      role="button"
      tabIndex={isUnavailable ? -1 : 0}
      aria-disabled={!!isUnavailable}
      onKeyDown={event => { if (!isUnavailable && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onClick(hero); } }}
      onClick={() => !isUnavailable && onClick(hero)}
      className={`relative group flex flex-col rounded-xl overflow-hidden cursor-pointer transition-all border ${
        isUnavailable
          ? 'opacity-35 grayscale pointer-events-none bg-[#0D1017] border-[#1A202C]'
          : isSelected
          ? 'bg-[#1A202C] border-[#B8FF01] shadow-[0_0_16px_rgba(184,255,1,0.2)]'
          : 'bg-[#12161F] border-[#232A38] hover:bg-[#1A202C] hover:border-[#334155] hover:-translate-y-0.5'
      }`}
    >
      {/* 1:1 Aspect Ratio Portrait Container */}
      <div className="relative aspect-square w-full bg-[#0A0D12] overflow-hidden">
        <img
          src={hero.portrait_asset}
          alt={hero.name}
          loading="lazy"
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).src =
              `https://hok.kurohiko.id/icons/hero/${hero.hero_id}.webp`;
          }}
        />

        {/* Diagonal Corner Tier Ribbon (Top-Left) */}
        <div className="absolute top-0 left-0 w-8 h-8 pointer-events-none">
          <div
            className={`w-full h-full ${tierColor} flex items-start justify-start p-1 shadow-md`}
            style={{ clipPath: 'polygon(0 0, 100% 0, 0 100%)' }}
          >
            <span className="text-[10px] font-black text-black leading-none drop-shadow-sm">
              {hero.tier}
            </span>
          </div>
        </div>

        {/* AI Top Pick Badge (Top-Right) */}
        {aiRank !== undefined && aiRank <= 3 && (
          <div className="absolute top-1.5 right-1.5 bg-[#B8FF01] text-black font-black text-[10px] px-1.5 py-0.5 rounded shadow">
            #{aiRank}
          </div>
        )}

        {/* Bottom subtle gradient */}
        <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[#12161F] to-transparent" />

        {/* CN-Only Unreleased Indicator */}
        {hero.is_global_released === false && (
          <div className="absolute bottom-1.5 left-1.5 bg-amber-500/90 text-black font-extrabold text-[8px] px-1 py-0.2 rounded shadow">
            CN Only
          </div>
        )}
      </div>

      {/* Hero Name & Identity */}
      <div className="p-2.5 flex-1 flex flex-col justify-between">
        <div>
          <h4 className="font-bold text-xs sm:text-sm text-slate-100 text-center truncate group-hover:text-white">
            {hero.name}
          </h4>
          <p className="text-[10px] text-center text-slate-400 truncate mt-0.5">
            {hero.primary_role} · {hero.primary_lane}
          </p>
        </div>

        {/* Two-Column Bottom Stats */}
        <div className="mt-2 pt-2 border-t border-[#232A38] grid grid-cols-2 gap-1 text-center font-mono-numbers">
          <div className="flex flex-col">
            <span className="text-[9px] text-slate-500 uppercase tracking-wider">Win</span>
            <span className={`text-[11px] font-bold ${winColor}`}>
              {winPercent}%
            </span>
          </div>
          <div className="flex flex-col border-l border-[#232A38]">
            <span className="text-[9px] text-slate-500 uppercase tracking-wider">Pick</span>
            <span className="text-[11px] font-semibold text-slate-300">
              {pickPercent}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
