import React, { useEffect, useRef } from 'react';
import { Lane, ActiveTab } from '../types';
import {
  Search,
  Shield,
  Swords,
  Wand2,
  Crosshair,
  HeartHandshake,
  Bot,
  BookOpen,
  Star,
  Layers,
} from 'lucide-react';

interface BottomCommandDockProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  selectedLane: Lane | 'All';
  onLaneChange: (lane: Lane | 'All') => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  favoriteCount: number;
}

const LANES_CONFIG: Array<{ key: Lane | 'All'; label: string; icon: React.ReactNode }> = [
  { key: 'All', label: 'Semua', icon: <Layers className="w-3.5 h-3.5" /> },
  { key: 'Clash', label: 'Clash', icon: <Swords className="w-3.5 h-3.5" /> },
  { key: 'Jungle', label: 'Jungle', icon: <Crosshair className="w-3.5 h-3.5" /> },
  { key: 'Mid', label: 'Mid', icon: <Wand2 className="w-3.5 h-3.5" /> },
  { key: 'Farm', label: 'Farm', icon: <Shield className="w-3.5 h-3.5" /> },
  { key: 'Roam', label: 'Roam', icon: <HeartHandshake className="w-3.5 h-3.5" /> },
];

export const BottomCommandDock: React.FC<BottomCommandDockProps> = ({
  activeTab,
  onTabChange,
  selectedLane,
  onLaneChange,
  searchQuery,
  onSearchChange,
  favoriteCount,
}) => {
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Global keyboard shortcut '/' to focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement !== searchInputRef.current) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 glass-dock px-3 pt-2 pb-3 safe-area-pb shadow-[0_-8px_24px_rgba(0,0,0,0.6)]">
      <div className="max-w-4xl mx-auto flex flex-col gap-2">
        {/* Row 1: Role / Lane Filter Pills */}
        <div className="flex items-center justify-between gap-1 overflow-x-auto no-scrollbar py-0.5">
          {LANES_CONFIG.map((lane) => {
            const isActive = selectedLane === lane.key;
            return (
              <button
                key={lane.key}
                onClick={() => onLaneChange(lane.key)}
                className={`flex-1 min-w-[56px] flex flex-col items-center justify-center py-1 px-1.5 rounded-lg text-xs font-bold transition-all ${
                  isActive
                    ? 'bg-[#B8FF01] text-[#0A0D12] shadow-[0_0_10px_rgba(184,255,1,0.3)]'
                    : 'bg-[#1A202C]/60 text-slate-400 hover:text-slate-100 hover:bg-[#1A202C]'
                }`}
              >
                <span className="mb-0.5">{lane.icon}</span>
                <span className="text-[10px] tracking-tight">{lane.label}</span>
              </button>
            );
          })}
        </div>

        {/* Row 2: Instant Search Bar */}
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Cari hero musuh / counter... (Tekan '/' untuk cari)"
            className="w-full bg-[#1A202C] border border-[#232A38] focus:border-[#B8FF01] focus:ring-1 focus:ring-[#B8FF01] rounded-xl pl-9 pr-9 py-2 text-xs sm:text-sm text-slate-100 placeholder-slate-500 outline-none transition-all font-medium"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs px-1"
            >
              ✕
            </button>
          )}
        </div>

        {/* Row 3: 4 Navigation Tabs */}
        <div className="grid grid-cols-4 gap-1 pt-1 border-t border-[#232A38]/60">
          <button
            onClick={() => onTabChange('counter')}
            className={`flex flex-col items-center py-1 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'counter'
                ? 'text-[#B8FF01]'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Swords className="w-4 h-4 mb-0.5" />
            <span className="text-[11px]">Counter</span>
          </button>

          <button
            onClick={() => onTabChange('draft')}
            className={`flex flex-col items-center py-1 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'draft'
                ? 'text-[#B8FF01]'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Bot className="w-4 h-4 mb-0.5" />
            <span className="text-[11px]">Draft AI</span>
          </button>

          <button
            onClick={() => onTabChange('wiki')}
            className={`flex flex-col items-center py-1 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'wiki'
                ? 'text-[#B8FF01]'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <BookOpen className="w-4 h-4 mb-0.5" />
            <span className="text-[11px]">Wiki & Tier</span>
          </button>

          <button
            onClick={() => onTabChange('favorites')}
            className={`relative flex flex-col items-center py-1 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'favorites'
                ? 'text-[#B8FF01]'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Star className="w-4 h-4 mb-0.5" />
            <span className="text-[11px]">Favorit</span>
            {favoriteCount > 0 && (
              <span className="absolute top-0 right-5 w-4 h-4 rounded-full bg-[#B8FF01] text-black text-[9px] font-black flex items-center justify-center">
                {favoriteCount}
              </span>
            )}
          </button>
        </div>
      </div>
    </nav>
  );
};
