import React, { useDeferredValue, useEffect, useId, useMemo, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import type { Hero } from '../types';
import { isHeroGlobalReleased } from '../data/heroReleaseStatus';
import { HeroThumbnail } from './ui/AssetThumbnail';
import { useNativeModalDialog } from './ui/useNativeModalDialog';
import { searchHeroes } from '../heroSearch';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  heroes: Hero[];
  onSelect: (heroId: number) => void;
  onlyGlobalReleased?: boolean;
  unavailableHeroIds?: Set<number>;
  title?: string;
}

export function VisionHeroPickerModal({
  isOpen,
  onClose,
  heroes,
  onSelect,
  onlyGlobalReleased = true,
  unavailableHeroIds = new Set<number>(),
  title = 'Pilih hero untuk slot ini',
}: Props) {
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const { dialogRef, requestClose } = useNativeModalDialog(isOpen, onClose);
  const titleId = useId();
  const searchId = useId();

  useEffect(() => {
    if (isOpen) setSearch('');
  }, [isOpen]);

  const filtered = useMemo(() => {
    const rows = heroes.filter(hero => !onlyGlobalReleased || isHeroGlobalReleased(hero));
    return searchHeroes(rows, deferredSearch, (a, b) => a.name.localeCompare(b.name));
  }, [heroes, onlyGlobalReleased, deferredSearch]);

  if (!isOpen) return null;

  return (
    <dialog ref={dialogRef} aria-labelledby={titleId} closedby="any" className="plan-dialog">
        <header className="dialog-header">
          <div className="section-heading">
            <span className="section-heading__icon"><Search aria-hidden="true" /></span>
            <div>
              <h2 id={titleId}>{title}</h2>
              <p>Pilih hero manual saat deteksi otomatis dianggap gagal.</p>
            </div>
          </div>
          <button type="button" className="ui-icon-button" onClick={requestClose} aria-label="Tutup pemilihan hero" title="Tutup">
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="plan-dialog__filters">
          <div className="search-field">
            <Search aria-hidden="true" />
            <label htmlFor={searchId} className="sr-only">Cari hero</label>
            <input
              id={searchId}
              autoFocus
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Cari hero..."
              autoComplete="off"
            />
            {search && (
              <button type="button" aria-label="Hapus pencarian" onClick={() => setSearch('')}>
                <X aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
        <div className="plan-dialog__roster">
          {filtered.length ? filtered.map(hero => {
            const locked = unavailableHeroIds.has(hero.hero_id);
            return (
              <button
                type="button"
                key={hero.hero_id}
                className="plan-hero-row"
                disabled={locked}
                onClick={() => {
                  if (locked) return;
                  onSelect(hero.hero_id);
                }}
              >
                <HeroThumbnail hero={hero} />
                <span>
                  <strong>{hero.name}</strong>
                  <small>{hero.primary_role} · {hero.primary_lane}</small>
                </span>
                {locked ? <X aria-label="Hero tidak tersedia" /> : <Check aria-hidden="true" />}
              </button>
            );
          }) : (
            <div className="empty-state">
              <Search aria-hidden="true" />
              <h3>Hero tidak ditemukan</h3>
              <p>Coba nama lain.</p>
            </div>
          )}
        </div>
        <footer className="dialog-footer">
          <button type="button" className="ui-button ui-button--primary" onClick={requestClose}>
            <Check aria-hidden="true" />Selesai
          </button>
        </footer>
    </dialog>
  );
}