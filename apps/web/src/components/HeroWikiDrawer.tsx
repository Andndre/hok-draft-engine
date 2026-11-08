import React, { useState } from 'react';
import { Hero } from '../types';
import { X, Star, Swords, Shield, Lightbulb, BookOpen, ExternalLink, Zap } from 'lucide-react';

interface HeroWikiDrawerProps {
  hero: Hero | null;
  onClose: () => void;
  isFavorite: boolean;
  onToggleFavorite: (heroId: number) => void;
  onPickForDraft?: (hero: Hero) => void;
  allHeroes: Hero[];
  onSelectRelatedHero: (hero: Hero) => void;
}

export const HeroWikiDrawer: React.FC<HeroWikiDrawerProps> = ({
  hero,
  onClose,
  isFavorite,
  onToggleFavorite,
  onPickForDraft,
  allHeroes,
  onSelectRelatedHero,
}) => {
  const [activeWikiTab, setActiveWikiTab] = useState<'counters' | 'tactics' | 'synergy'>('counters');

  if (!hero) return null;

  const idMap = new Map<number, Hero>();
  allHeroes.forEach((h) => idMap.set(h.hero_id, h));

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-sm flex justify-end transition-opacity">
      <div className="w-full max-w-lg bg-[#0E121A] border-l border-[#232A38] h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
        {/* Drawer Header */}
        <div className="relative p-4 border-b border-[#232A38] bg-[#12161F]">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 rounded-lg bg-[#1A202C] text-slate-400 hover:text-white border border-[#232A38] transition-all"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-4">
            <div className="relative w-16 h-16 rounded-xl overflow-hidden bg-[#0A0D12] border-2 border-[#232A38]">
              <img
                src={hero.portrait_asset}
                alt={hero.name}
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).src =
                    `https://hok.kurohiko.id/icons/hero/${hero.hero_id}.webp`;
                }}
              />
              <div
                className="absolute top-0 left-0 w-6 h-6 bg-[#EF4444] flex items-start justify-start p-0.5"
                style={{ clipPath: 'polygon(0 0, 100% 0, 0 100%)' }}
              >
                <span className="text-[8px] font-black text-black">{hero.tier}</span>
              </div>
            </div>

            <div className="flex-1 min-w-0 pr-8">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-extrabold text-white truncate">{hero.name}</h3>
                <span className="text-xs font-mono text-slate-400">({hero.chinese_name})</span>
              </div>
              <p className="text-xs text-slate-400 truncate mt-0.5">{hero.title}</p>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-[#1A202C] text-[#B8FF01] border border-[#B8FF01]/30">
                  {hero.primary_role} · {hero.lanes.join(' / ')}
                </span>
                <span className="text-[11px] font-mono text-emerald-400 font-bold">
                  {(hero.win_rate * 100).toFixed(1)}% WR
                </span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-[#232A38]">
            <button
              onClick={() => onToggleFavorite(hero.hero_id)}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-bold border transition-all ${
                isFavorite
                  ? 'bg-amber-400 text-black border-amber-400'
                  : 'bg-[#1A202C] text-slate-300 border-[#232A38] hover:text-white'
              }`}
            >
              <Star className="w-3.5 h-3.5" fill={isFavorite ? 'currentColor' : 'none'} />
              <span>{isFavorite ? 'Tersimpan di Favorit' : 'Simpan ke Favorit'}</span>
            </button>

            {onPickForDraft && (
              <button
                onClick={() => {
                  onPickForDraft(hero);
                  onClose();
                }}
                className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-bold bg-[#B8FF01] text-black shadow hover:brightness-110 transition-all"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>Pilih di Draft AI</span>
              </button>
            )}
          </div>
        </div>

        {/* Wiki Subtabs */}
        <div className="grid grid-cols-3 border-b border-[#232A38] bg-[#0A0D12]">
          <button
            onClick={() => setActiveWikiTab('counters')}
            className={`py-2.5 text-xs font-bold border-b-2 transition-all flex items-center justify-center gap-1.5 ${
              activeWikiTab === 'counters'
                ? 'border-[#B8FF01] text-[#B8FF01]'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Swords className="w-3.5 h-3.5" />
            <span>Counter Alami</span>
          </button>

          <button
            onClick={() => setActiveWikiTab('tactics')}
            className={`py-2.5 text-xs font-bold border-b-2 transition-all flex items-center justify-center gap-1.5 ${
              activeWikiTab === 'tactics'
                ? 'border-[#B8FF01] text-[#B8FF01]'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Lightbulb className="w-3.5 h-3.5" />
            <span>Cara Melawan</span>
          </button>

          <button
            onClick={() => setActiveWikiTab('synergy')}
            className={`py-2.5 text-xs font-bold border-b-2 transition-all flex items-center justify-center gap-1.5 ${
              activeWikiTab === 'synergy'
                ? 'border-[#B8FF01] text-[#B8FF01]'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>Melawan Siapa</span>
          </button>
        </div>

        {/* Scrollable Content Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {activeWikiTab === 'counters' && (
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center justify-between">
                <span>Daftar Hero Counter Alami</span>
                <span className="text-[10px] text-slate-500 font-mono">
                  {hero.counters.length} Hero Tercatat
                </span>
              </h4>

              {hero.counters.length === 0 ? (
                <p className="text-xs text-slate-500 italic p-3 bg-[#12161F] rounded-xl border border-[#232A38]">
                  Belum ada counter spesifik yang tercatat untuk {hero.name}.
                </p>
              ) : (
                hero.counters.map((c, i) => {
                  const targetHero = c.target_id ? idMap.get(c.target_id) : null;
                  return (
                    <div
                      key={i}
                      onClick={() => targetHero && onSelectRelatedHero(targetHero)}
                      className="p-3 rounded-xl bg-[#12161F] border border-[#232A38] hover:border-[#334155] cursor-pointer transition-all space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          {targetHero ? (
                            <img
                              src={targetHero.portrait_asset}
                              alt={targetHero.name}
                              className="w-8 h-8 rounded-lg object-cover"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-lg bg-[#1A202C] flex items-center justify-center text-xs font-bold">
                              {c.target_name[0]}
                            </div>
                          )}
                          <span className="font-bold text-xs text-white">
                            {c.target_name}
                          </span>
                        </div>
                        <span
                          className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded font-mono ${
                            c.severity === 'hard'
                              ? 'bg-rose-950 text-rose-400 border border-rose-800/40'
                              : 'bg-amber-950 text-amber-400 border border-amber-800/40'
                          }`}
                        >
                          {c.severity}
                        </span>
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed pl-1">
                        {c.reason}
                      </p>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {activeWikiTab === 'tactics' && (
            <div className="space-y-4">
              <div>
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                  Panduan Menghadapi di Pertandingan
                </h4>
                <div className="p-3 rounded-xl bg-[#12161F] border border-[#232A38] text-xs text-slate-200 leading-relaxed">
                  {hero.tactical_tips ||
                    `Fokuskan burst damage saat skill escape ${hero.name} sedang cooldown. Jaga formasi agar tidak terkena skill inisiasinya.`}
                </div>
              </div>

              {hero.counter_items.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                    Item Counter yang Direkomendasikan
                  </h4>
                  <div className="space-y-2">
                    {hero.counter_items.map((item, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-xl bg-[#12161F] border border-[#232A38] space-y-1"
                      >
                        <h5 className="font-bold text-xs text-[#F5C451]">{item.name}</h5>
                        {item.description && (
                          <p className="text-[11px] text-slate-400">{item.description}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeWikiTab === 'synergy' && (
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center justify-between">
                <span>Efektif Melawan Hero Berikut</span>
                <span className="text-[10px] text-slate-500 font-mono">
                  {hero.countered_by.length} Target
                </span>
              </h4>

              {hero.countered_by.length === 0 ? (
                <p className="text-xs text-slate-500 italic p-3 bg-[#12161F] rounded-xl border border-[#232A38]">
                  {hero.name} adalah hero versatile tanpa target kelemahan ekstrem.
                </p>
              ) : (
                hero.countered_by.map((c, i) => {
                  const targetHero = idMap.get(c.counter_id);
                  return (
                    <div
                      key={i}
                      onClick={() => targetHero && onSelectRelatedHero(targetHero)}
                      className="p-3 rounded-xl bg-[#12161F] border border-[#232A38] hover:border-[#334155] cursor-pointer transition-all space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          {targetHero ? (
                            <img
                              src={targetHero.portrait_asset}
                              alt={targetHero.name}
                              className="w-8 h-8 rounded-lg object-cover"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-lg bg-[#1A202C] flex items-center justify-center text-xs font-bold">
                              {c.counter_name[0]}
                            </div>
                          )}
                          <span className="font-bold text-xs text-white">
                            {c.counter_name}
                          </span>
                        </div>
                        <span className="text-[10px] font-mono text-emerald-400 font-bold">
                          Keunggulan Taktis
                        </span>
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed pl-1">
                        {c.reason}
                      </p>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
