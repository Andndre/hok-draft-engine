import React from 'react';
import { CheckCircle2, Globe, LoaderCircle, ShieldCheck } from 'lucide-react';
import type { ActiveTab } from '../types';
import { APP_NAVIGATION } from './ui/navigation';

interface Props {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  engineReady: boolean;
  onlyGlobalReleased: boolean;
  onToggleGlobalReleased: () => void;
  globalLocked?: boolean;
  favoriteCount: number;
}
export function HeaderSortBar({ activeTab, onTabChange, engineReady, onlyGlobalReleased, onToggleGlobalReleased, globalLocked = false, favoriteCount }: Props) {
  return <header className="app-header"><div className="app-header__inner">
    <a href="#main-content" className="app-brand" aria-label="HoK Draft Engine, menuju konten"><span className="app-brand__mark"><ShieldCheck aria-hidden="true" /></span><span><strong>HOK DRAFT ENGINE</strong><small>Draft, counter & wiki Global</small></span></a>
    <nav className="desktop-navigation" aria-label="Navigasi utama">{APP_NAVIGATION.map(({ id, label, icon: Icon }) => <button type="button" key={id} onClick={() => onTabChange(id)} aria-current={activeTab === id ? 'page' : undefined}><Icon aria-hidden="true" /><span>{label}</span>{id === 'favorites' && favoriteCount > 0 && <span className="navigation-count">{favoriteCount}</span>}</button>)}</nav>
    <div className="app-header__actions"><span className="data-status">{engineReady ? <CheckCircle2 aria-hidden="true" /> : <LoaderCircle className="is-spinning" aria-hidden="true" />}<span>{engineReady ? 'Data siap' : 'Memuat data'}</span></span>
      <button type="button" className="global-filter" disabled={globalLocked} aria-pressed={onlyGlobalReleased} aria-label={onlyGlobalReleased ? 'Filter hero Global aktif' : 'Tampilkan hero Global dan CN'} title={globalLocked ? 'Latihan memakai roster Global' : 'Ganti filter rilis Global'} onClick={onToggleGlobalReleased}><Globe aria-hidden="true" /><span>{onlyGlobalReleased ? 'Global' : 'Global + CN'}</span></button>
    </div>
  </div></header>;
}
