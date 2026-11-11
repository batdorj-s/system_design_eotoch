import { useEffect, useState } from "react";
import { Navigate } from "react-router";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Loader2, Play, Plus, Power, Trash2 } from "lucide-react";
import { api, qs } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { fmtDateTime } from "../../lib/format";
import type { Hospital, User } from "../../lib/types";

interface Stats {
  users: number; staff: number; assessments_total: number; assessments_period: number; urgent_period: number;
  risk_levels: Record<string, number>; avg_scores: Record<string, number>; daily: { date: string; count: number }[];
  bookings: Record<string, number>; hospitals: number; model_version: string;
}
interface KB { id: string; category: string; content: string; source: string; active: boolean; tags: string[] }
interface AuditRow { id: string; ts: string; action: string; actor_role: string; target: string | null; ip: string | null }

const TABS = ["Тойм", "Эмнэлэг", "Мэдлэгийн сан", "ML загвар", "Хэрэглэгч", "Аудит"] as const;

function Overview() {
  const [s, setS] = useState<Stats | null>(null);
  useEffect(() => { api<Stats>("/api/admin/stats").then(setS); }, []);
  if (!s) return <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />;
  const levels = [{ n: "Бага", v: s.risk_levels.low, c: "#16a34a" }, { n: "Дунд", v: s.risk_levels.moderate, c: "#d97706" }, { n: "Өндөр", v: s.risk_levels.high, c: "#dc2626" }];
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[["Хэрэглэгч", s.users], ["Үнэлгээ (нийт)", s.assessments_total], ["Сүүлийн 30 хоног", s.assessments_period], ["Яаралтай (30 хоног)", s.urgent_period], ["Идэвхтэй эмнэлэг", s.hospitals]].map(([l, v]) => (
          <div key={l as string} className="rounded-2xl border bg-white p-4"><p className="text-xs text-muted-foreground">{l}</p><p className="font-display text-2xl font-extrabold tabular-nums">{v}</p></div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-3xl border bg-white p-5">
          <p className="font-semibold">Өдөр тутмын үнэлгээ</p>
          <div className="mt-3 h-56"><ResponsiveContainer><AreaChart data={s.daily}><CartesianGrid stroke="#eef2f1" /><XAxis dataKey="date" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={28} /><Tooltip /><Area dataKey="count" name="Үнэлгээ" stroke="#0f8f7a" fill="#0f8f7a" fillOpacity={0.2} /></AreaChart></ResponsiveContainer></div>
        </div>
        <div className="rounded-3xl border bg-white p-5">
          <p className="font-semibold">Эрсдэлийн түвшний тархалт</p>
          <div className="mt-3 h-56"><ResponsiveContainer><BarChart data={levels}><XAxis dataKey="n" /><YAxis allowDecimals={false} width={28} /><Tooltip /><Bar dataKey="v" name="Хүн" radius={[8, 8, 0, 0]}>{levels.map((l) => <Cell key={l.n} fill={l.c} />)}</Bar></BarChart></ResponsiveContainer></div>
          <p className="mt-2 text-sm text-muted-foreground">Дундаж: зүрх {s.avg_scores.heart}% · чихрийн шижин {s.avg_scores.diabetes}% · хавдар {s.avg_scores.cancer}%</p>
        </div>
      </div>
      <div className="rounded-3xl border bg-white p-5">
        <p className="font-semibold">Захиалгын төлөв</p>
        <div className="mt-3 flex flex-wrap gap-3">{Object.entries(s.bookings).map(([k, v]) => <span key={k} className="rounded-xl bg-muted px-4 py-2 text-sm">{k}: <b>{v}</b></span>)}</div>
      </div>
    </div>
  );
}

function Hospitals() {
  const [list, setList] = useState<Hospital[]>([]);
  const [f, setF] = useState({ id: "", name: "", address: "", phone: "", lat: "47.92", lng: "106.92", specialties: "Зүрх судас, Дотоод шүүрэл", hours: "08:30–17:30", openTime: "08:30", closeTime: "17:30" });
  const [err, setErr] = useState("");
  const load = () => api<Hospital[]>("/api/admin/hospitals").then(setList);
  useEffect(() => { load(); }, []);
  const add = async () => {
    setErr("");
    try {
      await api("/api/admin/hospitals", { method: "POST", json: { ...f, lat: +f.lat, lng: +f.lng, specialties: f.specialties.split(",").map((s) => s.trim()).filter(Boolean) } });
      load();
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="space-y-6">
      <div className="overflow-x-auto rounded-3xl border bg-white">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground"><tr><th className="p-3 font-medium">Нэр</th><th className="p-3 font-medium">Мэргэжил</th><th className="p-3 font-medium">Утас</th><th className="p-3 font-medium">Төлөв</th><th /></tr></thead>
          <tbody>{list.map((h) => (
            <tr key={h.id} className="border-t">
              <td className="p-3 font-semibold">{h.name}<br /><span className="text-xs font-normal text-muted-foreground">{h.id}</span></td>
              <td className="p-3 text-xs">{h.specialties.join(", ")}</td>
              <td className="p-3">{h.phone || "—"}</td>
              <td className="p-3">{h.active === false ? <span className="text-muted-foreground">Идэвхгүй</span> : <span className="text-green-700">Идэвхтэй</span>}</td>
              <td className="p-3 text-right"><button onClick={() => api(`/api/admin/hospitals/${h.id}/active${qs({ active: h.active === false })}`, { method: "POST" }).then(load)} className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold hover:bg-muted"><Power className="h-3.5 w-3.5" />{h.active === false ? "Идэвхжүүлэх" : "Идэвхгүй болгох"}</button></td>
            </tr>))}
          </tbody>
        </table>
      </div>
      <div className="rounded-3xl border bg-white p-5">
        <p className="font-semibold">Шинэ эмнэлэг нэмэх</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(f) as (keyof typeof f)[]).map((k) => (
            <label key={k} className="text-xs font-semibold text-muted-foreground">{k}<input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} className="mt-1 h-10 w-full rounded-lg border px-3 text-sm font-normal text-foreground" /></label>
          ))}
        </div>
        {err && <p className="mt-3 text-sm text-red-700">{err}</p>}
        <button onClick={add} className="mt-4 flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white"><Plus className="h-4 w-4" />Нэмэх</button>
      </div>
    </div>
  );
}

function Knowledge() {
  const [list, setList] = useState<KB[]>([]);
  const [f, setF] = useState({ category: "general", content: "", source: "", tags: "" });
  const load = () => api<KB[]>("/api/admin/knowledge").then(setList);
  useEffect(() => { load(); }, []);
  const add = async () => {
    await api("/api/admin/knowledge", { method: "POST", json: { ...f, tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean) } });
    setF({ ...f, content: "", source: "" });
    load();
  };
  return (
    <div className="space-y-6">
      <div className="rounded-3xl border bg-white p-5">
        <p className="font-semibold">Шинэ мэдлэг нэмэх</p>
        <p className="text-sm text-muted-foreground">AI зөвлөгөө үүсгэхэд TF-IDF хайлтаар хамааралтай 10 бүлгийг сонгож ашиглана (RAG).</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="ангилал" className="h-10 rounded-lg border px-3 text-sm" />
          <input value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} placeholder="эх сурвалж" className="h-10 rounded-lg border px-3 text-sm" />
          <input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} placeholder="түлхүүр үг, таслалаар" className="h-10 rounded-lg border px-3 text-sm" />
          <textarea value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} placeholder="Агуулга (монгол хэлээр)" rows={3} className="rounded-lg border p-3 text-sm sm:col-span-3" />
        </div>
        <button onClick={add} disabled={f.content.length < 10 || !f.source} className="mt-3 flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"><Plus className="h-4 w-4" />Нэмэх</button>
      </div>
      <ul className="divide-y rounded-3xl border bg-white">
        {list.map((k) => (
          <li key={k.id} className="flex gap-4 p-4 text-sm">
            <span className="h-fit shrink-0 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground">{k.category}</span>
            <p className="flex-1">{k.content} <i className="text-muted-foreground">({k.source})</i></p>
            <button onClick={() => api(`/api/admin/knowledge/${k.id}`, { method: "DELETE" }).then(load)} className="h-fit rounded-lg p-2 text-muted-foreground hover:bg-red-50 hover:text-red-700" aria-label="Устгах"><Trash2 className="h-4 w-4" /></button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Model() {
  const [st, setSt] = useState<{ running: boolean; log: string; ok: boolean | null; version: string; finished_at: string | null } | null>(null);
  const [ver, setVer] = useState(`v${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`);
  const [err, setErr] = useState("");
  const load = () => api<typeof st>("/api/admin/model/status").then(setSt);
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!st?.running) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [st?.running]);
  const start = async () => {
    setErr("");
    try { await api("/api/admin/model/retrain", { method: "POST", json: { version: ver } }); load(); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="space-y-4">
      <div className="rounded-3xl border bg-white p-5">
        <p className="text-sm text-muted-foreground">Идэвхтэй хувилбар</p>
        <p className="font-display text-3xl font-extrabold">{st?.version ?? "…"}</p>
        <p className="mt-3 text-sm text-muted-foreground">Дахин сургахад <code>ai-model/eda.py</code> болон <code>ai-model/train.py</code> ажиллаж, 3 загварыг харьцуулан сонгоод, амжилттай бол серверт шууд ачаална. Шинэ өгөгдлөө <code>ai-model/data/</code>-д байрлуулна.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <input value={ver} onChange={(e) => setVer(e.target.value)} className="h-11 rounded-xl border px-3" aria-label="Хувилбар" />
          <button onClick={start} disabled={st?.running} className="flex items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-white disabled:opacity-50">
            {st?.running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} {st?.running ? "Сургаж байна…" : "Дахин сургах"}
          </button>
        </div>
        {err && <p className="mt-3 text-sm text-red-700">{err}</p>}
      </div>
      {st?.log && (
        <div className="rounded-3xl border bg-white p-5">
          <p className="font-semibold">Сүүлийн сургалт {st.ok === true ? "✅" : st.ok === false ? "❌" : ""} {st.finished_at && fmtDateTime(st.finished_at)}</p>
          <pre className="mt-3 max-h-96 overflow-auto rounded-xl bg-foreground p-4 text-xs text-white">{st.log}</pre>
        </div>
      )}
    </div>
  );
}

function Users() {
  const [list, setList] = useState<(User & { assessments: number; created_at: string })[]>([]);
  const [confirm, setConfirm] = useState("");
  const load = () => api<typeof list>("/api/admin/users").then(setList);
  useEffect(() => { load(); }, []);
  return (
    <div className="overflow-x-auto rounded-3xl border bg-white">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-muted/50 text-left text-muted-foreground"><tr><th className="p-3 font-medium">Нэр</th><th className="p-3 font-medium">Имэйл</th><th className="p-3 font-medium">Эрх</th><th className="p-3 font-medium">Үнэлгээ</th><th /></tr></thead>
        <tbody>{list.map((u) => (
          <tr key={u.id} className="border-t">
            <td className="p-3 font-semibold">{u.name}</td><td className="p-3">{u.email}</td><td className="p-3">{u.role}{u.hospital_id ? ` · ${u.hospital_id}` : ""}</td><td className="p-3 tabular-nums">{u.assessments}</td>
            <td className="p-3 text-right">{u.role !== "admin" && (confirm === u.id
              ? <button onClick={() => api(`/api/admin/users/${u.id}/data`, { method: "DELETE" }).then(() => { setConfirm(""); load(); })} className="rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-bold text-white">Баталгаажуулах</button>
              : <button onClick={() => setConfirm(u.id)} className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50">Өгөгдөл устгах</button>)}</td>
          </tr>))}
        </tbody>
      </table>
    </div>
  );
}

function Audit() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [action, setAction] = useState("");
  useEffect(() => { api<AuditRow[]>(`/api/admin/audit${qs({ action })}`).then(setRows); }, [action]);
  return (
    <div className="space-y-3">
      <select value={action} onChange={(e) => setAction(e.target.value)} className="h-10 rounded-xl border bg-white px-3 text-sm" aria-label="Үйлдлээр шүүх">
        <option value="">Бүх үйлдэл</option>
        {["user", "assessment", "booking", "hospital", "knowledge", "model", "admin"].map((a) => <option key={a} value={a}>{a}.*</option>)}
      </select>
      <div className="overflow-x-auto rounded-3xl border bg-white">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground"><tr><th className="p-3 font-medium">Цаг</th><th className="p-3 font-medium">Үйлдэл</th><th className="p-3 font-medium">Хэн</th><th className="p-3 font-medium">Объект</th><th className="p-3 font-medium">IP</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} className="border-t"><td className="p-3 tabular-nums">{fmtDateTime(r.ts)}</td><td className="p-3 font-mono text-xs">{r.action}</td><td className="p-3">{r.actor_role}</td><td className="p-3 font-mono text-xs">{r.target?.slice(0, 12) ?? "—"}</td><td className="p-3 text-xs">{r.ip}</td></tr>))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">Аудитын бүртгэл 90 хоног хадгалагдана (MongoDB TTL index).</p>
    </div>
  );
}

export function AdminDashboard() {
  const { user, ready } = useAuth();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Тойм");
  if (ready && user?.role !== "admin") return <Navigate to="/login" replace />;
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:py-10">
      <h1 className="text-3xl font-extrabold">Системийн удирдлага</h1>
      <div className="mt-6 flex gap-2 overflow-x-auto pb-1" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold ${tab === t ? "bg-primary text-white" : "bg-white ring-1 ring-border hover:bg-muted"}`}>{t}</button>
        ))}
      </div>
      <div className="mt-6">
        {tab === "Тойм" && <Overview />}
        {tab === "Эмнэлэг" && <Hospitals />}
        {tab === "Мэдлэгийн сан" && <Knowledge />}
        {tab === "ML загвар" && <Model />}
        {tab === "Хэрэглэгч" && <Users />}
        {tab === "Аудит" && <Audit />}
      </div>
    </div>
  );
}
