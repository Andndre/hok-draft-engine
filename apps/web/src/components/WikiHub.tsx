import React, { useState, useMemo } from 'react';
import {
  Coins,
  Search,
  Shield,
  Sparkles,
  Swords,
  Users,
  Zap,
  Info,
  CheckCircle2,
} from 'lucide-react';
import type { Hero, ItemCatalogEntry, SpellCatalogEntry, Lane, Role } from '../types';
import { ARCANA_L5_CATALOG, ArcanaCatalogEntry, ArcanaColor } from '../data/arcanaCatalog';
import { isHeroGlobalReleased } from '../data/heroReleaseStatus';

export type WikiSubTab = 'hero' | 'item' | 'arcana' | 'spell';

interface Props {
  heroes: Hero[];
  items?: ItemCatalogEntry[];
  spells?: SpellCatalogEntry[];
  onInspectHero: (hero: Hero) => void;
  onlyGlobalReleased: boolean;
  initialSubTab?: WikiSubTab;
  onSubTabChange?: (subTab: WikiSubTab) => void;
  initialTargetHeroId?: number;
}

export const WikiHub: React.FC<Props> = ({
  heroes,
  items = [],
  spells = [],
  onInspectHero,
  onlyGlobalReleased,
  initialSubTab = 'hero',
  onSubTabChange,
  initialTargetHeroId,
}) => {
  const [subTab, setSubTab] = useState<WikiSubTab>(initialSubTab);

  React.useEffect(() => {
    if (initialSubTab && initialSubTab !== subTab) {
      setSubTab(initialSubTab);
    }
  }, [initialSubTab]);

  const changeSubTab = (newTab: WikiSubTab) => {
    setSubTab(newTab);
    onSubTabChange?.(newTab);
  };

  // --- HERO & COUNTER SUBTAB STATE ---
  const [heroViewMode, setHeroViewMode] = useState<'catalog' | 'counter'>(initialTargetHeroId ? 'counter' : 'catalog');
  const [heroSearch, setHeroSearch] = useState('');
  const [selectedLane, setSelectedLane] = useState<Lane | 'All'>('All');
  const [selectedRole, setSelectedRole] = useState<Role | 'All'>('All');
  const [counterTargetHeroId, setCounterTargetHeroId] = useState<number | null>(
    initialTargetHeroId || (heroes.length > 0 ? heroes[0].hero_id : null)
  );

  // --- ITEM SUBTAB STATE ---
  const [itemSearch, setItemSearch] = useState('');
  const [selectedItemType, setSelectedItemType] = useState<string>('All');

  // --- ARCANA SUBTAB STATE ---
  const [arcanaSearch, setArcanaSearch] = useState('');
  const [selectedArcanaColor, setSelectedArcanaColor] = useState<ArcanaColor | 'all'>('all');

  // --- SPELL SUBTAB STATE ---
  const [spellSearch, setSpellSearch] = useState('');

  // 1. FILTERED HEROES
  const filteredHeroes = useMemo(() => {
    let list = heroes;
    if (onlyGlobalReleased) {
      list = list.filter((h) => isHeroGlobalReleased(h));
    }
    if (selectedLane !== 'All') {
      list = list.filter((h) => h.primary_lane === selectedLane || h.lanes.includes(selectedLane));
    }
    if (selectedRole !== 'All') {
      list = list.filter((h) => h.primary_role === selectedRole);
    }
    if (heroSearch.trim()) {
      const q = heroSearch.toLowerCase().trim();
      list = list.filter(
        (h) =>
          h.name.toLowerCase().includes(q) ||
          h.chinese_name.toLowerCase().includes(q) ||
          h.title.toLowerCase().includes(q) ||
          h.slug.toLowerCase().includes(q)
      );
    }
    return list;
  }, [heroes, onlyGlobalReleased, selectedLane, selectedRole, heroSearch]);

  const targetHero = useMemo(() => {
    if (!counterTargetHeroId) return heroes[0] || null;
    return heroes.find((h) => h.hero_id === counterTargetHeroId) || heroes[0] || null;
  }, [heroes, counterTargetHeroId]);

  // 2. FILTERED ITEMS
  const filteredItems = useMemo(() => {
    let list = items;
    if (selectedItemType !== 'All') {
      list = list.filter((i) => (i.type || '').toLowerCase() === selectedItemType.toLowerCase());
    }
    if (itemSearch.trim()) {
      const q = itemSearch.toLowerCase().trim();
      list = list.filter((i) => {
        const nameMatch = i.name.toLowerCase().includes(q);
        const descMatch = (i.desc || '').toLowerCase().includes(q);
        const hokstats = i.sources?.hokstats;
        const passiveMatch = (hokstats?.passive || '').toLowerCase().includes(q);
        const activeMatch = (hokstats?.active || '').toLowerCase().includes(q);
        const statsMatch = Object.values(hokstats?.stats || {}).some((s) => s.toLowerCase().includes(q));
        return nameMatch || descMatch || passiveMatch || activeMatch || statsMatch;
      });
    }
    return list;
  }, [items, selectedItemType, itemSearch]);

  // 3. FILTERED ARCANA
  const filteredArcana = useMemo(() => {
    let list = ARCANA_L5_CATALOG;
    if (selectedArcanaColor !== 'all') {
      list = list.filter((a) => a.color === selectedArcanaColor);
    }
    if (arcanaSearch.trim()) {
      const q = arcanaSearch.toLowerCase().trim();
      list = list.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.chinese_name.toLowerCase().includes(q) ||
          a.attr.toLowerCase().includes(q) ||
          a.desc.toLowerCase().includes(q) ||
          a.category.toLowerCase().includes(q)
      );
    }
    return list;
  }, [selectedArcanaColor, arcanaSearch]);

  // Map arcana ID to heroes that use it in their official build
  const arcanaUserMap = useMemo(() => {
    const map = new Map<number, Hero[]>();
    for (const h of heroes) {
      if (onlyGlobalReleased && !isHeroGlobalReleased(h)) continue;
      const arcList = h.official_build?.arcana || [];
      for (const a of arcList) {
        const idNum = Number(a.id);
        if (!map.has(idNum)) map.set(idNum, []);
        map.get(idNum)!.push(h);
      }
    }
    return map;
  }, [heroes, onlyGlobalReleased]);

  // 4. FILTERED SPELLS
  const filteredSpells = useMemo(() => {
    if (!spellSearch.trim()) return spells;
    const q = spellSearch.toLowerCase().trim();
    return spells.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.effect.toLowerCase().includes(q) ||
        s.sources?.hokstats?.best_for?.some((b) => b.toLowerCase().includes(q))
    );
  }, [spells, spellSearch]);

  return (
    <div className="wiki-hub space-y-6">
      {/* Subtab Navigation Pill Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#232A38]">
        <div className="w-full sm:w-auto overflow-x-auto no-scrollbar -mx-1 px-1 sm:mx-0 sm:px-0">
          <div className="flex items-center gap-1.5 p-1 bg-[#10141E] rounded-xl border border-[#232A38] w-max">
            <button
              type="button"
              onClick={() => changeSubTab('hero')}
              className={`shrink-0 whitespace-nowrap flex items-center gap-2 px-3 sm:px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all ${
                subTab === 'hero'
                  ? 'bg-[#B8FF01] text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-[#18202F]'
              }`}
            >
              <Users className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Hero & Counter</span>
              <span className="text-xs font-mono font-medium px-2 py-0.5 rounded-md bg-black/25">
                {filteredHeroes.length}
              </span>
            </button>
            <button
              type="button"
              onClick={() => changeSubTab('item')}
              className={`shrink-0 whitespace-nowrap flex items-center gap-2 px-3 sm:px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all ${
                subTab === 'item'
                  ? 'bg-[#B8FF01] text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-[#18202F]'
              }`}
            >
              <Swords className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Item Equipment</span>
              <span className="text-xs font-mono font-medium px-2 py-0.5 rounded-md bg-black/25">
                {items.length}
              </span>
            </button>
            <button
              type="button"
              onClick={() => changeSubTab('arcana')}
              className={`shrink-0 whitespace-nowrap flex items-center gap-2 px-3 sm:px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all ${
                subTab === 'arcana'
                  ? 'bg-[#B8FF01] text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-[#18202F]'
              }`}
            >
              <Sparkles className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Arcana Level 5</span>
              <span className="text-xs font-mono font-medium px-2 py-0.5 rounded-md bg-black/25">30</span>
            </button>
            <button
              type="button"
              onClick={() => changeSubTab('spell')}
              className={`shrink-0 whitespace-nowrap flex items-center gap-2 px-3 sm:px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all ${
                subTab === 'spell'
                  ? 'bg-[#B8FF01] text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-[#18202F]'
              }`}
            >
              <Zap className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Battle Spell</span>
              <span className="text-xs font-mono font-medium px-2 py-0.5 rounded-md bg-black/25">
                {spells.length}
              </span>
            </button>
          </div>
        </div>

        <div className="hidden lg:flex text-xs text-slate-400 items-center gap-1.5 shrink-0">
          <Info className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
          <span>Klik kartu mana pun untuk membuka detail ensiklopedia lengkap</span>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 1. HERO & COUNTER SUBTAB                                                  */}
      {/* ========================================================================= */}
      {subTab === 'hero' && (
        <div className="space-y-4">
          {/* Sub-mode switcher: Katalog vs Counter Matrix */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 p-3 bg-[#10141E] border border-[#232A38] rounded-xl">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider hidden sm:inline">Tampilan:</span>
              <div className="grid grid-cols-2 gap-1 bg-[#0A0D12] p-1 rounded-lg border border-[#232A38] w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => setHeroViewMode('catalog')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all flex items-center justify-center gap-1.5 whitespace-nowrap ${
                    heroViewMode === 'catalog'
                      ? 'bg-[#18202F] text-[#B8FF01] border border-[#324056]'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span>Katalog ({filteredHeroes.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setHeroViewMode('counter')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all flex items-center justify-center gap-1.5 whitespace-nowrap ${
                    heroViewMode === 'counter'
                      ? 'bg-[#18202F] text-[#B8FF01] border border-[#324056]'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Swords className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>Matrix Counter</span>
                </button>
              </div>
            </div>

            {/* Filter controls */}
            <div className="grid grid-cols-1 sm:flex sm:flex-wrap items-center gap-2 w-full lg:w-auto">
              <div className="relative w-full sm:w-56">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true" />
                <input
                  type="text"
                  placeholder="Cari hero..."
                  value={heroSearch}
                  onChange={(e) => setHeroSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#0A0D12] border border-[#232A38] rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-[#B8FF01]"
                />
              </div>

              {heroViewMode === 'catalog' && (
                <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 w-full sm:w-auto">
                  <select
                    value={selectedLane}
                    onChange={(e) => setSelectedLane(e.target.value as Lane | 'All')}
                    className="w-full sm:w-auto px-2.5 py-1.5 text-xs bg-[#0A0D12] border border-[#232A38] rounded-lg text-slate-200 focus:outline-none focus:border-[#B8FF01]"
                    aria-label="Filter Lane"
                  >
                    <option value="All">Semua Lane</option>
                    <option value="Clash">Clash Lane</option>
                    <option value="Jungle">Jungle</option>
                    <option value="Mid">Mid Lane</option>
                    <option value="Farm">Farm Lane</option>
                    <option value="Roam">Roaming</option>
                  </select>

                  <select
                    value={selectedRole}
                    onChange={(e) => setSelectedRole(e.target.value as Role | 'All')}
                    className="w-full sm:w-auto px-2.5 py-1.5 text-xs bg-[#0A0D12] border border-[#232A38] rounded-lg text-slate-200 focus:outline-none focus:border-[#B8FF01]"
                    aria-label="Filter Role"
                  >
                    <option value="All">Semua Role</option>
                    <option value="Marksman">Marksman</option>
                    <option value="Mage">Mage</option>
                    <option value="Fighter">Fighter</option>
                    <option value="Tank">Tank</option>
                    <option value="Assassin">Assassin</option>
                    <option value="Support">Support</option>
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* CATALOG MODE */}
          {heroViewMode === 'catalog' && (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-2 sm:gap-2.5">
              {filteredHeroes.map((hero) => {
                const bandColor =
                  hero.popularity_band === 'S'
                    ? 'border-amber-500/60 bg-amber-950/50 text-amber-300'
                    : hero.popularity_band === 'A'
                    ? 'border-purple-500/60 bg-purple-950/50 text-purple-300'
                    : 'border-slate-700 bg-slate-900/60 text-slate-400';
                return (
                  <button
                    key={hero.hero_id}
                    type="button"
                    onClick={() => onInspectHero(hero)}
                    className="group relative p-2 rounded-xl bg-[#10141E] border border-[#232A38] hover:border-[#B8FF01]/60 hover:bg-[#141A28] text-left transition-all flex flex-col justify-between"
                  >
                    <div className="space-y-1.5 w-full">
                      {/* Avatar Container */}
                      <div className="relative aspect-square w-full rounded-lg overflow-hidden bg-[#0A0D12] border border-[#1F2633]">
                        <img
                          src={hero.portrait_asset || `/assets/heroes/${hero.hero_id}.png`}
                          alt={hero.name}
                          loading="lazy"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                        />
                        {hero.popularity_band && (
                          <div className="absolute top-1 right-1">
                            <span
                              className={`text-[10px] font-mono font-bold px-1.5 py-0.2 rounded border backdrop-blur-xs ${bandColor}`}
                              title={`Popularitas HoK Camp: Band ${hero.popularity_band}`}
                            >
                              {hero.popularity_band}
                            </span>
                          </div>
                        )}
                        <div className="absolute bottom-1 left-1 bg-black/80 px-1.5 py-0.2 rounded text-[10px] font-mono text-slate-200 border border-white/10">
                          {hero.primary_lane}
                        </div>
                      </div>

                      {/* Info */}
                      <div className="min-w-0">
                        <h4 className="text-xs sm:text-sm font-bold text-slate-100 truncate group-hover:text-[#B8FF01]">
                          {hero.name}
                        </h4>
                        <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 mt-0.5">
                          <span>{(hero.win_rate * 100).toFixed(1)}%</span>
                          <span className="truncate max-w-[60px] text-right text-slate-400">{hero.primary_role}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* COUNTER MATRIX MODE */}
          {heroViewMode === 'counter' && targetHero && (
            <div className="space-y-4">
              {/* Target Hero Selector & Header */}
              <div className="p-4 bg-[#10141E] border border-[#232A38] rounded-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="relative w-14 h-14 rounded-xl overflow-hidden bg-[#0A0D12] border-2 border-[#B8FF01]/60 flex-shrink-0">
                    <img
                      src={targetHero.portrait_asset || `/assets/heroes/${targetHero.hero_id}.png`}
                      alt={targetHero.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-lg font-bold text-slate-100">{targetHero.name}</h3>
                      <span className="text-xs text-slate-400 font-mono">({targetHero.chinese_name})</span>
                      <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded bg-[#18202F] text-[#B8FF01] border border-[#2D3A50]">
                        {targetHero.primary_lane} · {targetHero.primary_role}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 mt-1">
                      Pilih hero untuk melihat matrix counter, ancaman, target empuk, dan sinergi duet turnamen.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 w-full md:w-auto">
                  <label htmlFor="target-hero-select" className="text-xs font-bold text-slate-400 whitespace-nowrap">
                    Ganti Hero:
                  </label>
                  <select
                    id="target-hero-select"
                    value={counterTargetHeroId || targetHero.hero_id}
                    onChange={(e) => setCounterTargetHeroId(Number(e.target.value))}
                    className="px-3 py-1.5 text-xs bg-[#0A0D12] border border-[#232A38] rounded-lg text-slate-200 focus:outline-none focus:border-[#B8FF01] flex-1 md:w-60"
                  >
                    {heroes.map((h) => (
                      <option key={h.hero_id} value={h.hero_id}>
                        {h.name} ({h.primary_lane})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => onInspectHero(targetHero)}
                    className="px-3.5 py-1.5 text-xs font-bold bg-[#B8FF01] text-slate-950 rounded-lg hover:bg-[#a6e600] flex items-center gap-1.5"
                  >
                    Detail Wiki
                  </button>
                </div>
              </div>

              {/* 2-Column Split: Strong Against vs Weak Against */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 1. KUAT MELAWAN (Target Empuk) */}
                <div className="p-4 bg-[#10141E] border border-emerald-900/40 rounded-xl space-y-3">
                  <div className="flex items-center justify-between border-b border-[#232A38] pb-2">
                    <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                      <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                      <span>{targetHero.name} Kuat Melawan (Target Empuk)</span>
                    </div>
                    <span className="text-xs font-mono font-semibold text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/50">
                      {(targetHero.counters || []).length} Hero
                    </span>
                  </div>

                  {(!targetHero.counters || targetHero.counters.length === 0) ? (
                    <p className="text-xs text-slate-400 py-4 text-center">
                      Belum ada catatan counter alami resmi untuk hero ini.
                    </p>
                  ) : (
                    <div className="space-y-2.5">
                      {targetHero.counters.map((c, idx) => {
                        const relHero = heroes.find((h) => h.hero_id === c.target_id || h.name === c.target_name);
                        return (
                          <div
                            key={idx}
                            className="p-3 rounded-lg bg-[#0A0D12] border border-[#232A38] hover:border-emerald-600/50 transition-all flex items-start gap-3"
                          >
                            <div className="w-10 h-10 rounded-lg overflow-hidden bg-[#18202F] border border-[#232A38] flex-shrink-0">
                              <img
                                src={relHero?.portrait_asset || (c.target_id ? `/assets/heroes/${c.target_id}.png` : '')}
                                alt={c.target_name}
                                className="w-full h-full object-cover"
                              />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-semibold text-slate-100">
                                  {c.target_name}
                                </span>
                                <span
                                  className={`text-xs font-mono font-medium px-2 py-0.5 rounded border ${
                                    c.severity === 'hard'
                                      ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                                      : 'bg-slate-900 text-slate-300 border-slate-700'
                                  }`}
                                >
                                  {c.severity === 'hard' ? 'Hard Counter' : 'Soft Counter'}
                                </span>
                              </div>
                              <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                                {c.reason || 'Hero ini memiliki keunggulan mekanik/range saat berhadapan.'}
                              </p>
                              {c.source && (
                                <span className="text-xs font-mono text-slate-400 mt-1 block">
                                  Sumber: {c.source === 'curation' ? 'Kurasi Taktis' : 'Kurohiko'}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 2. LEMAH MELAWAN (Di-counter Oleh) */}
                <div className="p-4 bg-[#10141E] border border-rose-900/40 rounded-xl space-y-3">
                  <div className="flex items-center justify-between border-b border-[#232A38] pb-2">
                    <div className="flex items-center gap-2 text-rose-400 font-bold text-sm">
                      <Shield className="w-4 h-4" aria-hidden="true" />
                      <span>{targetHero.name} Lemah Melawan (Ancaman Alami)</span>
                    </div>
                    <span className="text-xs font-mono font-semibold text-rose-400 bg-rose-950/60 px-2 py-0.5 rounded border border-rose-800/50">
                      {(targetHero.countered_by || []).length} Hero
                    </span>
                  </div>

                  {(!targetHero.countered_by || targetHero.countered_by.length === 0) ? (
                    <p className="text-xs text-slate-400 py-4 text-center">
                      Belum ada ancaman counter keras yang tercatat.
                    </p>
                  ) : (
                    <div className="space-y-2.5">
                      {targetHero.countered_by.map((cb, idx) => {
                        const relHero = heroes.find((h) => h.hero_id === cb.counter_id || h.name === cb.counter_name);
                        return (
                          <div
                            key={idx}
                            className="p-3 rounded-lg bg-[#0A0D12] border border-[#232A38] hover:border-rose-600/50 transition-all flex items-start gap-3"
                          >
                            <div className="w-10 h-10 rounded-lg overflow-hidden bg-[#18202F] border border-[#232A38] flex-shrink-0">
                              <img
                                src={relHero?.portrait_asset || (cb.counter_id ? `/assets/heroes/${cb.counter_id}.png` : '')}
                                alt={cb.counter_name}
                                className="w-full h-full object-cover"
                              />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-semibold text-slate-100">
                                  {cb.counter_name}
                                </span>
                                <span
                                  className={`text-xs font-mono font-medium px-2 py-0.5 rounded border ${
                                    cb.severity === 'hard'
                                      ? 'bg-rose-950 text-rose-300 border-rose-800'
                                      : 'bg-slate-900 text-slate-300 border-slate-700'
                                  }`}
                                >
                                  {cb.severity === 'hard' ? 'Hard Threat' : 'Soft Threat'}
                                </span>
                              </div>
                              <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                                {cb.reason || 'Hero ini mengeksploitasi kerentanan mobilitas atau durabilitas.'}
                              </p>
                              {cb.source && (
                                <span className="text-xs font-mono text-slate-400 mt-1 block">
                                  Sumber: {cb.source === 'curation' ? 'Kurasi Taktis' : 'Kurohiko'}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* 3. Sinergi Duet KPL Turnamen (jika ada) */}
              {targetHero.kpl_matchup?.synergies && targetHero.kpl_matchup.synergies.length > 0 && (
                <div className="p-4 bg-[#10141E] border border-[#232A38] rounded-xl space-y-3">
                  <div className="flex items-center justify-between border-b border-[#232A38] pb-2">
                    <div className="flex items-center gap-2 text-[#B8FF01] font-bold text-sm">
                      <Sparkles className="w-4 h-4" aria-hidden="true" />
                      <span>Sinergi Duet Terkuat di Turnamen KPL Pro (Empiris)</span>
                    </div>
                    <span className="text-xs font-mono text-slate-400">
                      {targetHero.kpl_matchup.synergies.length} Partner Terverifikasi
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                    {targetHero.kpl_matchup.synergies.slice(0, 6).map((syn, idx) => (
                      <div
                        key={idx}
                        className="p-2.5 rounded-lg bg-[#0A0D12] border border-[#232A38] flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <img
                            src={syn.partner_avatar || `/assets/heroes/${syn.partner_id}.png`}
                            alt={syn.partner_name}
                            className="w-8 h-8 rounded-lg object-cover border border-[#232A38]"
                          />
                          <div className="min-w-0">
                            <span className="font-semibold text-slate-100 block truncate leading-tight">
                              {syn.partner_name}
                            </span>
                            <span className="text-xs font-mono text-slate-400">
                              {syn.total_matches} Match ({syn.wins}W - {syn.losses}L)
                            </span>
                          </div>
                        </div>
                        <span className="font-mono font-bold text-emerald-400 text-xs">
                          {(syn.duet_winrate * 100).toFixed(1)}% WR
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. ITEM EQUIPMENT SUBTAB                                                  */}
      {/* ========================================================================= */}
      {subTab === 'item' && (
        <div className="space-y-4">
          {/* Item Category Pills & Search */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-[#10141E] border border-[#232A38] rounded-xl">
            <div className="w-full sm:w-auto overflow-x-auto no-scrollbar -mx-1 px-1 sm:mx-0 sm:px-0">
              <div className="flex items-center gap-1.5 w-max">
                {[
                  { id: 'All', label: 'Semua Item' },
                  { id: 'Attack', label: 'Serangan' },
                  { id: 'Magic', label: 'Sihir' },
                  { id: 'Defense', label: 'Pertahanan' },
                  { id: 'Movement', label: 'Sepatu' },
                  { id: 'Jungle', label: 'Hutan' },
                  { id: 'Support', label: 'Roaming' },
                ].map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedItemType(cat.id)}
                    className={`shrink-0 whitespace-nowrap px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                      selectedItemType.toLowerCase() === cat.id.toLowerCase()
                        ? 'bg-[#B8FF01] text-slate-950 shadow-sm font-bold'
                        : 'bg-[#0A0D12] text-slate-300 hover:text-white border border-[#232A38]'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true" />
              <input
                type="text"
                placeholder="Cari item, pasif, atau stat..."
                value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#0A0D12] border border-[#232A38] rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-[#B8FF01]"
              />
            </div>
          </div>

          {/* Item Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {filteredItems.map((item) => {
              const typeColor =
                item.type === 'Attack'
                  ? 'border-amber-600/50 bg-amber-950/20 text-amber-300'
                  : item.type === 'Magic'
                  ? 'border-purple-600/50 bg-purple-950/20 text-purple-300'
                  : item.type === 'Defense'
                  ? 'border-blue-600/50 bg-blue-950/20 text-blue-300'
                  : item.type === 'Movement'
                  ? 'border-cyan-600/50 bg-cyan-950/20 text-cyan-300'
                  : item.type === 'Jungle'
                  ? 'border-emerald-600/50 bg-emerald-950/20 text-emerald-300'
                  : item.type === 'Support'
                  ? 'border-rose-600/50 bg-rose-950/20 text-rose-300'
                  : 'border-slate-700 bg-slate-900/40 text-slate-400';

              const statsText = item.sources?.hokstats?.stats?.basestats || '';
              const passiveText = item.sources?.hokstats?.passive || '';
              const activeText = item.sources?.hokstats?.active || '';
              const buildPath = item.sources?.hokstats?.build_path || [];

              return (
                <div
                  key={String(item.id || item.name)}
                  className="p-3.5 rounded-xl bg-[#10141E] border border-[#232A38] hover:border-[#34425A] transition-all flex flex-col justify-between space-y-3"
                >
                  <div className="space-y-2.5">
                    {/* Header */}
                    <div className="flex items-start gap-3">
                      <div className="w-12 h-12 rounded-xl overflow-hidden bg-[#0A0D12] border border-[#232A38] flex-shrink-0 relative">
                        <img
                          src={item.icon || (item.id ? `/assets/items/${item.id}.png` : '')}
                          alt={item.name}
                          loading="lazy"
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = 'none';
                          }}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1.5">
                          <h4 className="text-sm font-bold text-slate-100 truncate">{item.name}</h4>
                          {item.type && (
                            <span className={`text-xs font-mono font-medium px-2 py-0.5 rounded border ${typeColor}`}>
                              {item.type}
                            </span>
                          )}
                        </div>
                        {item.price && (
                          <div className="flex items-center gap-1 text-xs font-mono text-amber-400 font-bold mt-1">
                            <Coins className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>{item.price.toLocaleString()} Gold</span>
                          </div>
                        )}
                        <p className="text-xs text-slate-300 leading-relaxed line-clamp-2 mt-1">
                          {item.desc || 'Equipment resmi HoK.'}
                        </p>
                      </div>
                    </div>

                    {/* Stats pills */}
                    {statsText && (
                      <div className="p-2 rounded-lg bg-[#0A0D12] border border-[#1A2230] text-xs font-mono font-medium text-[#B8FF01]">
                        {statsText}
                      </div>
                    )}

                    {/* Passive Effect */}
                    {passiveText && (
                      <div className="text-xs text-slate-300 bg-[#0E131C] p-2.5 rounded-lg border border-[#1A2230] leading-relaxed">
                        <span className="font-bold text-amber-300 block mb-0.5">Efek Pasif:</span>
                        <span className="text-xs text-slate-300 leading-relaxed">{passiveText}</span>
                      </div>
                    )}

                    {/* Active Effect */}
                    {activeText && (
                      <div className="text-xs text-slate-300 bg-[#16120E] p-2.5 rounded-lg border border-amber-900/40 leading-relaxed">
                        <span className="font-bold text-orange-400 block mb-0.5">Skill Aktif:</span>
                        <span className="text-xs text-slate-300 leading-relaxed">{activeText}</span>
                      </div>
                    )}
                  </div>

                  {/* Build path / tree */}
                  {buildPath.length > 0 && (
                    <div className="pt-2 border-t border-[#1C2331] text-xs text-slate-400">
                      <span className="block mb-1.5 font-semibold text-slate-300">Jalur Upgrade / Bahan:</span>
                      <div className="flex flex-wrap gap-1">
                        {buildPath.slice(0, 4).map((bp, idx) => (
                          <span
                            key={idx}
                            className="px-2 py-0.5 rounded bg-[#0A0D12] border border-[#232A38] text-slate-300 truncate max-w-[140px] text-xs font-mono"
                            title={bp}
                          >
                            {bp}
                          </span>
                        ))}
                        {buildPath.length > 4 && (
                          <span className="text-slate-400 px-1 text-xs font-mono">+{buildPath.length - 4}</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 3. ARCANA LEVEL 5 SUBTAB                                                  */}
      {/* ========================================================================= */}
      {subTab === 'arcana' && (
        <div className="space-y-4">
          {/* Arcana Filter Pills & Search */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-[#10141E] border border-[#232A38] rounded-xl">
            <div className="w-full sm:w-auto overflow-x-auto no-scrollbar -mx-1 px-1 sm:mx-0 sm:px-0">
              <div className="flex items-center gap-1.5 w-max">
                {[
                  { id: 'all', label: 'Semua (30)', fullLabel: 'Semua Arcana (30)' },
                  { id: 'red', label: 'Merah (Serang)', fullLabel: 'Merah (Serangan & Pierce)' },
                  { id: 'blue', label: 'Biru (Sustain)', fullLabel: 'Biru (Mobilitas & Sustain)' },
                  { id: 'green', label: 'Hijau (Defense)', fullLabel: 'Hijau (Defense & CDR)' },
                ].map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedArcanaColor(c.id as ArcanaColor | 'all')}
                    className={`shrink-0 whitespace-nowrap px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                      selectedArcanaColor === c.id
                        ? 'bg-[#B8FF01] text-slate-950 shadow-sm font-bold'
                        : 'bg-[#0A0D12] text-slate-300 hover:text-white border border-[#232A38]'
                    }`}
                  >
                    <span className="sm:hidden">{c.label}</span>
                    <span className="hidden sm:inline">{c.fullLabel}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true" />
              <input
                type="text"
                placeholder="Cari arcana atau stat..."
                value={arcanaSearch}
                onChange={(e) => setArcanaSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#0A0D12] border border-[#232A38] rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-[#B8FF01]"
              />
            </div>
          </div>

          {/* Arcana Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {filteredArcana.map((arc) => {
              const isRed = arc.color === 'red';
              const isBlue = arc.color === 'blue';
              const colorBorder = isRed
                ? 'border-rose-800/60 bg-rose-950/20 text-rose-300'
                : isBlue
                ? 'border-blue-800/60 bg-blue-950/20 text-blue-300'
                : 'border-emerald-800/60 bg-emerald-950/20 text-emerald-300';
              const badgeText = isRed ? 'Merah (Red)' : isBlue ? 'Biru (Blue)' : 'Hijau (Green)';
              const users = arcanaUserMap.get(arc.id) || [];

              return (
                <div
                  key={arc.id}
                  className="p-3.5 rounded-xl bg-[#10141E] border border-[#232A38] hover:border-[#34425A] transition-all flex flex-col justify-between space-y-3"
                >
                  <div className="space-y-2.5">
                    {/* Header */}
                    <div className="flex items-start gap-3">
                      <div
                        className={`relative w-12 h-12 rounded-xl bg-[#0A0D12] border flex items-center justify-center flex-shrink-0 overflow-hidden ${colorBorder}`}
                      >
                        <img
                          src={arc.icon}
                          alt={arc.name}
                          loading="lazy"
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1.5">
                          <h4 className="text-sm font-bold text-slate-100 truncate">{arc.name}</h4>
                          <span className="text-xs font-mono text-slate-400">{arc.chinese_name}</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className={`text-xs font-mono font-medium px-2 py-0.5 rounded border ${colorBorder}`}>
                            {badgeText}
                          </span>
                          <span className="text-xs font-mono font-medium px-2 py-0.5 rounded bg-black/40 text-slate-300 border border-[#232A38]">
                            Level 5
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Stat Attribute */}
                    <div className="p-2.5 rounded-lg bg-[#0A0D12] border border-[#1A2230] text-xs font-mono font-bold text-[#B8FF01]">
                      {arc.attr}
                    </div>

                    {/* Tactical Desc */}
                    <p className="text-xs text-slate-300 leading-relaxed">
                      {arc.desc}
                    </p>

                    {/* Recommended Roles */}
                    {arc.recommended_roles && arc.recommended_roles.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap pt-1">
                        <span className="text-xs font-semibold text-slate-400">Cocok untuk:</span>
                        {arc.recommended_roles.map((r, idx) => (
                          <span
                            key={idx}
                            className="text-xs font-mono px-2 py-0.5 rounded bg-[#18202F] text-slate-300 border border-[#263346]"
                          >
                            {r}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Users (Heroes in our dataset using this Arcana in official builds) */}
                  {users.length > 0 && (
                    <div className="pt-2.5 border-t border-[#1C2331]">
                      <span className="text-xs font-semibold text-slate-300 block mb-1.5">
                        Dipakai oleh {users.length} hero resmi:
                      </span>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {users.slice(0, 7).map((u) => (
                          <button
                            key={u.hero_id}
                            type="button"
                            onClick={() => onInspectHero(u)}
                            className="group relative w-7 h-7 rounded-lg overflow-hidden bg-[#0A0D12] border border-[#232A38] hover:border-[#B8FF01] transition-all"
                            title={`${u.name} (Buka Wiki)`}
                          >
                            <img
                              src={u.portrait_asset || `/assets/heroes/${u.hero_id}.png`}
                              alt={u.name}
                              className="w-full h-full object-cover"
                            />
                          </button>
                        ))}
                        {users.length > 7 && (
                          <span className="text-xs font-mono text-slate-400 pl-1">
                            +{users.length - 7}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 4. BATTLE SPELL SUBTAB                                                    */}
      {/* ========================================================================= */}
      {subTab === 'spell' && (
        <div className="space-y-4">
          {/* Spell Header & Search */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-[#10141E] border border-[#232A38] rounded-xl">
            <div className="text-xs text-slate-200 flex items-center gap-2">
              <Zap className="w-4 h-4 text-[#B8FF01] shrink-0" aria-hidden="true" />
              <span>Daftar 11 Battle Spell Resmi HoK Global (Cooldown & Rekomendasi Taktis)</span>
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true" />
              <input
                type="text"
                placeholder="Cari spell..."
                value={spellSearch}
                onChange={(e) => setSpellSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#0A0D12] border border-[#232A38] rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-[#B8FF01]"
              />
            </div>
          </div>

          {/* Spell Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {filteredSpells.map((spell) => {
              const hokstats = spell.sources?.hokstats;
              const cooldown = hokstats?.cooldown || '';
              const bestFor = hokstats?.best_for || [];

              return (
                <div
                  key={spell.id}
                  className="p-3.5 rounded-xl bg-[#10141E] border border-[#232A38] hover:border-[#34425A] transition-all flex flex-col justify-between space-y-3"
                >
                  <div className="space-y-2.5">
                    {/* Header */}
                    <div className="flex items-start gap-3">
                      <div className="w-12 h-12 rounded-xl overflow-hidden bg-[#0A0D12] border border-[#232A38] flex-shrink-0 relative">
                        <img
                          src={spell.icon || `/assets/skills/${spell.id}.png`}
                          alt={spell.name}
                          loading="lazy"
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1.5">
                          <h4 className="text-sm font-bold text-slate-100 truncate">{spell.name}</h4>
                          {cooldown && (
                            <span className="text-xs font-mono px-2 py-0.5 rounded bg-blue-950/70 text-blue-300 border border-blue-800/60 font-bold">
                              {cooldown}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                          {hokstats?.effect || spell.effect}
                        </p>
                      </div>
                    </div>

                    {/* Best for tags */}
                    {bestFor.length > 0 && (
                      <div className="p-2.5 bg-[#0A0D12] rounded-lg border border-[#1A2230] space-y-1.5">
                        <span className="text-xs font-bold text-slate-400 block tracking-wider">
                          Rekomendasi Taktis:
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {bestFor.map((bf, idx) => (
                            <span
                              key={idx}
                              className="text-xs font-mono px-2 py-0.5 rounded bg-[#18202F] text-slate-300 border border-[#2A374A]"
                            >
                              {bf}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
