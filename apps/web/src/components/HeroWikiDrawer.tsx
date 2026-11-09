import React, { useEffect, useMemo, useState } from 'react';
import { Hero } from '../types';
import { X, Star, Swords, Shield, Lightbulb, BookOpen, Zap, Sparkles, ArrowRight, CheckCircle2, AlertCircle, Wrench, Trophy, AlertTriangle, ShieldBan, Link2 } from 'lucide-react';
import { AssetThumbnail } from './ui/AssetThumbnail';
import { displayCopy } from './ui/presentation';
import { useDialogFocus } from './ui/useDialogFocus';
import { getItemMeta } from '../data/itemsMap';

interface HeroWikiDrawerProps {
  hero: Hero | null;
  onClose: () => void;
  isFavorite: boolean;
  onToggleFavorite: (heroId: number) => void;
  onPickForDraft?: (hero: Hero) => void;
  draftActionLabel?: string;
  initialTab?: 'build' | 'counters' | 'abilities' | 'tactics';
  allHeroes: Hero[];
  onSelectRelatedHero: (hero: Hero) => void;
}

export const HeroWikiDrawer: React.FC<HeroWikiDrawerProps> = ({
  hero: sourceHero,
  onClose,
  isFavorite,
  onToggleFavorite,
  onPickForDraft,
  draftActionLabel = 'Pilih di draft',
  initialTab = 'build',
  allHeroes,
  onSelectRelatedHero,
}) => {
  const [activeWikiTab, setActiveWikiTab] = useState<'build' | 'counters' | 'abilities' | 'tactics'>(initialTab);
  const hero = useMemo(() => displayCopy(sourceHero), [sourceHero]);
  const dialog = useDialogFocus(!!sourceHero, onClose);
  useEffect(() => setActiveWikiTab(initialTab), [initialTab]);

  if (!hero) return null;

  const idMap = new Map<number, Hero>();
  const slugMap = new Map<string, Hero>();
  allHeroes.forEach((h) => {
    idMap.set(h.hero_id, h);
    slugMap.set(h.slug, h);
    slugMap.set(h.slug.replace(/-/g, '').toLowerCase(), h);
  });

  const hGuide = hero.hokfire_guide;
  const hCounters = hero.hokfire_counters;
  const kpl = hero.kpl_matchup;
  const abilities = hero.abilities || [];

  // Set of opponents that this hero actually beats (favorable according to HOKFIRE or KPL pro stats)
  const favorableAgainstSet = new Set<string>();
  if (hCounters?.strong_against) {
    hCounters.strong_against.forEach((s) => favorableAgainstSet.add(s.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()));
  }
  if (kpl?.best_matchups) {
    kpl.best_matchups.forEach((m) => favorableAgainstSet.add(m.opponent_name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()));
  }

  return (
    <div className="wiki-drawer fixed inset-0 z-[70] overflow-hidden bg-black/70 backdrop-blur-sm flex justify-end transition-opacity">
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="hero-wiki-title" tabIndex={-1} className="wiki-drawer__panel w-full max-w-lg bg-[#0E121A] border-l border-[#232A38] h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
        {/* Drawer Header */}
        <div className="relative p-4 border-b border-[#232A38] bg-[#12161F]">
          <button
            type="button"
            aria-label="Tutup wiki hero"
            title="Tutup wiki hero"
            onClick={onClose}
            className="wiki-close absolute top-4 right-4 rounded-lg bg-[#1A202C] text-slate-400 hover:text-white border border-[#232A38] transition-all"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-4">
            <div className="relative w-16 h-16 rounded-xl overflow-hidden bg-[#0A0D12] border-2 border-[#232A38] flex-shrink-0">
              <AssetThumbnail src={hero.portrait_asset} name={hero.name} kind="hero" className="w-full h-full object-cover asset-thumbnail--fill" />
              <div
                className="absolute top-0 left-0 w-6 h-6 bg-[#EF4444] flex items-start justify-start p-0.5"
                style={{ clipPath: 'polygon(0 0, 100% 0, 0 100%)' }}
              >
                <span className="text-xs font-black text-black">{hero.tier}</span>
              </div>
            </div>

            <div className="flex-1 min-w-0 pr-8">
              <div className="flex items-center gap-2">
                <h3 id="hero-wiki-title" className="text-lg font-extrabold text-white truncate">{hero.name}</h3>
                <span className="text-xs font-mono text-slate-400">({hero.chinese_name})</span>
              </div>
              <p className="text-xs text-slate-400 truncate mt-0.5">{hero.title}</p>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-[#1A202C] text-[#B8FF01] border border-[#B8FF01]/30">
                  {hero.primary_role} · {hero.lanes.join(' / ')}
                </span>
                <span className="text-xs font-mono text-emerald-400 font-bold">
                  {(hero.win_rate * 100).toFixed(1)}% WR
                </span>
                {hGuide && (
                  <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-[#F5C451]/10 text-[#F5C451] border border-[#F5C451]/30 font-bold">
                    Diff: {hGuide.difficulty === 1 ? 'Mudah' : hGuide.difficulty === 2 ? 'Sedang' : 'Sulit'}
                  </span>
                )}
                {hero.is_global_released === false ? (
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-amber-950/70 text-amber-300 border border-amber-800/60 font-bold">
                    CN/KPL Only
                  </span>
                ) : (
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-emerald-950/70 text-emerald-300 border border-emerald-800/60 font-bold">
                    Global Ready
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-[#232A38]">
            <button
              aria-pressed={isFavorite}
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
                  onPickForDraft(sourceHero!);
                  onClose();
                }}
                className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-bold bg-[#B8FF01] text-black shadow hover:brightness-110 transition-all"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>{draftActionLabel}</span>
              </button>
            )}
          </div>
        </div>

        {/* Wiki Subtabs */}
        <div aria-label="Bagian wiki hero" className="wiki-sections grid grid-cols-4 border-b border-[#232A38] bg-[#0A0D12]">
          <button
            aria-pressed={activeWikiTab === 'build'}
            onClick={() => setActiveWikiTab('build')}
            className={`py-2.5 text-xs font-bold border-b-2 transition-all flex items-center justify-center gap-1 ${
              activeWikiTab === 'build'
                ? 'border-[#B8FF01] text-[#B8FF01]'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Wrench className="w-3.5 h-3.5" />
            <span>Build HOKFIRE</span>
          </button>

          <button
            aria-pressed={activeWikiTab === 'counters'}
            onClick={() => setActiveWikiTab('counters')}
            className={`py-2.5 text-xs font-bold border-b-2 transition-all flex items-center justify-center gap-1 ${
              activeWikiTab === 'counters'
                ? 'border-[#B8FF01] text-[#B8FF01]'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Swords className="w-3.5 h-3.5" />
            <span>Counter</span>
          </button>

          <button
            aria-pressed={activeWikiTab === 'abilities'}
            onClick={() => setActiveWikiTab('abilities')}
            className={`py-2.5 text-xs font-bold border-b-2 transition-all flex items-center justify-center gap-1 ${
              activeWikiTab === 'abilities'
                ? 'border-[#B8FF01] text-[#B8FF01]'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Skill & Pros</span>
          </button>

          <button
            aria-pressed={activeWikiTab === 'tactics'}
            onClick={() => setActiveWikiTab('tactics')}
            className={`py-2.5 text-xs font-bold border-b-2 transition-all flex items-center justify-center gap-1 ${
              activeWikiTab === 'tactics'
                ? 'border-[#B8FF01] text-[#B8FF01]'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Lightbulb className="w-3.5 h-3.5" />
            <span>Gameplay</span>
          </button>
        </div>

        {/* Scrollable Content Body */}
        <div className="flex-1 overflow-y-auto p-4 pb-16 space-y-4">
          {/* TAB 1: BUILD & ARCANA HOKFIRE */}
          {activeWikiTab === 'build' && (
            <div className="space-y-4">
              {/* Core & Full Build */}
              {hGuide && hGuide.full_build.length > 0 ? (
                <>
                  <div className="p-3 bg-[#12161F] border border-[#232A38] rounded-xl space-y-2.5">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-[#F5C451]" />
                        <span>Rekomendasi Full Build HOKFIRE</span>
                      </h4>
                      {hGuide.spell && (
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[#1A202C] border border-amber-900/40">
                          <AssetThumbnail src={`/assets/skills/${hGuide.spell.toLowerCase().trim()}.png`} name={hGuide.spell} kind="item" className="w-4 h-4 rounded-full object-cover" />
                          <span className="text-xs font-mono text-amber-300 font-bold">
                            {hGuide.spell}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {hGuide.full_build.map((item, idx) => {
                        const isCore = hGuide.core_items.includes(item);
                        const meta = getItemMeta(item);
                        return (
                          <div
                            key={idx}
                            className={`p-2 rounded-xl border flex items-center gap-2.5 transition-all ${
                              isCore
                                ? 'bg-[#151D2A] border-[#B8FF01]/60 shadow-[0_0_8px_rgba(184,255,1,0.1)]'
                                : 'bg-[#0A0D12] border-[#232A38] hover:border-slate-700'
                            }`}
                            title={meta?.desc || item}
                          >
                            <div className="relative w-10 h-10 rounded-lg bg-[#12161F] border border-[#232A38] flex-shrink-0 overflow-hidden flex items-center justify-center">
                              {meta ? (
                                <AssetThumbnail src={meta.icon} name={item} kind="item" className="w-full h-full object-cover asset-thumbnail--fill" />
                              ) : (
                                <span className="text-xs font-black text-slate-500">
                                  {item.slice(0, 2).toUpperCase()}
                                </span>
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <span className="font-semibold text-sm text-white leading-snug block">
                                {item}
                              </span>
                              <span
                                className={`text-xs font-mono mt-0.5 block ${
                                  isCore ? 'text-[#B8FF01] font-bold' : 'text-slate-500'
                                }`}
                              >
                                {isCore ? 'Item inti' : `Slot #${idx + 1}`}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Situational Item Swaps */}
                  {hGuide.situational_items.length > 0 && (
                    <div className="p-3 bg-[#12161F] border border-[#232A38] rounded-xl space-y-2">
                      <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                        <Shield className="w-3.5 h-3.5 text-[#B8FF01]" />
                        <span>Item Situasional (Swap Khusus)</span>
                      </h4>
                      <p className="text-xs text-slate-400">
                        Tukar item full build di atas saat menghadapi kondisi spesifik pertandingan:
                      </p>

                      <div className="space-y-1.5 pt-1">
                        {hGuide.situational_items.map((sit, idx) => {
                          const metaFrom = getItemMeta(sit.from);
                          const metaTo = getItemMeta(sit.to);
                          return (
                            <div
                              key={idx}
                              className="p-2 rounded-lg bg-[#0A0D12] border border-[#232A38] flex items-center justify-between text-xs"
                            >
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 truncate">
                                  {metaFrom && (
                                    <AssetThumbnail src={metaFrom.icon} name={sit.from} kind="item" className="w-5 h-5 rounded object-cover border border-[#232A38] flex-shrink-0" />
                                  )}
                                  <span className="text-slate-300 truncate font-medium">{sit.from}</span>
                                </div>
                                <ArrowRight className="w-3.5 h-3.5 text-[#B8FF01] flex-shrink-0" />
                                <div className="flex items-center gap-1.5 truncate">
                                  {metaTo && (
                                    <AssetThumbnail src={metaTo.icon} name={sit.to} kind="item" className="w-5 h-5 rounded object-cover border border-[#B8FF01]/40 flex-shrink-0" />
                                  )}
                                  <span className="text-[#F5C451] font-bold truncate">{sit.to}</span>
                                </div>
                              </div>
                              <span className="text-xs font-mono px-2 py-0.5 rounded bg-rose-950/80 text-rose-300 border border-rose-800/50 flex-shrink-0 ml-2">
                                {sit.vs}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Arcana Setup */}
                  {hGuide.arcana.length > 0 && (
                    <div className="p-3 bg-[#12161F] border border-[#232A38] rounded-xl space-y-2">
                      <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center justify-between">
                        <span>Susunan Arcana Resmi</span>
                        <span className="text-xs text-slate-500 font-mono">30 Sockets</span>
                      </h4>
                      <div className="grid grid-cols-2 gap-2">
                        {hGuide.arcana.map((arc, idx) => {
                          const iconSrc = arc.icon_url || (arc.id ? `/assets/arcana/${arc.id}.png` : '');
                          const colorBorder =
                            arc.color === 'R'
                              ? 'border-rose-800/60 bg-rose-950/20 text-rose-300'
                              : arc.color === 'B'
                              ? 'border-blue-800/60 bg-blue-950/20 text-blue-300'
                              : 'border-emerald-800/60 bg-emerald-950/20 text-emerald-300';

                          return (
                            <div
                              key={idx}
                              className={`p-2 rounded-xl bg-[#0A0D12] border flex items-center gap-2.5 ${colorBorder}`}
                              title={arc.desc || arc.name}
                            >
                              <div className="relative w-8 h-8 rounded-lg bg-[#12161F] border border-[#232A38] overflow-hidden flex items-center justify-center flex-shrink-0">
                                {iconSrc ? (
                                  <AssetThumbnail src={iconSrc} name={arc.name} kind="item" className="w-full h-full object-cover asset-thumbnail--fill" />
                                ) : (
                                  <span className="text-xs font-black">{arc.name.slice(0, 2)}</span>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <span className="text-xs font-bold text-slate-200 block truncate leading-tight">
                                  {arc.name}
                                </span>
                                <span className="text-xs font-mono text-slate-400 block truncate">
                                  {arc.desc ? arc.desc.slice(0, 24) + '...' : `Arcana Tipe ${arc.color || 'L3'}`}
                                </span>
                              </div>
                              <span className="text-xs font-mono font-black text-[#B8FF01] flex-shrink-0">
                                x{arc.count}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Skill Priority */}
                  {hGuide.skill_priority && (
                    <div className="p-2.5 bg-[#12161F] border border-[#232A38] rounded-xl flex items-center justify-between">
                      <span className="text-xs text-slate-400">Prioritas Leveling Skill:</span>
                      <span className="text-xs font-bold text-[#B8FF01] font-mono">{hGuide.skill_priority}</span>
                    </div>
                  )}
                </>
              ) : (
                <div className="p-6 text-center bg-[#12161F] rounded-xl border border-[#232A38] space-y-2">
                  <p className="text-sm font-semibold text-slate-300">Build guide resmi sedang disusun.</p>
                  <p className="text-xs text-slate-500">Lihat tab Skill & Gameplay untuk tips bermain.</p>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: COUNTERS & MATCHUPS */}
          {activeWikiTab === 'counters' && (
            <div className="space-y-4">
              {/* SECTION 1: KPL OFFICIAL PRO TOURNAMENT MATCHUPS (11,141 Matches Data) */}
              {kpl && (kpl.total_picks > 0 || kpl.worst_matchups.length > 0 || kpl.best_matchups.length > 0) && (
                <div className="p-3.5 bg-[#121824] border border-[#23334D] rounded-xl space-y-3 shadow-lg">
                  <div className="flex items-center justify-between border-b border-[#23334D] pb-2">
                    <div className="flex items-center gap-2">
                      <Trophy className="w-4 h-4 text-[#F5C451]" />
                      <h4 className="text-xs font-black text-white uppercase tracking-wider">
                        KPL Pro Tournament Matchups
                      </h4>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs font-mono">
                      <span className="px-1.5 py-0.5 rounded bg-[#1A2233] text-slate-300 border border-[#2A3750]">
                        {kpl.total_picks} Picks
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-[#1A2233] text-amber-300 border border-[#2A3750]">
                        {kpl.total_bans} Bans
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-[#1A2233] text-emerald-400 font-bold border border-[#2A3750]">
                        {(kpl.overall_winrate * 100).toFixed(1)}% WR
                      </span>
                    </div>
                  </div>

                  {/* KPL Hard Counters (Worst Matchups) */}
                  {kpl.worst_matchups.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono text-rose-400 font-bold flex items-center gap-1">
                          <ShieldBan className="w-4 h-4" aria-hidden="true" /> HARD COUNTER DI TURNAMEN KPL:
                        </span>
                        <span className="text-xs font-mono text-slate-500">Winrate Hero Rendah</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {kpl.worst_matchups.map((m) => {
                          const rel = idMap.get(m.opponent_id);
                          return (
                            <button
                              key={m.opponent_id}
                              onClick={() => rel && onSelectRelatedHero(rel)}
                              className="p-2 rounded-lg bg-rose-950/30 border border-rose-900/40 hover:border-rose-500/70 flex items-center justify-between text-left transition-all group"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <AssetThumbnail src={m.opponent_avatar} name={m.opponent_name} kind="hero" className="w-7 h-7 rounded-md object-cover border border-rose-800/40 group-hover:scale-105 transition-transform" />
                                <div className="min-w-0">
                                  <span className="text-xs font-bold text-white block truncate">
                                    {m.opponent_name}
                                  </span>
                                  <span className="text-xs font-mono text-slate-400 block">
                                    {m.wins}W - {m.losses}L ({m.total_matches} Game)
                                  </span>
                                </div>
                              </div>
                              <span className="text-xs font-mono font-black text-rose-400 pl-1.5 flex-shrink-0">
                                {(m.hero_winrate * 100).toFixed(1)}% WR
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* KPL Favorable Targets (Best Matchups) */}
                  {kpl.best_matchups.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono text-emerald-400 font-bold flex items-center gap-1">
                          <Swords className="w-4 h-4" aria-hidden="true" /> TARGET EMPUK DI TURNAMEN KPL:
                        </span>
                        <span className="text-xs font-mono text-slate-500">Winrate Hero Tinggi</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {kpl.best_matchups.map((m) => {
                          const rel = idMap.get(m.opponent_id);
                          return (
                            <button
                              key={m.opponent_id}
                              onClick={() => rel && onSelectRelatedHero(rel)}
                              className="p-2 rounded-lg bg-emerald-950/30 border border-emerald-900/40 hover:border-emerald-500/70 flex items-center justify-between text-left transition-all group"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <AssetThumbnail src={m.opponent_avatar} name={m.opponent_name} kind="hero" className="w-7 h-7 rounded-md object-cover border border-emerald-800/40 group-hover:scale-105 transition-transform" />
                                <div className="min-w-0">
                                  <span className="text-xs font-bold text-white block truncate">
                                    {m.opponent_name}
                                  </span>
                                  <span className="text-xs font-mono text-slate-400 block">
                                    {m.wins}W - {m.losses}L ({m.total_matches} Game)
                                  </span>
                                </div>
                              </div>
                              <span className="text-xs font-mono font-black text-emerald-400 pl-1.5 flex-shrink-0">
                                {(m.hero_winrate * 100).toFixed(1)}% WR
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* KPL Duet Synergies (Best Team Combos) */}
                  {kpl.synergies && kpl.synergies.length > 0 && (
                    <div className="space-y-1.5 pt-1 border-t border-[#1C2638]">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono text-indigo-400 font-bold flex items-center gap-1">
                          <Link2 className="w-4 h-4" aria-hidden="true" /> REKAN DUET SINERGI TERBAIK DI TURNAMEN KPL:
                        </span>
                        <span className="text-xs font-mono text-slate-500">Duet Winrate Tinggi</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {kpl.synergies.map((s) => {
                          const rel = idMap.get(s.partner_id);
                          return (
                            <button
                              key={s.partner_id}
                              onClick={() => rel && onSelectRelatedHero(rel)}
                              className="p-2 rounded-lg bg-indigo-950/30 border border-indigo-900/40 hover:border-indigo-500/70 flex items-center justify-between text-left transition-all group"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <AssetThumbnail src={s.partner_avatar} name={s.partner_name} kind="hero" className="w-7 h-7 rounded-md object-cover border border-indigo-800/40 group-hover:scale-105 transition-transform" />
                                <div className="min-w-0">
                                  <span className="text-xs font-bold text-white block truncate">
                                    {s.partner_name}
                                  </span>
                                  <span className="text-xs font-mono text-slate-400 block">
                                    {s.wins}W - {s.losses}L ({s.total_matches} Game Bersama)
                                  </span>
                                </div>
                              </div>
                              <span className="text-xs font-mono font-black text-indigo-400 pl-1.5 flex-shrink-0">
                                {(s.duet_winrate * 100).toFixed(1)}% WR
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* SECTION 2: HOKFIRE Verified Matchups */}
              {hCounters && (hCounters.weak_against.length > 0 || hCounters.strong_against.length > 0 || hCounters.synergizes.length > 0) && (
                <div className="p-3 bg-[#151A24] border border-[#2A3446] rounded-xl space-y-3">
                  <h4 className="text-xs font-extrabold text-[#F5C451] uppercase tracking-wider flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>HOKFIRE Official Matchups</span>
                  </h4>

                  {/* Weak Against (Hard Counter) */}
                  {hCounters.weak_against.length > 0 && (
                    <div>
                      <span className="text-xs font-mono text-rose-400 font-bold block mb-1">
                        <ShieldBan className="w-4 h-4 inline-block mr-1" aria-hidden="true" /> LEMAH MELAWAN (Counter Alami HOKFIRE):
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {hCounters.weak_against.map((slug) => {
                          const rel = slugMap.get(slug.replace(/-/g, '').toLowerCase());
                          return (
                            <button
                              key={slug}
                              onClick={() => rel && onSelectRelatedHero(rel)}
                              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-950/60 text-rose-200 border border-rose-800/50 text-xs font-bold hover:border-rose-400 transition-all"
                            >
                              {rel && <AssetThumbnail src={rel.portrait_asset} name={rel.name} kind="hero" className="w-3.5 h-3.5 rounded-full" />}
                              <span>{rel ? rel.name : slug}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Strong Against */}
                  {hCounters.strong_against.length > 0 && (
                    <div>
                      <span className="text-xs font-mono text-emerald-400 font-bold block mb-1">
                        <Swords className="w-4 h-4 inline-block mr-1" aria-hidden="true" /> KUAT MELAWAN (Target Empuk):
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {hCounters.strong_against.map((slug) => {
                          const rel = slugMap.get(slug.replace(/-/g, '').toLowerCase());
                          return (
                            <button
                              key={slug}
                              onClick={() => rel && onSelectRelatedHero(rel)}
                              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-950/60 text-emerald-200 border border-emerald-800/50 text-xs font-bold hover:border-emerald-400 transition-all"
                            >
                              {rel && <AssetThumbnail src={rel.portrait_asset} name={rel.name} kind="hero" className="w-3.5 h-3.5 rounded-full" />}
                              <span>{rel ? rel.name : slug}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Synergizes */}
                  {hCounters.synergizes.length > 0 && (
                    <div>
                      <span className="text-xs font-mono text-indigo-400 font-bold block mb-1">
                        <Link2 className="w-4 h-4 inline-block mr-1" aria-hidden="true" /> REKAN SINERGI TERBAIK (Duet Kombo):
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {hCounters.synergizes.map((slug) => {
                          const rel = slugMap.get(slug.replace(/-/g, '').toLowerCase());
                          return (
                            <button
                              key={slug}
                              onClick={() => rel && onSelectRelatedHero(rel)}
                              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-indigo-950/60 text-indigo-200 border border-indigo-800/50 text-xs font-bold hover:border-indigo-400 transition-all"
                            >
                              {rel && <AssetThumbnail src={rel.portrait_asset} name={rel.name} kind="hero" className="w-3.5 h-3.5 rounded-full" />}
                              <span>{rel ? rel.name : slug}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* SECTION 3: Kurohiko Community Counters with Smart Conflict Resolution */}
              <div className="space-y-4">
                <div className="flex items-center justify-between text-xs text-slate-300 font-bold uppercase tracking-wider">
                  <span>Matriks Counter Komunitas (Kurohiko)</span>
                  <span className="text-xs text-slate-500 font-mono">
                    {((hero.countered_by?.length || 0) + (hero.counters?.length || 0))} Matchup
                  </span>
                </div>

                {/* 3A: Lemah Melawan (Hero yang meng-counter kita) */}
                <div className="space-y-2.5">
                  <span className="text-xs font-black uppercase text-rose-400 tracking-wider flex items-center gap-1">
                    <span><ShieldBan className="w-4 h-4 inline-block mr-1" aria-hidden="true" /> Lemah Melawan (Counter Alami):</span>
                  </span>

                  {(!hero.countered_by || hero.countered_by.length === 0) ? (
                    <p className="text-xs text-slate-500 italic p-2.5 bg-[#12161F] rounded-xl border border-[#232A38]">
                      Belum ada counter alami spesifik yang tercatat.
                    </p>
                  ) : (
                    hero.countered_by.map((c, i) => {
                      const predatorHero = c.counter_id ? idMap.get(c.counter_id) : null;
                      const cleanCounterName = c.counter_name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
                      const isDisputed = favorableAgainstSet.has(cleanCounterName);

                      return (
                        <div
                          key={i}
                          onClick={() => predatorHero && onSelectRelatedHero(predatorHero)}
                          className={`p-3 rounded-xl border transition-all space-y-2 cursor-pointer ${
                            isDisputed
                              ? 'bg-[#181512] border-amber-800/50 hover:border-amber-600'
                              : 'bg-[#12161F] border-[#232A38] hover:border-[#334155]'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                              {predatorHero ? (
                                <AssetThumbnail src={predatorHero.portrait_asset} name={predatorHero.name} kind="hero" className="w-8 h-8 rounded-lg object-cover" />
                              ) : (
                                <div className="w-8 h-8 rounded-lg bg-[#1A202C] flex items-center justify-center text-xs font-bold">
                                  {c.counter_name[0]}
                                </div>
                              )}
                              <div>
                                <span className="font-bold text-xs text-white block">{c.counter_name}</span>
                                {isDisputed && (
                                  <span className="text-xs font-mono text-amber-400 font-semibold block">
                                     Bertentangan dgn Meta KPL / HOKFIRE
                                  </span>
                                )}
                              </div>
                            </div>
                            <span
                              className={`text-xs uppercase font-bold px-2 py-0.5 rounded font-mono flex items-center gap-1 ${
                                isDisputed
                                  ? 'bg-amber-950/80 text-amber-300 border border-amber-800/60'
                                  : c.severity === 'hard'
                                  ? 'bg-rose-950 text-rose-400 border border-rose-800/40'
                                  : 'bg-amber-950 text-amber-400 border border-amber-800/40'
                              }`}
                            >
                              {isDisputed && <AlertTriangle className="w-2.5 h-2.5" />}
                              <span>{isDisputed ? 'DISPUTED' : c.severity}</span>
                            </span>
                          </div>

                          <p className="text-xs text-slate-300 leading-relaxed pl-1">{c.reason}</p>

                          {isDisputed && (
                            <div className="p-2.5 rounded-lg bg-amber-950/30 border border-amber-900/40 text-xs text-amber-200/90 leading-relaxed flex items-start gap-2">
                              <Lightbulb className="w-4 h-4 text-amber-400 flex-shrink-0" aria-hidden="true" />
                              <div>
                                <strong className="text-amber-300">Catatan Meta Turnamen:</strong> Data empiris turnamen pro (KPL) dan panduan resmi HOKFIRE mencatat <strong>{hero.name}</strong> justru lebih unggul saat berhadapan dengan <strong>{c.counter_name}</strong> pada patch kompetitif aktif.
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>

                {/* 3B: Kuat Melawan (Target empuk yang di-counter kita) */}
                {hero.counters && hero.counters.length > 0 && (
                  <div className="space-y-2.5 pt-2 border-t border-[#232A38]/60">
                    <span className="text-xs font-black uppercase text-emerald-400 tracking-wider flex items-center gap-1">
                      <span><Swords className="w-4 h-4 inline-block mr-1" aria-hidden="true" /> Kuat Melawan (Target Empuk):</span>
                    </span>

                    {hero.counters.map((c, i) => {
                      const targetHero = c.target_id ? idMap.get(c.target_id) : null;
                      return (
                        <div
                          key={i}
                          onClick={() => targetHero && onSelectRelatedHero(targetHero)}
                          className="p-3 rounded-xl border border-[#232A38] bg-[#12161F] hover:border-[#334155] transition-all space-y-1.5 cursor-pointer"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                              {targetHero ? (
                                <AssetThumbnail src={targetHero.portrait_asset} name={targetHero.name} kind="hero" className="w-8 h-8 rounded-lg object-cover" />
                              ) : (
                                <div className="w-8 h-8 rounded-lg bg-[#1A202C] flex items-center justify-center text-xs font-bold">
                                  {c.target_name[0]}
                                </div>
                              )}
                              <span className="font-bold text-xs text-white">{c.target_name}</span>
                            </div>
                            <span className="text-xs uppercase font-bold px-2 py-0.5 rounded font-mono bg-emerald-950 text-emerald-400 border border-emerald-800/40">
                              {c.severity}
                            </span>
                          </div>
                          <p className="text-xs text-slate-300 leading-relaxed pl-1">{c.reason}</p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: ABILITIES & PROS / CONS */}
          {activeWikiTab === 'abilities' && (
            <div className="space-y-4">
              {/* Pros & Cons */}
              {hGuide && (hGuide.pros.length > 0 || hGuide.cons.length > 0) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Pros */}
                  <div className="p-3 bg-[#101F18] border border-emerald-900/50 rounded-xl space-y-2">
                    <span className="text-xs font-black uppercase text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>Kelebihan (Pros)</span>
                    </span>
                    <ul className="space-y-1">
                      {hGuide.pros.map((p, idx) => (
                        <li key={idx} className="text-xs text-slate-200 flex items-start gap-1.5">
                          <span className="text-emerald-400 font-bold">•</span>
                          <span>{p}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Cons */}
                  <div className="p-3 bg-[#241216] border border-rose-900/50 rounded-xl space-y-2">
                    <span className="text-xs font-black uppercase text-rose-400 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      <span>Kelemahan (Cons)</span>
                    </span>
                    <ul className="space-y-1">
                      {hGuide.cons.map((c, idx) => (
                        <li key={idx} className="text-xs text-slate-200 flex items-start gap-1.5">
                          <span className="text-rose-400 font-bold">•</span>
                          <span>{c}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {/* Ability Descriptions */}
              <div className="space-y-2.5">
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center justify-between">
                  <span>Kemampuan & Skill Hero ({abilities.length})</span>
                  <span className="text-xs text-slate-500 font-mono">HOK Official Abilities</span>
                </h4>

                {abilities.length === 0 ? (
                  <p className="text-xs text-slate-500 italic p-3 bg-[#12161F] rounded-xl border border-[#232A38]">
                    Informasi detail skill belum dimuat.
                  </p>
                ) : (
                  abilities.map((ab, idx) => {
                    const abilityIconSrc = `/assets/abilities/${hero.hero_id}-${idx}.png`;
                    return (
                      <div
                        key={idx}
                        className="p-3 bg-[#12161F] border border-[#232A38] rounded-xl space-y-2 hover:border-[#334155] transition-all"
                      >
                        <div className="flex items-center gap-3">
                          {/* Ability Icon with Gold Border for Ultimate */}
                          <div
                            className={`relative w-12 h-12 rounded-xl overflow-hidden bg-[#0A0D12] border-2 flex-shrink-0 flex items-center justify-center ${
                              ab.type.toLowerCase().includes('ultimate')
                                ? 'border-[#F5C451] shadow-[0_0_10px_rgba(245,196,81,0.2)]'
                                : ab.type.toLowerCase().includes('passive')
                                ? 'border-indigo-400/60'
                                : 'border-[#232A38]'
                            }`}
                          >
                            <AssetThumbnail src={abilityIconSrc} name={ab.name} kind="item" className="w-full h-full object-cover asset-thumbnail--fill" />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-extrabold text-sm text-white truncate">{ab.name}</span>
                              <span
                                className={`text-xs font-mono px-2 py-0.5 rounded font-bold uppercase ${
                                  ab.type.toLowerCase().includes('ultimate')
                                    ? 'bg-[#F5C451]/10 text-[#F5C451] border border-[#F5C451]/30'
                                    : ab.type.toLowerCase().includes('passive')
                                    ? 'bg-indigo-950/60 text-indigo-300 border border-indigo-800/40'
                                    : 'bg-[#1A202C] text-[#B8FF01] border border-[#232A38]'
                                }`}
                              >
                                {ab.type}
                              </span>
                            </div>
                            <span className="text-xs font-mono text-slate-500 block mt-0.5">
                              {idx === 0
                                ? 'Skill Pasif'
                                : idx === 3
                                ? 'Skill Pamungkas (Ultimate)'
                                : `Skill Aktif #${idx}`}
                            </span>
                          </div>
                        </div>

                        <p className="text-xs text-slate-300 leading-relaxed pt-1 border-t border-[#1E2533]">
                          {ab.desc}
                        </p>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* TAB 4: GAMEPLAY & TACTICS */}
          {activeWikiTab === 'tactics' && (
            <div className="space-y-4">
              {/* HOKFIRE Gameplay Breakdown */}
              {hGuide && hGuide.gameplay_tips ? (
                <div className="p-3.5 bg-[#12161F] border border-[#232A38] rounded-xl space-y-2">
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <BookOpen className="w-3.5 h-3.5 text-[#B8FF01]" />
                    <span>Panduan Bermain Resmi HOKFIRE</span>
                  </h4>
                  <div className="text-xs text-slate-200 leading-relaxed whitespace-pre-line">
                    {hGuide.gameplay_tips.replace(/## /g, '')}
                  </div>
                </div>
              ) : null}

              {/* Cara Melawan / Menghadapi dari Kurohiko */}
              <div>
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                  Cara Melawan di Pertandingan
                </h4>
                <div className="p-3 rounded-xl bg-[#12161F] border border-[#232A38] text-xs text-slate-200 leading-relaxed">
                  {hero.tactical_tips ||
                    `Fokuskan burst damage saat skill escape ${hero.name} sedang cooldown. Jaga formasi agar tidak terkena skill inisiasinya.`}
                </div>
              </div>

              {/* Item Counter */}
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
                          <p className="text-xs text-slate-400">{item.description}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
