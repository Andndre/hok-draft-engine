import React from 'react';
import { Hero, TacticalVector, TacticalDelta } from '../types';
import { Sparkles, TrendingUp, TrendingDown, Minus, ShieldAlert } from 'lucide-react';

interface TacticalRadarPanelProps {
  scores: TacticalVector;
  deltas?: TacticalDelta[];
  primaryInsight?: string;
  recommendations: Array<{
    hero: Hero;
    probability: number;
    choiceScore: number;
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
              <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded font-black ${
                activeSide === 'blue' ? 'bg-blue-950 text-blue-400 border border-blue-800/40' : 'bg-red-950 text-red-400 border border-red-800/40'
              }`}>
                {activeSide.toUpperCase()} SIDE {isPickPhase ? 'PICK' : 'BAN'}
              </span>
            </h3>
            <p className="text-[11px] text-slate-400">
              6-Axis Real-Time Distilled Neural Decision Matrix
            </p>
          </div>
        </div>

        {/* Win Probability Dial */}
        <div className="flex flex-col items-end font-mono-numbers">
          <span className="text-[10px] uppercase text-slate-400 font-semibold tracking-wider">Win Prob</span>
          <span className={`text-2xl font-black ${
            winRatePercent >= 52 ? 'text-[#10B981]' : winRatePercent >= 48 ? 'text-slate-100' : 'text-[#F43F5E]'
          }`}>
            {winRatePercent}%
          </span>
        </div>
      </div>

      {/* Primary Dynamic AI Insight Banner */}
      {primaryInsight && (
        <div className="bg-[#1A202C] border-l-4 border-[#B8FF01] p-3 rounded-r-xl flex items-start gap-2.5">
          <ShieldAlert className="w-4 h-4 text-[#B8FF01] mt-0.5 flex-shrink-0" />
          <p className="text-xs text-slate-200 leading-relaxed font-medium">
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
            <div key={axis.key} className="bg-[#0A0D12] p-2.5 rounded-xl border border-[#232A38]/60 flex flex-col justify-between">
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
            return (
              <div
                key={rec.hero.hero_id}
                onClick={() => onSelectCandidate(rec.hero)}
                className="group flex items-center justify-between p-2 rounded-xl bg-[#0A0D12] hover:bg-[#1A202C] border border-[#232A38] hover:border-[#B8FF01]/60 cursor-pointer transition-all"
              >
                <div className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-md bg-[#1A202C] flex items-center justify-center font-black text-xs font-mono text-slate-300 group-hover:bg-[#B8FF01] group-hover:text-black transition-colors">
                    #{idx + 1}
                  </div>
                  <img
                    src={rec.hero.portrait_asset}
                    alt={rec.hero.name}
                    className="w-10 h-10 rounded-lg object-cover border border-[#232A38]"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).src =
                        `https://hok.kurohiko.id/icons/hero/${rec.hero.hero_id}.webp`;
                    }}
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-xs sm:text-sm text-slate-100 group-hover:text-[#B8FF01]">
                        {rec.hero.name}
                      </span>
                      <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-slate-800 text-slate-300">
                        {rec.hero.tier}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-400">
                      {rec.hero.primary_role} · {rec.hero.primary_lane}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3 font-mono-numbers">
                  <div className="text-right">
                    <span className="text-xs font-bold text-[#B8FF01]">{probPct}%</span>
                    <span className="block text-[9px] text-slate-500 uppercase">Confidence</span>
                  </div>
                  <button className="px-2.5 py-1 text-xs font-bold rounded-lg bg-[#232A38] group-hover:bg-[#B8FF01] group-hover:text-black transition-all">
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
