import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Loader2, Trash2, TrendingDown, TrendingUp } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { BOOKING_STATUS, fmtDate, fmtDateTime } from "../lib/format";
import type { AssessmentSummary, Booking } from "../lib/types";
import { assessmentController, session } from "../domain";
import { LevelBadge } from "../components/RiskVisuals";

export function MyHealth() {
  const { user, ready, logout } = useAuth();
  const nav = useNavigate();
  const [hist, setHist] = useState<AssessmentSummary[] | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [confirm, setConfirm] = useState<"" | "assessments" | "all">("");

  const load = () => {
    if (user) assessmentController.listByUser(user).then(setHist).catch(() => setHist([]));
    api<Booking[]>("/api/me/bookings").then(setBookings).catch(() => null);
  };
  useEffect(() => { if (user) load(); }, [user]);

  if (ready && !user) return <Navigate to="/login" replace />;
  if (!hist) return <div className="flex justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  const chart = [...hist].reverse().filter((h) => h.scores).map((h) => ({
    date: fmtDate(h.created_at), "Зүрх судас": h.scores!.heart, "Чихрийн шижин": h.scores!.diabetes, "Хавдар": h.scores!.cancer,
  }));
  const trend = hist.length >= 2 && hist[0].overall && hist[1].overall ? hist[0].overall.value - hist[1].overall.value : null;

  const del = async (id: string) => {
    await api(`/api/me/assessments/${id}`, { method: "DELETE" });
    load();
  };
  const wipe = async (scope: "assessments" | "all") => {
    await api(`/api/me/data?scope=${scope}`, { method: "DELETE" });
    session.clear();
    setConfirm("");
    if (scope === "all") { logout(); nav("/"); } else load();
  };
  const cancel = async (id: string) => {
    await api(`/api/me/bookings/${id}/cancel`, { method: "POST" });
    load();
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold">Сайн байна уу, {user?.name}</h1>
          <p className="text-muted-foreground">Эрүүл мэндийн үнэлгээний түүх</p>
        </div>
        <Link to="/assessment" className="rounded-xl bg-primary px-5 py-3 font-bold text-white hover:brightness-110">Шинэ үнэлгээ</Link>
      </div>

      {trend !== null && (
        <div className={`mt-6 flex items-center gap-3 rounded-2xl p-4 ${trend <= 0 ? "bg-green-50 text-green-900" : "bg-amber-50 text-amber-900"}`}>
          {trend <= 0 ? <TrendingDown className="h-5 w-5" /> : <TrendingUp className="h-5 w-5" />}
          Өмнөх үнэлгээнээс нийт эрсдэл <b>{Math.abs(trend).toFixed(1)}</b> пунктээр {trend <= 0 ? "буурсан 🎉" : "өссөн"}.
        </div>
      )}

      {chart.length >= 2 && (
        <section className="mt-6 rounded-3xl border bg-white p-6">
          <h2 className="font-bold">Эрсдэлийн өөрчлөлт</h2>
          <div className="mt-4 h-72">
            <ResponsiveContainer>
              <LineChart data={chart} margin={{ left: -16, right: 8 }}>
                <CartesianGrid stroke="#eef2f1" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} unit="%" />
                <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} />
                <Legend />
                <Line dataKey="Зүрх судас" stroke="#dc2626" strokeWidth={2.5} dot />
                <Line dataKey="Чихрийн шижин" stroke="#2563eb" strokeWidth={2.5} dot />
                <Line dataKey="Хавдар" stroke="#9333ea" strokeWidth={2.5} dot />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      <section className="mt-6 rounded-3xl border bg-white">
        <h2 className="border-b p-5 font-bold">Үнэлгээнүүд ({hist.length})</h2>
        {hist.length === 0 && <p className="p-6 text-muted-foreground">Одоогоор үнэлгээ алга.</p>}
        <ul className="divide-y">
          {hist.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-4 p-5">
              <div className="min-w-[140px]">
                <p className="font-semibold">{fmtDateTime(h.created_at)}</p>
                <p className="text-xs text-muted-foreground">BMI {h.bmi} · {h.model_version}</p>
              </div>
              {h.overall && <div className="flex items-center gap-2"><span className="font-display text-xl font-extrabold">{Math.round(h.overall.value)}%</span><LevelBadge level={h.overall.level} /></div>}
              {h.urgent && <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-bold text-red-700">Яаралтай</span>}
              <div className="ml-auto flex gap-2">
                <Link to={`/result/${h.id}`} className="rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-muted">Харах</Link>
                <button onClick={() => del(h.id)} className="rounded-lg border p-2 text-muted-foreground hover:bg-red-50 hover:text-red-700" aria-label="Устгах"><Trash2 className="h-4 w-4" /></button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-6 rounded-3xl border bg-white">
        <h2 className="border-b p-5 font-bold">Миний захиалгууд</h2>
        {bookings.length === 0 && <p className="p-6 text-muted-foreground">Захиалга алга.</p>}
        <ul className="divide-y">
          {bookings.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-3 p-5">
              <span className="font-display font-extrabold text-primary">{b.code}</span>
              <span className="font-semibold">{b.hospital_name}</span>
              <span className="text-sm text-muted-foreground">{b.date} {b.time} · {b.specialty}</span>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${BOOKING_STATUS[b.status].cls}`}>{BOOKING_STATUS[b.status].label}</span>
              {(b.status === "pending" || b.status === "confirmed") && (
                <button onClick={() => cancel(b.id)} className="ml-auto text-sm font-semibold text-red-700 hover:underline">Цуцлах</button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-6 rounded-3xl border border-red-200 bg-white p-6">
        <h2 className="font-bold">Миний өгөгдөл</h2>
        <p className="mt-1 text-sm text-muted-foreground">Хувийн мэдээлэл хамгаалах тухай хуулийн дагуу та өгөгдлөө хүссэн үедээ устгах эрхтэй. Устгасны дараа сэргээх боломжгүй.</p>
        {confirm ? (
          <div className="mt-4 rounded-2xl bg-red-50 p-4">
            <p className="font-semibold text-red-800">{confirm === "all" ? "Бүртгэл болон бүх өгөгдлөө бүрмөсөн устгах уу?" : "Бүх үнэлгээгээ устгах уу?"}</p>
            <div className="mt-3 flex gap-2">
              <button onClick={() => wipe(confirm)} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white">Тийм, устгах</button>
              <button onClick={() => setConfirm("")} className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold">Болих</button>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={() => setConfirm("assessments")} className="rounded-lg border px-4 py-2 text-sm font-semibold hover:bg-muted">Бүх үнэлгээг устгах</button>
            <button onClick={() => setConfirm("all")} className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50">Бүртгэлээ устгах</button>
          </div>
        )}
      </section>
    </div>
  );
}
