import React, { useState, useMemo } from 'react';
import { Hero, Lane } from '../types';
import { X, Check, Search, Sparkles, Shield, AlertTriangle } from 'lucide-react';
import { isHeroGlobalReleased } from '../data/heroReleaseStatus';

interface PlanSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  heroes: Hero[];
  currentPlanAId: number | null;
  currentPlanBId: number | null;
  onSelectPlanA: (heroId: number | null) => void;
  onSelectPlanB: (heroId: number | null) => void;
  activeSide: 'blue' | 'red';
  unavailableHeroIds: Set<number>;
  recommendedOpeners: Hero[];
  onlyGlobalReleased?: boolean;
}

const LANES: Array<Lane | 'All'> = ['All', 'Clash', 'Jungle', 'Mid', 'Farm', 'Roam'];

export const PlanSelectionModal: React.FC<PlanSelectionModalProps> = ({
  isOpen,
  onClose,
  heroes,
  currentPlanAId,
  currentPlanBId,
  onSelectPlanA,
  onSelectPlanB,
  activeSide,
  unavailableHeroIds,
  recommendedOpeners,
  onlyGlobalReleased = true,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLane, setSelectedLane] = useState<Lane | 'All'>('All');
  const [activeSlot, setActiveSlot] = useState<'A' | 'B'>('A');

  const planAHero = useMemo(() => heroes.find((h) => h.hero_id === currentPlanAId) || null, [heroes, currentPlanAId]);
  const planBHero = useMemo(() => heroes.find((h) => h.hero_id === currentPlanBId) || null, [heroes, currentPlanBId]);

  const filteredHeroes = useMemo(() => {
    let list = [...heroes];

    if (onlyGlobalReleased) {
      list = list.filter((h) => isHeroGlobalReleased(h));
    }

    if (selectedLane !== 'All') {
      list = list.filter((h) => h.primary_lane === selectedLane || h.lanes.includes(selectedLane));
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (h) =>
          h.name.toLowerCase().includes(q) ||
          h.chinese_name.toLowerCase().includes(q) ||
          h.primary_role.toLowerCase().includes(q) ||
          h.primary_lane.toLowerCase().includes(q)
      );
    }

    // Sort: Recommended openers first, then tier, then win rate
    const recIds = new Set(recommendedOpeners.map((r) => r.hero_id));
    list.sort((a, b) => {
      const aRec = recIds.has(a.hero_id) ? 1 : 0;
      const bRec = recIds.has(b.hero_id) ? 1 : 0;
      if (aRec !== bRec) return bRec - aRec;
      if (a.tier !== b.tier) return a.tier.localeCompare(b.tier);
      return b.win_rate - a.win_rate;
    });

    return list;
  }, [heroes, selectedLane, searchQuery, recommendedOpeners]);

  if (!isOpen) return null;

  const handlePickHero = (hero: Hero) => {
    if (activeSlot === 'A') {
      // If same as Plan B, swap or clear Plan B
      if (currentPlanBId === hero.hero_id) {
        onSelectPlanB(null);
      }
      onSelectPlanA(hero.hero_id);
      setActiveSlot('B'); // Automatically move to slot B for convenience
    } else {
      // If same as Plan A, swap or clear Plan A
      if (currentPlanAId === hero.hero_id) {
        onSelectPlanA(null);
      }
      onSelectPlanB(hero.hero_id);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#12161F] border border-[#232A38] rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-[#232A38] flex items-center justify-between gap-3 bg-[#0D1017]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#B8FF01]/10 text-[#B8FF01]">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-sm sm:text-base text-white flex items-center gap-2">
                SESI STRATEGI FIRST-PICK ({activeSide.toUpperCase()} SIDE)
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#1A202C] text-slate-300 border border-[#232A38]">
                  PLAN A & PLAN B
                </span>
              </h3>
              <p className="text-[11px] text-slate-400">
                Tentukan target pick utama (Plan A) & rencana cadangan (Plan B) jika Plan A di-ban lawan.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-[#1A202C] text-slate-400 hover:text-white hover:bg-[#232A38] transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Plan A & Plan B Slot Cards */}
        <div className="p-4 bg-[#0A0D12] border-b border-[#232A38] grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Plan A Card */}
          <div
            onClick={() => setActiveSlot('A')}
            className={`p-3 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
              activeSlot === 'A'
                ? 'bg-[#151D2A] border-[#B8FF01] ring-1 ring-[#B8FF01]/60 shadow-[0_0_12px_rgba(184,255,1,0.15)]'
                : 'bg-[#12161F] border-[#232A38] hover:border-slate-600'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-[#1A202C] overflow-hidden border border-[#232A38] flex-shrink-0 flex items-center justify-center">
                {planAHero ? (
                  <img src={planAHero.portrait_asset} alt={planAHero.name} className="w-full h-full object-cover" />
                ) : (
                  <span className="font-mono text-xs font-bold text-slate-500">A</span>
                )}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-black uppercase px-1.5 py-0.2 rounded bg-[#B8FF01] text-black">
                    PLAN A (UTAMA)
                  </span>
                  {activeSlot === 'A' && (
                    <span className="text-[9px] text-[#B8FF01] font-mono animate-pulse font-bold">• Memilih</span>
                  )}
                </div>
                <h4 className="font-bold text-sm text-white truncate mt-0.5">
                  {planAHero ? planAHero.name : 'Pilih Target Utama'}
                </h4>
                <p className="text-[10px] text-slate-400 truncate">
                  {planAHero ? `${planAHero.primary_role} · ${planAHero.primary_lane} · Tier ${planAHero.tier}` : 'Klik hero di bawah'}
                </p>
              </div>
            </div>
            {planAHero && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectPlanA(null);
                }}
                className="text-xs text-rose-400 hover:text-rose-300 font-mono ml-2 p-1"
                title="Hapus Plan A"
              >
                Hapus
              </button>
            )}
          </div>

          {/* Plan B Card */}
          <div
            onClick={() => setActiveSlot('B')}
            className={`p-3 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
              activeSlot === 'B'
                ? 'bg-[#1D1B28] border-indigo-400 ring-1 ring-indigo-400/60 shadow-[0_0_12px_rgba(129,140,248,0.15)]'
                : 'bg-[#12161F] border-[#232A38] hover:border-slate-600'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-[#1A202C] overflow-hidden border border-[#232A38] flex-shrink-0 flex items-center justify-center">
                {planBHero ? (
                  <img src={planBHero.portrait_asset} alt={planBHero.name} className="w-full h-full object-cover" />
                ) : (
                  <span className="font-mono text-xs font-bold text-slate-500">B</span>
                )}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-black uppercase px-1.5 py-0.2 rounded bg-indigo-500 text-white">
                    PLAN B (CADANGAN)
                  </span>
                  {activeSlot === 'B' && (
                    <span className="text-[9px] text-indigo-400 font-mono animate-pulse font-bold">• Memilih</span>
                  )}
                </div>
                <h4 className="font-bold text-sm text-white truncate mt-0.5">
                  {planBHero ? planBHero.name : 'Pilih Rencana Cadangan'}
                </h4>
                <p className="text-[10px] text-slate-400 truncate">
                  {planBHero ? `${planBHero.primary_role} · ${planBHero.primary_lane} · Tier ${planBHero.tier}` : 'Aktif otomatis bila Plan A di-ban'}
                </p>
              </div>
            </div>
            {planBHero && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectPlanB(null);
                }}
                className="text-xs text-rose-400 hover:text-rose-300 font-mono ml-2 p-1"
                title="Hapus Plan B"
              >
                Hapus
              </button>
            )}
          </div>
        </div>

        {/* Filter Controls */}
        <div className="p-3 border-b border-[#232A38] flex flex-wrap items-center justify-between gap-2.5 bg-[#0D1017]">
          {/* Lane Filter Tabs */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
            {LANES.map((lane) => (
              <button
                key={lane}
                onClick={() => setSelectedLane(lane)}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                  selectedLane === lane
                    ? 'bg-[#B8FF01] text-black shadow-sm'
                    : 'bg-[#1A202C] text-slate-300 hover:text-white border border-[#232A38]'
                }`}
              >
                {lane === 'All' ? 'Semua' : lane}
              </button>
            ))}
          </div>

          {/* Search Input */}
          <div className="relative w-full sm:w-60">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari dari 120 Hero..."
              className="w-full bg-[#12161F] text-xs text-white pl-8 pr-3 py-1.5 rounded-lg border border-[#232A38] focus:border-[#B8FF01] focus:outline-none"
            />
          </div>
        </div>

        {/* Hero Grid */}
        <div className="p-4 overflow-y-auto flex-1 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 max-h-[460px]">
          {filteredHeroes.map((hero) => {
            const isPlanA = currentPlanAId === hero.hero_id;
            const isPlanB = currentPlanBId === hero.hero_id;
            const isUnavailable = unavailableHeroIds.has(hero.hero_id);
            const isRecommended = recommendedOpeners.some((r) => r.hero_id === hero.hero_id);

            return (
              <div
                key={hero.hero_id}
                onClick={() => !isUnavailable && handlePickHero(hero)}
                className={`p-2.5 rounded-xl border transition-all flex items-center justify-between gap-2 cursor-pointer ${
                  isUnavailable
                    ? 'opacity-40 grayscale pointer-events-none bg-[#0D1017] border-[#1A202C]'
                    : isPlanA
                    ? 'bg-[#151D2A] border-[#B8FF01] ring-1 ring-[#B8FF01]'
                    : isPlanB
                    ? 'bg-[#1D1B28] border-indigo-400 ring-1 ring-indigo-400'
                    : 'bg-[#0A0D12] border-[#232A38] hover:bg-[#1A202C] hover:border-slate-500'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="relative w-9 h-9 rounded-lg overflow-hidden border border-[#232A38] flex-shrink-0">
                    <img src={hero.portrait_asset} alt={hero.name} className="w-full h-full object-cover" />
                    {isRecommended && (
                      <span className="absolute top-0 right-0 w-2 h-2 rounded-full bg-[#B8FF01]" title="Rekomendasi AI" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="font-bold text-xs text-slate-100 truncate">{hero.name}</span>
                      <span className="text-[9px] font-mono px-1 rounded bg-slate-800 text-slate-300">
                        {hero.tier}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-400 truncate">
                      {hero.primary_lane} · {(hero.win_rate * 100).toFixed(0)}% WR
                    </div>
                  </div>
                </div>

                <div className="flex-shrink-0">
                  {isPlanA ? (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#B8FF01] text-black">Plan A</span>
                  ) : isPlanB ? (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-indigo-500 text-white">Plan B</span>
                  ) : (
                    <button
                      className="px-2 py-0.5 text-[10px] font-bold rounded bg-[#1A202C] text-slate-300 hover:bg-[#B8FF01] hover:text-black transition-all"
                    >
                      Pilih
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-[#232A38] bg-[#0D1017] flex items-center justify-between">
          <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-[#B8FF01]" />
            <span>AI akan mem-ban counter dari Plan A, atau pivot ke Plan B jika Plan A di-ban lawan.</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-[#B8FF01] text-black font-extrabold text-xs shadow-md hover:bg-[#a6e600] transition-all"
          >
            Terapkan Strategi
          </button>
        </div>
      </div>
    </div>
  );
};
