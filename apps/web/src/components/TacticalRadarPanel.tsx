import React from 'react';
import { Hero, TacticalVector, TacticalDelta } from '../types';
import { TournamentPhaseStrategy } from '../engine/jevInference';
import { Sparkles, TrendingUp, TrendingDown, Minus, ShieldAlert, Crosshair, CheckCircle2 } from 'lucide-react';

interface TacticalRadarPanelProps {
  scores: TacticalVector;
  deltas?: TacticalDelta[];
  primaryInsight?: string;
  phaseStrategy?: TournamentPhaseStrategy;
  targetFirstPickId?: number | null;
  onChangeTargetFirstPick?: (heroId: number | null) => void;
  recommendations: Array<{
    hero: Hero;
    probability: number;
    choiceScore: number;
    proComboTag?: string;
    laneTag?: string;
  }>;
  onSelectCandidate: (hero: Hero) => void;
  activeSide: 'blue' | 'red';
  isPickPhase: boolean;
}

const TACTICAL_AXES: Array<{
  key: keyof TacticalVector;
  label: string;
  color: string;
  barColor: string;
}> = [
  { key: 'win_probability', label: 'Win Probability', color: 'text-emerald-400', barColor: 'bg-emerald-500' },
  { key: 'early_game_pressure', label: 'Early Pressure', color: 'text-amber-400', barColor: 'bg-amber-500' },
  { key: 'cc_chain_lockdown', label: 'CC Chain Lockdown', color: 'text-indigo-400', barColor: 'bg-indigo-500' },
  { key: 'frontline_durability', label: 'Frontline Durability', color: 'text-sky-400', barColor: 'bg-sky-500' },
  { key: 'enemy_carry_shutdown', label: 'Carry Shutdown', color: 'text-rose-400', barColor: 'bg-rose-500' },
  { key: 'draft_flexibility', label: 'Flexibility', color: 'text-lime-400', barColor: 'bg-lime-500' },
];

export const TacticalRadarPanel: React.FC<TacticalRadarPanelProps> = ({
  scores,
  deltas,
  primaryInsight,
  phaseStrategy,
  targetFirstPickId,
  onChangeTargetFirstPick,
  recommendations,
  onSelectCandidate,
  activeSide,
  isPickPhase,
}) => {
  const winRatePercent = Math.round(scores.win_probability * 100);

  return (
    <div className="bg-[#12161F] border border-[#232A38] rounded-2xl p-4 flex flex-col gap-4 shadow-xl">
      {/* Header: Tactical Dimension Gauge */}
      <div className="flex items-center justify-between pb-3 border-b border-[#232A38]">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-[#B8FF01]/10 text-[#B8FF01]">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-white flex items-center gap-2">
              JEV SYSTEM ONE EVALUATOR
              <span
                className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded font-black ${
                  activeSide === 'blue'
                    ? 'bg-blue-950 text-blue-400 border border-blue-800/40'
                    : 'bg-red-950 text-red-400 border border-red-800/40'
                }`}
              >
                {activeSide.toUpperCase()} SIDE {isPickPhase ? 'PICK' : 'BAN'}
              </span>
            </h3>
            <p className="text-[11px] text-slate-400">
              4-Phase Pro Tournament BP Strategy & 6-Axis Neural Matrix
            </p>
          </div>
        </div>

        {/* Win Probability Dial */}
        <div className="flex flex-col items-end font-mono-numbers">
          <span className="text-[10px] uppercase text-slate-400 font-semibold tracking-wider">Win Prob</span>
          <span
            className={`text-2xl font-black ${
              winRatePercent >= 52 ? 'text-[#10B981]' : winRatePercent >= 48 ? 'text-slate-100' : 'text-[#F43F5E]'
            }`}
          >
            {winRatePercent}%
          </span>
        </div>
      </div>

      {/* 4-Phase Tournament Strategy Box */}
      {phaseStrategy && (
        <div className="bg-[#0D111A] border border-[#2A3346] rounded-xl p-3 flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Crosshair className="w-3.5 h-3.5 text-[#B8FF01]" />
              <span className="text-[11px] font-extrabold tracking-wide text-[#B8FF01] uppercase">
                {phaseStrategy.phaseTitle}
              </span>
            </div>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#1A202C] text-slate-300 border border-[#232A38]">
              {phaseStrategy.phaseId.replace(/_/g, ' ')}
            </span>
          </div>

          <p className="text-xs text-slate-200 leading-relaxed">
            {phaseStrategy.phaseObjective}
          </p>

          {/* Phase 1 Target First-Pick Opener Selector */}
          {(phaseStrategy.phaseId === 'BAN_PHASE_1' || phaseStrategy.phaseId === 'PICK_PHASE_1') &&
            phaseStrategy.candidateOpeners.length > 0 && (
              <div className="pt-1.5 border-t border-[#232A38]/80 flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span className="font-semibold uppercase tracking-wider">
                    🎯 Rencana First-Pick Kita (Klik utk ganti target ban counter):
                  </span>
                  {targetFirstPickId && onChangeTargetFirstPick && (
                    <button
                      onClick={() => onChangeTargetFirstPick(null)}
                      className="text-[#B8FF01] hover:underline font-mono"
                    >
                      Auto AI
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {phaseStrategy.candidateOpeners.map((op) => {
                    const isSelected = phaseStrategy.plannedOpener?.hero_id === op.hero_id;
                    return (
                      <button
                        key={op.hero_id}
                        onClick={() => onChangeTargetFirstPick && onChangeTargetFirstPick(op.hero_id)}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-bold transition-all border ${
                          isSelected
                            ? 'bg-[#B8FF01] text-black border-[#B8FF01] shadow-[0_0_8px_rgba(184,255,1,0.25)]'
                            : 'bg-[#151A26] text-slate-300 border-[#232A38] hover:border-slate-500'
                        }`}
                      >
                        <img
                          src={op.portrait_asset}
                          alt={op.name}
                          className="w-4 h-4 rounded-full object-cover"
                        />
                        <span>{op.name}</span>
                        <span className={`text-[9px] font-mono ${isSelected ? 'text-black/75' : 'text-slate-400'}`}>
                          {op.primary_lane}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {phaseStrategy.bannedOpenerCounters.length > 0 && (
                  <div className="flex items-center gap-1.5 text-[10px] text-emerald-400 font-medium pt-0.5">
                    <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>
                      Counter {phaseStrategy.plannedOpener?.name} yang sudah di-ban:{' '}
                      <strong>{phaseStrategy.bannedOpenerCounters.join(', ')}</strong>
                    </span>
                  </div>
                )}
              </div>
            )}

          {/* Phase 2 Lane Vacancy Indicator */}
          {(phaseStrategy.phaseId === 'BAN_PHASE_2' || phaseStrategy.phaseId === 'PICK_PHASE_2') && (
            <div className="pt-1.5 border-t border-[#232A38]/80 flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono">
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400">Lane Kosong Musuh:</span>
                {phaseStrategy.enemyVacantLanes.map((l) => (
                  <span
                    key={l}
                    className="px-1.5 py-0.5 rounded bg-rose-950/90 text-rose-300 border border-rose-800/50 font-bold"
                  >
                    {l}
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400">Lane Kosong Kita:</span>
                {phaseStrategy.ourVacantLanes.map((l) => (
                  <span
                    key={l}
                    className="px-1.5 py-0.5 rounded bg-emerald-950/90 text-emerald-300 border border-emerald-800/50 font-bold"
                  >
                    {l}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Secondary Delta / Last Action Insight Banner */}
      {primaryInsight && (
        <div className="bg-[#1A202C] border-l-4 border-[#B8FF01] p-2.5 rounded-r-xl flex items-start gap-2">
          <ShieldAlert className="w-4 h-4 text-[#B8FF01] mt-0.5 flex-shrink-0" />
          <p className="text-[11px] text-slate-200 leading-relaxed font-medium">
            {primaryInsight}
          </p>
        </div>
      )}

      {/* 6-Axis Tactical Dimension Bars */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {TACTICAL_AXES.map((axis) => {
          const val = scores[axis.key];
          const percent = Math.round(val * 100);
          const delta = deltas?.find((d) => d.dimension === axis.key);

          return (
            <div
              key={axis.key}
              className="bg-[#0A0D12] p-2.5 rounded-xl border border-[#232A38]/60 flex flex-col justify-between"
            >
              <div className="flex items-center justify-between text-xs mb-1.5 font-medium">
                <span className="text-slate-300">{axis.label}</span>
                <div className="flex items-center gap-1.5 font-mono-numbers">
                  <span className={`font-bold ${axis.color}`}>{percent}%</span>
                  {delta && delta.deltaPercent !== 0 && (
                    <span
                      className={`text-[10px] font-bold flex items-center ${
                        delta.direction === 'up'
                          ? 'text-[#10B981]'
                          : delta.direction === 'down'
                          ? 'text-[#F43F5E]'
                          : 'text-slate-400'
                      }`}
                    >
                      {delta.direction === 'up' && <TrendingUp className="w-2.5 h-2.5 mr-0.5" />}
                      {delta.direction === 'down' && <TrendingDown className="w-2.5 h-2.5 mr-0.5" />}
                      {delta.direction === 'neutral' && <Minus className="w-2.5 h-2.5 mr-0.5" />}
                      {delta.deltaPercent > 0 ? `+${delta.deltaPercent}%` : `${delta.deltaPercent}%`}
                    </span>
                  )}
                </div>
              </div>
              <div className="w-full h-1.5 bg-[#1A202C] rounded-full overflow-hidden">
                <div
                  className={`h-full ${axis.barColor} transition-all duration-300 rounded-full`}
                  style={{ width: `${Math.min(100, Math.max(5, percent))}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Top 5 AI Candidate Recommendations */}
      <div className="pt-2">
        <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2.5 flex items-center justify-between">
          <span>AI Rekomendasi Prioritas ({isPickPhase ? 'Pick' : 'Ban'})</span>
          <span className="text-[10px] text-slate-500 font-mono">Top Choices by Jev Choice Head</span>
        </h4>

        <div className="flex flex-col gap-2">
          {recommendations.slice(0, 5).map((rec, idx) => {
            const probPct = (rec.probability * 100).toFixed(1);
            const isBanPhase = !isPickPhase;
            return (
              <div
                key={rec.hero.hero_id}
                onClick={() => onSelectCandidate(rec.hero)}
                className="group flex items-center justify-between p-2 rounded-xl bg-[#0A0D12] hover:bg-[#1A202C] border border-[#232A38] hover:border-[#B8FF01]/60 cursor-pointer transition-all"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-6 h-6 rounded-md bg-[#1A202C] flex-shrink-0 flex items-center justify-center font-black text-xs font-mono text-slate-300 group-hover:bg-[#B8FF01] group-hover:text-black transition-colors">
                    #{idx + 1}
                  </div>
                  <img
                    src={rec.hero.portrait_asset}
                    alt={rec.hero.name}
                    className="w-10 h-10 rounded-lg object-cover border border-[#232A38] flex-shrink-0"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).src =
                        `https://hok.kurohiko.id/icons/hero/${rec.hero.hero_id}.webp`;
                    }}
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-bold text-xs sm:text-sm text-slate-100 group-hover:text-[#B8FF01]">
                        {rec.hero.name}
                      </span>
                      <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-slate-800 text-slate-300">
                        {rec.hero.tier}
                      </span>
                      {rec.laneTag && (
                        <span
                          className={`text-[9px] font-mono px-1.5 py-0.2 rounded font-semibold ${
                            rec.laneTag.includes('Isi') || rec.laneTag.includes('Target Utama')
                              ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/40'
                              : rec.laneTag.includes('Counter') ||
                                rec.laneTag.includes('Deny') ||
                                rec.laneTag.includes('Target')
                              ? 'bg-rose-950 text-rose-300 border border-rose-800/40'
                              : 'bg-amber-950 text-amber-400 border border-amber-800/40'
                          }`}
                        >
                          {rec.laneTag}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-400 truncate">
                      {rec.hero.primary_role} · {rec.hero.primary_lane} · {(rec.hero.win_rate * 100).toFixed(1)}% WR
                    </div>
                    {rec.proComboTag && (
                      <div className="text-[10px] text-[#B8FF01] font-medium truncate max-w-[290px]">
                        {rec.proComboTag}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2.5 font-mono-numbers flex-shrink-0 ml-2">
                  <div className="text-right">
                    <span className="text-xs font-bold text-[#B8FF01]">{probPct}%</span>
                    <span className="block text-[9px] text-slate-500 uppercase">Score</span>
                  </div>
                  <button
                    className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all ${
                      isBanPhase
                        ? 'bg-rose-950/80 text-rose-300 border border-rose-800/50 group-hover:bg-rose-600 group-hover:text-white'
                        : 'bg-[#232A38] text-slate-200 group-hover:bg-[#B8FF01] group-hover:text-black'
                    }`}
                  >
                    {isPickPhase ? 'Pilih' : 'Ban'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
