"""Alertes Telegram gratuites (jeton dans le secret GitHub TELEGRAM_BOT_TOKEN, destinataire TELEGRAM_CHAT_ID)."""
from __future__ import annotations

import os

import requests

from .util import log


_chat: str | None = None


def resolve_chat(state: dict) -> None:
    """Sans TELEGRAM_CHAT_ID : on retrouve tout seul la discussion où vous avez écrit /start au bot."""
    global _chat
    _chat = os.environ.get("TELEGRAM_CHAT_ID") or state.get("tg_chat")
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if _chat or not token:
        return
    try:
        r = requests.get(f"https://api.telegram.org/bot{token}/getUpdates", timeout=15).json()
        for u in reversed(r.get("result", [])):
            chat = (u.get("message") or u.get("my_chat_member") or {}).get("chat") or {}
            if chat.get("type") == "private":
                _chat = str(chat["id"])
                state["tg_chat"] = _chat
                log.info("Discussion Telegram trouvée automatiquement")
                send("✅ <b>Vigie est connecté.</b>\nVous recevrez ici les signaux forts, les actus importantes, "
                     "les rappels d'annonces et le résumé du matin.")
                return
        log.warning("Telegram : envoyez /start à votre bot pour l'activer")
    except Exception as e:
        log.warning("Telegram getUpdates : %s", e)


def configured() -> bool:
    return bool(os.environ.get("TELEGRAM_BOT_TOKEN") and (_chat or os.environ.get("TELEGRAM_CHAT_ID")))


def send(text: str, silent: bool = False) -> bool:
    if not configured():
        return False
    try:
        r = requests.post(f"https://api.telegram.org/bot{os.environ['TELEGRAM_BOT_TOKEN']}/sendMessage", timeout=20,
                          json={"chat_id": _chat or os.environ["TELEGRAM_CHAT_ID"], "text": text, "parse_mode": "HTML",
                                "disable_web_page_preview": True, "disable_notification": silent})
        if not r.ok:
            log.warning("Telegram : %s %s", r.status_code, r.text[:200])
        return r.ok
    except Exception as e:
        log.warning("Telegram : %s", e)
        return False
