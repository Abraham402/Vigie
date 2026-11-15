"""Alertes Telegram gratuites (jeton dans le secret GitHub TELEGRAM_BOT_TOKEN, destinataire TELEGRAM_CHAT_ID)."""
from __future__ import annotations

import os

import requests

from .util import log


def configured() -> bool:
    return bool(os.environ.get("TELEGRAM_BOT_TOKEN") and os.environ.get("TELEGRAM_CHAT_ID"))


def send(text: str) -> bool:
    if not configured():
        return False
    try:
        r = requests.post(f"https://api.telegram.org/bot{os.environ['TELEGRAM_BOT_TOKEN']}/sendMessage", timeout=20,
                          json={"chat_id": os.environ["TELEGRAM_CHAT_ID"], "text": text, "parse_mode": "HTML",
                                "disable_web_page_preview": True})
        if not r.ok:
            log.warning("Telegram : %s %s", r.status_code, r.text[:200])
        return r.ok
    except Exception as e:
        log.warning("Telegram : %s", e)
        return False
