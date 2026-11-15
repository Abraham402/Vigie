"""Sources complémentaires gratuites : initiés (Yahoo), Congrès US, calendrier économique, Fear & Greed, VIX."""
from __future__ import annotations

import datetime as dt

import pandas as pd

from .util import http_get, log

MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."]


def fr_date(d: dt.date) -> str:
    return f"{d.day} {MONTHS[d.month - 1]}"


def fmt_amount(v: float) -> str:
    if v >= 1e9:
        return f"{v / 1e9:.1f} Md$".replace(".", ",")
    if v >= 1e6:
        return f"{v / 1e6:.1f} M$".replace(".", ",")
    if v >= 1e3:
        return f"{v / 1e3:.0f} k$"
    return f"{v:.0f} $"


def insiders(stocks: list[str], days: int = 60) -> list[list]:
    """Transactions des dirigeants (SEC Form 4) via Yahoo Finance."""
    rows = []
    try:
        import yfinance as yf
    except Exception:
        return rows
    cutoff = pd.Timestamp.utcnow().tz_localize(None) - pd.Timedelta(days=days)
    for s in stocks:
        if s == "SPY":
            continue
        try:
            df = yf.Ticker(s).insider_transactions
            if df is None or df.empty:
                continue
            for _, r in df.head(15).iterrows():
                d = pd.to_datetime(r.get("Start Date"), errors="coerce")
                if pd.isna(d) or d.tz_localize(None) < cutoff:
                    continue
                txt = str(r.get("Text") or r.get("Transaction") or "")
                low = txt.lower()
                if "sale" in low or "sold" in low:
                    op = "Vente"
                elif "purchase" in low or "bought" in low or "buy" in low:
                    op = "Achat"
                else:
                    continue  # attributions d'actions, options : moins informatifs
                val = float(r.get("Value") or 0)
                who = str(r.get("Position") or "Dirigeant").title()
                rows.append([d.date().isoformat(), f"{str(r.get('Insider') or '').title()} ({who})", "Initié · Form 4", s, op,
                             fmt_amount(val) if val else f"{int(r.get('Shares') or 0):,} actions".replace(",", " ")])
        except Exception as e:
            log.warning("initiés %s : %s", s, e)
    return rows


CONGRESS = [
    ("https://house-stock-watcher-data.s3-us-west-2.amazonaws.com/data/all_transactions.json", "Chambre"),
    ("https://senate-stock-watcher-data.s3-us-west-2.amazonaws.com/aggregate/all_transactions.json", "Sénat"),
]


def congress(tickers: list[str], days: int = 120) -> list[list]:
    """Déclarations boursières des membres du Congrès (données publiques communautaires)."""
    rows = []
    cutoff = dt.date.today() - dt.timedelta(days=days)
    for url, chamber in CONGRESS:
        r = http_get(url, timeout=25, retries=0)
        if r is None:
            continue
        try:
            for t in r.json():
                tk = (t.get("ticker") or "").upper().strip()
                if tk not in tickers:
                    continue
                d = pd.to_datetime(t.get("transaction_date"), errors="coerce")
                if pd.isna(d) or d.date() < cutoff:
                    continue
                typ = (t.get("type") or "").lower()
                op = "Achat" if "purchase" in typ else "Vente" if "sale" in typ else None
                if not op:
                    continue
                who = t.get("representative") or t.get("senator") or "Élu"
                rows.append([d.date().isoformat(), str(who), f"Congrès · {chamber}", tk, op, str(t.get("amount") or "")])
        except Exception as e:
            log.warning("Congrès %s : %s", chamber, e)
    return rows


def calendar_events() -> list[dict]:
    """Calendrier économique de la semaine (flux public JSON) + résultats d'entreprises (Yahoo)."""
    out = []
    r = http_get("https://nfs.faireconomy.media/ff_calendar_thisweek.json", timeout=15, retries=1)
    if r is not None:
        try:
            for e in r.json():
                imp = {"High": 3, "Medium": 2}.get(e.get("impact"))
                cty = e.get("country")
                if not imp or cty not in ("USD", "EUR"):
                    continue
                t = pd.to_datetime(e["date"], utc=True)
                out.append({"t": int(t.timestamp() * 1000), "ev": e.get("title", ""), "c": "US" if cty == "USD" else "Zone euro",
                            "imp": imp, "cons": e.get("forecast") or "", "prev": e.get("previous") or "",
                            "assets": "SPY, BTC" if imp == 3 and cty == "USD" else ("SPY" if cty == "USD" else "")})
        except Exception as e:
            log.warning("calendrier : %s", e)
    return out


def earnings(stocks: list[str]) -> list[dict]:
    out = []
    try:
        import yfinance as yf
    except Exception:
        return out
    now = pd.Timestamp.utcnow()
    for s in stocks:
        if s == "SPY":
            continue
        try:
            cal = yf.Ticker(s).calendar
            dates = cal.get("Earnings Date") if isinstance(cal, dict) else None
            if not dates:
                continue
            d = pd.Timestamp(dates[0]).tz_localize("America/New_York") + pd.Timedelta(hours=16, minutes=5)
            if now <= d <= now + pd.Timedelta(days=21):
                eps = cal.get("Earnings Average")
                out.append({"t": int(d.timestamp() * 1000), "ev": f"Résultats trimestriels {s}", "c": "US", "imp": 3,
                            "cons": f"BPA {eps:.2f} $".replace(".", ",") if eps else "", "prev": "", "assets": s})
        except Exception as e:
            log.warning("résultats %s : %s", s, e)
    return out


def crypto_fear_greed() -> float | None:
    r = http_get("https://api.alternative.me/fng/", params={"limit": 1}, timeout=10, retries=1)
    try:
        return float(r.json()["data"][0]["value"]) if r is not None else None
    except Exception:
        return None


def vix() -> float | None:
    try:
        import yfinance as yf
        v = yf.Ticker("^VIX").fast_info["last_price"]
        return float(v)
    except Exception:
        return None
