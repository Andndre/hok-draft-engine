import React from 'react';
import { SortMode, ViewMode } from '../types';
import { ArrowUpDown, LayoutGrid, List, Cpu, Sparkles, Globe } from 'lucide-react';

interface HeaderSortBarProps {
  hideAiSort?: boolean;
  globalLocked?: boolean;
  sortMode: SortMode;
  onSortChange: (mode: SortMode) => void;
  viewMode: ViewMode;
  onViewChange: (mode: ViewMode) => void;
  engineReady: boolean;
  engineLatency: number | null;
  totalFiltered: number;
  onlyGlobalReleased: boolean;
  onToggleGlobalReleased: () => void;
}

export const HeaderSortBar: React.FC<HeaderSortBarProps> = ({
  hideAiSort = false,
  globalLocked = false,
  sortMode,
  onSortChange,
  viewMode,
  onViewChange,
  engineReady,
  engineLatency,
  totalFiltered,
  onlyGlobalReleased,
  onToggleGlobalReleased,
}) => {
  return (
    <header className="sticky top-0 z-40 bg-[#0A0D12]/90 backdrop-blur-md border-b border-[#232A38] px-4 py-3">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
        {/* Brand & AI Engine Badge */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#B8FF01] to-[#F5C451] p-[1.5px] flex items-center justify-center">
              <div className="w-full h-full bg-[#0A0D12] rounded-[6px] flex items-center justify-center font-extrabold text-[#B8FF01] text-xs">
                HOK
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-sm sm:text-base tracking-tight text-white">
                  HOK DRAFT ENGINE
                </span>
                <span className="text-[10px] font-mono uppercase bg-[#1A202C] text-[#B8FF01] px-1.5 py-0.5 rounded border border-[#B8FF01]/30">
                  Global
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Mesin taktis lokal · {totalFiltered} Hero
              </p>
            </div>
          </div>

          {/* Model Status Pill */}
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#12161F] border border-[#232A38] text-[11px]">
            <Cpu className={`w-3.5 h-3.5 ${engineReady ? 'text-[#B8FF01]' : 'text-amber-400 animate-pulse'}`} />
            <span className="font-mono text-slate-300">
              {engineReady
                ? `Mesin lokal ${engineLatency !== null ? `(${engineLatency}ms)` : ''}`
                : 'Memuat Engine...'}
            </span>
          </div>
        </div>

        {/* Sorting & View Mode Controls */}
        <div className="flex items-center gap-2">
          {/* Global Only Server Filter Toggle */}
          <button
            disabled={globalLocked}
            onClick={onToggleGlobalReleased}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold rounded-lg border transition-all ${
              onlyGlobalReleased
                ? 'bg-emerald-950/70 border-emerald-500/60 text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.15)]'
                : 'bg-[#12161F] border-[#232A38] text-slate-400 hover:text-white'
            }`}
            title="Saring hero rilis server Global (matikan untuk memasukkan hero eksklusif CN/KPL)"
          >
            <Globe className={`w-3.5 h-3.5 ${onlyGlobalReleased ? 'text-emerald-400' : 'text-slate-400'}`} />
            <span className="hidden sm:inline">
              {onlyGlobalReleased ? 'Rilis Global (Aktif)' : 'Semua Hero (+CN)'}
            </span>
            <span className="sm:hidden">{onlyGlobalReleased ? 'Global' : 'All'}</span>
          </button>

          {/* Sort Buttons */}
          <div className="flex items-center bg-[#12161F] p-0.5 rounded-lg border border-[#232A38]">
            {!hideAiSort && <button
              onClick={() => onSortChange('ai')}
              className={`flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
                sortMode === 'ai'
                  ? 'bg-[#B8FF01] text-[#0A0D12] shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Urutkan berdasarkan rekomendasi taktis"
            >
              <Sparkles className="w-3 h-3" />
              <span>AI Score</span>
            </button>}

            <button
              onClick={() => onSortChange('win')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
                sortMode === 'win'
                  ? 'bg-[#B8FF01] text-[#0A0D12]'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Urutkan berdasarkan Win Rate Global"
            >
              Win %
            </button>

            <button
              onClick={() => onSortChange('pick')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
                sortMode === 'pick'
                  ? 'bg-[#B8FF01] text-[#0A0D12]'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Urutkan berdasarkan Pick Rate Global"
            >
              Pick %
            </button>

            <button
              onClick={() => onSortChange('az')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
                sortMode === 'az'
                  ? 'bg-[#B8FF01] text-[#0A0D12]'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Urutkan berdasarkan Alfabet A-Z"
            >
              A-Z
            </button>
          </div>

          {/* View Mode Toggle */}
          <div className="flex items-center bg-[#12161F] p-0.5 rounded-lg border border-[#232A38]">
            <button
              onClick={() => onViewChange('compact')}
              className={`p-1.5 rounded-md transition-all ${
                viewMode === 'compact'
                  ? 'bg-[#232A38] text-[#B8FF01]'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Kurohiko Compact View"
            >
              <List className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onViewChange('detailed')}
              className={`p-1.5 rounded-md transition-all ${
                viewMode === 'detailed'
                  ? 'bg-[#232A38] text-[#B8FF01]'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="HOKFIRE Detailed View"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
