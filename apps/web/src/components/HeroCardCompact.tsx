import React from 'react';
import { Hero } from '../types';

interface HeroCardCompactProps {
  hero: Hero;
  isSelected?: boolean;
  isUnavailable?: boolean;
  onClick: (hero: Hero) => void;
  quickBadge?: string;
}

export const HeroCardCompact: React.FC<HeroCardCompactProps> = ({
  hero,
  isSelected,
  isUnavailable,
  onClick,
  quickBadge,
}) => {
  const winPercent = (hero.win_rate * 100).toFixed(1);
  const winColor =
    hero.win_rate >= 0.5
      ? 'text-[#10B981]'
      : hero.win_rate >= 0.49
      ? 'text-slate-300'
      : 'text-[#F43F5E]';

  return (
    <div
      onClick={() => !isUnavailable && onClick(hero)}
      className={`relative group flex items-center gap-3 p-2 rounded-xl cursor-pointer transition-all border ${
        isUnavailable
          ? 'opacity-40 grayscale pointer-events-none bg-[#0D1017] border-[#1A202C]'
          : isSelected
          ? 'bg-[#1A202C] border-[#B8FF01] shadow-[0_0_12px_rgba(184,255,1,0.25)]'
          : 'bg-[#12161F] border-[#232A38] hover:bg-[#1A202C] hover:border-[#334155]'
      }`}
      style={{ minHeight: '62px' }}
    >
      {/* 48x48 Portrait Avatar */}
      <div className="relative w-12 h-12 flex-shrink-0 rounded-lg overflow-hidden bg-[#0A0D12] border border-[#232A38]">
        <img
          src={hero.portrait_asset}
          alt={hero.name}
          loading="lazy"
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).src =
              `https://hok.kurohiko.id/icons/hero/${hero.hero_id}.webp`;
          }}
        />

        {/* Lane indicator icon / dot */}
        <span
          className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border border-[#12161F] ${
            hero.primary_lane === 'Clash'
              ? 'bg-amber-500'
              : hero.primary_lane === 'Jungle'
              ? 'bg-emerald-500'
              : hero.primary_lane === 'Mid'
              ? 'bg-indigo-500'
              : hero.primary_lane === 'Farm'
              ? 'bg-rose-500'
              : 'bg-cyan-500'
          }`}
          title={hero.primary_lane}
        />
      </div>

      {/* Info Column */}
      <div className="flex-1 min-w-0 pr-1">
        <div className="flex items-center justify-between gap-1">
          <h4 className="font-semibold text-xs sm:text-sm text-slate-100 truncate group-hover:text-white">
            {hero.name}
          </h4>
          {hero.tier && (
            <span
              className={`text-[10px] font-mono font-bold px-1 py-0.2 rounded ${
                hero.tier === 'S'
                  ? 'bg-rose-950 text-rose-400 border border-rose-800/40'
                  : hero.tier === 'A'
                  ? 'bg-amber-950 text-amber-400 border border-amber-800/40'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              {hero.tier}
            </span>
          )}
        </div>

        <div className="flex items-center justify-between mt-1 text-[11px] text-slate-400">
          <span className="truncate">{hero.primary_role} · {hero.primary_lane}</span>
          <span className={`font-mono-numbers font-semibold ${winColor}`}>
            {winPercent}%
          </span>
        </div>

        {/* Quick Badge / AI recommendation pill */}
        {quickBadge && (
          <div className="mt-1 flex items-center">
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#B8FF01]/10 text-[#B8FF01] border border-[#B8FF01]/30 truncate">
              {quickBadge}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
