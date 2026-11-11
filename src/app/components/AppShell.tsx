import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router";
import { Menu, X, PhoneCall, MessageCircle, LogOut, UserRound, ShieldCheck } from "lucide-react";
import { useAuth } from "../lib/auth";
import { SOSDialog } from "./SOSDialog";
import { ChatAssistant } from "./ChatAssistant";

const NAV = [
  { to: "/assessment", label: "Үнэлгээ" },
  { to: "/hospitals", label: "Эмнэлэг" },
  { to: "/insights", label: "Өгөгдөл ба ML" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [sos, setSos] = useState(false);
  const [chat, setChat] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();

  useEffect(() => setOpen(false), [loc.pathname]);

  const links = [
    ...NAV,
    ...(user ? [{ to: "/me", label: "Миний түүх" }] : []),
    ...(user?.role === "staff" || user?.role === "admin" ? [{ to: "/staff", label: "Эмнэлэг (ажилтан)" }] : []),
    ...(user?.role === "admin" ? [{ to: "/admin", label: "Админ" }] : []),
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <header className="no-print sticky top-0 z-40 border-b bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4">
          <Link to="/" className="flex items-center gap-2.5 shrink-0" aria-label="Eotoch нүүр">
            <img src="/logo.jpg" alt="" className="h-9 w-9 rounded-lg object-cover ring-1 ring-border" />
            <span className="font-display text-lg font-extrabold tracking-tight text-primary">Eotoch</span>
          </Link>
          <nav className="hidden lg:flex items-center gap-1 ml-4" aria-label="Үндсэн цэс">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) =>
                  `whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${isActive ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setSos(true)}
              className="flex items-center gap-1.5 rounded-full bg-red-600 px-3.5 py-2 text-sm font-bold text-white shadow-sm hover:bg-red-700 focus-visible:ring-4 focus-visible:ring-red-200"
              aria-label="Яаралтай тусламж 103"
            >
              <PhoneCall className="h-4 w-4" /> SOS
            </button>
            {user ? (
              <div className="hidden lg:flex items-center gap-2">
                <Link to="/me" className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm hover:bg-muted">
                  <UserRound className="h-4 w-4 text-primary" />
                  <span className="max-w-[120px] truncate">{user.name}</span>
                </Link>
                <button
                  onClick={() => { logout(); nav("/"); }}
                  className="rounded-full p-2 text-muted-foreground hover:bg-muted"
                  aria-label="Гарах"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <Link to="/login" className="hidden lg:inline-flex rounded-full border px-4 py-2 text-sm font-medium hover:bg-muted">
                Нэвтрэх
              </Link>
            )}
            <button className="lg:hidden rounded-lg p-2 hover:bg-muted" onClick={() => setOpen(!open)} aria-label="Цэс" aria-expanded={open}>
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
        {open && (
          <nav className="lg:hidden border-t bg-white px-4 py-3 space-y-1" aria-label="Гар утасны цэс">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} className="block rounded-lg px-3 py-2.5 font-medium hover:bg-muted">
                {l.label}
              </NavLink>
            ))}
            {user ? (
              <button onClick={() => { logout(); nav("/"); }} className="block w-full text-left rounded-lg px-3 py-2.5 font-medium text-muted-foreground hover:bg-muted">
                Гарах
              </button>
            ) : (
              <NavLink to="/login" className="block rounded-lg px-3 py-2.5 font-medium text-primary hover:bg-muted">Нэвтрэх / Бүртгүүлэх</NavLink>
            )}
          </nav>
        )}
      </header>

      <main className="flex-1">{children}</main>

      <footer className="no-print border-t bg-white">
        <div className="mx-auto max-w-6xl px-4 py-6 text-sm text-muted-foreground flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
          <p className="flex items-start gap-2">
            <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
            Eotoch нь эмнэлгийн онош биш, эрсдэлийн урьдчилсан тооцоо гаргадаг. Эмчтэй зөвлөлдөнө үү.
          </p>
          <div className="flex gap-4">
            <Link to="/privacy" className="hover:text-foreground">Нууцлалын бодлого</Link>
            <a href="mailto:support@eotoch.mn" className="hover:text-foreground">Санал, гомдол</a>
          </div>
        </div>
      </footer>

      <button
        onClick={() => setChat(true)}
        className="no-print fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-lg shadow-primary/30 hover:brightness-110 focus-visible:ring-4 focus-visible:ring-primary/30"
        aria-label="AI туслахтай ярих"
      >
        <MessageCircle className="h-6 w-6" />
      </button>

      <SOSDialog open={sos} onClose={() => setSos(false)} />
      <ChatAssistant open={chat} onClose={() => setChat(false)} />
    </div>
  );
}
