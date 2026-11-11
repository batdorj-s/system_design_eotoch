from __future__ import annotations

import math
import random
from datetime import date, datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from ..db import get_db, new_id, now
from ..security import audit, current_user, optional_user, require_role

router = APIRouter(prefix="/api", tags=["hospitals"])
UB = ZoneInfo("Asia/Ulaanbaatar")
UB_CENTER = (47.9188, 106.9176)
SLOTS = [f"{h:02d}:{m:02d}" for h in range(9, 17) for m in (0, 30) if not (h == 12)]


def haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def is_open(h: dict, at: datetime | None = None) -> bool:
    t = (at or datetime.now(UB)).strftime("%H:%M")
    return h.get("openTime", "00:00") <= t <= h.get("closeTime", "23:59")


def _public(h: dict) -> dict:
    out = {k: v for k, v in h.items() if k != "_id"}
    out["id"] = h["_id"]
    return out


@router.get("/hospitals")
def list_hospitals(lat: float | None = Query(None, ge=-90, le=90), lng: float | None = Query(None, ge=-180, le=180),
                   specialty: str | None = None, emergency: bool = False,
                   prioritize: list[str] = Query(default=[])):
    q: dict = {"active": {"$ne": False}}
    if specialty:
        q["specialties"] = specialty
    if emergency:
        q["isEmergency"] = True
    origin = (lat, lng) if lat is not None and lng is not None else UB_CENTER
    out = []
    for h in get_db().hospitals.find(q):
        d = _public(h)
        d["distance_km"] = round(haversine(origin[0], origin[1], h["lat"], h["lng"]), 2)
        d["open_now"] = is_open(h)
        d["match"] = len(set(prioritize) & set(h.get("specialties", [])))
        out.append(d)
    # яаралтай/өндөр эрсдэлтэй үед тохирох мэргэжилтэй эмнэлгийг эхэнд гаргана
    out.sort(key=lambda d: (-d["match"], d["distance_km"]))
    return {"origin": {"lat": origin[0], "lng": origin[1], "fallback": lat is None}, "hospitals": out}


@router.get("/hospitals/{hid}")
def get_hospital(hid: str):
    h = get_db().hospitals.find_one({"_id": hid})
    if not h:
        raise HTTPException(404, "Эмнэлэг олдсонгүй")
    return _public(h)


@router.get("/hospitals/{hid}/slots")
def slots(hid: str, day: date, specialty: str):
    taken = {b["time"] for b in get_db().bookings.find(
        {"hospital_id": hid, "date": day.isoformat(), "specialty": specialty,
         "status": {"$in": ["pending", "confirmed"]}})}
    today = datetime.now(UB)
    out = []
    for s in SLOTS:
        past = day == today.date() and s <= today.strftime("%H:%M")
        out.append({"time": s, "available": s not in taken and not past})
    return out


# --- Захиалга ---------------------------------------------------------------------
class BookingIn(BaseModel):
    hospital_id: str
    specialty: str
    date: date
    time: str = Field(pattern=r"^\d{2}:\d{2}$")
    name: str = Field(min_length=2, max_length=80)
    phone: str = Field(pattern=r"^\+?\d{8,12}$")
    assessment_id: str | None = None
    share_assessment: bool = False


def _code(db) -> str:
    while True:
        c = f"ТЗ-{random.randint(1000, 9999)}"
        if not db.bookings.find_one({"code": c}):
            return c


@router.post("/bookings")
def create_booking(body: BookingIn, request: Request, user: dict | None = Depends(optional_user)):
    db = get_db()
    h = db.hospitals.find_one({"_id": body.hospital_id, "active": {"$ne": False}})
    if not h:
        raise HTTPException(404, "Эмнэлэг олдсонгүй")
    if body.specialty not in h.get("specialties", []):
        raise HTTPException(400, "Энэ эмнэлэгт тухайн мэргэжил байхгүй")
    today = datetime.now(UB).date()
    if body.date < today or body.date > today + timedelta(days=60):
        raise HTTPException(400, "Огноо өнөөдрөөс хойш 60 хоногийн дотор байх ёстой")
    if body.time not in SLOTS:
        raise HTTPException(400, "Цагийн сонголт буруу")
    active = {"$in": ["pending", "confirmed"]}
    d = body.date.isoformat()
    # давхардал шалгах: (1) слот дүүрсэн (2) нэг утсаар нэг өдөр нэг эмнэлэгт давхар захиалга
    if db.bookings.find_one({"hospital_id": h["_id"], "date": d, "time": body.time,
                             "specialty": body.specialty, "status": active}):
        raise HTTPException(409, "Энэ цаг захиалагдсан байна. Өөр цаг сонгоно уу.")
    if db.bookings.find_one({"hospital_id": h["_id"], "date": d, "phone": body.phone, "status": active}):
        raise HTTPException(409, "Та энэ өдөр энэ эмнэлэгт захиалга өгсөн байна.")

    shared = None
    if body.assessment_id and body.share_assessment:
        a = db.assessments.find_one({"_id": body.assessment_id})
        if a and (a.get("user_id") in (None, user["_id"] if user else None)):
            # эмнэлэгт зөвхөн шаардлагатай хураангуйг дамжуулна
            shared = {"scores": a.get("scores"), "overall": a.get("overall"), "bmi": a.get("bmi"),
                      "urgent": a.get("urgent"), "created_at": a["created_at"]}
    doc = {"_id": new_id(), "code": _code(db), "hospital_id": h["_id"], "hospital_name": h["name"],
           "specialty": body.specialty, "date": d, "time": body.time, "name": body.name,
           "phone": body.phone, "user_id": user["_id"] if user else None, "status": "pending",
           "shared_assessment": shared, "created_at": now(), "history": [{"status": "pending", "at": now()}]}
    db.bookings.insert_one(doc)
    audit("booking.create", user, doc["_id"], request, hospital=h["_id"])
    return _booking_out(doc)


def _booking_out(b: dict) -> dict:
    return {k: v for k, v in b.items() if k not in ("_id",)} | {"id": b["_id"]}


@router.get("/me/bookings")
def my_bookings(user: dict = Depends(current_user)):
    return [_booking_out(b) for b in get_db().bookings.find({"user_id": user["_id"]}).sort("date", -1)]


@router.post("/me/bookings/{bid}/cancel")
def cancel_my_booking(bid: str, request: Request, user: dict = Depends(current_user)):
    r = get_db().bookings.update_one(
        {"_id": bid, "user_id": user["_id"], "status": {"$in": ["pending", "confirmed"]}},
        {"$set": {"status": "cancelled"}, "$push": {"history": {"status": "cancelled", "at": now(), "by": "user"}}})
    if not r.modified_count:
        raise HTTPException(404, "Захиалга олдсонгүй")
    audit("booking.cancel", user, bid, request)
    return {"ok": True}


@router.get("/bookings/lookup")
def lookup(code: str, phone: str):
    """Нэвтрээгүй хэрэглэгч кодоо утасны дугаартайгаа шалгах."""
    b = get_db().bookings.find_one({"code": code, "phone": phone})
    if not b:
        raise HTTPException(404, "Захиалга олдсонгүй")
    return _booking_out(b)


# --- Эмнэлгийн ажилтан ------------------------------------------------------------
staff = APIRouter(prefix="/api/staff", tags=["staff"])


def _hid(user: dict, hospital_id: str | None) -> str:
    if user["role"] == "admin" and hospital_id:
        return hospital_id
    if not user.get("hospital_id"):
        raise HTTPException(400, "Ажилтанд эмнэлэг холбогдоогүй байна")
    return user["hospital_id"]


@staff.get("/bookings")
def staff_bookings(day: date | None = None, status: str | None = None, hospital_id: str | None = None,
                   user: dict = Depends(require_role("staff", "admin"))):
    q: dict = {"hospital_id": _hid(user, hospital_id)}
    if day:
        q["date"] = day.isoformat()
    if status:
        q["status"] = status
    return [_booking_out(b) for b in get_db().bookings.find(q).sort([("date", 1), ("time", 1)])]


class StatusIn(BaseModel):
    status: Literal["confirmed", "cancelled", "completed", "no_show"]
    note: str = Field(default="", max_length=300)


@staff.patch("/bookings/{bid}")
def set_status(bid: str, body: StatusIn, request: Request, user: dict = Depends(require_role("staff", "admin"))):
    db = get_db()
    b = db.bookings.find_one({"_id": bid})
    if not b or (user["role"] != "admin" and b["hospital_id"] != user.get("hospital_id")):
        raise HTTPException(404, "Захиалга олдсонгүй")
    db.bookings.update_one({"_id": bid}, {"$set": {"status": body.status, "staff_note": body.note},
                                          "$push": {"history": {"status": body.status, "at": now(),
                                                                "by": user["_id"]}}})
    audit("booking.status", user, bid, request, status=body.status)
    return _booking_out(db.bookings.find_one({"_id": bid}))


@staff.get("/load")
def load(day: date | None = None, hospital_id: str | None = None,
         user: dict = Depends(require_role("staff", "admin"))):
    hid = _hid(user, hospital_id)
    h = get_db().hospitals.find_one({"_id": hid})
    d = (day or datetime.now(UB).date()).isoformat()
    bs = list(get_db().bookings.find({"hospital_id": hid, "date": d}))
    by_status: dict[str, int] = {}
    for b in bs:
        by_status[b["status"]] = by_status.get(b["status"], 0) + 1
    capacity = len(SLOTS) * len(h.get("specialties", [])) if h else 0
    busy = by_status.get("pending", 0) + by_status.get("confirmed", 0)
    week = []
    base = date.fromisoformat(d)
    for i in range(7):
        dd = (base + timedelta(days=i)).isoformat()
        week.append({"date": dd, "count": get_db().bookings.count_documents(
            {"hospital_id": hid, "date": dd, "status": {"$in": ["pending", "confirmed"]}})})
    return {"date": d, "total": len(bs), "by_status": by_status, "capacity": capacity,
            "free_slots": max(0, capacity - busy), "week": week}


class HospitalUpdate(BaseModel):
    name: str | None = Field(None, max_length=120)
    address: str | None = Field(None, max_length=200)
    phone: str | None = Field(None, max_length=20)
    hours: str | None = Field(None, max_length=40)
    openTime: str | None = Field(None, pattern=r"^\d{2}:\d{2}$")
    closeTime: str | None = Field(None, pattern=r"^\d{2}:\d{2}$")
    specialties: list[str] | None = None
    isEmergency: bool | None = None


@staff.get("/hospital")
def my_hospital(hospital_id: str | None = None, user: dict = Depends(require_role("staff", "admin"))):
    return get_hospital(_hid(user, hospital_id))


@staff.put("/hospital")
def update_my_hospital(body: HospitalUpdate, request: Request, hospital_id: str | None = None,
                       user: dict = Depends(require_role("staff", "admin"))):
    hid = _hid(user, hospital_id)
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    get_db().hospitals.update_one({"_id": hid}, {"$set": patch | {"updated_at": now()}})
    audit("hospital.update", user, hid, request, fields=list(patch))
    return get_hospital(hid)
