"""Indicateurs techniques et variables explicatives pour le modèle."""
from __future__ import annotations

import numpy as np
import pandas as pd


def ema(s: pd.Series, n: int) -> pd.Series:
    return s.ewm(span=n, adjust=False).mean()


def rsi(close: pd.Series, n: int = 14) -> pd.Series:
    d = close.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    rs = up / dn.replace(0, np.nan)
    out = 100 - 100 / (1 + rs)
    out[(dn == 0) & (up > 0)] = 100.0  # hausse sans aucune baisse : RSI maximal
    return out.fillna(50)


def macd(close: pd.Series) -> tuple[pd.Series, pd.Series, pd.Series]:
    m = ema(close, 12) - ema(close, 26)
    s = ema(m, 9)
    return m, s, m - s


def bollinger_pctb(close: pd.Series, n: int = 20) -> pd.Series:
    mid = close.rolling(n).mean()
    sd = close.rolling(n).std()
    return (close - (mid - 2 * sd)) / (4 * sd).replace(0, np.nan)


FEATURES = ["r1", "r3", "r6", "r12", "r24", "r72", "rsi", "macd_n", "ema_gap", "trend200", "pctb",
            "vol24", "vol_ratio", "vz", "range_pos", "ctx_r24"]


def build(df: pd.DataFrame, ctx: pd.Series | None = None) -> pd.DataFrame:
    """Construit les variables à partir de bougies OHLCV (index temporel)."""
    c, v = df["close"], df["volume"]
    lr = np.log(c).diff()
    f = pd.DataFrame(index=df.index)
    for k in (1, 3, 6, 12, 24, 72):
        f[f"r{k}"] = np.log(c / c.shift(k))
    f["rsi"] = rsi(c)
    _, _, h = macd(c)
    f["macd_n"] = h / c
    f["ema_gap"] = ema(c, 20) / ema(c, 50) - 1
    f["trend200"] = c / ema(c, 200) - 1
    f["pctb"] = bollinger_pctb(c)
    f["vol24"] = lr.rolling(24).std()
    f["vol_ratio"] = f["vol24"] / lr.rolling(168).std()
    lv = np.log1p(v)
    f["vz"] = (lv - lv.rolling(48).mean()) / lv.rolling(48).std().replace(0, np.nan)
    lo, hi = df["low"].rolling(48).min(), df["high"].rolling(48).max()
    f["range_pos"] = (c - lo) / (hi - lo).replace(0, np.nan)
    if ctx is not None and len(ctx):
        cr = np.log(ctx / ctx.shift(24)).reindex(f.index, method="ffill")
        f["ctx_r24"] = cr
    else:
        f["ctx_r24"] = 0.0
    return f.replace([np.inf, -np.inf], np.nan)


def target(df: pd.DataFrame, h: int) -> pd.Series:
    """1 si le prix de clôture dans h bougies est plus haut qu'aujourd'hui."""
    fut = df["close"].shift(-h)
    y = (fut > df["close"]).astype(float)
    y[fut.isna()] = np.nan
    return y


def future_return(df: pd.DataFrame, h: int) -> pd.Series:
    return df["close"].shift(-h) / df["close"] - 1


def describe_technical(df: pd.DataFrame) -> tuple[float, str]:
    """Score technique entre -1 et 1 avec une explication en français."""
    c = df["close"]
    e20, e50 = ema(c, 20).iloc[-1], ema(c, 50).iloc[-1]
    r = float(rsi(c).iloc[-1])
    _, _, h = macd(c)
    hn = float(h.iloc[-1] / c.iloc[-1])
    score = np.tanh((e20 / e50 - 1) * 60 + hn * 300 + (r - 50) / 40)
    parts = [f"EMA 20 {'au-dessus' if e20 > e50 else 'sous'} l'EMA 50",
             f"RSI {r:.0f}" + (" (suracheté)" if r > 70 else " (survendu)" if r < 30 else ""),
             f"MACD {'haussier' if hn > 0 else 'baissier'}"]
    return float(score), ", ".join(parts)


def describe_volume(df: pd.DataFrame) -> tuple[float, str]:
    v = np.log1p(df["volume"])
    z = float((v.iloc[-6:].mean() - v.iloc[-54:-6].mean()) / (v.iloc[-54:-6].std() or 1))
    r6 = float(df["close"].iloc[-1] / df["close"].iloc[-7] - 1)
    pct = float(np.expm1(v.iloc[-6:].mean() - v.iloc[-54:-6].mean()) * 100)
    score = np.tanh(z / 2) * (1 if r6 >= 0 else -1)
    return float(score), f"Volume {pct:+.0f} % vs moyenne récente, sur un mouvement {'haussier' if r6 >= 0 else 'baissier'} ({r6 * 100:+.1f} %)"


def describe_volatility(df: pd.DataFrame) -> tuple[float, str]:
    lr = np.log(df["close"]).diff()
    a, b = float(lr.tail(24).std()), float(lr.tail(168).std() or 1e-9)
    ratio = a / b if b else 1
    score = -np.tanh((ratio - 1) * 1.5) * 0.6
    return float(score), f"Volatilité {'en hausse' if ratio > 1.1 else 'en baisse' if ratio < .9 else 'stable'} ({ratio:.1f}× la normale) : {'mouvements brusques possibles' if ratio > 1.1 else 'marché plus calme'}"
