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
    isComplete?: boolean;
  };
  fearlessEnabled: boolean;
  onToggleFearless: (val: boolean) => void;
  gameNumber: number;
  onGameNumberChange: (n: number) => void;
  onResetDraft: () => void;
  onUndoStep: () => void;
  onSelectSlot: (side: 'blue' | 'red', action: 'pick' | 'ban', index: number) => void;
  blueFearlessUsedHeroes?: Hero[];
  redFearlessUsedHeroes?: Hero[];
}

const TOURNAMENT_PHASES = [
  { id: 'BAN_1', label: '1. Ban Fase 1', sub: 'Ban Counter Meta Opener', start: 0, end: 3, isBan: true },
  { id: 'PICK_1', label: '2. Pick Fase 1', sub: 'Amankan Opener & Core (3v3)', start: 4, end: 9, isBan: false },
  { id: 'BAN_2', label: '3. Ban Fase 2', sub: 'Putus Kombo di Lane Kosong', start: 10, end: 13, isBan: true },
  { id: 'PICK_2', label: '4. Pick Fase 2', sub: 'Counter & Tutup Lane (2v2)', start: 14, end: 17, isBan: false },
];

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
  blueFearlessUsedHeroes = [],
  redFearlessUsedHeroes = [],
}) => {
  const activeBlueBanIdx =
    !currentTurn.isComplete && currentTurn.side === 'blue' && currentTurn.action === 'ban'
      ? blueBans.findIndex((b) => b === null)
      : -1;
  const activeRedBanIdx =
    !currentTurn.isComplete && currentTurn.side === 'red' && currentTurn.action === 'ban'
      ? redBans.findIndex((b) => b === null)
      : -1;

  return (
    <div className="bg-[#12161F] border border-[#232A38] rounded-2xl p-4 shadow-xl flex flex-col gap-3.5">
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
              KPL / KIC 4-Phase Global Ban & Pick Sequence (Langkah {Math.min(18, currentTurn.stepIndex + 1)}/18)
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

      {/* 4-Phase Tournament Progress Stepper */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {TOURNAMENT_PHASES.map((p) => {
          const isActive =
            !currentTurn.isComplete &&
            currentTurn.stepIndex >= p.start &&
            currentTurn.stepIndex <= p.end;
          const isDone = currentTurn.stepIndex > p.end;

          return (
            <div
              key={p.id}
              className={`px-2.5 py-1.5 rounded-xl border text-left transition-all ${
                isActive
                  ? p.isBan
                    ? 'bg-rose-950/50 border-rose-500 ring-1 ring-rose-500/50'
                    : 'bg-[#1A2410] border-[#B8FF01] ring-1 ring-[#B8FF01]/50'
                  : isDone
                  ? 'bg-[#0D1017] border-[#232A38] opacity-60'
                  : 'bg-[#0A0D12] border-[#1E2430] opacity-50'
              }`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`text-[11px] font-extrabold ${
                    isActive
                      ? p.isBan
                        ? 'text-rose-400'
                        : 'text-[#B8FF01]'
                      : isDone
                      ? 'text-slate-400'
                      : 'text-slate-500'
                  }`}
                >
                  {p.label}
                </span>
                {isActive && (
                  <span
                    className={`w-2 h-2 rounded-full animate-ping ${
                      p.isBan ? 'bg-rose-400' : 'bg-[#B8FF01]'
                    }`}
                  />
                )}
              </div>
              <p className="text-[9px] text-slate-400 truncate mt-0.5">{p.sub}</p>
            </div>
          );
        })}
      </div>

      {/* Main 5v5 Board Layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Blue Side */}
        <div className="flex flex-col gap-2.5 bg-[#0A0D12] p-3 rounded-xl border border-[#3B82F6]/30">
          <div className="flex items-center justify-between pb-1.5 border-b border-[#232A38]">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#3B82F6] animate-pulse" />
              <span className="font-extrabold text-xs sm:text-sm text-[#3B82F6] tracking-wide">
                BLUE SIDE (FIRST PICK)
              </span>
            </div>
            {/* Bans Bar (Phase 1: B1, B2 | Phase 2: B3, B4) */}
            <div className="flex items-center gap-1">
              <span className="text-[10px] uppercase font-mono text-slate-500 mr-1">Bans</span>
              {blueBans.map((hero, idx) => {
                const isActiveBan = activeBlueBanIdx === idx;
                return (
                  <React.Fragment key={idx}>
                    {idx === 2 && <div className="w-1 h-4 border-l border-slate-700 mx-0.5" title="Ban Phase 2" />}
                    <div
                      className={`w-7 h-7 rounded-md bg-[#12161F] overflow-hidden flex items-center justify-center relative transition-all ${
                        isActiveBan
                          ? 'border-2 border-rose-500 ring-2 ring-rose-500/40 scale-105'
                          : 'border border-rose-900/40'
                      }`}
                    >
                      {hero ? (
                        <img
                          src={hero.portrait_asset}
                          alt={hero.name}
                          title={`Banned: ${hero.name}`}
                          className="w-full h-full object-cover grayscale opacity-75"
                        />
                      ) : (
                        <span
                          className={`text-[10px] font-mono font-bold ${
                            isActiveBan ? 'text-rose-400 animate-pulse' : 'text-slate-600'
                          }`}
                        >
                          B{idx + 1}
                        </span>
                      )}
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          {/* Picks List */}
          <div className="flex flex-col gap-2">
            {bluePicks.map((hero, idx) => {
              const isCurrent =
                !currentTurn.isComplete &&
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
                      <span className="text-xs font-mono font-bold text-slate-600">B{idx + 1}</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h5 className="font-bold text-xs sm:text-sm text-slate-100 truncate">
                      {hero
                        ? hero.name
                        : isCurrent
                        ? 'Giliran Blue Pick...'
                        : idx < 3
                        ? `Blue Pick #${idx + 1} (Fase 1)`
                        : `Blue Pick #${idx + 1} (Fase 2)`}
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

          {/* Fearless Locked Heroes for Blue */}
          {fearlessEnabled && blueFearlessUsedHeroes.length > 0 && (
            <div className="pt-2 border-t border-[#232A38]/70 flex flex-col gap-1">
              <span className="text-[10px] text-slate-400 font-mono flex items-center justify-between">
                <span>Terkunci Fearless Blue ({blueFearlessUsedHeroes.length} hero):</span>
                <span className="text-[9px] text-slate-500">Game sebelumnya</span>
              </span>
              <div className="flex flex-wrap gap-1">
                {blueFearlessUsedHeroes.map((h) => (
                  <div key={h.hero_id} className="relative group">
                    <img
                      src={h.portrait_asset}
                      alt={h.name}
                      title={`${h.name} (Terkunci untuk Blue - sudah dipakai di game sebelumnya)`}
                      className="w-6 h-6 rounded-md object-cover grayscale border border-blue-900/60 opacity-60 hover:opacity-100 hover:scale-110 transition-all"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Red Side */}
        <div className="flex flex-col gap-2.5 bg-[#0A0D12] p-3 rounded-xl border border-[#EF4444]/30">
          <div className="flex items-center justify-between pb-1.5 border-b border-[#232A38]">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#EF4444] animate-pulse" />
              <span className="font-extrabold text-xs sm:text-sm text-[#EF4444] tracking-wide">
                RED SIDE (COUNTER PICK)
              </span>
            </div>
            {/* Bans Bar (Phase 1: B1, B2 | Phase 2: B3, B4) */}
            <div className="flex items-center gap-1">
              <span className="text-[10px] uppercase font-mono text-slate-500 mr-1">Bans</span>
              {redBans.map((hero, idx) => {
                const isActiveBan = activeRedBanIdx === idx;
                return (
                  <React.Fragment key={idx}>
                    {idx === 2 && <div className="w-1 h-4 border-l border-slate-700 mx-0.5" title="Ban Phase 2" />}
                    <div
                      className={`w-7 h-7 rounded-md bg-[#12161F] overflow-hidden flex items-center justify-center relative transition-all ${
                        isActiveBan
                          ? 'border-2 border-rose-500 ring-2 ring-rose-500/40 scale-105'
                          : 'border border-rose-900/40'
                      }`}
                    >
                      {hero ? (
                        <img
                          src={hero.portrait_asset}
                          alt={hero.name}
                          title={`Banned: ${hero.name}`}
                          className="w-full h-full object-cover grayscale opacity-75"
                        />
                      ) : (
                        <span
                          className={`text-[10px] font-mono font-bold ${
                            isActiveBan ? 'text-rose-400 animate-pulse' : 'text-slate-600'
                          }`}
                        >
                          B{idx + 1}
                        </span>
                      )}
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          {/* Picks List */}
          <div className="flex flex-col gap-2">
            {redPicks.map((hero, idx) => {
              const isCurrent =
                !currentTurn.isComplete &&
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
                      <span className="text-xs font-mono font-bold text-slate-600">R{idx + 1}</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h5 className="font-bold text-xs sm:text-sm text-slate-100 truncate">
                      {hero
                        ? hero.name
                        : isCurrent
                        ? 'Giliran Red Pick...'
                        : idx < 3
                        ? `Red Pick #${idx + 1} (Fase 1)`
                        : idx === 4
                        ? `Red Pick #5 (Last Counter R5)`
                        : `Red Pick #${idx + 1} (Fase 2)`}
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

          {/* Fearless Locked Heroes for Red */}
          {fearlessEnabled && redFearlessUsedHeroes.length > 0 && (
            <div className="pt-2 border-t border-[#232A38]/70 flex flex-col gap-1">
              <span className="text-[10px] text-slate-400 font-mono flex items-center justify-between">
                <span>Terkunci Fearless Red ({redFearlessUsedHeroes.length} hero):</span>
                <span className="text-[9px] text-slate-500">Game sebelumnya</span>
              </span>
              <div className="flex flex-wrap gap-1">
                {redFearlessUsedHeroes.map((h) => (
                  <div key={h.hero_id} className="relative group">
                    <img
                      src={h.portrait_asset}
                      alt={h.name}
                      title={`${h.name} (Terkunci untuk Red - sudah dipakai di game sebelumnya)`}
                      className="w-6 h-6 rounded-md object-cover grayscale border border-rose-900/60 opacity-60 hover:opacity-100 hover:scale-110 transition-all"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
