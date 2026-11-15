"""Outils communs : configuration, chemins, requêtes HTTP robustes, journal."""
from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Any

import requests

ROOT = Path(__file__).resolve().parents[2]
CONFIG_DIR = ROOT / "config"
OUT_DIR = Path(os.environ.get("VIGIE_OUT", ROOT / "out"))
STATE_DIR = Path(os.environ.get("VIGIE_STATE", ROOT / "state"))

UA = "Mozilla/5.0 (compatible; VigieBot/1.0; educational market research)"

log = logging.getLogger("vigie")


def setup_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def load_settings() -> dict:
    return json.loads((CONFIG_DIR / "settings.json").read_text(encoding="utf-8"))


def load_people() -> list[tuple[str, str]]:
    """Lit config/people.txt -> [(terme de recherche, libellé)]."""
    out = []
    path = CONFIG_DIR / "people.txt"
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        q, _, label = line.partition("|")
        out.append((q.strip(), (label or q).strip()))
    return out


def http_get(url: str, *, params: dict | None = None, timeout: float = 15, retries: int = 2,
             headers: dict | None = None) -> requests.Response | None:
    h = {"User-Agent": UA, "Accept": "*/*"}
    if headers:
        h.update(headers)
    for attempt in range(retries + 1):
        try:
            r = requests.get(url, params=params, timeout=timeout, headers=h)
            if r.status_code == 200:
                return r
            if r.status_code in (429, 500, 502, 503, 504):
                time.sleep(1.5 * (attempt + 1))
                continue
            log.warning("GET %s -> %s", url[:90], r.status_code)
            return None
        except requests.RequestException as e:
            log.warning("GET %s échoue : %s", url[:90], e)
            time.sleep(1.0 * (attempt + 1))
    return None


def read_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def write_json(path: Path, data: Any, compact: bool = True) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    txt = json.dumps(data, ensure_ascii=False, separators=(",", ":") if compact else None,
                     indent=None if compact else 1, default=_default)
    path.write_text(txt, encoding="utf-8")


def _default(o: Any) -> Any:
    try:
        import numpy as np
        if isinstance(o, (np.integer,)):
            return int(o)
        if isinstance(o, (np.floating,)):
            return float(o)
    except Exception:
        pass
    return str(o)


def now_ms() -> int:
    return int(time.time() * 1000)
