"""AI зөвлөгөө: Gemini → Ollama → дүрэмд суурилсан загвар (fallback).

Нууцлал: LLM рүү зөвхөн нас/хүйс/эрсдэлийн дүн, идэвхтэй хүчин зүйлс болон сонгосон
мэдлэгийн бүлгүүдийг дамжуулна — нэр, утас, байршил, чөлөөт бичвэр дамжуулахгүй.
"""
from __future__ import annotations

import logging
import re

import httpx

from ..config import get_settings
from ..ml.features import bmi_of
from .knowledge import build_query, retrieve

log = logging.getLogger("eotoch.advice")

DISCLAIMER = "⚕️ Энэ нь эмнэлгийн онош биш, эрсдэлийн урьдчилсан тооцоо юм. Эмчтэй зөвлөлдөнө үү."

SYSTEM = (
    "Чи бол 'Eotoch' — Монголын эрүүл мэндийн AI туслах. Зөвхөн монгол хэлээр, ойлгомжтой, дулаахан "
    "өнгөөр бич. Эмийн жор, эмийн нэр, тун хэзээ ч бүү санал болго. Онош бүү тавь. "
    "'100% үнэн' мэт хэтрүүлсэн үг бүү хэрэглэ. Өгөгдсөн мэдлэгийн сангийн баримтыг ашигла."
)

TIPS = {
    "lifestyle_smoking": "🚭 Тамхинаас гарах нь таны хамгийн том ахиц болно — 1 жилийн дотор зүрхний эрсдэл хагасаар буурна. Зөвлөгөөний утас 1800-1218.",
    "Smoking": "🚭 Тамхидалт уушгины хавдрын гол шалтгаан — гарах төлөвлөгөөгөө өнөөдрөөс эхлүүлээрэй.",
    "smoker": "🚭 Тамхи нь инсулины мэдрэмжийг бууруулдаг — гарах нь сахрын хяналтад ч тустай.",
    "trestbps": "🩺 Даралтаа долоо хоногт 2–3 удаа хэмжиж тэмдэглэ; 140/90-ээс дээш байвал эмчид хандаарай.",
    "lifestyle_bp": "🩺 Даралтаа долоо хоногт 2–3 удаа хэмжиж тэмдэглэ; 140/90-ээс дээш байвал эмчид хандаарай. Давс, архийг багасгах нь даралтыг бууруулна.",
    "sys_bp": "🩺 Даралт ихсэлт чихрийн шижинтэй хамт явдаг — даралтаа тогтмол хянаарай.",
    "lifestyle_salt": "🧂 Цайндаа давс хийхээ больж, хиам, лаазалсан хүнсийг багасгаад өдрийн давсаа 5 г хүртэл буулгаарай.",
    "bmi": "⚖️ Жингийн 5–10%-ийг бууруулахад чихрийн шижингийн эрсдэл 58% хүртэл буурна. Тавагныхаа хагасыг ногоогоор дүүргээрэй.",
    "Obesity": "⚖️ Жингээ хэвийн хэмжээнд барих нь хэд хэдэн төрлийн хавдрын эрсдэлийг бууруулна.",
    "lifestyle_obesity": "⚖️ Хэвлийн таргалалт зүрхний ачааллыг нэмэгдүүлдэг — бүсэлхийгээ хэмжиж хянаарай.",
    "lifestyle_inactive": "🚶 Өдөр бүр 30 минут хурдан алхах (долоо хоногт 150 мин) зорилт тавиарай.",
    "inactive": "🚶 Хоолны дараа 10–15 минут алхах нь цусан дахь сахрын огцом өсөлтийг бууруулна.",
    "lifestyle_alcohol": "🍷 Архины хэрэглээгээ эрс багасгаарай — аюулгүй хэмжээ гэж байдаггүй.",
    "Alcohol use": "🍷 Согтууруулах ундаа 7 төрлийн хавдрын шалтгаан — хэрэглээгээ багасгаарай.",
    "lifestyle_diet": "🥗 Өдөр бүр 400 г жимс, ногоо идэхийг зорь.",
    "low_fruit_veg": "🥗 Цагаан гурил, чихэрлэг ундааг ногоо, бүхэл үр тариагаар орлуулаарай.",
    "Balanced Diet": "🥗 Тэнцвэртэй хооллолт — улаан мах, өөхийг багасгаж ногоо, загас нэмээрэй.",
    "Air Pollution": "😷 Утаатай өдрүүдэд KN95 амны хаалт зүүж, гэртээ агаар цэвэршүүлэгч ашиглаарай.",
    "family_diabetes": "🧬 Гэр бүлд чихрийн шижин байгаа тул жил бүр өлөн үеийн сахраа шинжлүүлээрэй.",
    "Genetic Risk": "🧬 Удамшлын эрсдэлтэй тул хавдрын эрт илрүүлэг үзлэгт тогтмол хамрагдаарай.",
    "lifestyle_family": "🧬 Гэр бүлд зүрхний өвчин байгаа тул холестерин, даралтаа жил бүр шалгуулаарай.",
    "thirst": "💧 Их цангах, олон шээх шинж нь сахар ихсэлтийн шинж байж болно — шинжилгээ өгөөрэй.",
    "exang": "❤️ Хүч гаргахад цээж өвдөж байгаа бол зүрх судасны эмчид аль болох хурдан үзүүлээрэй.",
    "Coughing of Blood": "🚨 Цустай ханиалга нь яаралтай үзлэг шаарддаг шинж тэмдэг.",
    "high_bp": "🩺 Даралт ихсэлт чихрийн шижинтэй хамт явдаг — даралтаа тогтмол хянаарай.",
    "high_chol": "🧈 Холестерин өндөр бол амьтны өөх, шарсан хоолыг багасгаж, загас, ногоо нэмээрэй.",
    "ever_smoker": "🚭 Тамхи нь инсулины мэдрэмжийг бууруулдаг — гарах нь сахрын хяналтад ч тустай.",
    "no_fruits": "🍎 Өдөр бүр 1–2 жимс идэхийг зорь (чихэрлэг ундааны оронд).",
    "no_veggies": "🥗 Өдөр бүр ногоо идэж, тавагныхаа хагасыг ногоогоор дүүргээрэй.",
    "diab_family": "🧬 Гэр бүлд чихрийн шижин байгаа тул жил бүр өлөн үеийн сахраа шинжлүүлээрэй.",
    "diab_thirst": "💧 Их цангах, олон шээх шинж нь сахар ихсэлтийн шинж байж болно — шинжилгээ өгөөрэй.",
    "chol": "🧈 Холестерин өндөр бол амьтны өөх, шарсан хоолыг багасгаарай.",
}


def _summary_line(result: dict) -> str:
    o = result["overall"]
    top = max(result["risks"].values(), key=lambda r: r["value"])
    if o["level"] == "high":
        return f"Таны нийт эрсдэл өндөр ({o['value']:.0f}%) бөгөөд ялангуяа {top['label'].lower()}ын эрсдэл ({top['value']:.0f}%) анхаарал татаж байна. Эмчид ойрын хугацаанд үзүүлэхийг зөвлөж байна."
    if o["level"] == "moderate":
        return f"Таны нийт эрсдэл дунд түвшинд ({o['value']:.0f}%) байна. {top['label']} ({top['value']:.0f}%) хамгийн өндөр — амьдралын хэв маягаа өөрчилснөөр бууруулах боломжтой."
    return f"Сайн мэдээ — таны нийт эрсдэл бага ({o['value']:.0f}%) байна. Одоогийн эрүүл зуршлаа хадгалаарай."


def template_advice(answers: dict, result: dict, sources: list[dict]) -> str:
    tips: list[str] = []
    factors = sorted((f for r in result["risks"].values() for f in r["factors"] if f["impact"] > 0.3),
                     key=lambda f: -f["impact"])
    for f in factors:
        t = TIPS.get(f["feature"])
        if t and t not in tips:
            tips.append(t)
    defaults = [TIPS["lifestyle_inactive"], TIPS["lifestyle_diet"], TIPS["lifestyle_salt"],
                "🩺 Жил бүр урьдчилан сэргийлэх үзлэгт хамрагдаж даралт, сахар, холестеринээ шалгуулаарай."]
    for t in defaults:
        if len(tips) >= 3:
            break
        if t not in tips:
            tips.append(t)
    fact = f"\n\n📊 Баримт: {sources[0]['content']} ({sources[0]['source']})" if sources else ""
    return (f"{_summary_line(result)}\n\n" + "\n".join(f"• {t}" for t in tips[:5]) + fact +
            "\n\nЖижиг алхам бүр чухал — та өөрийн эрүүл мэндээ сайжруулах бүрэн боломжтой! 💪")


def _llm_prompt(answers: dict, result: dict, sources: list[dict]) -> str:
    risks = "\n".join(f"- {r['label']}: {r['value']:.0f}% ({r['level_label']}); гол хүчин зүйл: "
                      + ", ".join(f"{f['label']} ({f['impact']:+.0f}%)" for f in r["factors"][:3])
                      for r in result["risks"].values())
    kb = "\n".join(f"- {s['content']} ({s['source']})" for s in sources)
    return f"""{SYSTEM}

Хэрэглэгч: {int(float(answers.get('age', 30)))} настай {'эрэгтэй' if answers.get('gender') == 'male' else 'эмэгтэй'}, BMI {bmi_of(answers):.1f}.
ML загварын эрсдэлийн дүн (нийт {result['overall']['value']:.0f}%):
{risks}

Мэдлэгийн сан (ДЭМБ STEPS болон бусад):
{kb}

Дараах бүтцээр 500–1200 тэмдэгтэд багтаан бич:
1. Ерөнхий дүгнэлт (1–2 өгүүлбэр)
2. Хамгийн чухал 3–5 бодит зөвлөмж (• тэмдэгтэй; хооллолт, хөдөлгөөн, тамхи, архи, давс)
3. Урам өгсөн төгсгөл (1 өгүүлбэр)"""


def _gemini(prompt: str) -> str | None:
    s = get_settings()
    if not s.gemini_api_key:
        return None
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{s.gemini_model}:generateContent"
    try:
        r = httpx.post(url, headers={"x-goog-api-key": s.gemini_api_key}, timeout=25,
                       json={"contents": [{"parts": [{"text": prompt}]}],
                             "generationConfig": {"temperature": 0.6, "maxOutputTokens": 1200}})
        if r.status_code != 200:
            log.warning("Gemini %s: %s", r.status_code, r.json().get("error", {}).get("message", "")[:200])
            return None
        return r.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
    except Exception as e:
        log.warning("Gemini алдаа: %s", type(e).__name__)
        return None


def _ollama(prompt: str) -> str | None:
    s = get_settings()
    if not s.ollama_url:
        return None
    try:
        r = httpx.post(f"{s.ollama_url.rstrip('/')}/api/generate", timeout=60,
                       json={"model": s.ollama_model, "prompt": prompt, "stream": False})
        r.raise_for_status()
        return r.json().get("response", "").strip() or None
    except Exception as e:
        log.warning("Ollama алдаа: %s", e)
        return None


_FORBIDDEN = re.compile(r"(\d+\s?(мг|mg)\b|таблет|ууж эмчил|100\s?%)", re.I)


def _safe(text: str) -> bool:
    return not _FORBIDDEN.search(text)


def generate_advice(answers: dict, result: dict) -> dict:
    if not result.get("in_scope", True) or "risks" not in result:
        return {"text": result.get("scope_message", ""), "provider": "rule", "sources": [],
                "disclaimer": DISCLAIMER}
    sources = retrieve(build_query(answers, result), k=10)
    prompt = _llm_prompt(answers, result, sources)
    for name, fn in (("gemini", _gemini), ("ollama", _ollama)):
        text = fn(prompt)
        if text and _safe(text):
            return {"text": text, "provider": name, "sources": sources[:5], "disclaimer": DISCLAIMER}
    return {"text": template_advice(answers, result, sources), "provider": "template",
            "sources": sources[:5], "disclaimer": DISCLAIMER}


# --- Чат туслах ----------------------------------------------------------------
_PATTERNS = {
    "bp_systolic": re.compile(r"даралт\D{0,15}(\d{2,3})"),
    "weight": re.compile(r"(?:жин\D{0,10}(\d{2,3})|(\d{2,3})\s?кг)"),
    "height": re.compile(r"(?:өндөр\D{0,10}(\d{3})|(\d{3})\s?см)"),
    "age": re.compile(r"(\d{2})\s?(?:настай|нас)"),
}


def extract_updates(message: str) -> dict:
    """'Даралт 150 болсон', 'жин 80 кг' гэх мэт шинэ мэдээллийг таньж авна."""
    m = message.lower()
    out: dict = {}
    for key, rx in _PATTERNS.items():
        hit = rx.search(m)
        if hit:
            val = next(g for g in hit.groups() if g)
            out[key] = val
    if re.search(r"тамхи(наас)?\s?(гарсан|хаясан|больсон)", m):
        out["smoking"] = "former"
    elif re.search(r"тамхи\s?(татдаг|татаж байна)", m):
        out["smoking"] = "current"
    return out


def chat_reply(message: str, history: list[dict], answers: dict | None, result: dict | None) -> dict:
    sources = retrieve(message, k=4)
    ctx = ""
    if result and result.get("risks"):
        ctx = "Хэрэглэгчийн сүүлийн үнэлгээ: " + ", ".join(
            f"{r['label']} {r['value']:.0f}%" for r in result["risks"].values()) + "."
    hist = "\n".join(f"{'Хэрэглэгч' if h.get('role') == 'user' else 'Eotoch'}: {h.get('text', '')}"
                     for h in history[-6:])
    kb = "\n".join(f"- {s['content']} ({s['source']})" for s in sources)
    prompt = (f"{SYSTEM}\nХариултаа 2–5 өгүүлбэрт багтаа. Яаралтай шинж тэмдэг дурдвал 103 руу залгахыг сануул.\n"
              f"{ctx}\nМэдлэгийн сан:\n{kb}\n\nЯриа:\n{hist}\nХэрэглэгч: {message}\nEotoch:")
    for name, fn in (("gemini", _gemini), ("ollama", _ollama)):
        text = fn(prompt)
        if text and _safe(text):
            return {"reply": text, "provider": name, "sources": sources}
    if re.search(r"цээж.*өвд|амьсгал давч|ухаан|цус.*ханиа", message.lower()):
        reply = "🚨 Таны дурдсан шинж тэмдэг яаралтай байж болзошгүй. Нэн даруй 103 руу залгах эсвэл ойрын яаралтай тусламжийн эмнэлэгт хандана уу."
    elif sources:
        reply = f"{sources[0]['content']} ({sources[0]['source']})"
        if len(sources) > 1:
            reply += f"\n\nМөн: {sources[1]['content']}"
    else:
        reply = "Уучлаарай, энэ асуултад хариулах мэдээлэл алга. Эмчтэйгээ зөвлөлдөнө үү."
    return {"reply": reply, "provider": "knowledge_base", "sources": sources}
