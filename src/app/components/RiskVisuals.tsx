import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer } from "recharts";
import { LEVEL_STYLE, pct } from "../lib/format";
import type { DiseaseRisk, Level } from "../lib/types";

export function RiskRing({ value, level, size = 140, label }: { value: number; level: Level; size?: number; label?: string }) {
  const r = (size - 16) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.min(100, Math.max(0, value));
  const color = LEVEL_STYLE[level].hex;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#e5ece9" strokeWidth={12} fill="none" />
        <circle
          cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={12} fill="none" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} style={{ transition: "stroke-dashoffset 900ms ease" }}
        />
      </svg>
      <div className="absolute text-center">
        <div className="font-display text-3xl font-extrabold" style={{ color }}>{pct(value)}</div>
        {label && <div className="text-xs font-medium text-muted-foreground">{label}</div>}
      </div>
    </div>
  );
}

export function LevelBadge({ level }: { level: Level }) {
  const s = LEVEL_STYLE[level];
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${s.bg} ${s.text} ring-1 ${s.ring}`}>{s.label}</span>;
}

export function RiskRadar({ data }: { data: { axis: string; value: number }[] }) {
  return (
    <div className="h-72 w-full" role="img" aria-label={`Эрсдэлийн радар: ${data.map((d) => `${d.axis} ${Math.round(d.value)}%`).join(", ")}`}>
      <ResponsiveContainer>
        <RadarChart data={data} outerRadius="72%">
          <PolarGrid stroke="#dfe7e5" />
          <PolarAngleAxis dataKey="axis" tick={{ fontSize: 12, fill: "#3b4a47" }} />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          <Radar dataKey="value" stroke="#0f8f7a" fill="#0f8f7a" fillOpacity={0.25} strokeWidth={2} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** SHAP хувь нэмэр: эерэг = эрсдэл нэмсэн, сөрөг = бууруулсан */
export function FactorBars({ risk }: { risk: DiseaseRisk }) {
  const max = Math.max(5, ...risk.factors.map((f) => Math.abs(f.impact)));
  if (!risk.factors.length) return <p className="text-sm text-muted-foreground">Онцлох хүчин зүйл алга.</p>;
  return (
    <ul className="space-y-2.5">
      {risk.factors.map((f) => {
        const up = f.impact > 0;
        const w = (Math.abs(f.impact) / max) * 100;
        return (
          <li key={f.feature} className="text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <span>
                {f.label}
                {f.source === "odds_ratio" && <span className="ml-1 text-[10px] text-muted-foreground" title="Хэвлэгдсэн судалгааны odds ratio">OR</span>}
              </span>
              <span className={`shrink-0 font-semibold tabular-nums ${up ? "text-red-600" : "text-green-600"}`}>
                {up ? "+" : "−"}{Math.abs(f.impact).toFixed(1)}
              </span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-muted overflow-hidden">
              <div className={`h-full rounded-full ${up ? "bg-red-500" : "bg-green-500"}`} style={{ width: `${w}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
