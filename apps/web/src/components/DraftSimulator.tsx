import React from 'react';
import { Hero } from '../types';
import { RotateCcw, ShieldCheck, Flame, Undo2 } from 'lucide-react';

interface DraftSimulatorProps {
  bluePicks: Array<Hero | null>;
  redPicks: Array<Hero | null>;
  blueBans: Array<Hero | null>;
  redBans: Array<Hero | null>;
  currentTurn: {
    side: 'blue' | 'red';
    action: 'pick' | 'ban';
    stepIndex: number;
  };
  fearlessEnabled: boolean;
  onToggleFearless: (val: boolean) => void;
  gameNumber: number;
  onGameNumberChange: (n: number) => void;
  onResetDraft: () => void;
  onUndoStep: () => void;
  onSelectSlot: (side: 'blue' | 'red', action: 'pick' | 'ban', index: number) => void;
}

export const DraftSimulator: React.FC<DraftSimulatorProps> = ({
  bluePicks,
  redPicks,
  blueBans,
  redBans,
  currentTurn,
  fearlessEnabled,
  onToggleFearless,
  gameNumber,
  onGameNumberChange,
  onResetDraft,
  onUndoStep,
}) => {
  return (
    <div className="bg-[#12161F] border border-[#232A38] rounded-2xl p-4 shadow-xl flex flex-col gap-4">
      {/* Draft Control Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#232A38]">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-[#3B82F6]/10 text-[#3B82F6]">
            <Flame className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-extrabold text-sm text-white">
              TOURNAMENT DRAFT SIMULATOR
            </h3>
            <p className="text-[11px] text-slate-400">
              Pro Step-by-Step Ban/Pick Sequence
            </p>
          </div>
        </div>

        {/* Global BP / Fearless Draft Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => onToggleFearless(!fearlessEnabled)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
              fearlessEnabled
                ? 'bg-[#B8FF01] text-black border-[#B8FF01] shadow-[0_0_10px_rgba(184,255,1,0.25)]'
                : 'bg-[#1A202C] text-slate-400 border-[#232A38] hover:text-white'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Fearless Draft (Global BP)</span>
          </button>

          {fearlessEnabled && (
            <div className="flex items-center bg-[#1A202C] px-2 py-1 rounded-lg border border-[#232A38] text-xs font-mono">
              <span className="text-slate-400 mr-1.5">Game:</span>
              {[1, 2, 3, 4, 5].map((g) => (
                <button
                  key={g}
                  onClick={() => onGameNumberChange(g)}
                  className={`w-5 h-5 rounded flex items-center justify-center font-bold text-xs ${
                    gameNumber === g ? 'bg-[#B8FF01] text-black' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
          )}

          <button
            onClick={onUndoStep}
            className="p-1.5 bg-[#1A202C] hover:bg-[#232A38] text-slate-300 rounded-lg border border-[#232A38] transition-all"
            title="Undo Step"
          >
            <Undo2 className="w-4 h-4" />
          </button>

          <button
            onClick={onResetDraft}
            className="p-1.5 bg-[#1A202C] hover:bg-[#232A38] text-rose-400 rounded-lg border border-[#232A38] transition-all"
            title="Reset Draft"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main 5v5 Board Layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Blue Side */}
        <div className="flex flex-col gap-2.5 bg-[#0A0D12] p-3 rounded-xl border border-[#3B82F6]/30">
          <div className="flex items-center justify-between pb-1 border-b border-[#232A38]">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#3B82F6] animate-pulse" />
              <span className="font-extrabold text-xs sm:text-sm text-[#3B82F6] tracking-wide">
                BLUE SIDE (FIRST PICK)
              </span>
            </div>
            {/* Bans Bar */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase font-mono text-slate-500 mr-1">Bans</span>
              {blueBans.map((hero, idx) => (
                <div
                  key={idx}
                  className="w-7 h-7 rounded-md bg-[#12161F] border border-rose-900/40 overflow-hidden flex items-center justify-center relative"
                >
                  {hero ? (
                    <img
                      src={hero.portrait_asset}
                      alt={hero.name}
                      className="w-full h-full object-cover grayscale opacity-75"
                    />
                  ) : (
                    <span className="text-[10px] text-slate-600 font-mono">B{idx + 1}</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Picks List */}
          <div className="flex flex-col gap-2">
            {bluePicks.map((hero, idx) => {
              const isCurrent =
                currentTurn.side === 'blue' &&
                currentTurn.action === 'pick' &&
                bluePicks.findIndex((p) => p === null) === idx;

              return (
                <div
                  key={idx}
                  className={`flex items-center gap-3 p-2 rounded-xl border transition-all ${
                    isCurrent
                      ? 'bg-[#1A202C] border-[#3B82F6] ring-1 ring-[#3B82F6]'
                      : hero
                      ? 'bg-[#12161F] border-[#232A38]'
                      : 'bg-[#0D1017] border-dashed border-[#232A38]/80 opacity-60'
                  }`}
                >
                  <div className="w-10 h-10 rounded-lg bg-[#1A202C] overflow-hidden flex-shrink-0 flex items-center justify-center border border-[#232A38]">
                    {hero ? (
                      <img src={hero.portrait_asset} alt={hero.name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-xs font-mono font-bold text-slate-600">P{idx + 1}</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h5 className="font-bold text-xs sm:text-sm text-slate-100 truncate">
                      {hero ? hero.name : isCurrent ? 'Memilih Hero...' : `Blue Pick #${idx + 1}`}
                    </h5>
                    <p className="text-[10px] text-slate-400 truncate">
                      {hero ? `${hero.primary_role} · ${hero.primary_lane}` : 'Menunggu giliran'}
                    </p>
                  </div>
                  {hero && (
                    <span className="text-xs font-mono font-bold text-emerald-400">
                      {(hero.win_rate * 100).toFixed(1)}%
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Red Side */}
        <div className="flex flex-col gap-2.5 bg-[#0A0D12] p-3 rounded-xl border border-[#EF4444]/30">
          <div className="flex items-center justify-between pb-1 border-b border-[#232A38]">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#EF4444] animate-pulse" />
              <span className="font-extrabold text-xs sm:text-sm text-[#EF4444] tracking-wide">
                RED SIDE (COUNTER PICK)
              </span>
            </div>
            {/* Bans Bar */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase font-mono text-slate-500 mr-1">Bans</span>
              {redBans.map((hero, idx) => (
                <div
                  key={idx}
                  className="w-7 h-7 rounded-md bg-[#12161F] border border-rose-900/40 overflow-hidden flex items-center justify-center relative"
                >
                  {hero ? (
                    <img
                      src={hero.portrait_asset}
                      alt={hero.name}
                      className="w-full h-full object-cover grayscale opacity-75"
                    />
                  ) : (
                    <span className="text-[10px] text-slate-600 font-mono">B{idx + 1}</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Picks List */}
          <div className="flex flex-col gap-2">
            {redPicks.map((hero, idx) => {
              const isCurrent =
                currentTurn.side === 'red' &&
                currentTurn.action === 'pick' &&
                redPicks.findIndex((p) => p === null) === idx;

              return (
                <div
                  key={idx}
                  className={`flex items-center gap-3 p-2 rounded-xl border transition-all ${
                    isCurrent
                      ? 'bg-[#1A202C] border-[#EF4444] ring-1 ring-[#EF4444]'
                      : hero
                      ? 'bg-[#12161F] border-[#232A38]'
                      : 'bg-[#0D1017] border-dashed border-[#232A38]/80 opacity-60'
                  }`}
                >
                  <div className="w-10 h-10 rounded-lg bg-[#1A202C] overflow-hidden flex-shrink-0 flex items-center justify-center border border-[#232A38]">
                    {hero ? (
                      <img src={hero.portrait_asset} alt={hero.name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-xs font-mono font-bold text-slate-600">P{idx + 1}</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h5 className="font-bold text-xs sm:text-sm text-slate-100 truncate">
                      {hero ? hero.name : isCurrent ? 'Memilih Hero...' : `Red Pick #${idx + 1}`}
                    </h5>
                    <p className="text-[10px] text-slate-400 truncate">
                      {hero ? `${hero.primary_role} · ${hero.primary_lane}` : 'Menunggu giliran'}
                    </p>
                  </div>
                  {hero && (
                    <span className="text-xs font-mono font-bold text-emerald-400">
                      {(hero.win_rate * 100).toFixed(1)}%
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
