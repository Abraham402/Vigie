"""IA gratuite : Google Gemini (clé GEMINI_API_KEY) ou Groq (clé GROQ_API_KEY), toujours facultative."""
from __future__ import annotations

import json
import os
import re

import requests

from .util import log

GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-flash-latest")
GROQ_MODEL = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")


def available() -> bool:
    return bool(os.environ.get("GEMINI_API_KEY") or os.environ.get("GROQ_API_KEY"))


def ask(prompt: str, max_tokens: int = 1500, temperature: float = 0.4) -> str | None:
    key = os.environ.get("GEMINI_API_KEY")
    if key:
        try:
            r = requests.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent",
                params={"key": key}, timeout=60,
                json={"contents": [{"role": "user", "parts": [{"text": prompt}]}],
                      "generationConfig": {"temperature": temperature, "maxOutputTokens": max_tokens}})
            if r.ok:
                parts = r.json()["candidates"][0]["content"]["parts"]
                return "".join(p.get("text", "") for p in parts)
            log.warning("Gemini : %s %s", r.status_code, r.text[:200])
        except Exception as e:
            log.warning("Gemini : %s", e)
    key = os.environ.get("GROQ_API_KEY")
    if key:
        try:
            r = requests.post("https://api.groq.com/openai/v1/chat/completions", timeout=60,
                              headers={"Authorization": f"Bearer {key}"},
                              json={"model": GROQ_MODEL, "messages": [{"role": "user", "content": prompt}],
                                    "temperature": temperature, "max_tokens": max_tokens})
            if r.ok:
                return r.json()["choices"][0]["message"]["content"]
            log.warning("Groq : %s %s", r.status_code, r.text[:200])
        except Exception as e:
            log.warning("Groq : %s", e)
    return None


def ask_json(prompt: str, max_tokens: int = 2500):
    txt = ask(prompt + "\n\nRéponds uniquement avec du JSON valide, sans texte autour.", max_tokens=max_tokens, temperature=0.2)
    if not txt:
        return None
    m = re.search(r"(\[.*\]|\{.*\})", txt, re.S)
    try:
        return json.loads(m.group(1) if m else txt)
    except Exception:
        log.warning("Réponse IA non lisible : %s", txt[:200])
        return None


def enrich_news(items: list[dict], proba: dict) -> None:
    """Traduit les titres en français et ajoute un résumé d'une phrase (en un seul appel)."""
    if not items or not available():
        return
    payload = [{"i": k, "titre": it["txt"], "extrait": it.get("summary", "")[:250], "actif": it.get("asset"),
                "proba_hausse_24h": proba.get(it.get("asset"), [None, [None]])[1][0] if it.get("asset") in proba else None}
               for k, it in enumerate(items)]
    prompt = ("Tu es analyste financier pour un débutant francophone. Pour chaque actualité ci-dessous, donne :\n"
              "- \"fr\" : le titre traduit en français naturel (garde les noms propres et chiffres)\n"
              "- \"ai\" : une phrase simple (25 mots max) qui explique l'impact probable sur l'actif indiqué, sans promettre de gain\n"
              "Renvoie une liste JSON d'objets {\"i\":…, \"fr\":…, \"ai\":…}.\n\n" + json.dumps(payload, ensure_ascii=False))
    res = ask_json(prompt)
    if not isinstance(res, list):
        return
    for r in res:
        try:
            it = items[int(r["i"])]
            if r.get("fr"):
                it["txt_en"] = it["txt"]
                it["txt"] = str(r["fr"])[:300]
            if r.get("ai"):
                it["ai"] = str(r["ai"])[:300]
        except Exception:
            continue
