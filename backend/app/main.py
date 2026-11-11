from __future__ import annotations

import json
import logging
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import db as dbmod
from .config import get_settings
from .db import get_db, new_id, now
from .ml.predictor import get_engine
from .routers import admin, assessments, auth, hospitals, ml
from .security import hash_password
from .services.knowledge import seed_knowledge

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)  # API түлхүүр логт гарахаас сэргийлнэ
log = logging.getLogger("eotoch")
DATA = Path(__file__).resolve().parent / "data"


def seed() -> None:
    s = get_settings()
    db = get_db()
    if db.hospitals.count_documents({}) == 0:
        for h in json.loads((DATA / "hospitals.json").read_text()):
            db.hospitals.insert_one({"_id": h.pop("id"), **h})
    if not db.users.find_one({"role": "admin"}):
        db.users.insert_one({"_id": new_id(), "email": s.seed_admin_email, "name": "Системийн админ",
                             "role": "admin", "password": hash_password(s.seed_admin_password),
                             "active": True, "created_at": now()})
    if not db.users.find_one({"role": "staff"}):
        db.users.insert_one({"_id": new_id(), "email": "staff@songdo.mn", "name": "Сонгдо — бүртгэл",
                             "role": "staff", "hospital_id": "songdo",
                             "password": hash_password(s.seed_staff_password), "active": True,
                             "created_at": now()})
    seed_knowledge()


@asynccontextmanager
async def lifespan(_: FastAPI):
    s = get_settings()
    seed()
    get_engine()  # загваруудыг урьдчилан ачаална
    if s.data_key_ephemeral:
        log.warning("DATA_ENCRYPTION_KEY тохируулаагүй — түр түлхүүр ашиглаж байна (дахин асаахад "
                    "шифрлэгдсэн өгөгдөл уншигдахгүй).")
    log.info("DB: %s | model %s | Gemini: %s", dbmod.db_backend, get_engine().version,
             "on" if s.gemini_api_key else "off")
    yield


app = FastAPI(title="EOTOCH API", version="2.0", lifespan=lifespan,
              description="Монголын эрүүл мэндийн AI туслах — эрсдэлийн үнэлгээ, зөвлөгөө, эмнэлгийн захиалга")

app.add_middleware(CORSMiddleware, allow_origins=get_settings().cors_origins, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

# --- Хүсэлтийн хязгаар: нэг IP минутад 60, өдөрт 500 --------------------------------
_hits: dict[str, deque] = defaultdict(deque)


@app.middleware("http")
async def rate_limit(request: Request, call_next):
    if request.url.path.startswith("/api/") and request.method != "OPTIONS":
        s = get_settings()
        ip = request.client.host if request.client else "unknown"
        t = time.time()
        q = _hits[ip]
        while q and q[0] < t - 86400:
            q.popleft()
        last_min = sum(1 for x in q if x > t - 60)
        if last_min >= s.rate_per_minute or len(q) >= s.rate_per_day:
            return JSONResponse({"detail": "Хэт олон хүсэлт. Түр хүлээгээд дахин оролдоно уу."}, status_code=429)
        q.append(t)
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return resp


for r in (auth.router, assessments.router, hospitals.router, hospitals.staff, admin.router, ml.router):
    app.include_router(r)


@app.get("/api/health")
def health():
    s = get_settings()
    return {"status": "ok", "db": dbmod.db_backend, "model_version": get_engine().version,
            "ai": {"gemini": bool(s.gemini_api_key), "ollama": bool(s.ollama_url)}}
