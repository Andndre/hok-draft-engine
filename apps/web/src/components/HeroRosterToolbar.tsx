import { DropdownSelect } from './ui/DropdownSelect';
import React, { useEffect, useRef } from 'react';
import { ArrowDownAZ, ChartColumn, Crosshair, FilterX, HeartHandshake, Layers, LayoutGrid, List, Search, Shield, Sparkles, Swords, TrendingUp, Wand2, X } from 'lucide-react';
import type { Lane, SortMode, ViewMode } from '../types';

interface Props {
  title?: string;
  count: number;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  selectedLane: Lane | 'All';
  onLaneChange: (lane: Lane | 'All') => void;
  sortMode: SortMode;
  onSortChange: (mode: SortMode) => void;
  viewMode: ViewMode;
  onViewChange: (mode: ViewMode) => void;
  hideAiSort?: boolean;
  active?: boolean;
}
const lanes = [
  { id: 'All', name: 'Semua', icon: Layers }, { id: 'Clash', name: 'Clash', icon: Swords },
  { id: 'Jungle', name: 'Jungle', icon: Crosshair }, { id: 'Mid', name: 'Mid', icon: Wand2 },
  { id: 'Farm', name: 'Farm', icon: Shield }, { id: 'Roam', name: 'Roam', icon: HeartHandshake },
] as const;
export function HeroRosterToolbar({ title = 'Pilih hero', count, searchQuery, onSearchChange, selectedLane, onLaneChange, sortMode, onSortChange, viewMode, onViewChange, hideAiSort = false, active = true }: Props) {
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!active) return;
    const shortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !target?.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]')) {
        event.preventDefault(); search.current?.focus();
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [active]);
  const effectiveSort = hideAiSort && sortMode === 'ai' ? 'az' : sortMode;
  const SortIcon = { ai: Sparkles, win: TrendingUp, pick: ChartColumn, az: ArrowDownAZ }[effectiveSort];
  const reset = () => { onSearchChange(''); onLaneChange('All'); search.current?.focus(); };
  return <div className="roster-toolbar" aria-label="Pencarian dan filter hero">
    <div className="roster-toolbar__heading"><h2>{title} <span className="count-badge">{count}</span></h2>
      <div className="view-switch" role="group" aria-label="Tampilan hero">
        <button type="button" aria-label="Tampilan daftar" aria-pressed={viewMode === 'compact'} title="Tampilan daftar" onClick={() => onViewChange('compact')}><List aria-hidden="true" /></button>
        <button type="button" aria-label="Tampilan kartu" aria-pressed={viewMode === 'detailed'} title="Tampilan kartu" onClick={() => onViewChange('detailed')}><LayoutGrid aria-hidden="true" /></button>
      </div>
    </div>
    <div className="roster-toolbar__search-row">
      <div className="search-field"><Search aria-hidden="true" /><label className="sr-only" htmlFor={active ? 'hero-search' : undefined}>Cari hero</label>
        <input ref={search} id={active ? 'hero-search' : undefined} type="search" autoComplete="off" value={searchQuery} onChange={event => onSearchChange(event.target.value)} placeholder="Cari nama hero atau counter…" />
        {searchQuery ? <button type="button" aria-label="Hapus pencarian" title="Hapus pencarian" onClick={() => { onSearchChange(''); search.current?.focus(); }}><X aria-hidden="true" /></button> : <kbd aria-hidden="true">/</kbd>}
      </div>
      <DropdownSelect<SortMode> label="Urutkan hero" value={effectiveSort} onChange={onSortChange} icon={SortIcon}
        options={[...(!hideAiSort ? [{ value: 'ai' as const, label: 'Skor AI' }] : []), { value: 'win', label: 'Win rate' }, { value: 'pick', label: 'Pick rate' }, { value: 'az', label: 'Nama A–Z' }]} />
    </div>
    <div className="lane-filter" role="group" aria-label="Filter lane">{lanes.map(({ id, name, icon: Icon }) => <button type="button" key={id} aria-pressed={selectedLane === id} onClick={() => onLaneChange(id)}><Icon aria-hidden="true" /><span>{name}</span></button>)}</div>
    {(searchQuery || selectedLane !== 'All') && <button type="button" className="filter-reset" onClick={reset}><FilterX aria-hidden="true" />Bersihkan filter</button>}
  </div>;
}
