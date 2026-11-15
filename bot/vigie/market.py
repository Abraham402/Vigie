"""Données de marché gratuites : Binance (crypto) et Yahoo Finance via yfinance (actions)."""
from __future__ import annotations

import time

import numpy as np
import pandas as pd

from .util import http_get, log

BINANCE = ["https://data-api.binance.vision", "https://api.binance.com", "https://api.binance.us"]
INTERVAL_S = {"5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400}
YF_CRYPTO = {"BTC": "BTC-USD", "ETH": "ETH-USD", "SOL": "SOL-USD", "BNB": "BNB-USD", "XRP": "XRP-USD"}
_binance_base: str | None = None


def _empty() -> pd.DataFrame:
    return pd.DataFrame(columns=["open", "high", "low", "close", "volume"], dtype=float)


def binance_get(path: str, params: dict) -> list | dict | None:
    """Essaie les points d'accès publics Binance (certains pays bloquent api.binance.com)."""
    global _binance_base
    bases = [_binance_base] if _binance_base else []
    bases += [b for b in BINANCE if b != _binance_base]
    for b in bases:
        r = http_get(b + path, params=params, timeout=12, retries=1)
        if r is not None:
            _binance_base = b
            return r.json()
    return None


def crypto_klines(sym: str, interval: str, total: int) -> pd.DataFrame:
    """Bougies Binance paginées (1000 max par requête), du plus ancien au plus récent."""
    rows: list = []
    end = None
    while len(rows) < total:
        params = {"symbol": f"{sym}USDT", "interval": interval, "limit": min(1000, total - len(rows))}
        if end:
            params["endTime"] = end
        data = binance_get("/api/v3/klines", params)
        if not data:
            break
        rows = data + rows
        end = data[0][0] - 1
        if len(data) < params["limit"]:
            break
        time.sleep(0.15)
    if not rows:
        return yf_history(YF_CRYPTO.get(sym, f"{sym}-USD"), interval)
    df = pd.DataFrame(rows, columns=["t", "open", "high", "low", "close", "volume", "ct", "qv", "n", "tb", "tq", "i"])
    df.index = pd.to_datetime(df["t"], unit="ms", utc=True)
    df = df[["open", "high", "low", "close", "volume"]].astype(float)
    return df[~df.index.duplicated(keep="last")].sort_index()


def crypto_ticker(sym: str) -> dict | None:
    d = binance_get("/api/v3/ticker/24hr", {"symbol": f"{sym}USDT"})
    if not d or "lastPrice" not in d:
        return None
    return {"price": float(d["lastPrice"]), "open": float(d["openPrice"]), "hi": float(d["highPrice"]),
            "lo": float(d["lowPrice"]), "volume_usd": float(d.get("quoteVolume", 0))}


_YF_PERIOD = {"5m": "5d", "15m": "30d", "1h": "730d", "1d": "5y", "4h": "730d"}


def yf_history(ticker: str, interval: str, period: str | None = None) -> pd.DataFrame:
    try:
        import yfinance as yf
        iv = "1h" if interval == "4h" else interval
        df = yf.Ticker(ticker).history(period=period or _YF_PERIOD.get(interval, "60d"), interval=iv, auto_adjust=False)
        if df is None or df.empty:
            return _empty()
        df = df.rename(columns=str.lower)[["open", "high", "low", "close", "volume"]].astype(float)
        df.index = pd.to_datetime(df.index, utc=True)
        df = df[~df.index.duplicated(keep="last")].sort_index().dropna()
        if interval == "4h":
            df = resample(df, "4h")
        return df
    except Exception as e:  # yfinance peut lever des erreurs variées
        log.warning("yfinance %s %s : %s", ticker, interval, e)
        return _empty()


def stock_quote(ticker: str) -> dict | None:
    try:
        import yfinance as yf
        fi = yf.Ticker(ticker).fast_info
        price = float(fi["last_price"])
        prev = float(fi["previous_close"])
        hi, lo = float(fi.get("day_high") or price), float(fi.get("day_low") or price)
        vol = float(fi.get("last_volume") or 0) * price
        if not np.isfinite(price):
            return None
        return {"price": price, "open": prev, "hi": hi, "lo": lo, "volume_usd": vol}
    except Exception as e:
        log.warning("cotation %s : %s", ticker, e)
        return None


def resample(df: pd.DataFrame, rule: str) -> pd.DataFrame:
    if df.empty:
        return df
    o = df.resample(rule, label="left", closed="left").agg(
        {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"})
    return o.dropna()


def to_rows(df: pd.DataFrame, n: int, decimals: int = 6) -> list[list]:
    """Format compact pour le navigateur : [temps (s), o, h, l, c, v]."""
    if df is None or df.empty:
        return []
    d = df.tail(n)
    t = (d.index.astype("int64") // 10**9).astype(int)
    out = []
    for ti, (o, h, l, c, v) in zip(t, d[["open", "high", "low", "close", "volume"]].to_numpy()):
        out.append([int(ti), round(float(o), decimals), round(float(h), decimals), round(float(l), decimals),
                    round(float(c), decimals), round(float(v), 2)])
    return out


def price_decimals(p: float) -> int:
    return 6 if p < 1 else 4 if p < 10 else 2


class MarketData:
    """Collecte et met en cache les séries de prix d'un actif."""

    def __init__(self, sym: str, name: str, kind: str):
        self.sym, self.name, self.kind = sym, name, kind
        self.h1 = _empty()      # bougies horaires (entraînement)
        self.d1 = _empty()      # bougies journalières
        self.quote: dict | None = None
        self.display: dict[int, pd.DataFrame] = {}

    @property
    def yf(self) -> str:
        return YF_CRYPTO.get(self.sym, f"{self.sym}-USD") if self.kind == "crypto" else self.sym

    def fetch(self) -> "MarketData":
        if self.kind == "crypto":
            self.h1 = crypto_klines(self.sym, "1h", 6000)
            self.d1 = crypto_klines(self.sym, "1d", 1500)
            self.quote = crypto_ticker(self.sym)
            self.display = {3600: self.h1, 14400: resample(self.h1, "4h"), 86400: self.d1}
        else:
            self.h1 = yf_history(self.sym, "1h")
            self.d1 = yf_history(self.sym, "1d")
            self.quote = stock_quote(self.sym)
            self.display = {300: yf_history(self.sym, "5m"), 900: yf_history(self.sym, "15m"),
                            3600: self.h1, 14400: resample(self.h1, "4h"), 86400: self.d1}
        if self.quote is None and not self.h1.empty:
            last = self.h1.tail(24)
            self.quote = {"price": float(last["close"].iloc[-1]), "open": float(last["open"].iloc[0]),
                          "hi": float(last["high"].max()), "lo": float(last["low"].min()),
                          "volume_usd": float((last["close"] * last["volume"]).sum())}
        log.info("%s : %d bougies 1 h, %d bougies 1 j, prix %s", self.sym, len(self.h1), len(self.d1),
                 self.quote and self.quote["price"])
        return self

    def spark(self) -> list[float]:
        if self.h1.empty:
            return []
        return [round(float(x), price_decimals(float(x))) for x in self.h1["close"].tail(25)]

    def browser_payload(self) -> dict:
        q = self.quote or {}
        dec = price_decimals(q.get("price", 100) or 100)
        n = {300: 300, 900: 300, 3600: 500, 14400: 300, 86400: 400}
        return {"n": self.name, "t": self.kind, **{k: round(v, dec) if k != "volume_usd" else round(v) for k, v in q.items()},
                "spark": self.spark(), "bars": {str(k): to_rows(v, n.get(k, 300), dec) for k, v in self.display.items()}}
