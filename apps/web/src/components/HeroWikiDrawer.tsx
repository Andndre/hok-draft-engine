import { RoleLabel } from './ui/RoleIcon';
import { LaneLabel } from './ui/LaneIcon';
import React, { useEffect, useMemo, useState } from 'react';
import { Hero, ItemCatalogEntry, SpellCatalogEntry, TacticalTag } from '../types';
import { X, Star, Swords, Shield, Lightbulb, BookOpen, Zap, Sparkles, ArrowRight, CheckCircle2, AlertCircle, Wrench, ShieldBan, Link2 } from 'lucide-react';
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
  itemCatalog?: ItemCatalogEntry[];
  spellCatalog?: SpellCatalogEntry[];
}

type MatchupSourceLabel = 'KPL' | 'HOKFIRE' | 'HoKStats' | 'Kurohiko';

interface MatchupEvidenceLine {
  source: MatchupSourceLabel;
  url?: string;
  detail?: string;
  meta?: string;
  metric?: string;
}

interface MatchupCardData {
  heroId: number | null;
  name: string;
  avatar?: string;
  evidence: MatchupEvidenceLine[];
  hasSourceConflict?: boolean;
}

interface MatchupPanelProps {
  hero: Hero;
  allHeroes: Hero[];
  onSelectRelatedHero: (hero: Hero) => void;
}

const FACTUAL_SKILL_TAG_GROUPS: ReadonlyArray<{
  category: 'Mobilitas' | 'Crowd Control' | 'Utilitas Tim';
  tone: string;
  items: ReadonlyArray<readonly [TacticalTag, string, string]>;
}> = [
  {
    category: 'Mobilitas',
    tone: 'border-sky-800/60 bg-sky-950/30 text-sky-200',
    items: [
      ['dash', 'Dash', 'Melesat atau meluncur cepat di atas tanah secara horizontal.'],
      ['blink', 'Blink', 'Teleportasi instan seketika tanpa jeda lintasan fisik.'],
      ['leap', 'Leap', 'Melompat ke udara dan mendarat di area target (dapat melewati rintangan).'],
      ['teleport', 'Teleport Peta', 'Berpindah posisi jarak jauh atau lintas peta.'],
    ],
  },
  {
    category: 'Crowd Control',
    tone: 'border-amber-800/60 bg-amber-950/30 text-amber-200',
    items: [
      ['suppress', 'Suppress', 'Mengunci lawan total tanpa bisa dibatalkan spell Purify atau cleanse biasa.'],
      ['cc_knockup', 'Knock-up', 'Menerbangkan lawan ke udara (airborne) dan menghentikan aksi.'],
      ['cc_knockback', 'Knock-back', 'Mendorong atau menghempaskan posisi lawan ke belakang.'],
      ['cc_pull', 'Pull / Hook', 'Menarik atau menculik lawan ke arah hero atau titik skill.'],
      ['cc_stun', 'Stun', 'Melumpuhkan lawan total sehingga tidak bisa bergerak atau memakai skill.'],
      ['cc_root', 'Root', 'Mengikat lawan di tempat (tidak bisa bergerak, namun masih bisa memakai skill tertentu).'],
      ['cc_silence', 'Silence', 'Membisukan lawan sehingga tidak dapat menggunakan skill selama durasi.'],
      ['cc_taunt', 'Taunt', 'Memaksa lawan menyerang hero ini dan mengunci penggunaan skill selama durasi.'],
      ['cc_slow', 'Slow', 'Memperlambat kecepatan gerak (movement speed) lawan.'],
    ],
  },
  {
    category: 'Utilitas Tim',
    tone: 'border-emerald-800/60 bg-emerald-950/30 text-emerald-200',
    items: [
      ['ally_heal', 'Heal Sekutu', 'Memulihkan sejumlah HP untuk rekan satu tim.'],
      ['ally_shield', 'Shield Sekutu', 'Memberikan tameng pelindung (shield) kepada rekan satu tim.'],
      ['ally_move_speed_buff', 'Buff Speed Sekutu', 'Meningkatkan kecepatan gerak rekan tim di sekitar.'],
      ['ally_attack_speed_buff', 'Buff Attack Speed Sekutu', 'Meningkatkan kecepatan serangan (attack speed) rekan tim.'],
      ['ally_damage_buff', 'Buff Damage Sekutu', 'Meningkatkan output damage atau status serangan rekan tim.'],
      ['ally_cleanse', 'Cleanse CC Sekutu', 'Menghapus efek crowd control yang sedang dialami rekan tim.'],
      ['ally_cc_immunity', 'Imunitas CC Sekutu', 'Memberikan imunitas sementara dari efek crowd control kepada rekan tim.'],
    ],
  },
];

const MatchupPanel: React.FC<MatchupPanelProps> = ({ hero, allHeroes, onSelectRelatedHero }) => {
  const normalizeName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const idMap = new Map(allHeroes.map((item) => [item.hero_id, item]));
  const nameMap = new Map<string, Hero>();
  allHeroes.forEach((item) => {
    nameMap.set(normalizeName(item.name), item);
    nameMap.set(normalizeName(item.slug), item);
  });
  const kpl = hero.kpl_matchup;
  const hokfire = hero.hokfire_counters;
  const guide = hero.hokstats_guide;
  const danger = new Map<string, MatchupCardData>();
  const favorable = new Map<string, MatchupCardData>();
  const partners = new Map<string, MatchupCardData>();

  const add = (group: Map<string, MatchupCardData>, heroId: number | null | undefined, name: string, line: MatchupEvidenceLine, avatar?: string) => {
    const related = heroId == null ? nameMap.get(normalizeName(name)) : idMap.get(heroId);
    const resolvedId = heroId ?? related?.hero_id ?? null;
    const resolvedName = related?.name || name;
    const key = resolvedId == null ? `name:${normalizeName(resolvedName)}` : `hero:${resolvedId}`;
    const current = group.get(key) || { heroId: resolvedId, name: resolvedName, avatar: related?.portrait_asset || avatar, evidence: [] };
    if (!current.avatar) current.avatar = avatar;
    const signature = [line.source, line.url, line.detail, line.meta, line.metric].join('|');
    if (!current.evidence.some((item) => [item.source, item.url, item.detail, item.meta, item.metric].join('|') === signature)) current.evidence.push(line);
    group.set(key, current);
  };

  kpl?.worst_matchups.forEach((item) => add(danger, item.opponent_id, item.opponent_name, {
    source: 'KPL', detail: `${item.wins}W · ${item.losses}L · ${item.total_matches} game`, metric: `${(item.hero_winrate * 100).toFixed(1)}% WR`,
  }, item.opponent_avatar));
  hokfire?.weak_against.forEach((slug) => {
    const related = nameMap.get(normalizeName(slug));
    add(danger, related?.hero_id, related?.name || slug, { source: 'HOKFIRE', url: 'https://www.hokfire.com/' }, related?.portrait_asset);
  });
  guide?.matchups.filter((item) => item.relation === 'countered_by').forEach((item) => add(danger, item.hero_id, item.hero_name, {
    source: 'HoKStats', url: item.source.url, detail: item.evidence,
  }));
  hero.countered_by.forEach((item) => add(danger, item.counter_id, item.counter_name, {
    source: 'Kurohiko', url: 'https://hok.kurohiko.id/', detail: item.reason, meta: `${item.severity} counter`,
  }));

  kpl?.best_matchups.forEach((item) => add(favorable, item.opponent_id, item.opponent_name, {
    source: 'KPL', detail: `${item.wins}W · ${item.losses}L · ${item.total_matches} game`, metric: `${(item.hero_winrate * 100).toFixed(1)}% WR`,
  }, item.opponent_avatar));
  hokfire?.strong_against.forEach((slug) => {
    const related = nameMap.get(normalizeName(slug));
    add(favorable, related?.hero_id, related?.name || slug, { source: 'HOKFIRE', url: 'https://www.hokfire.com/' }, related?.portrait_asset);
  });
  guide?.matchups.filter((item) => item.relation === 'strong_against').forEach((item) => add(favorable, item.hero_id, item.hero_name, {
    source: 'HoKStats', url: item.source.url, detail: item.evidence,
  }));
  hero.counters.forEach((item) => add(favorable, item.target_id, item.target_name, {
    source: 'Kurohiko', url: 'https://hok.kurohiko.id/', detail: item.reason, meta: `${item.severity} target`,
  }));

  for (const key of danger.keys()) {
    if (!favorable.has(key)) continue;
    const dangerEntry = danger.get(key);
    const favorableEntry = favorable.get(key);
    if (dangerEntry) dangerEntry.hasSourceConflict = true;
    if (favorableEntry) favorableEntry.hasSourceConflict = true;
  }

  kpl?.synergies?.forEach((item) => add(partners, item.partner_id, item.partner_name, {
    source: 'KPL', detail: `${item.wins}W · ${item.losses}L · ${item.total_matches} game bersama`, metric: `${(item.duet_winrate * 100).toFixed(1)}% WR`,
  }, item.partner_avatar));
  hokfire?.synergizes.forEach((slug) => {
    const related = nameMap.get(normalizeName(slug));
    add(partners, related?.hero_id, related?.name || slug, { source: 'HOKFIRE', url: 'https://www.hokfire.com/' }, related?.portrait_asset);
  });
  guide?.partners.forEach((item) => add(partners, item.hero_id, item.hero_name, {
    source: 'HoKStats', url: item.source.url,
  }));

  const groups = [
    { title: 'Lemah melawan', hint: 'Ancaman yang perlu diwaspadai', rows: danger, tone: 'text-rose-300', icon: <ShieldBan className="h-4 w-4" aria-hidden="true" /> },
    { title: 'Kuat melawan', hint: 'Target yang menguntungkan', rows: favorable, tone: 'text-emerald-300', icon: <Swords className="h-4 w-4" aria-hidden="true" /> },
    { title: 'Rekan sinergi', hint: 'Hero dengan kombinasi yang disarankan', rows: partners, tone: 'text-indigo-300', icon: <Link2 className="h-4 w-4" aria-hidden="true" /> },
  ];
  const hasRows = groups.some((group) => group.rows.size > 0);

  return (
    <section className="rounded-xl border border-[#263142] bg-[#121824] p-4 space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#263142] pb-3">
        <div className="flex items-center gap-2">
          <Swords className="h-4 w-4 text-[#B8FF01]" aria-hidden="true" />
          <div>
            <h4 className="text-sm font-bold text-white">Counter & matchup</h4>
            <p className="text-xs text-slate-500">Semua sumber dalam format yang sama; label sumber ada di tiap hero.</p>
          </div>
        </div>
        {kpl && (kpl.total_picks > 0 || kpl.total_bans > 0) && (
          <div className="flex flex-wrap gap-1.5 text-xs font-mono tabular-nums">
            <span className="rounded-md border border-[#2A3750] bg-[#1A2233] px-2 py-1 text-slate-300">{kpl.total_picks} picks KPL</span>
            <span className="rounded-md border border-[#2A3750] bg-[#1A2233] px-2 py-1 text-amber-300">{kpl.total_bans} bans</span>
            <span className="rounded-md border border-[#2A3750] bg-[#1A2233] px-2 py-1 text-emerald-300">{(kpl.overall_winrate * 100).toFixed(1)}% WR</span>
          </div>
        )}
      </header>

      {hasRows ? groups.map((group) => {
        if (!group.rows.size) return null;
        return (
          <section key={group.title} className="space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className={`flex items-center gap-2 ${group.tone}`}>
                {group.icon}
                <h5 className="text-xs font-bold uppercase tracking-wide">{group.title}</h5>
                <span className="rounded-full bg-[#1A202C] px-2 py-0.5 text-[11px] font-mono text-slate-400">{group.rows.size}</span>
              </div>
              <span className="hidden text-xs text-slate-500 sm:block">{group.hint}</span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {[...group.rows.values()].map((entry) => {
                const related = entry.heroId == null ? nameMap.get(normalizeName(entry.name)) : idMap.get(entry.heroId);
                const uniqueSources = [...new Map(entry.evidence.map((item) => [`${item.source}|${item.url || ''}`, item])).values()];
                return (
                  <article key={`${group.title}-${entry.heroId ?? entry.name}`} className="flex min-w-0 gap-3 rounded-xl border border-[#263142] bg-[#0F151F] p-3 transition-colors hover:border-[#3A485C]">
                    <button type="button" disabled={!related} onClick={() => related && onSelectRelatedHero(related)} aria-label={`Buka wiki ${related?.name || entry.name}`} className="h-11 w-11 shrink-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8FF01] disabled:cursor-default">
                      <AssetThumbnail src={related?.portrait_asset || entry.avatar} name={related?.name || entry.name} kind="hero" className="h-11 w-11 rounded-lg border border-[#30394A] object-cover" />
                    </button>
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <button type="button" disabled={!related} onClick={() => related && onSelectRelatedHero(related)} className="truncate text-left text-sm font-semibold text-white hover:text-[#B8FF01] focus-visible:outline-none focus-visible:underline disabled:cursor-default disabled:hover:text-white">
                          {related?.name || entry.name}
                        </button>
                        {entry.evidence.filter((item) => item.metric).map((item, index) => <span key={`${item.source}-metric-${index}`} className={`shrink-0 rounded-md px-2 py-1 text-xs font-mono font-bold tabular-nums ${group.title === 'Lemah melawan' ? 'bg-rose-950/40 text-rose-300' : group.title === 'Kuat melawan' ? 'bg-emerald-950/40 text-emerald-300' : 'bg-indigo-950/40 text-indigo-300'}`}>{item.metric}</span>)}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {entry.hasSourceConflict && <span className="rounded border border-amber-800/50 bg-amber-950/30 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">Sumber berbeda</span>}
                        {uniqueSources.map((item) => item.url ? (
                          <a key={`${item.source}-${item.url}`} href={item.url} target="_blank" rel="noreferrer" className="rounded border border-[#30394A] bg-[#171F2B] px-1.5 py-0.5 text-[10px] font-medium text-slate-400 hover:text-slate-200">{item.source}</a>
                        ) : (
                          <span key={item.source} className="rounded border border-[#30394A] bg-[#171F2B] px-1.5 py-0.5 text-[10px] font-medium text-slate-400">{item.source}</span>
                        ))}
                      </div>
                      {entry.evidence.filter((item) => item.detail || item.meta).map((item, index) => (
                        <p key={`${item.source}-detail-${index}`} className="text-xs leading-relaxed text-slate-400">
                          {item.meta && <span className="font-medium text-slate-300">{item.meta} · </span>}{item.detail}
                        </p>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      }) : (
        <p className="rounded-lg border border-dashed border-[#30394A] bg-[#0F151F] p-4 text-sm text-slate-400">Belum ada data counter atau matchup untuk hero ini.</p>
      )}
    </section>
  );
};

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
  itemCatalog = [],
  spellCatalog = [],
}) => {
  const [activeWikiTab, setActiveWikiTab] = useState<'build' | 'counters' | 'abilities' | 'tactics'>(initialTab);
  const [selectedBuild, setSelectedBuild] = useState(() => sourceHero?.hokfire_guide?.full_build?.length ? 'hokfire' : sourceHero?.hokstats_guide?.build_variants?.[0] ? `hokstats:${sourceHero.hokstats_guide.build_variants[0].id}` : 'hokfire');
  const hero = useMemo(() => displayCopy(sourceHero), [sourceHero]);
  const dialog = useDialogFocus(!!sourceHero, onClose);
  useEffect(() => setActiveWikiTab(initialTab), [initialTab]);
  useEffect(() => {
    const hasHokfire = Boolean(sourceHero?.hokfire_guide?.full_build?.length);
    const firstVariant = sourceHero?.hokstats_guide?.build_variants?.[0];
    setSelectedBuild(hasHokfire ? 'hokfire' : firstVariant ? `hokstats:${firstVariant.id}` : 'hokfire');
  }, [sourceHero?.hero_id]);

  if (!hero) return null;

  const idMap = new Map<number, Hero>(allHeroes.map((h) => [h.hero_id, h]));

  const hGuide = hero.hokfire_guide;
  const abilities = hero.abilities || [];
  const buildVariants = hero.hokstats_guide?.build_variants || [];
  const selectedVariant = selectedBuild.startsWith('hokstats:') ? buildVariants.find(build => `hokstats:${build.id}` === selectedBuild) : undefined;
  const activeBuildItems = selectedVariant?.items || hGuide?.full_build || [];
  const activeBuildLabel = selectedVariant ? `HoKStats · ${selectedVariant.name}` : 'HOKFIRE';
  const selectedSpellName = hGuide?.spell || '';
  const selectedSpell = selectedSpellName ? spellCatalog.find(spell => spell.name.toLowerCase() === selectedSpellName.toLowerCase()) : undefined;
  const findItem = (name: string) => itemCatalog.find(item => item.name.toLowerCase() === name.toLowerCase()) || getItemMeta(name);
  const heroTags = hero.tactical_profile?.tags;
  const factualSkillGroups = heroTags
    ? FACTUAL_SKILL_TAG_GROUPS.map((group) => ({
        ...group,
        matched: group.items.filter(([tag]) => heroTags[tag] === true),
      })).filter((group) => group.matched.length > 0)
    : [];

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
                  <RoleLabel role={hero.primary_role} /> · {hero.lanes.map((lane, index) => <React.Fragment key={lane}>{index > 0 && ' / '}<LaneLabel lane={lane} /></React.Fragment>)}
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
            <span>Build & Item</span>
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
              {buildVariants.length > 0 && (
                <label className="block space-y-1.5">
                  <span className="text-xs font-bold text-slate-400">Pilih preset build</span>
                  <select aria-label="Preset build" value={selectedBuild} onChange={event => setSelectedBuild(event.target.value)} className="w-full rounded-lg border border-[#30394A] bg-[#10151E] px-3 py-2 text-sm text-white">
                    {hGuide?.full_build.length ? <option value="hokfire">HOKFIRE · Build utama</option> : null}
                    {buildVariants.map(build => <option key={build.id} value={`hokstats:${build.id}`}>HoKStats · {build.name}{build.use_case ? ` — ${build.use_case}` : ''}</option>)}
                  </select>
                </label>
              )}
              {selectedVariant && hero.hokstats_guide && <div className="flex items-center justify-between rounded-lg border border-[#263142] bg-[#121824] px-3 py-2 text-xs"><span className="text-slate-300">Build HoKStats · {selectedVariant.name}</span><a className="text-slate-400 underline underline-offset-2 hover:text-white" href={hero.hokstats_guide.source.url} target="_blank" rel="noreferrer">Sumber</a></div>}
              {activeBuildItems.length > 0 ? (
                <>
                  <div className="p-3 bg-[#12161F] border border-[#232A38] rounded-xl space-y-2.5">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-[#F5C451]" />
                        <span>Rekomendasi Full Build {activeBuildLabel}</span>
                      </h4>
                      {selectedSpellName && (
                        <details className="relative rounded-lg bg-[#1A202C] border border-amber-900/40 px-2 py-1">
                          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-mono text-amber-300 font-bold">
                            <AssetThumbnail src={selectedSpell?.icon || `/assets/skills/${selectedSpellName.toLowerCase().trim()}.png`} name={selectedSpellName} kind="item" className="w-4 h-4 rounded-full object-cover" />
                            {selectedSpellName} · detail spell
                          </summary>
                          <div className="absolute right-0 z-10 mt-2 w-64 rounded-xl border border-[#30394A] bg-[#10151E] p-3 shadow-xl space-y-2">
                            {selectedSpell?.sources.hokfire?.effect && <p className="text-xs text-slate-200"><strong className="text-amber-300">HOKFIRE:</strong> {selectedSpell.sources.hokfire.effect}</p>}
                            {selectedSpell?.sources.hokstats && <div className="text-xs text-slate-200 space-y-1"><p><strong className="text-emerald-300">HoKStats:</strong> {selectedSpell.sources.hokstats.effect}</p>{selectedSpell.sources.hokstats.cooldown && <p>Cooldown: {selectedSpell.sources.hokstats.cooldown}</p>}{selectedSpell.sources.hokstats.best_for.length > 0 && <p>Disarankan untuk: {selectedSpell.sources.hokstats.best_for.join(', ')}</p>}</div>}
                            {selectedSpell?.sources.hokstats?.source && <a className="text-xs text-slate-500 underline underline-offset-2 hover:text-slate-300" href={selectedSpell.sources.hokstats.source.url} target="_blank" rel="noreferrer">Sumber HoKStats</a>}
                            {!selectedSpell && <p className="text-xs text-slate-400">{selectedSpellName}</p>}
                          </div>
                        </details>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {activeBuildItems.map((item, idx) => {
                        const isCore = !selectedVariant && Boolean(hGuide?.core_items.includes(item));
                        const catalogMeta = findItem(item) && 'sources' in (findItem(item) as object) ? findItem(item) as ItemCatalogEntry : undefined;
                        const meta = catalogMeta || getItemMeta(item);
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
                              {(meta?.desc || catalogMeta?.sources.hokstats) && <details className="mt-1.5">
                                <summary className="cursor-pointer text-xs text-sky-300">Detail item</summary>
                                <div className="mt-1.5 space-y-1 text-xs text-slate-300">
                                  {meta?.desc && <p><strong className="text-amber-300">HOKFIRE:</strong> {meta.desc}</p>}
                                  {catalogMeta?.sources.hokstats && <div><strong className="text-slate-200">HoKStats:</strong>{Object.entries(catalogMeta.sources.hokstats.stats).map(([key, value]) => <p key={key}>{key}: {value}</p>)}{catalogMeta.sources.hokstats.passive && <p>Passive: {catalogMeta.sources.hokstats.passive}</p>}{catalogMeta.sources.hokstats.active && <p>Active: {catalogMeta.sources.hokstats.active}</p>}{catalogMeta.sources.hokstats.build_path.length > 0 && <p>Build path: {catalogMeta.sources.hokstats.build_path.join(' → ')}</p>}<a href={catalogMeta.sources.hokstats.source.url} target="_blank" rel="noreferrer" className="text-slate-500 underline underline-offset-2 hover:text-slate-300">Sumber HoKStats</a></div>}
                                </div>
                              </details>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Situational Item Swaps */}
                  {hGuide && hGuide.situational_items.length > 0 && (
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
                  {hGuide && hGuide.arcana.length > 0 && (
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
                  {hGuide?.skill_priority && (
                    <div className="p-2.5 bg-[#12161F] border border-[#232A38] rounded-xl flex items-center justify-between">
                      <span className="text-xs text-slate-400">Prioritas Leveling Skill:</span>
                      <span className="text-xs font-bold text-[#B8FF01] font-mono">{hGuide?.skill_priority}</span>
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
            <MatchupPanel hero={hero} allHeroes={allHeroes} onSelectRelatedHero={onSelectRelatedHero} />
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

              {hero.hokstats_guide && (hero.hokstats_guide.pros.length > 0 || hero.hokstats_guide.cons.length > 0) && <div className="rounded-xl border border-[#263142] bg-[#121824] p-3 space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200">Panduan HoKStats</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {hero.hokstats_guide.pros.length > 0 && <div><span className="text-xs font-bold text-emerald-300">Kelebihan</span><ul className="mt-1 space-y-1">{hero.hokstats_guide.pros.map((item, index) => <li key={index} className="text-xs text-slate-200">• {item}</li>)}</ul></div>}
                  {hero.hokstats_guide.cons.length > 0 && <div><span className="text-xs font-bold text-rose-300">Kelemahan</span><ul className="mt-1 space-y-1">{hero.hokstats_guide.cons.map((item, index) => <li key={index} className="text-xs text-slate-200">• {item}</li>)}</ul></div>}
                </div>
                <a className="text-xs text-slate-500 underline underline-offset-2 hover:text-slate-300" href={hero.hokstats_guide.source.url} target="_blank" rel="noreferrer">Sumber HoKStats · {hero.hokstats_guide.source.fetched_at.slice(0, 10)}</a>
              </div>}

              {/* Factual Skill Mechanics */}
              {factualSkillGroups.length > 0 && (
                <div className="p-3 bg-[#12161F] border border-[#232A38] rounded-xl space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Mekanik Skill Terverifikasi</h4>
                    <span className="text-[11px] text-slate-500">Faktual dari skill</span>
                  </div>
                  <div className="space-y-2">
                    {factualSkillGroups.map((group) => (
                      <div key={group.category} className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] font-semibold text-slate-400 mr-1">{group.category}:</span>
                        {group.matched.map(([tag, label, desc]) => (
                          <span
                            key={tag}
                            title={desc}
                            className={`rounded-md border px-2 py-0.5 text-xs font-semibold cursor-help transition-all hover:brightness-125 ${group.tone}`}
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    ))}
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
              {hero.hokstats_guide && hero.hokstats_guide.skills.length > 0 && <div className="space-y-2.5">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">Detail skill HoKStats</h4>
                {hero.hokstats_guide.skills.map((skill, index) => <div key={`${skill.name}-${index}`} className="rounded-xl border border-[#232A38] bg-[#12161F] p-3 space-y-1"><div className="flex items-center gap-2"><h5 className="text-sm font-bold text-white">{skill.name || `Skill ${index + 1}`}</h5>{skill.type && <span className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] uppercase text-slate-400">{skill.type}</span>}</div><p className="text-xs leading-relaxed text-slate-300">{skill.description}</p></div>)}
                <a className="text-xs text-slate-500 underline" href={hero.hokstats_guide.source.url} target="_blank" rel="noreferrer">Sumber HoKStats</a>
              </div>}
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

              {hero.hokstats_guide && (hero.hokstats_guide.pick_when.length || hero.hokstats_guide.avoid_when.length || hero.hokstats_guide.power_spikes.length || hero.hokstats_guide.common_mistakes.length || hero.hokstats_guide.partners.length) > 0 && <div className="p-3.5 bg-[#121824] border border-[#263142] rounded-xl space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200">Panduan draft & permainan HoKStats</h4>
                {([['Pilih saat', hero.hokstats_guide.pick_when], ['Hindari saat', hero.hokstats_guide.avoid_when], ['Power spike', hero.hokstats_guide.power_spikes], ['Kesalahan umum', hero.hokstats_guide.common_mistakes]] as const).filter(([, values]) => values.length > 0).map(([label, values]) => <div key={label}><h5 className="text-xs font-bold text-slate-200">{label}</h5><ul className="mt-1 space-y-1">{values.map((value, index) => <li key={index} className="text-xs leading-relaxed text-slate-300">• {value}</li>)}</ul></div>)}
                {hero.hokstats_guide.partners.length > 0 && <div><h5 className="text-xs font-bold text-slate-200">Partner yang disarankan</h5><div className="mt-1 flex flex-wrap gap-1.5">{hero.hokstats_guide.partners.map((partner, index) => { const related = partner.hero_id ? idMap.get(partner.hero_id) : undefined; return <button key={`${partner.hero_id}-${index}`} type="button" disabled={!related} onClick={() => related && onSelectRelatedHero(related)} className="rounded-lg border border-indigo-800/50 bg-indigo-950/30 px-2 py-1 text-xs text-indigo-200">{related?.name || partner.hero_name}</button>; })}</div></div>}
                <a className="text-xs text-slate-500 underline underline-offset-2 hover:text-slate-300" href={hero.hokstats_guide.source.url} target="_blank" rel="noreferrer">Sumber HoKStats · {hero.hokstats_guide.source.fetched_at.slice(0, 10)}</a>
              </div>}

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
