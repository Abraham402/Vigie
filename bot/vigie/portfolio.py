"""Suivi du portefeuille fictif sur Telegram.

L'application dépose une copie du portefeuille dans un message épinglé de la discussion
avec le bot (texte commençant par « 📌 » et contenant « #VIGIE {json} »). Le bot la lit
avec getChat et envoie un point au rythme demandé (freq en minutes).
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
from zoneinfo import ZoneInfo

import requests

from . import telegram
from .util import log, now_ms

PARIS = ZoneInfo("Europe/Paris")


def read_pinned() -> dict | None:
    token, chat = os.environ.get("TELEGRAM_BOT_TOKEN"), telegram._chat
    if not token or not chat:
        return None
    try:
        r = requests.get(f"https://api.telegram.org/bot{token}/getChat", params={"chat_id": chat}, timeout=15).json()
        txt = ((r.get("result") or {}).get("pinned_message") or {}).get("text", "")
        return parse(txt)
    except Exception as e:
        log.warning("lecture du portefeuille épinglé : %s", e)
        return None


def parse(txt: str) -> dict | None:
    m = re.search(r"#VIGIE\s*(\{.*\})", txt or "", re.S)
    if not m:
        return None
    try:
        snap = json.loads(m.group(1))
        return snap if isinstance(snap, dict) and "pos" in snap else None
    except Exception:
        return None


def money(v: float, dec: int = 0) -> str:
    s = f"{abs(v):,.{dec}f}".replace(",", " ").replace(".", ",")
    return ("−" if v < 0 else "") + s + " $"


def pct(v: float) -> str:
    return f"{v:+.2f} %".replace(".", ",").replace("-", "−")


def build_report(snap: dict, prices: dict[str, float], proba: dict, last: dict | None, now: dt.datetime) -> tuple[str, dict]:
    """Texte du point + valeurs à mémoriser pour le prochain point."""
    lines, values, total = [], {}, float(snap.get("cash", 0))
    for s, (q, cost, sl, tp) in snap.get("pos", {}).items():
        px = prices.get(s)
        if not px:
            continue
        val = q * px
        total += val
        values[s] = val
        since_buy = (val / cost - 1) * 100 if cost else 0
        prev = (last or {}).get("values", {}).get(s)
        step = f" · depuis le dernier point {pct((val / prev - 1) * 100)}" if prev else ""
        p24 = proba.get(s, [None, [None]])[1][0] if s in proba else None
        bot = f" · bot {p24} % hausse 24 h" if p24 is not None else ""
        warn = " · ⚠️ sans stop-loss" if not sl else ""
        icon = "🟢" if since_buy >= 0 else "🔴"
        lines.append(f"{icon} <b>{s}</b> : {money(val)} ({pct(since_buy)} depuis l'achat){step}{bot}{warn}")
        if sl and px <= sl * 1.02:
            lines.append(f"   🛑 {s} est à moins de 2 % de votre stop-loss ({money(sl, 2)})")
        if tp and px >= tp * 0.98:
            lines.append(f"   🎯 {s} approche de votre objectif ({money(tp, 2)})")
    cap = float(snap.get("cap") or 10000)
    perf = (total / cap - 1) * 100
    head = [f"💼 <b>Point portefeuille · {now.strftime('%H:%M')}</b>",
            f"Valeur : <b>{money(total)}</b> ({pct(perf)} depuis le début)"]
    if last and last.get("total"):
        d = total - last["total"]
        head.append(f"Depuis le dernier point : {money(d)} ({pct((total / last['total'] - 1) * 100)})")
    if not lines:
        lines = ["Aucune position ouverte : tout est en liquidités."]
    txt = "\n".join(head + [""] + lines) + "\n\n<i>Portefeuille fictif · cours des actions différés de ~15 min</i>"
    return txt, {"t": now_ms(), "total": total, "values": values}


def maybe_send(state: dict, mds: dict, proba: dict) -> None:
    if not telegram.configured():
        return
    snap = read_pinned()
    if snap is None:
        return
    state["pf_snap"] = snap
    freq = int(snap.get("freq") or 0)
    if freq <= 0:
        return
    last = state.get("pf_report")
    if last and now_ms() - last["t"] < (freq - 7) * 60 * 1000:  # tolérance : passages toutes les ~15 min
        return
    now = dt.datetime.now(PARIS)
    prices = {s: m.quote["price"] for s, m in mds.items() if m.quote}
    txt, mem = build_report(snap, prices, proba, last, now)
    if telegram.send(txt, silent=now.hour >= 23 or now.hour < 7):
        state["pf_report"] = mem
        log.info("Point portefeuille envoyé")
