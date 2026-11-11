from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from ..db import get_db, new_id, now
from ..ml.predictor import get_engine
from ..security import audit, current_user, decrypt, encrypt, optional_user
from ..services.advice import chat_reply, extract_updates, generate_advice

router = APIRouter(prefix="/api", tags=["assessments"])

Symptom = Literal["chest_pain", "coughing_blood", "short_breath", "fatigue", "weight_loss",
                  "swallow_diff", "thirst", "none"]


class Answers(BaseModel):
    age: int = Field(ge=10, le=100)
    gender: Literal["male", "female"]
    height: float = Field(ge=100, le=220)
    weight: float = Field(ge=30, le=200)
    bp_systolic: float = Field(ge=80, le=220)
    smoking: Literal["never", "former", "current"]
    alcohol_freq: Literal["never", "seldom", "often", "daily"]
    salt_intake: float = Field(ge=1, le=10)
    air_pollution: float = Field(ge=1, le=10)
    activity: Literal["low", "moderate", "high"] = "moderate"
    fruit_veg: Literal["rare", "some", "daily"] = "some"
    cholesterol: Literal["unknown", "normal", "borderline", "high"] = "unknown"
    blood_sugar: Literal["unknown", "normal", "high"] = "unknown"
    family_history: list[Literal["diabetes", "heart", "cancer", "none"]] = []
    symptoms: list[Symptom] = []
    body_parts: list[str] = Field(default=[], max_length=7)
    notes: str = Field(default="", max_length=500)


class AssessIn(BaseModel):
    answers: Answers
    consent: bool
    with_advice: bool = True


def _summary(doc: dict) -> dict:
    return {"id": doc["_id"], "created_at": doc["created_at"], "model_version": doc.get("model_version"),
            "overall": doc.get("overall"), "scores": doc.get("scores"), "bmi": doc.get("bmi"),
            "urgent": doc.get("urgent", False)}


@router.post("/assessments")
def create_assessment(body: AssessIn, request: Request, user: dict | None = Depends(optional_user)):
    if not body.consent:
        raise HTTPException(400, "Мэдээлэл боловсруулах зөвшөөрөл шаардлагатай")
    answers = body.answers.model_dump()
    result = get_engine().predict(answers)
    advice = generate_advice(answers, result) if body.with_advice else None
    doc = {
        "_id": new_id(), "user_id": user["_id"] if user else None, "created_at": now(),
        "model_version": result["model_version"],
        # эрүүл мэндийн түүхий хариулт, зөвлөгөөг AES-256-GCM-ээр шифрлэнэ
        "answers_enc": encrypt(answers), "result_enc": encrypt(result),
        "advice_enc": encrypt(advice) if advice else None,
        # статистикт зориулсан нэргүйжүүлсэн оноо
        "scores": {k: v["value"] for k, v in result.get("risks", {}).items()},
        "overall": result.get("overall"), "bmi": result["bmi"], "urgent": result["urgent"],
        "consent": {"at": now(), "v": "1.0"},
    }
    get_db().assessments.insert_one(doc)
    audit("assessment.create", user, doc["_id"], request, urgent=result["urgent"])
    return {"id": doc["_id"], "created_at": doc["created_at"], "answers": answers, "result": result,
            "advice": advice}


@router.post("/assessments/preview")
def preview(answers: Answers):
    """Хадгалахгүйгээр тооцоолох (чат туслах дахин тооцоолоход ашиглана)."""
    return get_engine().predict(answers.model_dump())


@router.post("/assessments/{aid}/advice")
def regenerate_advice(aid: str, user: dict | None = Depends(optional_user)):
    doc = _owned(aid, user, allow_anonymous=True)
    advice = generate_advice(decrypt(doc["answers_enc"]), decrypt(doc["result_enc"]))
    get_db().assessments.update_one({"_id": aid}, {"$set": {"advice_enc": encrypt(advice)}})
    return advice


def _owned(aid: str, user: dict | None, allow_anonymous: bool = False) -> dict:
    doc = get_db().assessments.find_one({"_id": aid})
    if not doc:
        raise HTTPException(404, "Үнэлгээ олдсонгүй")
    if doc.get("user_id") is None and allow_anonymous:
        return doc
    if not user or (doc.get("user_id") != user["_id"] and user["role"] != "admin"):
        raise HTTPException(403, "Энэ үнэлгээг харах эрхгүй")
    return doc


@router.get("/assessments/{aid}")
def get_assessment(aid: str, user: dict | None = Depends(optional_user)):
    doc = _owned(aid, user, allow_anonymous=True)
    return {**_summary(doc), "answers": decrypt(doc["answers_enc"]), "result": decrypt(doc["result_enc"]),
            "advice": decrypt(doc.get("advice_enc"))}


# --- Хэрэглэгчийн түүх ба өгөгдлийн удирдлага ----------------------------------
@router.get("/me/assessments")
def my_history(user: dict = Depends(current_user)):
    docs = get_db().assessments.find({"user_id": user["_id"]}).sort("created_at", -1)
    return [_summary(d) for d in docs]


@router.post("/me/assessments/{aid}/claim")
def claim(aid: str, user: dict = Depends(current_user)):
    """Нэвтрэхээс өмнө хийсэн нэргүй үнэлгээг өөрийн түүхэнд нэмэх."""
    r = get_db().assessments.update_one({"_id": aid, "user_id": None}, {"$set": {"user_id": user["_id"]}})
    return {"claimed": r.modified_count == 1}


@router.delete("/me/assessments/{aid}")
def delete_assessment(aid: str, request: Request, user: dict = Depends(current_user)):
    r = get_db().assessments.delete_one({"_id": aid, "user_id": user["_id"]})
    if not r.deleted_count:
        raise HTTPException(404, "Үнэлгээ олдсонгүй")
    audit("assessment.delete", user, aid, request)
    return {"deleted": True}


@router.delete("/me/data")
def delete_all(request: Request, scope: Literal["assessments", "chats", "all"] = "all",
               user: dict = Depends(current_user)):
    db = get_db()
    n = {}
    if scope in ("assessments", "all"):
        n["assessments"] = db.assessments.delete_many({"user_id": user["_id"]}).deleted_count
    if scope in ("chats", "all"):
        n["chats"] = db.chats.delete_many({"user_id": user["_id"]}).deleted_count
    if scope == "all":
        db.bookings.update_many({"user_id": user["_id"]}, {"$set": {"user_id": None}})
        db.users.delete_one({"_id": user["_id"]})
    audit("user.delete_data", user, user["_id"], request, scope=scope, counts=n)
    return {"deleted": n, "account_deleted": scope == "all"}


# --- Чат туслах ------------------------------------------------------------------
class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=1000)
    history: list[dict] = Field(default=[], max_length=20)
    assessment_id: str | None = None
    answers: dict | None = None


@router.post("/chat")
def chat(body: ChatIn, user: dict | None = Depends(optional_user)):
    answers, result = body.answers, None
    if body.assessment_id:
        doc = _owned(body.assessment_id, user, allow_anonymous=True)
        answers, result = decrypt(doc["answers_enc"]), decrypt(doc["result_enc"])
    out = chat_reply(body.message, body.history, answers, result)
    updates = extract_updates(body.message)
    if updates and answers:
        try:
            merged = Answers(**{**answers, **updates}).model_dump()
            out["updated"] = {"changes": updates, "answers": merged, "result": get_engine().predict(merged)}
        except Exception:
            pass
    if user:
        get_db().chats.insert_one({"_id": new_id(), "user_id": user["_id"], "at": now(),
                                   "enc": encrypt({"q": body.message, "a": out["reply"]})})
    return out
