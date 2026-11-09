import React, { useState } from 'react';
import { Hero } from '../types';
import { X, Star, Swords, Shield, Lightbulb, BookOpen, Zap, Sparkles, ArrowRight, CheckCircle2, AlertCircle, Wrench } from 'lucide-react';

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
  const [activeWikiTab, setActiveWikiTab] = useState<'build' | 'counters' | 'abilities' | 'tactics'>('build');

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
  const abilities = hero.abilities || [];

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/70 backdrop-blur-sm flex justify-end transition-opacity">
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
            <div className="relative w-16 h-16 rounded-xl overflow-hidden bg-[#0A0D12] border-2 border-[#232A38] flex-shrink-0">
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
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-[#1A202C] text-[#B8FF01] border border-[#B8FF01]/30">
                  {hero.primary_role} · {hero.lanes.join(' / ')}
                </span>
                <span className="text-[11px] font-mono text-emerald-400 font-bold">
                  {(hero.win_rate * 100).toFixed(1)}% WR
                </span>
                {hGuide && (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#F5C451]/10 text-[#F5C451] border border-[#F5C451]/30 font-bold">
                    Diff: {hGuide.difficulty === 1 ? 'Mudah' : hGuide.difficulty === 2 ? 'Sedang' : 'Sulit'}
                  </span>
                )}
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
        <div className="grid grid-cols-4 border-b border-[#232A38] bg-[#0A0D12]">
          <button
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
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
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
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#1A202C] text-amber-300 border border-amber-900/40">
                          Spell: {hGuide.spell}
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {hGuide.full_build.map((item, idx) => {
                        const isCore = hGuide.core_items.includes(item);
                        return (
                          <div
                            key={idx}
                            className={`p-2 rounded-lg border text-left flex flex-col justify-between ${
                              isCore
                                ? 'bg-[#151D2A] border-[#B8FF01]/60 shadow-[0_0_8px_rgba(184,255,1,0.1)]'
                                : 'bg-[#0A0D12] border-[#232A38]'
                            }`}
                          >
                            <span className="font-bold text-xs text-white leading-tight">{item}</span>
                            <span className={`text-[9px] font-mono mt-1 ${isCore ? 'text-[#B8FF01] font-bold' : 'text-slate-500'}`}>
                              {isCore ? '★ Core Item' : `Item #${idx + 1}`}
                            </span>
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
                      <p className="text-[11px] text-slate-400">
                        Tukar item full build di atas saat menghadapi kondisi spesifik pertandingan:
                      </p>

                      <div className="space-y-1.5 pt-1">
                        {hGuide.situational_items.map((sit, idx) => (
                          <div
                            key={idx}
                            className="p-2 rounded-lg bg-[#0A0D12] border border-[#232A38] flex items-center justify-between text-xs"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-slate-300 truncate font-medium">{sit.from}</span>
                              <ArrowRight className="w-3 h-3 text-[#B8FF01] flex-shrink-0" />
                              <span className="text-[#F5C451] font-bold truncate">{sit.to}</span>
                            </div>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-rose-950/80 text-rose-300 border border-rose-800/50 flex-shrink-0 ml-2">
                              {sit.vs}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Arcana Setup */}
                  {hGuide.arcana.length > 0 && (
                    <div className="p-3 bg-[#12161F] border border-[#232A38] rounded-xl space-y-2">
                      <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                        Susunan Arcana Resmi
                      </h4>
                      <div className="grid grid-cols-2 gap-2">
                        {hGuide.arcana.map((arc, idx) => (
                          <div
                            key={idx}
                            className="p-2 rounded-lg bg-[#0A0D12] border border-[#232A38] flex items-center justify-between"
                          >
                            <span className="text-xs font-bold text-slate-200">{arc.name}</span>
                            <span className="text-xs font-mono font-black text-[#B8FF01]">x{arc.count}</span>
                          </div>
                        ))}
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
              {/* HOKFIRE Verified Matchups */}
              {hCounters && (hCounters.weak_against.length > 0 || hCounters.strong_against.length > 0 || hCounters.synergizes.length > 0) && (
                <div className="p-3 bg-[#151A24] border border-[#2A3446] rounded-xl space-y-3">
                  <h4 className="text-xs font-extrabold text-[#F5C451] uppercase tracking-wider flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>HOKFIRE Official Matchups</span>
                  </h4>

                  {/* Weak Against (Hard Counter) */}
                  {hCounters.weak_against.length > 0 && (
                    <div>
                      <span className="text-[10px] font-mono text-rose-400 font-bold block mb-1">
                        🚫 LEMAH MELAWAN (Counter Alami HOKFIRE):
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
                              {rel && <img src={rel.portrait_asset} alt={rel.name} className="w-3.5 h-3.5 rounded-full" />}
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
                      <span className="text-[10px] font-mono text-emerald-400 font-bold block mb-1">
                        ⚔️ KUAT MELAWAN (Target Empuk):
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
                              {rel && <img src={rel.portrait_asset} alt={rel.name} className="w-3.5 h-3.5 rounded-full" />}
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
                      <span className="text-[10px] font-mono text-indigo-400 font-bold block mb-1">
                        🔗 REKAN SINERGI TERBAIK (Duet Kombo):
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
                              {rel && <img src={rel.portrait_asset} alt={rel.name} className="w-3.5 h-3.5 rounded-full" />}
                              <span>{rel ? rel.name : slug}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Kurohiko Community Counters */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center justify-between">
                  <span>Matriks Counter Komunitas (Kurohiko)</span>
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
                            <span className="font-bold text-xs text-white">{c.target_name}</span>
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
                        <p className="text-xs text-slate-300 leading-relaxed pl-1">{c.reason}</p>
                      </div>
                    );
                  })
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
                    <span className="text-[10px] font-black uppercase text-emerald-400 flex items-center gap-1">
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
                    <span className="text-[10px] font-black uppercase text-rose-400 flex items-center gap-1">
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
                  <span className="text-[10px] text-slate-500 font-mono">HOK Official Abilities</span>
                </h4>

                {abilities.length === 0 ? (
                  <p className="text-xs text-slate-500 italic p-3 bg-[#12161F] rounded-xl border border-[#232A38]">
                    Informasi detail skill belum dimuat.
                  </p>
                ) : (
                  abilities.map((ab, idx) => (
                    <div key={idx} className="p-3 bg-[#12161F] border border-[#232A38] rounded-xl space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-extrabold text-xs text-white">{ab.name}</span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#1A202C] text-[#B8FF01] border border-[#232A38]">
                          {ab.type}
                        </span>
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed">{ab.desc}</p>
                    </div>
                  ))
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
                    {hGuide.gameplay_tips.replace(/## /g, '📌 ')}
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
                          <p className="text-[11px] text-slate-400">{item.description}</p>
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
