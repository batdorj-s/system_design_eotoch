from __future__ import annotations

import base64
import os
import secrets
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_DIR = BACKEND_DIR.parent
load_dotenv(BACKEND_DIR / ".env")


class Settings:
    def __init__(self) -> None:
        self.env = os.getenv("APP_ENV", "development")
        self.mongo_url = os.getenv("MONGO_URL", "mongodb://localhost:27017")
        self.mongo_db = os.getenv("MONGO_DB", "eotoch")
        # "auto": MongoDB холбогдохгүй бол санах ойн (mongomock) DB ашиглана
        self.db_mode = os.getenv("DB_MODE", "auto")  # auto | mongo | memory

        self.jwt_secret = os.getenv("JWT_SECRET") or secrets.token_urlsafe(32)
        self.jwt_hours = int(os.getenv("JWT_HOURS", "72"))

        key = os.getenv("DATA_ENCRYPTION_KEY")
        # 32 байт = AES-256. Тохируулаагүй бол хөгжүүлэлтэд түр түлхүүр үүсгэнэ.
        self.data_key = base64.b64decode(key) if key else secrets.token_bytes(32)
        self.data_key_ephemeral = key is None

        self.gemini_api_key = os.getenv("GEMINI_API_KEY", "")
        self.gemini_model = os.getenv("GEMINI_MODEL", "gemini-flash-latest")
        self.ollama_url = os.getenv("OLLAMA_URL", "")
        self.ollama_model = os.getenv("OLLAMA_MODEL", "llama3")

        self.cors_origins = [o.strip() for o in os.getenv(
            "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip()]
        self.rate_per_minute = int(os.getenv("RATE_PER_MINUTE", "60"))
        self.rate_per_day = int(os.getenv("RATE_PER_DAY", "500"))

        self.seed_admin_email = os.getenv("SEED_ADMIN_EMAIL", "admin@eotoch.mn")
        self.seed_admin_password = os.getenv("SEED_ADMIN_PASSWORD", "Admin@2026")
        self.seed_staff_password = os.getenv("SEED_STAFF_PASSWORD", "Staff@2026")

        self.artifacts_dir = Path(__file__).resolve().parent / "ml" / "artifacts"
        self.ai_model_dir = PROJECT_DIR / "ai-model"


@lru_cache
def get_settings() -> Settings:
    return Settings()
