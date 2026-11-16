"""Outils inspirés du skill day-trader-skill (github.com/Jakeschincariol/day-trader-skill, MIT) :

- scanner : figures techniques sur les clôtures journalières (règles de trader-scanner)
- ATR : volatilité moyenne pour proposer un stop-loss adapté (méthode de trader-exit)
- Congrès : déclarations officielles de la Chambre (lecteur de trader-pelosi)
"""
from __future__ import annotations

import datetime as dt
import os
import tempfile

import numpy as np
import pandas as pd

from .util import log, now_ms

SETUPS = {
    "breakout_20d": ("Cassure du plus haut 20 jours", "La clôture dépasse toutes celles des 20 séances précédentes : les acheteurs prennent le dessus."),
    "bull_flag": ("Drapeau haussier", "Forte hausse (> 10 %) puis 5 séances de pause serrée (< 5 %) : souvent une respiration avant de repartir."),
    "reclaim_ma20": ("Retour au-dessus de la moyenne 20 j", "Le prix repasse au-dessus de sa moyenne des 20 derniers jours : la tendance courte s'améliore."),
    "oversold": ("Survendu (RSI < 30)", "Le prix a beaucoup baissé en peu de temps : un rebond est possible, mais la baisse peut continuer."),
    "oversold_bounce": ("Rebond après survente", "Le RSI était sous 30 hier et la clôture remonte aujourd'hui : premier signe de rebond."),
}

# Actifs supplémentaires balayés par le scanner (en plus de la watchlist)
EXTRA = [("AMZN", "Amazon", "stock"), ("GOOGL", "Alphabet (Google)", "stock"), ("META", "Meta", "stock"),
         ("AMD", "AMD", "stock"), ("NFLX", "Netflix", "stock"), ("PLTR", "Palantir", "stock"),
         ("COIN", "Coinbase", "stock"), ("MSTR", "Strategy", "stock"), ("AVGO", "Broadcom", "stock"),
         ("JPM", "JPMorgan", "stock"), ("QQQ", "Nasdaq 100 (ETF)", "stock"), ("GLD", "Or (ETF)", "stock"),
         ("DOGE-USD", "Dogecoin", "crypto"), ("ADA-USD", "Cardano", "crypto"), ("AVAX-USD", "Avalanche", "crypto"),
         ("LINK-USD", "Chainlink", "crypto"), ("DOT-USD", "Polkadot", "crypto")]


def rsi_wilder(closes: list[float], n: int = 14) -> float | None:
    if len(closes) < n + 1:
        return None
    g = [max(0.0, closes[i] - closes[i - 1]) for i in range(1, len(closes))]
    lo = [max(0.0, closes[i - 1] - closes[i]) for i in range(1, len(closes))]
    ag, al = sum(g[:n]) / n, sum(lo[:n]) / n
    for i in range(n, len(g)):
        ag = (ag * (n - 1) + g[i]) / n
        al = (al * (n - 1) + lo[i]) / n
    return 100 - 100 / (1 + ag / al) if al else 100.0


def find_setups(c: list[float]) -> tuple[list[str], dict]:
    """Règles de trader-scanner, sur des clôtures journalières complètes (au moins 30)."""
    last = c[-1]
    hi20 = max(c[-21:-1])
    ma20 = sum(c[-20:]) / 20.0
    ma20_prev = sum(c[-21:-1]) / 20.0
    run = c[-6] / c[-16] - 1
    rng5 = (max(c[-5:]) - min(c[-5:])) / last
    r, r_prev = rsi_wilder(c), rsi_wilder(c[:-1])
    tags = []
    if last > hi20:
        tags.append("breakout_20d")
    if run > 0.10 and rng5 < 0.05:
        tags.append("bull_flag")
    if c[-2] < ma20_prev and last > ma20:
        tags.append("reclaim_ma20")
    if r is not None and r < 30:
        tags.append("oversold")
    if r_prev is not None and r_prev < 30 and last > c[-2]:
        tags.append("oversold_bounce")
    return tags, {"rsi": r, "high20": hi20, "ma20": ma20, "run_pct": run * 100, "range5_pct": rng5 * 100}


def complete_closes(d1: pd.DataFrame, kind: str, now: dt.datetime | None = None) -> list[float]:
    """Clôtures des séances terminées : la bougie du jour en cours est écartée (comme le skill)."""
    if d1 is None or d1.empty:
        return []
    now = now or dt.datetime.now(dt.timezone.utc)
    d = d1.copy()
    last_day = d.index[-1].tz_convert("America/New_York").date() if kind == "stock" else d.index[-1].date()
    if kind == "crypto":
        if last_day >= now.date():
            d = d.iloc[:-1]
    else:
        ny = now.astimezone(dt.timezone(dt.timedelta(hours=-5)))
        if last_day >= ny.date() and ny.hour < 16:
            d = d.iloc[:-1]
    return [float(x) for x in d["close"].dropna()]


def scan(mds: dict, state: dict) -> list[dict]:
    """Figures techniques sur la watchlist + une sélection d'actifs populaires (rafraîchi toutes les 3 h)."""
    cache = state.get("scan_cache") or {}
    hits = []
    for s, md in mds.items():
        c = complete_closes(md.d1, md.kind)
        if len(c) >= 30:
            tags, num = find_setups(c)
            if tags:
                hits.append(_hit(s, md.name, md.kind, True, tags, num, c[-1]))
    if now_ms() - cache.get("t", 0) > 3 * 3600 * 1000:
        extra = []
        try:
            import yfinance as yf
            df = yf.download([t for t, _, _ in EXTRA], period="3mo", interval="1d", progress=False, auto_adjust=False, group_by="ticker", threads=False)
            for t, name, kind in EXTRA:
                try:
                    sub = df[t].dropna(subset=["Close"]).rename(columns=str.lower)
                    sub.index = pd.to_datetime(sub.index, utc=True)
                    c = complete_closes(sub, kind)
                    if len(c) >= 30:
                        tags, num = find_setups(c)
                        if tags:
                            extra.append(_hit(t.replace("-USD", ""), name, kind, False, tags, num, c[-1]))
                except Exception:
                    continue
        except Exception as e:
            log.warning("scanner (actifs supplémentaires) : %s", e)
        cache = {"t": now_ms(), "hits": extra}
        state["scan_cache"] = cache
    hits += cache.get("hits", [])
    order = {k: i for i, k in enumerate(SETUPS)}
    hits.sort(key=lambda h: (not h["mine"], min(order[t] for t in h["tags"])))
    return hits[:30]


def _hit(s, name, kind, mine, tags, num, last):
    return {"s": s, "n": name, "t": kind, "mine": mine, "tags": tags, "px": round(last, 6),
            "rsi": round(num["rsi"], 1) if num["rsi"] is not None else None,
            "hi20": round(num["high20"], 6), "ma20": round(num["ma20"], 6)}


def atr(df: pd.DataFrame, n: int = 14) -> float | None:
    """ATR (moyenne des « vraies » amplitudes) sur n bougies, méthode de Wilder."""
    if df is None or len(df) < n + 1:
        return None
    h, l, c = df["high"].to_numpy(float), df["low"].to_numpy(float), df["close"].to_numpy(float)
    tr = np.maximum(h[1:] - l[1:], np.maximum(abs(h[1:] - c[:-1]), abs(l[1:] - c[:-1])))
    a = tr[:n].mean()
    for x in tr[n:]:
        a = (a * (n - 1) + x) / n
    return float(a)


OWNER_FR = {"SP": "conjoint", "JT": "compte joint", "DC": "enfant", "": ""}
MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."]


def congress(state: dict, every_h: float = 6) -> list[list]:
    """Transactions déclarées par les élus de la Chambre (PDF officiels), mises à jour toutes les 6 h."""
    from . import ptr_house as ptr
    store = state.setdefault("congress", {"t": 0, "seen": [], "rows": []})
    if now_ms() - store["t"] > every_h * 3600 * 1000:
        store["t"] = now_ms()
        try:
            year = dt.date.today().year
            rows = ptr.load_index(year)
            cutoff = (dt.date.today() - dt.timedelta(days=60)).isoformat()
            todo = [r for r in rows if r["type"] == "P" and (r["filed"] or "") >= cutoff and r["doc_id"] not in store["seen"]][:15]
            pdf_dir = os.path.join(tempfile.gettempdir(), "vigie-ptr")
            for r in todo:
                store["seen"].append(r["doc_id"])
                try:
                    _, rep = ptr._fetch_and_read(r["doc_id"], r["year"], pdf_dir, filed=r["filed"])
                except Exception as e:
                    log.warning("PTR %s : %s", r["doc_id"], e)
                    continue
                if not rep:
                    continue
                for t in rep["rows"]:
                    if not t.get("ticker") or t.get("type") not in ("P", "S", "S (partial)"):
                        continue
                    store["rows"].append({"date": t["date"], "who": r["name"], "owner": t.get("owner", ""),
                                          "ticker": t["ticker"], "op": "Achat" if t["type"] == "P" else "Vente",
                                          "amount": t.get("amount") or "", "filed": r["filed"],
                                          "option": bool(t.get("option")), "url": rep.get("url")})
            store["seen"] = store["seen"][-600:]
            store["rows"] = sorted(store["rows"], key=lambda x: x["date"] or "", reverse=True)[:120]
            log.info("Congrès : %d déclarations lues, %d transactions en mémoire", len(todo), len(store["rows"]))
        except Exception as e:
            log.warning("Congrès (PTR officiels) : %s", e)
    out = []
    for x in store["rows"][:40]:
        try:
            d = dt.date.fromisoformat(x["date"])
            dtxt = f"{d.day} {MONTHS[d.month - 1]}"
        except Exception:
            dtxt = x["date"] or ""
        who = x["who"] + (f" ({OWNER_FR.get(x['owner'], '')})" if OWNER_FR.get(x["owner"]) else "")
        amt = x["amount"].replace("$", "").replace(",", " ").replace(" - ", "–").strip() + " $"
        out.append([dtxt, who, "Congrès" + (" · option" if x["option"] else ""), x["ticker"], x["op"], amt, x["date"]])
    return out
