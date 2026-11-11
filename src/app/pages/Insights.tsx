import { useEffect, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { AlertTriangle, CheckCircle2, Database, FlaskConical, Loader2, Star } from "lucide-react";
import { api } from "../lib/api";
import { ALGO_LABEL } from "../lib/format";

interface CompRow { model: string; exportable: boolean; auc: number; auc_std: number; accuracy: number; f1: number; monotonic_violations: number; brier?: number }
interface ModelInfo {
  key: string; title: string; algorithm: string; rows: number; features: string[];
  comparison: CompRow[];
  test: { auc: number; accuracy: number; f1: number; ap?: number; brier?: number; confusion_matrix: number[][]; roc: { fpr: number; tpr: number }[]; calibration: { predicted: number; observed: number }[] };
  importance: { feature: string; importance: number }[];
  full_clinical_auc?: number; bp_conditional_coef?: number;
  leakage_demo?: { accuracy_with_duplicates: number; test_rows_also_in_train: number; test_rows: number };
  synthetic?: boolean; source?: string; prior?: { train: number; population: number } | null; cv_rows?: number;
}
interface Card { version: string; trained_at: string; models: ModelInfo[]; feature_labels: Record<string, string>; lifestyle_odds_ratios: Record<string, number>; bp_odds_ratio_per_20mmHg: number; diabetes_extra_odds_ratios: Record<string, number> }
interface Dataset {
  key: string; title: string; source: string; rows: number; unique_rows?: number; duplicates?: number; target: string;
  class_balance: Record<string, number>; findings: string[]; correlations: { feature: string; corr: number }[];
  histograms?: Record<string, { bin: string; negative: number; positive: number; rate: number | null }[]>;
}

const TABS = [{ k: "heart", l: "Зүрх судас" }, { k: "diabetes", l: "Чихрийн шижин" }, { k: "cancer", l: "Хавдар" }];
const CM_LABELS: Record<string, string[]> = { heart: ["Эрүүл", "Өвчтэй"], diabetes: ["Үгүй", "Тийм"], cancer: ["Low/Medium", "High"] };

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border bg-white p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-2xl font-extrabold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Panel({ title, children, desc }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border bg-white p-5 md:p-6">
      <h3 className="font-bold">{title}</h3>
      {desc && <p className="mt-0.5 text-sm text-muted-foreground">{desc}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Insights() {
  const [card, setCard] = useState<Card | null>(null);
  const [eda, setEda] = useState<{ datasets: Dataset[] } | null>(null);
  const [tab, setTab] = useState("heart");
  const [err, setErr] = useState("");

  useEffect(() => {
    Promise.all([api<Card>("/api/ml/model-card"), api<{ datasets: Dataset[] }>("/api/ml/insights")])
      .then(([c, e]) => { setCard(c); setEda(e); })
      .catch((e) => setErr(e.message));
  }, []);

  if (err) return <p className="mx-auto max-w-xl px-4 py-16 text-center text-red-700">{err}</p>;
  if (!card || !eda) return <div className="flex justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  const m = card.models.find((x) => x.key === tab)!;
  const d = eda.datasets.find((x) => x.key === tab)!;
  const lbl = (f: string) => card.feature_labels[f] ?? f;
  const hist = d.histograms?.age;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold">Өгөгдөл ба машин сургалт</h1>
          <p className="mt-1 max-w-2xl text-muted-foreground">Загварууд ямар өгөгдлөөр, ямар аргаар сургагдсан, хэр найдвартай, ямар хязгаарлалттай болохыг ил тод харуулна.</p>
        </div>
        <span className="rounded-full bg-secondary px-3 py-1 text-sm font-semibold text-secondary-foreground">Загвар {card.version}</span>
      </div>

      <ol className="mt-6 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
        {["Өгөгдөл цэвэрлэх (0→NaN, давхардал)", "7 алгоритмыг давтагдсан 5-fold CV-ээр харьцуулах", "Клиник логик шалгалт (monotonicity)", "Хүн амын түвшинд калибровк + OR", "SHAP тайлбар · ONNX экспорт"].map((s, i) => (
          <li key={s} className="flex gap-3 rounded-2xl bg-white p-4 ring-1 ring-border">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">{i + 1}</span>{s}
          </li>
        ))}
      </ol>

      <div className="mt-8 flex gap-2 overflow-x-auto" role="tablist">
        {TABS.map((t) => (
          <button key={t.k} role="tab" aria-selected={tab === t.k} onClick={() => setTab(t.k)}
            className={`shrink-0 rounded-full px-5 py-2.5 font-semibold ${tab === t.k ? "bg-primary text-white" : "bg-white ring-1 ring-border hover:bg-muted"}`}>{t.l}</button>
        ))}
      </div>

      <div className="mt-6 space-y-6">
        <section className="rounded-3xl bg-foreground p-6 text-white">
          <p className="flex items-center gap-2 text-sm text-white/70"><Database className="h-4 w-4" /> {d.source}</p>
          <h2 className="mt-1 text-2xl font-extrabold">{d.title}</h2>
          <ul className="mt-4 space-y-2 text-[15px] text-white/90">
            {d.findings.map((f) => <li key={f} className="flex gap-2"><FlaskConical className="mt-1 h-4 w-4 shrink-0 text-emerald-300" />{f}</li>)}
          </ul>
        </section>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Сургалтын мөр" value={m.rows.toLocaleString()} hint={m.leakage_demo ? `${d.rows} мөрөөс ${d.duplicates} давхардал хассан` : m.rows < d.rows ? `Нийт ${d.rows.toLocaleString()}-аас 18–69 насны` : undefined} />
          <Stat label="Тестийн ROC-AUC" value={m.test.auc.toFixed(3)} hint="1.0 = төгс, 0.5 = санамсаргүй" />
          <Stat label="Нарийвчлал (accuracy)" value={`${(m.test.accuracy * 100).toFixed(1)}%`} />
          <Stat label="Сонгосон загвар" value={ALGO_LABEL[m.algorithm] ?? m.algorithm} />
        </div>

        {m.leakage_demo && (
          <div className="flex gap-3 rounded-3xl bg-amber-50 p-5 text-amber-950 ring-1 ring-amber-200">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-bold">Data leakage жишээ</p>
              <p className="mt-1 text-sm">Давхардлыг арилгалгүй сургахад тест өгөгдлийн {m.leakage_demo.test_rows}-аас {m.leakage_demo.test_rows_also_in_train} мөр нь сургалтад аль хэдийн байсан тул нарийвчлал хуурамчаар <b>{(m.leakage_demo.accuracy_with_duplicates * 100).toFixed(0)}%</b> гарсан. Бид давхардлыг хасаж, 152 давтагдашгүй мөр дээр давтагдсан CV-ээр үнэлсэн. Энэ датасет бага, хялбаршуулсан тул гаралтыг <b>харьцангуй индекс</b> гэж тайлбарлана.</p>
            </div>
          </div>
        )}
        {m.full_clinical_auc && (
          <div className="flex gap-3 rounded-3xl bg-blue-50 p-5 text-blue-950 ring-1 ring-blue-200">
            <FlaskConical className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="text-sm">Бүх клиник шинжийг (ЭКГ, зүрхний цохилт, ST депресс, цээжний өвдөлтийн төрөл) ашиглавал AUC = <b>{m.full_clinical_auc.toFixed(3)}</b>. Асуулгаар цуглуулах боломжтой шинжүүдээр AUC = <b>{m.comparison.find((c) => c.model === m.algorithm)?.auc.toFixed(3)}</b> — эмнэлгийн шинжилгээгүйгээр алдагдах мэдээллийн хэмжээ. Даралтын нөхцөлт коэффициент {m.bp_conditional_coef} (≈0) тул даралтыг мета-шинжилгээний OR ({card.bp_odds_ratio_per_20mmHg}× / 20 ммМУБ)-оор тооцсон.</p>
          </div>
        )}
        {m.synthetic && (
          <div className="flex gap-3 rounded-3xl bg-violet-50 p-5 text-violet-950 ring-1 ring-violet-200">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="text-sm">Монголын чихрийн шижингийн хувь хүний түвшний нээлттэй өгөгдөл байхгүй тул STEPS 2013 тархалт болон FINDRISC/ADA odds ratio-д тулгуурласан <b>синтетик когорт</b> ашигласан. Бодит өгөгдөл (жишээ нь CDC BRFSS) нэмэгдэхэд админ хэсгээс дахин сургана.</p>
          </div>
        )}

        <Panel title="Алгоритмуудын харьцуулалт" desc={`Repeated stratified 5-fold cross-validation · ★ = сонгосон. Сонголтын дүрэм: ONNX-д хөрвүүлэгдэх, клиник логик зөрчил ≤ 2%, AUC хамгийн өндөр; 0.01 дотор логистик регресс байвал хамгийн их regularization-тэйг (one-standard-error дүрэм).`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b"><th className="py-2 pr-3 font-medium">Алгоритм</th><th className="py-2 pr-3 font-medium">ROC-AUC</th><th className="py-2 pr-3 font-medium">Accuracy</th><th className="py-2 pr-3 font-medium">F1</th><th className="py-2 pr-3 font-medium">Brier</th><th className="py-2 pr-3 font-medium">Логик зөрчил</th><th className="py-2 font-medium">ONNX</th></tr>
              </thead>
              <tbody>
                {m.comparison.map((c) => (
                  <tr key={c.model} className={`border-b last:border-0 ${c.model === m.algorithm ? "bg-secondary/60 font-semibold" : ""}`}>
                    <td className="py-2.5 pr-3">{c.model === m.algorithm && <Star className="mr-1 inline h-3.5 w-3.5 fill-amber-400 text-amber-400" />}{ALGO_LABEL[c.model] ?? c.model}</td>
                    <td className="py-2.5 pr-3 tabular-nums">{c.auc.toFixed(3)} <span className="text-xs font-normal text-muted-foreground">±{c.auc_std.toFixed(3)}</span></td>
                    <td className="py-2.5 pr-3 tabular-nums">{(c.accuracy * 100).toFixed(1)}%</td>
                    <td className="py-2.5 pr-3 tabular-nums">{c.f1.toFixed(3)}</td>
                    <td className="py-2.5 pr-3 tabular-nums">{c.brier?.toFixed(3) ?? "—"}</td>
                    <td className={`py-2.5 pr-3 tabular-nums ${c.monotonic_violations > 0.02 ? "text-red-600" : "text-green-700"}`}>{(c.monotonic_violations * 100).toFixed(1)}%</td>
                    <td className="py-2.5">{c.exportable ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <span className="text-muted-foreground">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Шинжийн ач холбогдол (SHAP)" desc="Загварын шийдвэрт шинж бүр хэр нөлөөлдөг (дундаж |SHAP|)">
            <div className="h-72">
              <ResponsiveContainer>
                <BarChart data={m.importance.slice(0, 10).map((x) => ({ name: lbl(x.feature), v: +(x.importance * 100).toFixed(1) }))} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid horizontal={false} stroke="#eef2f1" />
                  <XAxis type="number" unit="%" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v: number) => `${v}%`} />
                  <Bar dataKey="v" fill="#0f8f7a" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
          <Panel title="Зорилтот хувьсагчтай хамаарал" desc="Pearson корреляц (EDA)">
            <div className="h-72">
              <ResponsiveContainer>
                <BarChart data={d.correlations.slice(0, 10).map((c) => ({ name: lbl(c.feature), v: c.corr }))} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid horizontal={false} stroke="#eef2f1" />
                  <XAxis type="number" domain={[-1, 1]} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 12 }} />
                  <ReferenceLine x={0} stroke="#94a3b8" />
                  <Tooltip />
                  <Bar dataKey="v" radius={4}>
                    {d.correlations.slice(0, 10).map((c) => <Cell key={c.feature} fill={c.corr >= 0 ? "#dc2626" : "#16a34a"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
          <Panel title="ROC муруй (тест өгөгдөл)" desc={`AUC = ${m.test.auc.toFixed(3)}${m.key === "cancer" ? " · High түвшин эсэх" : ""}`}>
            <div className="h-64">
              <ResponsiveContainer>
                <LineChart data={m.test.roc} margin={{ left: -16, right: 8 }}>
                  <CartesianGrid stroke="#eef2f1" />
                  <XAxis dataKey="fpr" type="number" domain={[0, 1]} tick={{ fontSize: 11 }} label={{ value: "Хуурамч эерэг", position: "insideBottom", offset: -2, fontSize: 11 }} />
                  <YAxis type="number" domain={[0, 1]} tick={{ fontSize: 11 }} />
                  <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke="#cbd5e1" strokeDasharray="4 4" />
                  <Line dataKey="tpr" stroke="#0f8f7a" strokeWidth={2.5} dot={false} name="Үнэн эерэг" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Panel>
          <Panel title="Калибровк" desc="Таамагласан магадлал бодит давтамжтай хэр таарч байна (диагональ = төгс)">
            <div className="h-64">
              <ResponsiveContainer>
                <LineChart data={m.test.calibration} margin={{ left: -16, right: 8 }}>
                  <CartesianGrid stroke="#eef2f1" />
                  <XAxis dataKey="predicted" type="number" domain={[0, 1]} tick={{ fontSize: 11 }} />
                  <YAxis type="number" domain={[0, 1]} tick={{ fontSize: 11 }} />
                  <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke="#cbd5e1" strokeDasharray="4 4" />
                  <Line dataKey="observed" stroke="#2563eb" strokeWidth={2.5} name="Бодит давтамж" />
                </LineChart>
              </ResponsiveContainer>
            </div>
            {m.test.brier !== undefined && <p className="mt-2 text-xs text-muted-foreground">Brier score: {m.test.brier.toFixed(3)} (бага байх тусам сайн)</p>}
          </Panel>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
          <Panel title="Confusion matrix (тест)">
            <table className="mx-auto text-center text-sm">
              <thead><tr><th className="p-2 text-xs text-muted-foreground">Бодит \ Таамаг</th>{CM_LABELS[m.key].map((l) => <th key={l} className="p-2 font-semibold">{l}</th>)}</tr></thead>
              <tbody>
                {m.test.confusion_matrix.map((row, i) => {
                  const max = Math.max(...m.test.confusion_matrix.flat());
                  return (
                    <tr key={i}><th className="p-2 font-semibold">{CM_LABELS[m.key][i]}</th>
                      {row.map((v, j) => <td key={j} className="h-14 w-16 rounded-lg font-bold tabular-nums" style={{ background: `rgba(15,143,122,${0.08 + (v / max) * 0.7})`, color: v / max > 0.5 ? "#fff" : undefined }}>{v}</td>)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>
          {hist ? (
            <Panel title="Насны тархалт ба өвчлөл" desc="EDA: насны бүлэг тус бүрийн тоо">
              <div className="h-64">
                <ResponsiveContainer>
                  <BarChart data={hist} margin={{ left: -16, right: 8 }}>
                    <CartesianGrid vertical={false} stroke="#eef2f1" />
                    <XAxis dataKey="bin" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="negative" stackId="a" fill="#99d5ca" name="Сөрөг" />
                    <Bar dataKey="positive" stackId="a" fill="#dc2626" name="Эерэг" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          ) : (
            <Panel title="Ангиллын тэнцвэр" desc="Давхардал хассаны дараа">
              <div className="flex h-40 items-end gap-4">
                {Object.entries(d.class_balance).map(([k, v]) => (
                  <div key={k} className="flex flex-1 flex-col items-center gap-1">
                    <span className="text-sm font-bold tabular-nums">{v}</span>
                    <div className="w-full rounded-t-lg bg-primary/70" style={{ height: `${(v / Math.max(...Object.values(d.class_balance))) * 110}px` }} />
                    <span className="text-xs text-muted-foreground">{k}</span>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </div>

        {tab === "diabetes" && !m.synthetic && (
          <Panel title="Монголын хүн амд тохируулах" desc="АНУ-ын BRFSS өгөгдлөөр сурсан загварыг Монголд хэрэглэхийн тулд">
            <div className="grid gap-2 sm:grid-cols-3">
              {m.prior && (
                <div className="rounded-xl bg-muted/60 px-4 py-3 text-sm">
                  Суурь тархалт <b className="tabular-nums">{(m.prior.train * 100).toFixed(1)}% → {(m.prior.population * 100).toFixed(1)}%</b>
                  <p className="text-xs text-muted-foreground">BRFSS (18–69 нас) → STEPS 2013 (6.9% + 8.3%)</p>
                </div>
              )}
              {Object.entries(card.diabetes_extra_odds_ratios).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between rounded-xl bg-muted/60 px-4 py-3 text-sm">
                  <span>{lbl(k)} <span className="text-xs text-muted-foreground">(BRFSS-д байхгүй)</span></span><b className="tabular-nums">×{v}</b>
                </div>
              ))}
            </div>
            {m.cv_rows && m.cv_rows < m.rows && <p className="mt-3 text-xs text-muted-foreground">Алгоритм харьцуулалтыг {m.cv_rows.toLocaleString()} мөрийн давхаргалсан дэд түүвэр дээр, эцсийн загварыг бүх {m.rows.toLocaleString()} мөр дээр сургасан.</p>}
          </Panel>
        )}

        {tab === "heart" && (
          <Panel title="Амьдралын хэв маягийн тохируулга (odds ratio)" desc="UCI өгөгдөлд байхгүй хүчин зүйлсийг хэвлэгдсэн судалгааны OR-оор log-odds дээр нэмнэ (INTERHEART, Lancet 2004).">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {Object.entries(card.lifestyle_odds_ratios).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between rounded-xl bg-muted/60 px-4 py-3 text-sm">
                  <span>{lbl(k)}</span><b className="tabular-nums">×{v}</b>
                </div>
              ))}
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}
