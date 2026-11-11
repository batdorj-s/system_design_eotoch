"""Мэдлэгийн сангаас хамааралтай бүлгүүдийг TF-IDF (тэмдэгтийн n-gram)-ээр сонгох RAG хэсэг."""
from __future__ import annotations

import json
from pathlib import Path

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from ..db import get_db, new_id, now

SEED_FILE = Path(__file__).resolve().parent.parent / "data" / "knowledge.json"

CATEGORY_QUERIES = {
    "heart": "зүрх даралт холестерин цээж өвдөлт",
    "diabetes": "чихрийн шижин сахар цангах удамшил жин",
    "cancer": "хавдар уушги ханиалга тамхи агаар бохирдол",
}


def seed_knowledge() -> None:
    db = get_db()
    if db.knowledge.count_documents({}) == 0:
        for k in json.loads(SEED_FILE.read_text()):
            db.knowledge.insert_one({"_id": new_id(), **k, "active": True, "updated_at": now()})


def _docs() -> list[dict]:
    return list(get_db().knowledge.find({"active": {"$ne": False}}))


def build_query(answers: dict, result: dict) -> str:
    parts: list[str] = []
    risks = result.get("risks", {})
    for key, r in sorted(risks.items(), key=lambda kv: -kv[1]["value"]):
        if r["level"] != "low":
            parts.append(CATEGORY_QUERIES[key])
        parts += [f["label"].lower() for f in r["factors"] if f["impact"] > 0]
    if answers.get("smoking") == "current":
        parts.append("тамхи гарах")
    if answers.get("alcohol_freq") in ("often", "daily"):
        parts.append("архи")
    if (float(answers.get("salt_intake") or 5)) >= 7:
        parts.append("давс цай")
    if answers.get("activity") == "low":
        parts.append("хөдөлгөөн дасгал")
    if answers.get("fruit_veg") == "rare":
        parts.append("жимс ногоо хоол")
    if result.get("bmi", 22) >= 25:
        parts.append("жин таргалалт")
    if (float(answers.get("air_pollution") or 5)) >= 7:
        parts.append("агаар бохирдол утаа")
    return " ".join(parts) or "урьдчилан сэргийлэх үзлэг"


def retrieve(query: str, k: int = 10) -> list[dict]:
    docs = _docs()
    if not docs:
        return []
    texts = [f"{' '.join(d.get('tags', []))} {d['category']} {d['content']}" for d in docs]
    vec = TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), sublinear_tf=True)
    M = vec.fit_transform(texts + [query.lower()])
    sims = cosine_similarity(M[-1], M[:-1]).ravel()
    order = sims.argsort()[::-1][:k]
    return [{"id": docs[i]["_id"], "category": docs[i]["category"], "content": docs[i]["content"],
             "source": docs[i]["source"], "score": round(float(sims[i]), 3)} for i in order if sims[i] > 0]
