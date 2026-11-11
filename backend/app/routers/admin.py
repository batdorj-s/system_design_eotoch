from __future__ import annotations

import json
import subprocess
import sys
import threading
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field

from ..config import get_settings
from ..db import get_db, new_id, now
from ..ml.predictor import get_engine
from ..security import audit, hash_password, public_user, require_role
from .hospitals import HospitalUpdate

router = APIRouter(prefix="/api/admin", tags=["admin"])
admin_only = require_role("admin")


@router.get("/stats")
def stats(days: int = 30, _: dict = Depends(admin_only)):
    db = get_db()
    since = now() - timedelta(days=days)
    docs = list(db.assessments.find({"created_at": {"$gte": since}},
                                    {"scores": 1, "overall": 1, "created_at": 1, "urgent": 1, "bmi": 1}))
    levels = {"low": 0, "moderate": 0, "high": 0}
    daily: dict[str, int] = {}
    sums = {"heart": 0.0, "diabetes": 0.0, "cancer": 0.0}
    n_scored = 0
    for d in docs:
        if d.get("overall"):
            levels[d["overall"]["level"]] += 1
        if d.get("scores"):
            n_scored += 1
            for k in sums:
                sums[k] += d["scores"].get(k, 0)
        key = d["created_at"].strftime("%Y-%m-%d")
        daily[key] = daily.get(key, 0) + 1
    return {
        "users": db.users.count_documents({"role": "user"}),
        "staff": db.users.count_documents({"role": "staff"}),
        "assessments_total": db.assessments.count_documents({}),
        "assessments_period": len(docs),
        "urgent_period": sum(1 for d in docs if d.get("urgent")),
        "risk_levels": levels,
        "avg_scores": {k: round(v / n_scored, 1) if n_scored else 0 for k, v in sums.items()},
        "daily": [{"date": k, "count": v} for k, v in sorted(daily.items())],
        "bookings": {s: db.bookings.count_documents({"status": s})
                     for s in ("pending", "confirmed", "cancelled", "completed", "no_show")},
        "hospitals": db.hospitals.count_documents({"active": {"$ne": False}}),
        "model_version": get_engine().version,
    }


# --- Эмнэлэг -------------------------------------------------------------------
class HospitalIn(HospitalUpdate):
    id: str = Field(pattern=r"^[a-z0-9-]{2,40}$")
    name: str
    lat: float = Field(ge=41, le=53)
    lng: float = Field(ge=87, le=120)
    type: str = "Public"
    specialties: list[str] = []


@router.get("/hospitals")
def all_hospitals(_: dict = Depends(admin_only)):
    return [{**{k: v for k, v in h.items() if k != "_id"}, "id": h["_id"]} for h in get_db().hospitals.find()]


@router.post("/hospitals")
def add_hospital(body: HospitalIn, request: Request, user: dict = Depends(admin_only)):
    db = get_db()
    if db.hospitals.find_one({"_id": body.id}):
        raise HTTPException(409, "Ийм ID-тай эмнэлэг байна")
    doc = body.model_dump(exclude={"id"}, exclude_none=True) | {"_id": body.id, "active": True, "created_at": now()}
    db.hospitals.insert_one(doc)
    audit("hospital.create", user, body.id, request)
    return {"id": body.id}


@router.put("/hospitals/{hid}")
def edit_hospital(hid: str, body: HospitalUpdate, request: Request, user: dict = Depends(admin_only)):
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    r = get_db().hospitals.update_one({"_id": hid}, {"$set": patch | {"updated_at": now()}})
    if not r.matched_count:
        raise HTTPException(404, "Эмнэлэг олдсонгүй")
    audit("hospital.update", user, hid, request, fields=list(patch))
    return {"ok": True}


@router.post("/hospitals/{hid}/active")
def toggle_hospital(hid: str, active: bool, request: Request, user: dict = Depends(admin_only)):
    get_db().hospitals.update_one({"_id": hid}, {"$set": {"active": active}})
    audit("hospital.active", user, hid, request, active=active)
    return {"ok": True}


# --- Хэрэглэгч / ажилтан ----------------------------------------------------------
@router.get("/users")
def users(role: str | None = None, _: dict = Depends(admin_only)):
    q = {"role": role} if role else {}
    out = []
    for u in get_db().users.find(q).sort("created_at", -1).limit(500):
        out.append(public_user(u) | {"assessments": get_db().assessments.count_documents({"user_id": u["_id"]})})
    return out


class StaffIn(BaseModel):
    email: EmailStr
    name: str
    password: str = Field(min_length=8)
    hospital_id: str


@router.post("/staff")
def add_staff(body: StaffIn, request: Request, user: dict = Depends(admin_only)):
    db = get_db()
    if db.users.find_one({"email": body.email.lower()}):
        raise HTTPException(409, "Имэйл бүртгэлтэй байна")
    if not db.hospitals.find_one({"_id": body.hospital_id}):
        raise HTTPException(404, "Эмнэлэг олдсонгүй")
    uid = new_id()
    db.users.insert_one({"_id": uid, "email": body.email.lower(), "name": body.name, "role": "staff",
                         "hospital_id": body.hospital_id, "password": hash_password(body.password),
                         "active": True, "created_at": now()})
    audit("staff.create", user, uid, request)
    return {"id": uid}


@router.delete("/users/{uid}/data")
def erase_user(uid: str, request: Request, user: dict = Depends(admin_only)):
    """Хэрэглэгчийн хүсэлтээр бүх өгөгдлийг устгах."""
    db = get_db()
    n = {"assessments": db.assessments.delete_many({"user_id": uid}).deleted_count,
         "chats": db.chats.delete_many({"user_id": uid}).deleted_count}
    db.bookings.update_many({"user_id": uid}, {"$set": {"user_id": None}})
    db.users.delete_one({"_id": uid, "role": {"$ne": "admin"}})
    audit("admin.erase_user", user, uid, request, counts=n)
    return {"deleted": n}


# --- Мэдлэгийн сан ------------------------------------------------------------------
class KnowledgeIn(BaseModel):
    category: str = Field(max_length=30)
    content: str = Field(min_length=10, max_length=1000)
    source: str = Field(max_length=120)
    tags: list[str] = []
    active: bool = True


@router.get("/knowledge")
def knowledge(_: dict = Depends(admin_only)):
    return [{**{k: v for k, v in d.items() if k != "_id"}, "id": d["_id"]}
            for d in get_db().knowledge.find().sort("category", 1)]


@router.post("/knowledge")
def add_knowledge(body: KnowledgeIn, request: Request, user: dict = Depends(admin_only)):
    kid = new_id()
    get_db().knowledge.insert_one({"_id": kid, **body.model_dump(), "updated_at": now()})
    audit("knowledge.create", user, kid, request)
    return {"id": kid}


@router.put("/knowledge/{kid}")
def edit_knowledge(kid: str, body: KnowledgeIn, request: Request, user: dict = Depends(admin_only)):
    get_db().knowledge.update_one({"_id": kid}, {"$set": body.model_dump() | {"updated_at": now()}})
    audit("knowledge.update", user, kid, request)
    return {"ok": True}


@router.delete("/knowledge/{kid}")
def delete_knowledge(kid: str, request: Request, user: dict = Depends(admin_only)):
    get_db().knowledge.delete_one({"_id": kid})
    audit("knowledge.delete", user, kid, request)
    return {"ok": True}


# --- ML загвар --------------------------------------------------------------------
_train_state = {"running": False, "log": "", "started_at": None, "finished_at": None, "ok": None}


def _run_training(version: str) -> None:
    s = get_settings()
    try:
        p = subprocess.run([sys.executable, str(s.ai_model_dir / "eda.py")], capture_output=True, text=True,
                           cwd=s.ai_model_dir, timeout=600)
        p2 = subprocess.run([sys.executable, str(s.ai_model_dir / "train.py"), "--version", version],
                            capture_output=True, text=True, cwd=s.ai_model_dir, timeout=1800)
        _train_state["log"] = (p.stdout + p2.stdout + p2.stderr)[-6000:]
        _train_state["ok"] = p2.returncode == 0
        if p2.returncode == 0:
            get_engine().load()
    except Exception as e:
        _train_state["log"] += f"\n{e}"
        _train_state["ok"] = False
    finally:
        _train_state["running"] = False
        _train_state["finished_at"] = now()


class RetrainIn(BaseModel):
    version: str = Field(pattern=r"^v[\w.-]{1,30}$")


@router.post("/model/retrain")
def retrain(body: RetrainIn, request: Request, user: dict = Depends(admin_only)):
    if _train_state["running"]:
        raise HTTPException(409, "Сургалт явагдаж байна")
    _train_state.update(running=True, log="", started_at=now(), finished_at=None, ok=None)
    threading.Thread(target=_run_training, args=(body.version,), daemon=True).start()
    audit("model.retrain", user, body.version, request)
    return {"started": True}


@router.get("/model/status")
def model_status(_: dict = Depends(admin_only)):
    return {**_train_state, "version": get_engine().version}


# --- Аудит --------------------------------------------------------------------------
@router.get("/audit")
def audit_log(action: str | None = None, role: str | None = None, limit: int = 200,
              _: dict = Depends(admin_only)):
    q: dict = {}
    if action:
        q["action"] = {"$regex": f"^{action}"}
    if role:
        q["actor_role"] = role
    return [{**{k: v for k, v in d.items() if k != "_id"}, "id": str(d["_id"])}
            for d in get_db().audit.find(q).sort("ts", -1).limit(min(limit, 1000))]
