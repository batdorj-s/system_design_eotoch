import { useEffect, useState } from "react";
import { Navigate } from "react-router";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Check, Loader2, Save, X } from "lucide-react";
import { api, qs } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { BOOKING_STATUS } from "../../lib/format";
import type { Booking, Hospital } from "../../lib/types";

const today = () => new Date().toLocaleDateString("en-CA");

export function StaffDashboard() {
  const { user, ready } = useAuth();
  const [day, setDay] = useState(today());
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<Booking[] | null>(null);
  const [load, setLoad] = useState<{ total: number; by_status: Record<string, number>; capacity: number; free_slots: number; week: { date: string; count: number }[] } | null>(null);
  const [hospital, setHospital] = useState<Hospital | null>(null);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [hid, setHid] = useState<string | undefined>(undefined);
  const [saved, setSaved] = useState(false);
  const isAdmin = user?.role === "admin";

  useEffect(() => {
    if (isAdmin) api<{ hospitals: Hospital[] }>("/api/hospitals").then((r) => { setHospitals(r.hospitals); setHid((h) => h ?? r.hospitals[0]?.id); });
  }, [isAdmin]);

  const refresh = () => {
    if (!user || (isAdmin && !hid)) return;
    const h = isAdmin ? hid : undefined;
    api<Booking[]>(`/api/staff/bookings${qs({ day, status, hospital_id: h })}`).then(setRows).catch(() => setRows([]));
    api<typeof load>(`/api/staff/load${qs({ day, hospital_id: h })}`).then(setLoad).catch(() => null);
    api<Hospital>(`/api/staff/hospital${qs({ hospital_id: h })}`).then(setHospital).catch(() => null);
  };
  useEffect(refresh, [day, status, hid, isAdmin, user]); // eslint-disable-line react-hooks/exhaustive-deps

  if (ready && (!user || (user.role !== "staff" && !isAdmin))) return <Navigate to="/login" replace />;

  const act = async (id: string, s: string) => {
    await api(`/api/staff/bookings/${id}${qs({})}`, { method: "PATCH", json: { status: s } });
    refresh();
  };
  const saveHospital = async () => {
    if (!hospital) return;
    const { name, address, phone, hours, openTime, closeTime, specialties, isEmergency } = hospital;
    await api(`/api/staff/hospital${qs({ hospital_id: isAdmin ? hid : undefined })}`, { method: "PUT", json: { name, address, phone, hours, openTime, closeTime, specialties, isEmergency } });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-primary">Эмнэлгийн ажилтан</p>
          <h1 className="text-3xl font-extrabold">{hospital?.name ?? "…"}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {isAdmin && (
            <select value={hid} onChange={(e) => setHid(e.target.value)} className="h-11 rounded-xl border bg-white px-3" aria-label="Эмнэлэг">
              {hospitals.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          )}
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="h-11 rounded-xl border bg-white px-3" aria-label="Өдөр" />
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-11 rounded-xl border bg-white px-3" aria-label="Төлөв">
            <option value="">Бүх төлөв</option>
            {Object.entries(BOOKING_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
      </div>

      {load && (
        <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_1.2fr]">
          <div className="grid grid-cols-2 gap-3">
            {[["Нийт захиалга", load.total], ["Хүлээгдэж буй", load.by_status.pending ?? 0], ["Баталгаажсан", load.by_status.confirmed ?? 0], ["Сул слот", `${load.free_slots}/${load.capacity}`]].map(([l, v]) => (
              <div key={l as string} className="rounded-2xl border bg-white p-4">
                <p className="text-xs text-muted-foreground">{l}</p>
                <p className="font-display text-2xl font-extrabold tabular-nums">{v}</p>
              </div>
            ))}
          </div>
          <div className="rounded-2xl border bg-white p-4">
            <p className="text-sm font-semibold">7 хоногийн ачаалал</p>
            <div className="h-36">
              <ResponsiveContainer>
                <BarChart data={load.week.map((w) => ({ ...w, d: w.date.slice(5) }))}>
                  <XAxis dataKey="d" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={24} />
                  <Tooltip />
                  <Bar dataKey="count" name="Захиалга" fill="#0f8f7a" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      <section className="mt-6 overflow-hidden rounded-3xl border bg-white">
        <h2 className="border-b p-5 font-bold">Захиалгын хүснэгт</h2>
        {!rows ? <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div> : rows.length === 0 ? (
          <p className="p-6 text-muted-foreground">Энэ өдөр захиалга алга.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr><th className="p-3 font-medium">Цаг</th><th className="p-3 font-medium">Код</th><th className="p-3 font-medium">Үйлчлүүлэгч</th><th className="p-3 font-medium">Мэргэжил</th><th className="p-3 font-medium">Эрсдэлийн хураангуй</th><th className="p-3 font-medium">Төлөв</th><th className="p-3" /></tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id} className="border-t">
                    <td className="p-3 font-semibold tabular-nums">{b.time}</td>
                    <td className="p-3 font-display font-bold text-primary">{b.code}</td>
                    <td className="p-3">{b.name}<br /><a href={`tel:${b.phone}`} className="text-xs text-muted-foreground">{b.phone}</a></td>
                    <td className="p-3">{b.specialty}</td>
                    <td className="p-3 text-xs">
                      {b.shared_assessment ? (
                        <span className={b.shared_assessment.urgent ? "font-bold text-red-700" : ""}>
                          Нийт {Math.round(b.shared_assessment.overall.value)}% · ЗС {Math.round(b.shared_assessment.scores.heart)}% · ЧШ {Math.round(b.shared_assessment.scores.diabetes)}% · BMI {b.shared_assessment.bmi}
                        </span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="p-3"><span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${BOOKING_STATUS[b.status].cls}`}>{BOOKING_STATUS[b.status].label}</span></td>
                    <td className="p-3">
                      <div className="flex justify-end gap-1.5">
                        {b.status === "pending" && <button onClick={() => act(b.id, "confirmed")} className="flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-bold text-white"><Check className="h-3.5 w-3.5" />Батлах</button>}
                        {b.status === "confirmed" && <button onClick={() => act(b.id, "completed")} className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold hover:bg-muted">Үзүүлсэн</button>}
                        {(b.status === "pending" || b.status === "confirmed") && <button onClick={() => act(b.id, "cancelled")} className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"><X className="h-3.5 w-3.5" />Цуцлах</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {hospital && (
        <section className="mt-6 rounded-3xl border bg-white p-6">
          <h2 className="font-bold">Эмнэлгийн мэдээлэл</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {([["name", "Нэр"], ["address", "Хаяг"], ["phone", "Утас"], ["hours", "Ажлын цаг (текст)"], ["openTime", "Нээх (HH:MM)"], ["closeTime", "Хаах (HH:MM)"]] as const).map(([k, l]) => (
              <label key={k} className="text-sm font-semibold">{l}
                <input value={hospital[k] ?? ""} onChange={(e) => setHospital({ ...hospital, [k]: e.target.value })} className="mt-1 h-11 w-full rounded-xl border px-3 font-normal" />
              </label>
            ))}
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={hospital.isEmergency} onChange={(e) => setHospital({ ...hospital, isEmergency: e.target.checked })} className="h-4 w-4 accent-[var(--primary)]" /> 24/7 яаралтай тусламжтай
            </label>
          </div>
          <button onClick={saveHospital} className="mt-5 flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-semibold text-white">
            <Save className="h-4 w-4" /> {saved ? "Хадгалагдлаа ✓" : "Хадгалах"}
          </button>
        </section>
      )}
    </div>
  );
}
