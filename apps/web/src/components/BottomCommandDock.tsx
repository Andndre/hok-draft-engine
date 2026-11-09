import React from 'react';
import type { ActiveTab } from '../types';
import { APP_NAVIGATION } from './ui/navigation';
export function BottomCommandDock({ activeTab, onTabChange, favoriteCount }: { activeTab: ActiveTab; onTabChange: (tab: ActiveTab) => void; favoriteCount: number }) {
  return <nav className="mobile-navigation" aria-label="Navigasi utama seluler">{APP_NAVIGATION.map(({ id, label, icon: Icon }) => <button type="button" key={id} onClick={() => onTabChange(id)} aria-current={activeTab === id ? 'page' : undefined}><span className="mobile-navigation__icon"><Icon aria-hidden="true" />{id === 'favorites' && favoriteCount > 0 && <span className="navigation-count">{favoriteCount}</span>}</span><span>{label}</span></button>)}</nav>;
}
