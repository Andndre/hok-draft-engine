import { LaneLabel, LaneIcon } from './ui/LaneIcon';
import { DropdownSelect } from './ui/DropdownSelect';
import React, { useDeferredValue, useEffect, useId, useMemo, useState } from 'react';
import { Check, CheckCircle2, LockKeyhole, Search, ShieldCheck, SlidersHorizontal, Sparkles, Target, X } from 'lucide-react';
import type { Hero, Lane } from '../types';
import { isHeroGlobalReleased } from '../data/heroReleaseStatus';
import { HeroThumbnail } from './ui/AssetThumbnail';
import { useNativeModalDialog } from './ui/useNativeModalDialog';
import { searchHeroes } from '../heroSearch';

interface Props {
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
export function PlanSelectionModal({ isOpen, onClose, heroes, currentPlanAId, currentPlanBId, onSelectPlanA, onSelectPlanB, activeSide, unavailableHeroIds, recommendedOpeners, onlyGlobalReleased = true }: Props) {
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [lane, setLane] = useState<Lane | 'All'>('All');
  const [slot, setSlot] = useState<'A' | 'B'>('A');
  const { dialogRef, requestClose } = useNativeModalDialog(isOpen, onClose);
  const titleId = useId(), searchId = useId();
  useEffect(() => { if (isOpen) { setSlot('A'); setSearch(''); setLane('All'); } }, [isOpen]);
  const ranked = useMemo(() => new Set(recommendedOpeners.map(hero => hero.hero_id)), [recommendedOpeners]);
  const filtered = useMemo(() => {
    const rows = heroes.filter(hero => !onlyGlobalReleased || isHeroGlobalReleased(hero))
      .filter(hero => lane === 'All' || hero.lanes.includes(lane) || hero.primary_lane === lane);
    return searchHeroes(rows, deferredSearch, (a, b) => Number(ranked.has(b.hero_id)) - Number(ranked.has(a.hero_id)) || a.name.localeCompare(b.name));
  }, [heroes, onlyGlobalReleased, lane, deferredSearch, ranked]);
  if (!isOpen) return null;
  const choose = (hero: Hero) => {
    if (unavailableHeroIds.has(hero.hero_id)) return;
    if (slot === 'A') { if (currentPlanBId === hero.hero_id) onSelectPlanB(null); onSelectPlanA(hero.hero_id); setSlot('B'); }
    else { if (currentPlanAId === hero.hero_id) onSelectPlanA(null); onSelectPlanB(hero.hero_id); }
  };
  return <dialog ref={dialogRef} aria-labelledby={titleId} closedby="any" className="plan-dialog">
      <header className="dialog-header">
        <div className="section-heading">
          <span className="section-heading__icon"><SlidersHorizontal aria-hidden="true" /></span>
          <div>
            <h2 id={titleId}>{activeSide === 'blue' ? 'Atur Plan A/B' : 'Atur Strategi Red'}</h2>
            <p>
              {activeSide === 'blue'
                ? 'Tim Blue · Target first-pick B1 & cadangan proaktif'
                : 'Tim Red · Target respon R1 kontra B1 & cadangan sinergi'}
            </p>
          </div>
        </div>
        <button type="button" className="ui-icon-button" onClick={requestClose} aria-label="Tutup pengaturan rencana" title="Tutup">
          <X aria-hidden="true" />
        </button>
      </header>
      <div className="plan-dialog__selection" role="group" aria-label="Pilih slot rencana">
        {[
          {
            key: 'A' as const,
            id: currentPlanAId,
            clear: onSelectPlanA,
            label: activeSide === 'blue' ? 'Plan A · Utama B1' : 'Target R1 · Kontra B1',
          },
          {
            key: 'B' as const,
            id: currentPlanBId,
            clear: onSelectPlanB,
            label: activeSide === 'blue' ? 'Plan B · Cadangan' : 'Target R2 · Sinergi/R5',
          },
        ].map((plan) => {
          const hero = heroes.find((value) => value.hero_id === plan.id);
          return (
            <div key={plan.key} className={'plan-slot' + (slot === plan.key ? ' is-selected' : '')}>
              <button type="button" onClick={() => setSlot(plan.key)} aria-pressed={slot === plan.key}>
                {hero ? <HeroThumbnail hero={hero} /> : <Target aria-hidden="true" />}
                <span>
                  <small>{plan.label}</small>
                  <strong>{hero?.name ?? 'Belum ditentukan'}</strong>
                </span>
                {slot === plan.key && <CheckCircle2 aria-hidden="true" />}
              </button>
              <button
                type="button"
                className="ui-icon-button"
                aria-label={'Hapus Plan ' + plan.key}
                title={'Hapus Plan ' + plan.key}
                disabled={!hero}
                onClick={() => plan.clear(null)}
              >
                <X aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
      <p className="plan-dialog__instruction" role="status">
        <Target aria-hidden="true" />
        {activeSide === 'blue'
          ? `Pilih hero untuk Plan ${slot}.`
          : `Pilih hero target ${slot === 'A' ? 'R1 (Kontra B1)' : 'R2 (Sinergi / R5)'}.`}
      </p>
      <div className="plan-dialog__filters"><div className="search-field"><Search aria-hidden="true" /><label htmlFor={searchId} className="sr-only">Cari hero untuk rencana</label><input id={searchId} autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder="Cari hero pembuka…" autoComplete="off" />{search && <button type="button" aria-label="Hapus pencarian rencana" onClick={() => setSearch('')}><X aria-hidden="true" /></button>}</div><DropdownSelect<Lane | 'All'> label="Filter lane rencana" leadingIcon={<LaneIcon lane={lane} />} value={lane} onChange={setLane} options={(['All', 'Clash', 'Jungle', 'Mid', 'Farm', 'Roam'] as const).map(value => ({ value, label: value === 'All' ? 'Semua lane' : value, icon: <LaneIcon lane={value} /> }))} /></div>
      <div className="plan-dialog__roster">{filtered.length ? filtered.map(hero => {
        const selected = (slot === 'A' ? currentPlanAId : currentPlanBId) === hero.hero_id;
        const locked = unavailableHeroIds.has(hero.hero_id);
        return <button type="button" key={hero.hero_id} className={'plan-hero-row' + (selected ? ' is-selected' : '')} aria-pressed={selected} disabled={locked} onClick={() => choose(hero)}><HeroThumbnail hero={hero} /><span><strong>{hero.name}</strong><small><LaneLabel lane={hero.primary_lane} /> · Pop {hero.popularity_band ?? '—'}</small></span>{locked ? <LockKeyhole aria-label="Hero tidak tersedia" /> : selected ? <Check aria-label="Dipilih" /> : ranked.has(hero.hero_id) ? <Sparkles aria-label="Opener yang disarankan" /> : <Target aria-hidden="true" />}</button>;
      }) : <div className="empty-state"><Search aria-hidden="true" /><h3>Hero tidak ditemukan</h3><p>Coba nama lain atau ubah filter lane.</p></div>}</div>
      <footer className="dialog-footer">
        <p>
          <ShieldCheck aria-hidden="true" />
          {activeSide === 'blue'
            ? 'Plan B menjadi cadangan jika target utama di-ban atau di-counter.'
            : 'Red Side memprioritaskan Paket Respon Duet R1+R2 begitu B1 Blue terkunci.'}
        </p>
        <button type="button" className="ui-button ui-button--primary" onClick={requestClose}>
          <Check aria-hidden="true" />Selesai
        </button>
      </footer>
  </dialog>;
}
