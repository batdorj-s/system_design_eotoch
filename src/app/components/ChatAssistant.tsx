import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Send, Volume2, X, Bot, Sparkles } from "lucide-react";
import type { RiskResult } from "../lib/types";
import { api, session } from "../domain";

interface Msg {
  role: "user" | "bot";
  text: string;
  updated?: { changes: Record<string, string>; result: RiskResult };
}

const SUGGESTIONS = ["Даралтаа яаж бууруулах вэ?", "Тамхинаас гарахад юу туслах вэ?", "Миний даралт 150 болсон"];

// Web Speech API (Chrome, Edge, Safari)
type SR = { lang: string; interimResults: boolean; start(): void; stop(): void; onresult: (e: { results: { 0: { transcript: string } }[] }) => void; onend: () => void; onerror: () => void };
const SpeechRec = (window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }).SpeechRecognition
  ?? (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition;

function speak(text: string) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/[•📊🚭🩺🧂⚖️🚶🍷🥗😷🧬💧❤️🚨🧈💪⚕️]/gu, ""));
  const voices = window.speechSynthesis.getVoices();
  u.voice = voices.find((v) => v.lang.startsWith("mn")) ?? voices.find((v) => v.lang.startsWith("ru")) ?? null;
  u.lang = u.voice?.lang ?? "mn-MN";
  u.rate = 0.95;
  window.speechSynthesis.speak(u);
}

export function ChatAssistant({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "bot", text: "Сайн байна уу! Би Eotoch AI туслах. Эрүүл мэндийн асуултаа бичих эсвэл 🎤 дарж ярина уу." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<SR | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [msgs]);

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    setInput("");
    const history = msgs.map((m) => ({ role: m.role === "user" ? "user" : "assistant", text: m.text }));
    setMsgs((m) => [...m, { role: "user", text: t }]);
    setBusy(true);
    try {
      const r = await api.post<{ reply: string; updated?: Msg["updated"] }>("/api/chat", {
        message: t, history, assessment_id: session.getLastId() ?? undefined,
      });
      setMsgs((m) => [...m, { role: "bot", text: r.reply, updated: r.updated }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "bot", text: (e as Error).message }]);
    } finally {
      setBusy(false);
    }
  };

  const toggleMic = () => {
    if (!SpeechRec) {
      setMsgs((m) => [...m, { role: "bot", text: "Таны хөтөч дуу таних функцийг дэмжихгүй байна. Chrome эсвэл Edge ашиглана уу." }]);
      return;
    }
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = new SpeechRec();
    rec.lang = "mn-MN";
    rec.interimResults = false;
    rec.onresult = (e) => send(e.results[0][0].transcript);
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  };

  if (!open) return null;
  return (
    <div className="no-print fixed inset-0 z-50 flex items-end justify-end bg-black/20 sm:p-5" onClick={onClose}>
      <section
        className="flex h-[85vh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:h-[600px] sm:max-w-md sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="AI туслах"
      >
        <header className="flex items-center gap-3 border-b bg-primary px-5 py-4 text-white">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20"><Bot className="h-5 w-5" /></div>
          <div className="flex-1">
            <p className="font-display font-bold">Eotoch AI туслах</p>
            <p className="text-xs text-white/80">Дуу болон бичгээр · онош биш, зөвлөгөө</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 hover:bg-white/15" aria-label="Хаах"><X className="h-5 w-5" /></button>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto bg-muted/40 p-4" aria-live="polite">
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-line ${m.role === "user" ? "bg-primary text-white rounded-br-md" : "bg-white border rounded-bl-md"}`}>
                {m.text}
                {m.updated?.result.risks && (
                  <div className="mt-3 rounded-xl bg-secondary p-3 text-sm text-secondary-foreground">
                    <p className="mb-1 flex items-center gap-1 font-semibold"><Sparkles className="h-4 w-4" /> Шинэ мэдээллээр дахин тооцоолов</p>
                    {Object.values(m.updated.result.risks).map((r) => (
                      <p key={r.label}>{r.label}: <b>{Math.round(r.value)}%</b></p>
                    ))}
                  </div>
                )}
                {m.role === "bot" && i > 0 && (
                  <button onClick={() => speak(m.text)} className="mt-1.5 flex items-center gap-1 text-xs text-primary hover:underline">
                    <Volume2 className="h-3.5 w-3.5" /> Сонсох
                  </button>
                )}
              </div>
            </div>
          ))}
          {busy && <div className="w-16 rounded-2xl bg-white border px-4 py-3 text-muted-foreground">…</div>}
          <div ref={endRef} />
        </div>

        {msgs.length < 3 && (
          <div className="flex gap-2 overflow-x-auto border-t px-4 py-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => send(s)} className="shrink-0 rounded-full border px-3 py-1.5 text-sm hover:bg-muted">{s}</button>
            ))}
          </div>
        )}

        <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex items-center gap-2 border-t p-3">
          <button
            type="button"
            onClick={toggleMic}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${listening ? "bg-red-600 text-white animate-pulse" : "bg-secondary text-secondary-foreground"}`}
            aria-label={listening ? "Бичлэг зогсоох" : "Дуугаар асуух"}
          >
            {listening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={1000}
            placeholder="Асуултаа бичнэ үү…"
            className="h-11 flex-1 rounded-full border bg-white px-4 outline-none focus:ring-2 focus:ring-primary/30"
            aria-label="Асуулт"
          />
          <button type="submit" disabled={!input.trim() || busy} className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-white disabled:opacity-40" aria-label="Илгээх">
            <Send className="h-5 w-5" />
          </button>
        </form>
      </section>
    </div>
  );
}

export { speak };
