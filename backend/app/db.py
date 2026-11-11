from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from pymongo import ASCENDING, DESCENDING, MongoClient
from pymongo.database import Database

from .config import get_settings

log = logging.getLogger("eotoch.db")
_db: Database | None = None
db_backend = "unknown"


def now() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return uuid.uuid4().hex


def _connect() -> Database:
    global db_backend
    s = get_settings()
    if s.db_mode != "memory":
        try:
            client = MongoClient(s.mongo_url, serverSelectionTimeoutMS=1500, tz_aware=True)
            client.admin.command("ping")
            db_backend = "mongodb"
            log.info("MongoDB холбогдлоо: %s", s.mongo_url)
            return client[s.mongo_db]
        except Exception as e:
            if s.db_mode == "mongo":
                raise
            log.warning("MongoDB олдсонгүй (%s) — санах ойн DB ашиглана (өгөгдөл хадгалагдахгүй).", e)
    import mongomock

    db_backend = "memory"
    return mongomock.MongoClient(tz_aware=True)[s.mongo_db]


def get_db() -> Database:
    global _db
    if _db is None:
        _db = _connect()
        ensure_indexes(_db)
    return _db


def reset_db_for_tests() -> Database:
    global _db
    import mongomock

    _db = mongomock.MongoClient(tz_aware=True)["eotoch_test"]
    ensure_indexes(_db)
    return _db


def ensure_indexes(db: Database) -> None:
    db.users.create_index("email", unique=True)
    db.assessments.create_index([("user_id", ASCENDING), ("created_at", DESCENDING)])
    db.bookings.create_index([("hospital_id", ASCENDING), ("date", ASCENDING), ("time", ASCENDING)])
    db.bookings.create_index("code", unique=True)
    # Аудитын бүртгэл 90 хоног хадгалагдана (TTL index)
    db.audit.create_index("ts", expireAfterSeconds=90 * 24 * 3600)
    db.knowledge.create_index("category")
