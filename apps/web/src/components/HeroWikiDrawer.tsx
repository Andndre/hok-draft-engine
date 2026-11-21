import { RoleLabel } from './ui/RoleIcon';
import { LaneLabel } from './ui/LaneIcon';
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Hero, ItemCatalogEntry, SpellCatalogEntry, TacticalTag } from '../types';
import { X, Star, Swords, Shield, Lightbulb, BookOpen, Zap, Sparkles, ArrowRight, CheckCircle2, AlertCircle, Wrench, ShieldBan, Link2, Info } from 'lucide-react';
import { AssetThumbnail } from './ui/AssetThumbnail';
import { displayCopy } from './ui/presentation';
import { useNativeModalDialog } from './ui/useNativeModalDialog';
import { useFocusgroup } from './ui/useFocusgroup';
import { getItemMeta } from '../data/itemsMap';
import { ColoredText } from './ColoredText';
import { detectHeroSkillStances } from '../engine/skillStanceDetector';

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

type MatchupSourceLabel = 'KPL' | 'HOKFIRE' | 'HoKStats' | 'Kurohiko' | 'Kurasi';

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
  measured?: MeasuredEvidenceView;
}

interface MatchupPanelProps {
  hero: Hero;
  allHeroes: Hero[];
  onSelectRelatedHero: (hero: Hero) => void;
}

type MeasuredVerdict = 'confirmed' | 'contradicted' | 'inconclusive';

interface MeasuredEvidenceView {
  delta: number;
  weighted_delta?: number;
  n: number;
  n_eff?: number;
  verdict: MeasuredVerdict;
}

const formatIdNumber = (value: number, fractionDigits = 1) =>
  value.toLocaleString('id-ID', { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits });

const formatDelta = (delta: number) => {
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
  return `${sign}${formatIdNumber(Math.abs(delta) * 100, 1)}`;
};

const resolveMeasuredVerdict = (delta: number, group: 'danger' | 'favorable'): MeasuredVerdict => {
  if (group === 'danger') {
    if (delta <= -0.02) return 'confirmed';
    if (delta >= 0.02) return 'contradicted';
    return 'inconclusive';
  }
  if (delta >= 0.02) return 'confirmed';
  if (delta <= -0.02) return 'contradicted';
  return 'inconclusive';
};

const hasOpposingWeightedDelta = (delta: number, weightedDelta?: number): boolean =>
  weightedDelta != null && Math.sign(weightedDelta) !== Math.sign(delta) && Math.abs(weightedDelta) >= 0.02;

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

const TACTICAL_ROLE_TAGS: ReadonlyArray<readonly [TacticalTag, string, string]> = [
  ['frontline', 'Frontline', 'Mampu menyerap damage dan menahan garis depan tim.'],
  ['engage', 'Inisiator (Engage)', 'Dapat membuka pertempuran dengan gap-closer atau kontrol area yang andal.'],
  ['disengage', 'Counter-Engage / Disengage', 'Dapat membatalkan inisiasi lawan atau membantu tim mundur dengan aman.'],
  ['peel', 'Peel / Pelindung Carry', 'Mampu melindungi rekan tim dari sergapan lawan melalui CC atau displacement.'],
];

const TACTICAL_VULNERABILITY_TAGS: ReadonlyArray<readonly [TacticalTag, string, string]> = [
  ['dive_vulnerable', 'Rentan Dive', 'Sangat rentan disergap (dive) oleh assassin karena minim mobilitas atau pertahanan mandiri.'],
  ['kite_vulnerable', 'Rentan Kite', 'Mudah dipermainkan dari jarak jauh karena jangkauan serangan atau mobilitas terbatas.'],
  ['weak_early', 'Lemah Early Game', 'Ketahanan dan damage pada fase awal relatif rendah, memerlukan farming atau item core.'],
  ['low_damage', 'Damage Rendah', 'Bukan penghasil damage utama, fokus pada utilitas tim, durabilitas, atau kontrol.'],
];

function TagToggletip({
  label,
  description,
  className,
}: {
  label: string;
  description: string;
  className: string;
}) {
  const tipId = useId();
  return (
    <span className="toggletip-wrap">
      <button
        type="button"
        className={className}
        aria-expanded={false}
        {...({
          interestfor: tipId,
          popoverTarget: tipId,
          popoverTargetAction: 'show',
        } as Record<string, string>)}
      >
        {label}
      </button>
      <span id={tipId} role="tooltip" popover="hint" className="toggletip-panel">
        {description}
      </span>
    </span>
  );
}

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
  hero.countered_by?.forEach((item) => add(danger, item.counter_id, item.counter_name, {
    source: item.source === 'curation' ? 'Kurasi' : 'Kurohiko',
    url: item.source === 'curation' ? undefined : 'https://hok.kurohiko.id/',
    detail: item.reason,
    meta: `${item.severity} counter${item.source === 'curation' ? ' · kurasi manual' : ''}`,
  }));

  kpl?.best_matchups?.forEach((item) => add(favorable, item.opponent_id, item.opponent_name, {
    source: 'KPL', detail: `${item.wins}W · ${item.losses}L · ${item.total_matches} game`, metric: `${(item.hero_winrate * 100).toFixed(1)}% WR`,
  }, item.opponent_avatar));
  hokfire?.strong_against?.forEach((slug) => {
    const related = nameMap.get(normalizeName(slug));
    add(favorable, related?.hero_id, related?.name || slug, { source: 'HOKFIRE', url: 'https://www.hokfire.com/' }, related?.portrait_asset);
  });
  guide?.matchups?.filter((item) => item.relation === 'strong_against').forEach((item) => add(favorable, item.hero_id, item.hero_name, {
    source: 'HoKStats', url: item.source.url, detail: item.evidence,
  }));
  hero.counters?.forEach((item) => add(favorable, item.target_id, item.target_name, {
    source: item.source === 'curation' ? 'Kurasi' : 'Kurohiko',
    url: item.source === 'curation' ? undefined : 'https://hok.kurohiko.id/',
    detail: item.reason,
    meta: `${item.severity} target${item.source === 'curation' ? ' · kurasi manual' : ''}`,
  }));

  for (const key of danger.keys()) {
    if (!favorable.has(key)) continue;
    const dangerEntry = danger.get(key);
    const favorableEntry = favorable.get(key);
    if (dangerEntry) dangerEntry.hasSourceConflict = true;
    if (favorableEntry) favorableEntry.hasSourceConflict = true;
  }

  const attachMeasured = (
    group: Map<string, MatchupCardData>,
    direction: 'danger' | 'favorable'
  ) => {
    for (const entry of group.values()) {
      const related = entry.heroId == null ? nameMap.get(normalizeName(entry.name)) : idMap.get(entry.heroId);
      const opponentId = related?.hero_id ?? entry.heroId;
      const opponentName = related?.name || entry.name;
      const found =
        hero.measured_counters?.find(
          (m) =>
            (opponentId != null && m.target_id === opponentId) ||
            normalizeName(m.target_name) === normalizeName(opponentName)
        ) ||
        hero.measured_countered_by?.find(
          (m) =>
            (opponentId != null && m.counter_id === opponentId) ||
            normalizeName(m.counter_name) === normalizeName(opponentName)
        );
      if (found) {
        entry.measured = {
          delta: found.delta,
          weighted_delta: found.weighted_delta,
          n: found.n,
          n_eff: found.n_eff,
          verdict: resolveMeasuredVerdict(found.delta, direction),
        };
      }
    }
  };

  attachMeasured(danger, 'danger');
  attachMeasured(favorable, 'favorable');

  const curatedKeys = new Set<string>([...danger.keys(), ...favorable.keys()]);
  const measuredOnly = new Map<string, MatchupCardData & { delta: number; weighted_delta?: number; n: number; n_eff?: number }>();

  const addMeasuredOnly = (
    key: string,
    entry: MatchupCardData & { delta: number; weighted_delta?: number; n: number; n_eff?: number }
  ) => {
    if (!curatedKeys.has(key) && !measuredOnly.has(key)) measuredOnly.set(key, entry);
  };

  hero.measured_counters?.forEach((m) => {
    const related = idMap.get(m.target_id) || nameMap.get(normalizeName(m.target_name));
    const key = related ? `hero:${related.hero_id}` : `name:${normalizeName(m.target_name)}`;
    addMeasuredOnly(key, {
      heroId: related?.hero_id ?? null,
      name: related?.name || m.target_name,
      avatar: related?.portrait_asset,
      evidence: [],
      delta: m.delta,
      weighted_delta: m.weighted_delta,
      n: m.n,
      n_eff: m.n_eff,
    });
  });

  hero.measured_countered_by?.forEach((m) => {
    const related = idMap.get(m.counter_id) || nameMap.get(normalizeName(m.counter_name));
    const key = related ? `hero:${related.hero_id}` : `name:${normalizeName(m.counter_name)}`;
    addMeasuredOnly(key, {
      heroId: related?.hero_id ?? null,
      name: related?.name || m.counter_name,
      avatar: related?.portrait_asset,
      evidence: [],
      delta: m.delta,
      weighted_delta: m.weighted_delta,
      n: m.n,
      n_eff: m.n_eff,
    });
  });

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
  const hasRows = groups.some((group) => group.rows.size > 0) || measuredOnly.size > 0;

  return (
    <section className="rounded-xl border border-[#263142] bg-[#121824] p-4 space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#263142] pb-3">
        <div className="flex items-center gap-2">
          <Swords className="h-4 w-4 text-[#B8FF01]" aria-hidden="true" />
          <div>
            <h3 className="text-sm font-bold text-white">Counter & matchup</h3>
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
                <h4 className="text-xs font-bold uppercase tracking-wide">{group.title}</h4>
                <span className="rounded-full bg-[#1A202C] px-2 py-0.5 text-xs font-mono text-slate-400">{group.rows.size}</span>
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
                        {entry.hasSourceConflict && <span className="rounded border border-amber-800/50 bg-amber-950/30 px-2 py-0.5 text-xs font-medium text-amber-300">Sumber berbeda</span>}
                        {uniqueSources.map((item) => item.url ? (
                          <a key={`${item.source}-${item.url}`} href={item.url} target="_blank" rel="noreferrer" className="rounded border border-[#30394A] bg-[#171F2B] px-2 py-0.5 text-xs font-medium text-slate-400 hover:text-slate-200">{item.source}</a>
                        ) : (
                          <span key={item.source} className="rounded border border-[#30394A] bg-[#171F2B] px-2 py-0.5 text-xs font-medium text-slate-400">{item.source}</span>
                        ))}
                      </div>
                      {entry.evidence.filter((item) => item.detail || item.meta).map((item, index) => (
                        <p key={`${item.source}-detail-${index}`} className="text-xs leading-relaxed text-slate-400">
                          {item.meta && <span className="font-medium text-slate-300">{item.meta} · </span>}{item.detail}
                        </p>
                      ))}
                      {entry.measured && (
                        <p className="flex flex-wrap items-center gap-2 text-xs">
                          <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-medium tabular-nums ${
                            entry.measured.verdict === 'confirmed'
                              ? 'border-emerald-800/50 bg-emerald-950/30 text-emerald-300'
                              : entry.measured.verdict === 'contradicted'
                              ? 'border-rose-800/50 bg-rose-950/30 text-rose-300'
                              : 'border-slate-700 bg-slate-800/40 text-slate-300'
                          }`}>
                            {entry.measured.verdict === 'confirmed' && <CheckCircle2 className="h-3 w-3" aria-hidden="true" />}
                            {entry.measured.verdict === 'contradicted' && <AlertCircle className="h-3 w-3" aria-hidden="true" />}
                            {entry.measured.verdict === 'inconclusive' && <Info className="h-3 w-3" aria-hidden="true" />}
                            {entry.measured.verdict === 'confirmed' && <span>Data KPL mendukung</span>}
                            {entry.measured.verdict === 'contradicted' && <span>Data KPL menolak</span>}
                            {entry.measured.verdict === 'inconclusive' && <span>Data KPL netral</span>}
                            <span className="font-mono">{formatDelta(entry.measured.delta)} pp · n={entry.measured.n}</span>
                          </span>
                          {hasOpposingWeightedDelta(entry.measured.delta, entry.measured.weighted_delta) && (
                            <span className="text-xs text-slate-400">
                              12 bulan terakhir: {formatDelta(entry.measured.weighted_delta!)} pp (berlawanan)
                            </span>
                          )}
                        </p>
                      )}
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

      {measuredOnly.size > 0 && (
        <section className="space-y-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 text-slate-300">
              <Info className="h-4 w-4" aria-hidden="true" />
              <h4 className="text-xs font-bold uppercase tracking-wide">Terukur di KPL</h4>
              <span className="rounded-full bg-[#1A202C] px-2 py-0.5 text-xs font-mono text-slate-400">{measuredOnly.size}</span>
            </div>
            <details className="text-xs text-slate-400">
              <summary className="cursor-pointer list-none hover:text-slate-200">Apa artinya?</summary>
              <div className="mt-2 rounded-lg border border-[#30394A] bg-[#0F151F] p-3 space-y-1.5 text-xs leading-relaxed">
                <p><strong className="text-slate-200">pp</strong> = percentage point: selisih win rate hero ini saat lawan itu ada di tim lawan, dibanding saat lawan itu tidak ada.</p>
                <p><strong className="text-slate-200">n</strong> = jumlah game berpasangan yang jadi bukti (minimal 30).</p>
                <p>Bukti diberi bobot recency 12 bulan: data baru lebih berpengaruh dari data lama.</p>
              </div>
            </details>
          </div>
          <p className="text-xs leading-relaxed text-slate-400">
            Dihitung dari {hero.measured_meta?.measured_games?.toLocaleString('id-ID') ?? '9.817'} game pro tempat hero ini dipilih — bukan relasi kurasi; mesin tidak memakai ini sebagai counter.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {[...measuredOnly.values()].map((entry) => {
              const related = entry.heroId == null ? nameMap.get(normalizeName(entry.name)) : idMap.get(entry.heroId);
              return (
                <article key={`measured-only-${entry.heroId ?? entry.name}`} className="flex min-w-0 gap-3 rounded-xl border border-[#263142] bg-[#0F151F] p-3 transition-colors hover:border-[#3A485C]">
                  <button type="button" disabled={!related} onClick={() => related && onSelectRelatedHero(related)} aria-label={`Buka wiki ${related?.name || entry.name}`} className="h-11 w-11 shrink-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8FF01] disabled:cursor-default">
                    <AssetThumbnail src={related?.portrait_asset || entry.avatar} name={related?.name || entry.name} kind="hero" className="h-11 w-11 rounded-lg border border-[#30394A] object-cover" />
                  </button>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <button type="button" disabled={!related} onClick={() => related && onSelectRelatedHero(related)} className="truncate text-left text-sm font-semibold text-white hover:text-[#B8FF01] focus-visible:outline-none focus-visible:underline disabled:cursor-default disabled:hover:text-white">
                        {related?.name || entry.name}
                      </button>
                      <span className="shrink-0 rounded-md border border-slate-700 bg-slate-800/40 px-2 py-1 text-xs font-mono font-bold tabular-nums text-slate-300">
                        {formatDelta(entry.delta)} pp
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <span className="rounded border border-[#30394A] bg-[#171F2B] px-2 py-0.5 text-xs font-medium text-slate-400">KPL</span>
                    </div>
                    <p className="text-xs leading-relaxed text-slate-400">
                      n={entry.n}{entry.n_eff ? ` · n efektif=${formatIdNumber(entry.n_eff, 1)}` : ''}
                    </p>
                    {hasOpposingWeightedDelta(entry.delta, entry.weighted_delta) && (
                      <p className="text-xs text-slate-400">
                        12 bulan terakhir: {formatDelta(entry.weighted_delta!)} pp (berlawanan)
                      </p>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
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
  const [selectedBuild, setSelectedBuild] = useState<string>(() =>
    sourceHero?.official_build ? 'preset_1' : sourceHero?.hokfire_guide?.full_build?.length ? 'hokfire' : sourceHero?.hokstats_guide?.build_variants?.[0] ? `hokstats:${sourceHero.hokstats_guide.build_variants[0].id}` : 'preset_1'
  );
  const hero = useMemo(() => displayCopy(sourceHero), [sourceHero]);
  const titleId = useId();
  const tabsId = useId();
  const spellPopoverId = useId();
  const wikiTabsRef = useRef<HTMLDivElement>(null);
  const { dialogRef, requestClose } = useNativeModalDialog(Boolean(sourceHero), onClose);
  useFocusgroup(wikiTabsRef, Boolean(sourceHero));
  useEffect(() => setActiveWikiTab(initialTab), [initialTab]);
  useEffect(() => {
    if (sourceHero?.official_build) {
      setSelectedBuild('preset_1');
    } else if (sourceHero?.hokfire_guide?.full_build?.length) {
      setSelectedBuild('hokfire');
    } else if (sourceHero?.hokstats_guide?.build_variants?.[0]) {
      setSelectedBuild(`hokstats:${sourceHero.hokstats_guide.build_variants[0].id}`);
    } else {
      setSelectedBuild('preset_1');
    }
  }, [sourceHero?.hero_id]);

  if (!hero) return null;

  const idMap = new Map<number, Hero>(allHeroes.map((h) => [h.hero_id, h]));

  const hGuide = hero.hokfire_guide;
  const abilities = hero.abilities || [];
  const stances = useMemo(() => detectHeroSkillStances(hero), [hero]);
  const [activeStanceId, setActiveStanceId] = useState<string>(stances[0]?.id || 'default');

  useEffect(() => {
    setActiveStanceId(stances[0]?.id || 'default');
  }, [hero.hero_id, stances]);

  const activeStance = useMemo(() => {
    return stances.find((s) => s.id === activeStanceId) || stances[0];
  }, [stances, activeStanceId]);

  const buildVariants = hero.hokstats_guide?.build_variants || [];
  const selectedVariant = selectedBuild.startsWith('hokstats:') ? buildVariants.find(build => `hokstats:${build.id}` === selectedBuild) : undefined;
  const officialPreset = hero.official_build
    ? (selectedBuild === 'preset_2' ? hero.official_build.build_2 : hero.official_build.build_1)
    : undefined;
  const activeBuildItems = officialPreset?.items || selectedVariant?.items || hGuide?.full_build || [];
  const activeBuildLabel = officialPreset
    ? officialPreset.name
    : selectedVariant
    ? `HoKStats · ${selectedVariant.name}`
    : 'HOK Resmi';
  const activeBuildTips = officialPreset?.tips;
  const selectedSpellName = hero.official_build?.spell || hGuide?.spell || '';
  const selectedSpell = selectedSpellName ? spellCatalog.find(spell => spell.name.toLowerCase() === selectedSpellName.toLowerCase()) : undefined;
  const activeArcana = (hero.official_build?.arcana && hero.official_build.arcana.length > 0)
    ? hero.official_build.arcana
    : (hGuide?.arcana || []);
  const findItem = (name: string) => itemCatalog.find(item => item.name.toLowerCase() === name.toLowerCase()) || getItemMeta(name);
  const heroTags = hero.tactical_profile?.tags;
  const factualSkillGroups = heroTags
    ? FACTUAL_SKILL_TAG_GROUPS.map((group) => ({
        ...group,
        matched: group.items.filter(([tag]) => heroTags[tag] === true),
      })).filter((group) => group.matched.length > 0)
    : [];

  const tacticalRoleMatches = heroTags
    ? TACTICAL_ROLE_TAGS.filter(([tag]) => heroTags[tag] === true)
    : [];

  const tacticalVulnerabilityMatches = heroTags
    ? TACTICAL_VULNERABILITY_TAGS.filter(([tag]) => heroTags[tag] === true)
    : [];

  return (
    <dialog ref={dialogRef} aria-labelledby={titleId} closedby="any" className="wiki-drawer">
      <div className="wiki-drawer__panel w-full bg-[#0E121A] border-l border-[#232A38] h-full flex flex-col shadow-2xl">
        {/* Drawer Header */}
        <div className="relative p-4 border-b border-[#232A38] bg-[#12161F]">
          <button
            type="button"
            autoFocus
            aria-label="Tutup wiki hero"
            title="Tutup wiki hero"
            onClick={requestClose}
            className="wiki-close absolute top-4 right-4 rounded-lg bg-[#1A202C] text-slate-400 hover:text-white border border-[#232A38] transition-colors"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>

          <div className="flex items-center gap-4">
            <div className="relative w-16 h-16 rounded-xl overflow-hidden bg-[#0A0D12] border-2 border-[#232A38] flex-shrink-0">
              <AssetThumbnail src={hero.portrait_asset} name={hero.name} kind="hero" priority="eager" className="w-full h-full object-cover asset-thumbnail--fill" />
              <div
                className="wiki-tier-ribbon absolute top-0 left-0 w-6 h-6 bg-[#EF4444] flex items-start justify-start p-0.5"
              >
                <span
                  className="text-xs font-bold text-black font-mono"
                  title="Popularitas di HoK Camp (seberapa sering dipilih/dibanned) — bukan tier kekuatan"
                >
                  {hero.popularity_band ?? '—'}
                </span>
              </div>
            </div>

            <div className="flex-1 min-w-0 pr-8">
              <div className="flex items-center gap-2">
                <h2 id={titleId} className="text-xl font-bold text-white truncate">{hero.name}</h2>
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
              type="button"
              aria-pressed={isFavorite}
              onClick={() => onToggleFavorite(hero.hero_id)}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-bold border transition-colors ${
                isFavorite
                  ? 'bg-amber-400 text-black border-amber-400'
                  : 'bg-[#1A202C] text-slate-300 border-[#232A38] hover:text-white'
              }`}
            >
              <Star className="w-3.5 h-3.5" fill={isFavorite ? 'currentColor' : 'none'} aria-hidden="true" />
              <span>{isFavorite ? 'Tersimpan di Favorit' : 'Simpan ke Favorit'}</span>
            </button>

            {onPickForDraft && (
              <button
                type="button"
                onClick={() => {
                  onPickForDraft(sourceHero!);
                  requestClose();
                }}
                className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-bold bg-[#B8FF01] text-black shadow hover:brightness-110 transition-colors"
              >
                <Zap className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{draftActionLabel}</span>
              </button>
            )}
          </div>
        </div>

        {/* Wiki Subtabs */}
        <div
          ref={wikiTabsRef}
          role="tablist"
          aria-label="Bagian wiki hero"
          className="wiki-sections grid grid-cols-4 border-b border-[#232A38] bg-[#0A0D12]"
          {...({ focusgroup: 'tablist nomemory' } as Record<string, string>)}
        >
          {(
            [
              { key: 'build', label: 'Build & Item', Icon: Wrench },
              { key: 'counters', label: 'Counter', Icon: Swords },
              { key: 'abilities', label: 'Skill & Pros', Icon: BookOpen },
              { key: 'tactics', label: 'Gameplay', Icon: Lightbulb },
            ] as const
          ).map(({ key, label, Icon }) => {
            const selected = activeWikiTab === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                id={`${tabsId}-${key}`}
                aria-selected={selected}
                onClick={() => setActiveWikiTab(key)}
                onFocus={() => setActiveWikiTab(key)}
                className="wiki-section-tab py-2.5 text-xs font-bold border-b-2 transition-colors flex items-center justify-center gap-1"
                {...(selected ? ({ focusgroupstart: '' } as Record<string, string>) : {})}
              >
                <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>

        {/* Scrollable Content Body */}
        <div
          role="tabpanel"
          aria-labelledby={`${tabsId}-${activeWikiTab}`}
          className="flex-1 overflow-y-auto p-4 pb-16 space-y-4"
        >
          {/* TAB 1: BUILD & ARCANA */}
          {activeWikiTab === 'build' && (
            <div className="space-y-4">
              {/* Preset Build Selector */}
              {hero.official_build ? (
                <div className="flex gap-2 p-1 bg-[#0A0D12] rounded-xl border border-[#232A38]">
                  <button
                    type="button"
                    onClick={() => setSelectedBuild('preset_1')}
                    className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold transition-all ${
                      selectedBuild === 'preset_1'
                        ? 'bg-[#1A2333] text-[#F5C451] shadow-sm border border-[#F5C451]/30'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Preset Resmi #1 (Standar)
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedBuild('preset_2')}
                    className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold transition-all ${
                      selectedBuild === 'preset_2'
                        ? 'bg-[#1A2333] text-[#F5C451] shadow-sm border border-[#F5C451]/30'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Preset Resmi #2 (Alternatif)
                  </button>
                </div>
              ) : buildVariants.length > 0 ? (
                <label className="block space-y-1.5">
                  <span className="text-xs font-bold text-slate-400">Pilih preset build</span>
                  <select aria-label="Preset build" value={selectedBuild} onChange={event => setSelectedBuild(event.target.value)} className="w-full rounded-lg border border-[#30394A] bg-[#10151E] px-3 py-2 text-sm text-white">
                    {hGuide?.full_build && hGuide.full_build.length ? <option value="hokfire">HOKFIRE · Build utama</option> : null}
                    {buildVariants.map(build => <option key={build.id} value={`hokstats:${build.id}`}>HoKStats · {build.name}{build.use_case ? ` — ${build.use_case}` : ''}</option>)}
                  </select>
                </label>
              ) : null}
              {selectedVariant && hero.hokstats_guide && <div className="flex items-center justify-between rounded-lg border border-[#263142] bg-[#121824] px-3 py-2 text-xs"><span className="text-slate-300">Build HoKStats · {selectedVariant.name}</span><a className="text-slate-400 underline underline-offset-2 hover:text-white" href={hero.hokstats_guide.source.url} target="_blank" rel="noreferrer">Sumber</a></div>}

              {activeBuildTips && (
                <div className="p-3 bg-[#101520] border border-[#232A38] rounded-xl text-xs text-slate-300 leading-relaxed flex items-start gap-2">
                  <Lightbulb className="w-4 h-4 text-[#F5C451] flex-shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{activeBuildTips}</span>
                </div>
              )}

              {activeBuildItems.length > 0 ? (
                <>
                  <div className="p-3 bg-[#12161F] border border-[#232A38] rounded-xl space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-[#F5C451]" aria-hidden="true" />
                        <span>Rekomendasi Item ({activeBuildLabel})</span>
                      </h3>
                      {selectedSpellName && (
                        <div className="wiki-spell-group relative">
                          <button
                            type="button"
                            popoverTarget={spellPopoverId}
                            className="wiki-spell-trigger flex items-center gap-1.5 rounded-lg bg-[#1A202C] border border-amber-900/40 px-2 py-1 text-xs font-mono text-amber-300 font-bold hover:border-amber-600/60 transition-colors"
                          >
                            <AssetThumbnail src={selectedSpell?.icon || `/assets/skills/${selectedSpellName.toLowerCase().trim()}.png`} name={selectedSpellName} kind="item" className="w-4 h-4 rounded-full object-cover" />
                            <span>{selectedSpellName} · detail spell</span>
                          </button>
                          <div id={spellPopoverId} popover="auto" className="wiki-spell-popover w-64 rounded-xl border border-[#30394A] bg-[#10151E] p-3 shadow-xl space-y-2 text-left">
                            {selectedSpell?.sources.hokfire?.effect && <p className="text-xs text-slate-200"><strong className="text-amber-300">HOKFIRE:</strong> {selectedSpell.sources.hokfire.effect}</p>}
                            {selectedSpell?.sources.hokstats && <div className="text-xs text-slate-200 space-y-1"><p><strong className="text-emerald-300">HoKStats:</strong> {selectedSpell.sources.hokstats.effect}</p>{selectedSpell.sources.hokstats.cooldown && <p>Cooldown: {selectedSpell.sources.hokstats.cooldown}</p>}{selectedSpell.sources.hokstats.best_for.length > 0 && <p>Disarankan untuk: {selectedSpell.sources.hokstats.best_for.join(', ')}</p>}</div>}
                            {selectedSpell?.sources.hokstats?.source && <a className="text-xs text-slate-500 underline underline-offset-2 hover:text-slate-300" href={selectedSpell.sources.hokstats.source.url} target="_blank" rel="noreferrer">Sumber HoKStats</a>}
                            {!selectedSpell && <p className="text-xs text-slate-400">{selectedSpellName}</p>}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {activeBuildItems.map((item, idx) => {
                        const coreItems = hero.official_build?.core_items || hGuide?.core_items || [];
                        const isCore = !selectedVariant && coreItems.includes(item);
                        const catalogMeta = findItem(item) && 'sources' in (findItem(item) as object) ? findItem(item) as ItemCatalogEntry : undefined;
                        const meta = catalogMeta || getItemMeta(item);
                        return (
                          <div
                            key={idx}
                            className={`p-2 rounded-xl border flex items-center gap-2.5 transition-colors ${
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
                                <span className="text-xs font-bold text-slate-500">
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
                  {((hero.official_build?.situational_items && hero.official_build.situational_items.length > 0) || (hGuide && (hGuide.situational_items?.length ?? 0) > 0)) && (
                    <div className="p-3 bg-[#12161F] border border-[#232A38] rounded-xl space-y-2">
                      <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                        <Shield className="w-3.5 h-3.5 text-[#B8FF01]" aria-hidden="true" />
                        <span>Item Situasional (Swap Khusus)</span>
                      </h3>
                      <p className="text-xs text-slate-400">
                        Tukar item full build di atas saat menghadapi kondisi spesifik pertandingan:
                      </p>

                      <div className="space-y-1.5 pt-1">
                        {(hero.official_build?.situational_items || hGuide?.situational_items || []).map((sit, idx) => {
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
                                <ArrowRight className="w-3.5 h-3.5 text-[#B8FF01] flex-shrink-0" aria-hidden="true" />
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
                  {activeArcana.length > 0 && (
                    <div className="p-3 bg-[#12161F] border border-[#232A38] rounded-xl space-y-2">
                      <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center justify-between">
                        <span>Susunan Arcana Resmi Level 5</span>
                        <span className="text-xs text-slate-500 font-mono">30 Sockets</span>
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                        {activeArcana.map((arc, idx) => {
                          const iconSrc: string = (('icon' in arc && typeof arc.icon === 'string' && arc.icon)
                            ? arc.icon
                            : ('icon_url' in arc && typeof arc.icon_url === 'string' && arc.icon_url)
                            ? arc.icon_url
                            : (arc.id ? `/assets/arcana/${arc.id}.png` : '')) as string;
                          const isRed = arc.color === 'R' || arc.color === 'red';
                          const isBlue = arc.color === 'B' || arc.color === 'blue';
                          const colorBorder = isRed
                            ? 'border-rose-800/60 bg-rose-950/20 text-rose-300'
                            : isBlue
                            ? 'border-blue-800/60 bg-blue-950/20 text-blue-300'
                            : 'border-emerald-800/60 bg-emerald-950/20 text-emerald-300';
                          const attrText: string = (('attr' in arc && typeof arc.attr === 'string' && arc.attr)
                            ? arc.attr
                            : ('desc' in arc && typeof arc.desc === 'string' && arc.desc)
                            ? arc.desc
                            : '') as string;

                          return (
                            <div
                              key={idx}
                              className={`p-2 rounded-xl bg-[#0A0D12] border flex items-center gap-2.5 ${colorBorder}`}
                              title={attrText || arc.name}
                            >
                              <div className="relative w-8 h-8 rounded-lg bg-[#12161F] border border-[#232A38] overflow-hidden flex items-center justify-center flex-shrink-0">
                                {iconSrc ? (
                                  <AssetThumbnail src={iconSrc} name={arc.name} kind="item" className="w-full h-full object-cover asset-thumbnail--fill" />
                                ) : (
                                  <span className="text-xs font-bold text-slate-400">{arc.name.slice(0, 2)}</span>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <span className="text-xs font-bold text-slate-200 block truncate leading-tight">
                                  {arc.name}
                                </span>
                                <span className="text-xs font-mono text-slate-400 block truncate mt-0.5">
                                  {attrText ? attrText.slice(0, 30) : `Arcana Tipe ${arc.color || 'L5'}`}
                                </span>
                              </div>
                              <span className="text-xs font-mono font-bold text-[#B8FF01] flex-shrink-0">
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
              {hGuide && ((hGuide.pros?.length ?? 0) > 0 || (hGuide.cons?.length ?? 0) > 0) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Pros */}
                  <div className="p-3 bg-[#101F18] border border-emerald-900/50 rounded-xl space-y-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Kelebihan (Pros)</span>
                    </span>
                    <ul className="space-y-1">
                      {(hGuide.pros || []).map((p, idx) => (
                        <li key={idx} className="text-xs text-slate-200 flex items-start gap-1.5">
                          <span className="text-emerald-400 font-bold" aria-hidden="true">•</span>
                          <span>{p}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Cons */}
                  <div className="p-3 bg-[#241216] border border-rose-900/50 rounded-xl space-y-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-rose-400 flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Kelemahan (Cons)</span>
                    </span>
                    <ul className="space-y-1">
                      {(hGuide.cons || []).map((c, idx) => (
                        <li key={idx} className="text-xs text-slate-200 flex items-start gap-1.5">
                          <span className="text-rose-400 font-bold" aria-hidden="true">•</span>
                          <span>{c}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {(!hGuide || ((hGuide.pros?.length ?? 0) === 0 && (hGuide.cons?.length ?? 0) === 0)) && hero.hokstats_guide && ((hero.hokstats_guide.pros?.length ?? 0) > 0 || (hero.hokstats_guide.cons?.length ?? 0) > 0) && <div className="rounded-xl border border-[#263142] bg-[#121824] p-3 space-y-2">
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200">Panduan HoKStats</h3>
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
                    <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">Mekanik Skill Terverifikasi</h3>
                    <span className="text-xs text-slate-400">Faktual dari skill</span>
                  </div>
                  <div className="space-y-2">
                    {factualSkillGroups.map((group) => (
                      <div key={group.category} className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-semibold text-slate-400 mr-1">{group.category}:</span>
                        {group.matched.map(([tag, label, desc]) => (
                          <TagToggletip
                            key={tag}
                            label={label}
                            description={desc}
                            className={`toggletip-tag rounded border px-1.5 py-0.5 text-xs font-medium cursor-help transition-colors hover:brightness-125 ${group.tone}`}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Ability Descriptions */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                    <span>Kemampuan & Skill Hero</span>
                    <span className="text-xs font-mono font-normal text-slate-400">
                      ({activeStance?.skills.length || 0} Skill{stances.length > 1 ? ` · ${stances.length} Bentuk/Stance` : ''})
                    </span>
                  </h3>
                  <span className="text-xs text-slate-500 font-mono">HOK Official Abilities</span>
                </div>

                {/* Stance Selector when hero has multi-forms or combo branches */}
                {stances.length > 1 && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2 p-1.5 bg-[#12161F] border border-[#232A38] rounded-xl">
                      {stances.map((st) => {
                        const isActive = activeStance?.id === st.id;
                        return (
                          <button
                            key={st.id}
                            type="button"
                            onClick={() => setActiveStanceId(st.id)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                              isActive
                                ? 'bg-[#B8FF01]/15 text-[#B8FF01] border border-[#B8FF01]/40 shadow-[0_0_12px_rgba(184,255,1,0.15)]'
                                : 'text-slate-400 hover:text-white hover:bg-[#1A202C] border border-transparent'
                            }`}
                          >
                            <span>{st.label}</span>
                            {st.badge && (
                              <span
                                className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-medium ${
                                  isActive
                                    ? 'bg-[#B8FF01]/20 text-[#B8FF01] border border-[#B8FF01]/30'
                                    : 'bg-[#1A202C] text-slate-400 border border-slate-700'
                                }`}
                              >
                                {st.badge}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    {activeStance?.description && (
                      <div className="p-2.5 bg-[#0F131C] border border-[#1E2533] rounded-lg text-xs leading-relaxed text-slate-300">
                        <span className="font-bold text-[#B8FF01] mr-1">Mekanisme:</span>
                        {activeStance.description}
                      </div>
                    )}
                  </div>
                )}

                {/* Active Stance Skills */}
                {(!activeStance || activeStance.skills.length === 0) ? (
                  <p className="text-xs text-slate-500 italic p-3 bg-[#12161F] rounded-xl border border-[#232A38]">
                    {!hero.is_global_released
                      ? 'Hero eksklusif server China / KPL ini belum memiliki rilis deskripsi kemampuan resmi.'
                      : 'Informasi detail skill belum dimuat.'}
                  </p>
                ) : (
                  activeStance.skills.map((ab, idx) => {
                    const iconIdx = ab.iconIndex !== undefined ? ab.iconIndex : idx;
                    const abilityIconSrc = `/assets/abilities/${hero.hero_id}-${iconIdx}.png`;
                    return (
                      <div
                        key={`${ab.name}-${idx}`}
                        className="p-3 bg-[#12161F] border border-[#232A38] rounded-xl space-y-2 hover:border-[#334155] transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          {/* Ability Icon with Gold Border for Ultimate */}
                          <div
                            className={`relative w-12 h-12 rounded-xl overflow-hidden bg-[#0A0D12] border-2 flex-shrink-0 flex items-center justify-center ${
                              (ab.type || '').toLowerCase().includes('ultimate')
                                ? 'border-[#F5C451] shadow-[0_0_10px_rgba(245,196,81,0.2)]'
                                : (ab.type || '').toLowerCase().includes('passive')
                                ? 'border-indigo-400/60'
                                : ab.comboBadge
                                ? 'border-[#B8FF01]/60 shadow-[0_0_8px_rgba(184,255,1,0.15)]'
                                : 'border-[#232A38]'
                            }`}
                          >
                            <AssetThumbnail
                              src={abilityIconSrc}
                              fallbackSrc={abilityIconSrc}
                              name={ab.name}
                              kind="item"
                              className="w-full h-full object-cover asset-thumbnail--fill"
                            />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-sm text-white truncate">{ab.name}</span>
                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                {ab.comboBadge && (
                                  <span className="text-[11px] font-mono px-2 py-0.5 rounded font-bold bg-[#B8FF01]/10 text-[#B8FF01] border border-[#B8FF01]/30">
                                    {ab.comboBadge}
                                  </span>
                                )}
                                <span
                                  className={`text-xs font-mono px-2 py-0.5 rounded font-bold uppercase ${
                                    (ab.type || '').toLowerCase().includes('ultimate')
                                      ? 'bg-[#F5C451]/10 text-[#F5C451] border border-[#F5C451]/30'
                                      : (ab.type || '').toLowerCase().includes('passive')
                                      ? 'bg-indigo-950/60 text-indigo-300 border border-indigo-800/40'
                                      : 'bg-[#1A202C] text-[#B8FF01] border border-[#232A38]'
                                  }`}
                                >
                                  {ab.type}
                                </span>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 mt-1">
                              {ab.roleLabel && (
                                <span className="text-xs font-mono text-slate-400">
                                  {ab.roleLabel}
                                </span>
                              )}
                              {ab.cd !== undefined && ab.cd > 0 && (
                                <span className="text-xs font-mono font-medium text-cyan-300 bg-cyan-950/50 px-2 py-0.5 rounded border border-cyan-800/40">
                                  CD: {ab.cd >= 100 ? `${(ab.cd / 1000).toFixed(ab.cd % 1000 === 0 ? 0 : 1)}s` : `${ab.cd}s`}
                                </span>
                              )}
                              {ab.cost !== undefined && ab.cost > 0 && (
                                <span className="text-xs font-mono font-medium text-blue-300 bg-blue-950/50 px-2 py-0.5 rounded border border-blue-800/40">
                                  Cost: {ab.cost}
                                </span>
                              )}
                              {ab.tags && ab.tags.map((tag) => (
                                <span
                                  key={tag}
                                  className="text-xs font-medium text-amber-300 bg-amber-950/40 px-2 py-0.5 rounded border border-amber-800/40"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>

                        <p className="text-xs text-slate-300 leading-relaxed pt-1 border-t border-[#1E2533]">
                          <ColoredText text={ab.desc || ''} />
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
              {/* Karakteristik & Peran Taktis */}
              {(tacticalRoleMatches.length > 0 || tacticalVulnerabilityMatches.length > 0) && (
                <div className="rounded-xl border border-[#232A38] bg-[#12161F] p-3.5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200">
                      Karakteristik & Peran Taktis
                    </h3>
                    <span className="text-xs text-slate-400">Audit Taktis Terverifikasi</span>
                  </div>

                  {tacticalRoleMatches.length > 0 && (
                    <div className="space-y-1.5">
                      <span className="text-xs font-semibold text-indigo-300">Peran Komposisi Tim:</span>
                      <div className="flex flex-wrap gap-1.5">
                        {tacticalRoleMatches.map(([tag, label, tooltip]) => (
                          <TagToggletip
                            key={tag}
                            label={label}
                            description={tooltip}
                            className="toggletip-tag inline-flex cursor-help items-center rounded border border-indigo-800/60 bg-indigo-950/30 px-2 py-0.5 text-xs font-medium text-indigo-200 transition-colors hover:brightness-125"
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {tacticalVulnerabilityMatches.length > 0 && (
                    <div className="space-y-1.5">
                      <span className="text-xs font-semibold text-rose-300">Peringatan Kelemahan (Trade-off):</span>
                      <div className="flex flex-wrap gap-1.5">
                        {tacticalVulnerabilityMatches.map(([tag, label, tooltip]) => (
                          <TagToggletip
                            key={tag}
                            label={label}
                            description={tooltip}
                            className="toggletip-tag inline-flex cursor-help items-center rounded border border-rose-800/60 bg-rose-950/30 px-2 py-0.5 text-xs font-medium text-rose-200 transition-colors hover:brightness-125"
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* HOKFIRE Gameplay Breakdown */}
              {hGuide && hGuide.gameplay_tips ? (
                <div className="p-3.5 bg-[#12161F] border border-[#232A38] rounded-xl space-y-2">
                  <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                    <BookOpen className="w-3.5 h-3.5 text-[#B8FF01]" aria-hidden="true" />
                    <span>Panduan Bermain Resmi HOKFIRE</span>
                  </h3>
                  <div className="text-xs text-slate-200 leading-relaxed whitespace-pre-line">
                    {hGuide.gameplay_tips.replace(/## /g, '')}
                  </div>
                </div>
              ) : null}

              {/* Cara Melawan / Menghadapi dari Kurohiko */}
              <div>
                <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider mb-2">
                  Cara Melawan di Pertandingan
                </h3>
                <div className="p-3 rounded-xl bg-[#12161F] border border-[#232A38] text-xs text-slate-200 leading-relaxed">
                  {hero.tactical_tips ||
                    `Fokuskan burst damage saat skill escape ${hero.name} sedang cooldown. Jaga formasi agar tidak terkena skill inisiasinya.`}
                </div>
              </div>

              {/* Item Counter */}
              {hero.counter_items && hero.counter_items.length > 0 && (
                <div>
                  <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider mb-2">
                    Item Counter yang Direkomendasikan
                  </h3>
                  <div className="space-y-2">
                    {hero.counter_items.map((item, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-xl bg-[#12161F] border border-[#232A38] space-y-1"
                      >
                        <h4 className="font-bold text-sm text-[#F5C451]">{item.name}</h4>
                        {item.description && (
                          <p className="text-xs text-slate-300 leading-relaxed">{item.description}</p>
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
    </dialog>
  );
};
