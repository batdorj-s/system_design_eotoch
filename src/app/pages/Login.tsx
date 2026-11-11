import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Loader2 } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";

const input = "mt-1 h-12 w-full rounded-xl border bg-white px-4 font-normal outline-none focus:ring-2 focus:ring-primary/30";

export function Login() {
  const { login, register } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [f, setF] = useState({ email: "", password: "", name: "", phone: "", consent: false });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const u = mode === "login"
        ? await login(f.email, f.password)
        : await register({ email: f.email, password: f.password, name: f.name, phone: f.phone || undefined, consent: f.consent });
      const claim = params.get("claim");
      if (claim) {
        await api(`/api/me/assessments/${claim}/claim`, { method: "POST" }).catch(() => null);
        return nav(`/result/${claim}`);
      }
      nav(u.role === "admin" ? "/admin" : u.role === "staff" ? "/staff" : "/me");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <div className="rounded-3xl border bg-white p-7 shadow-sm">
        <div className="mb-6 grid grid-cols-2 rounded-xl bg-muted p-1" role="tablist">
          {(["login", "register"] as const).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
              className={`rounded-lg py-2 text-sm font-semibold ${mode === m ? "bg-white shadow-sm" : "text-muted-foreground"}`}>
              {m === "login" ? "Нэвтрэх" : "Бүртгүүлэх"}
            </button>
          ))}
        </div>
        <form onSubmit={submit} className="space-y-4">
          {mode === "register" && (
            <label className="block text-sm font-semibold">Нэр
              <input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={input} autoComplete="name" />
            </label>
          )}
          <label className="block text-sm font-semibold">Имэйл
            <input required type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} className={input} autoComplete="email" />
          </label>
          <label className="block text-sm font-semibold">Нууц үг
            <input required type="password" minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} className={input}
              autoComplete={mode === "login" ? "current-password" : "new-password"} />
            {mode === "register" && <span className="text-xs font-normal text-muted-foreground">Хамгийн багадаа 8 тэмдэгт</span>}
          </label>
          {mode === "register" && (
            <>
              <label className="block text-sm font-semibold">Утас (заавал биш)
                <input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value.replace(/[^\d+]/g, "") })} inputMode="tel" className={input} />
              </label>
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" required checked={f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })} className="mt-0.5 h-4 w-4 accent-[var(--primary)]" />
                <span><Link to="/privacy" target="_blank" className="font-semibold text-primary underline">Нууцлалын бодлого</Link> болон ашиглалтын нөхцөлийг зөвшөөрч байна.</span>
              </label>
            </>
          )}
          {err && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">{err}</p>}
          <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3.5 font-bold text-white hover:brightness-110 disabled:opacity-60">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}{mode === "login" ? "Нэвтрэх" : "Бүртгэл үүсгэх"}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">Бүртгэлгүйгээр ч <Link to="/assessment" className="font-semibold text-primary">үнэлгээ өгч</Link> болно.</p>
      </div>
    </div>
  );
}
