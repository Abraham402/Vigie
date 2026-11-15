"""Analyse de sentiment (VADER + lexique financier) et détection de l'actif concerné."""
from __future__ import annotations

import re

from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

FIN_LEXICON = {
    "surge": 2.4, "surges": 2.4, "soar": 2.6, "soars": 2.6, "rally": 2.0, "rallies": 2.0, "jump": 1.6, "jumps": 1.6,
    "gain": 1.2, "gains": 1.2, "beat": 1.8, "beats": 1.8, "record": 1.2, "bullish": 2.4, "upgrade": 2.0,
    "upgrades": 2.0, "inflows": 1.8, "inflow": 1.8, "approval": 1.8, "approves": 1.8, "approved": 1.8,
    "outperform": 1.8, "breakout": 1.6, "rebound": 1.4, "rebounds": 1.4, "buyback": 1.4, "rate cut": 1.6,
    "cut rates": 1.4, "partnership": 1.2, "adoption": 1.4, "all-time high": 2.2, "accumulate": 1.0,
    "plunge": -2.8, "plunges": -2.8, "crash": -3.0, "crashes": -3.0, "tumble": -2.4, "tumbles": -2.4,
    "slump": -2.2, "slumps": -2.2, "drop": -1.4, "drops": -1.4, "fall": -1.2, "falls": -1.2, "miss": -1.8,
    "misses": -1.8, "bearish": -2.4, "downgrade": -2.0, "downgrades": -2.0, "outflows": -1.8, "outflow": -1.8,
    "lawsuit": -1.8, "sues": -1.6, "probe": -1.4, "investigation": -1.4, "ban": -2.0, "bans": -2.0,
    "hack": -2.6, "hacked": -2.6, "exploit": -2.2, "recall": -1.6, "layoffs": -1.4, "tariff": -1.0,
    "tariffs": -1.0, "sell-off": -2.2, "selloff": -2.2, "liquidation": -1.8, "liquidations": -1.8,
    "rate hike": -1.6, "inflation": -0.6, "recession": -2.2, "default": -2.0, "bankruptcy": -3.0,
    "fraud": -2.8, "delay": -1.0, "delays": -1.0, "warning": -1.2, "fears": -1.4, "volatile": -0.6,
}

ASSET_KEYWORDS = {
    "BTC": [r"\bbitcoin", r"\bbtc\b", r"\bspot bitcoin etf"],
    "ETH": [r"\bethereum", r"\bether\b", r"\beth\b"],
    "SOL": [r"\bsolana", r"\bsol\b"],
    "BNB": [r"\bbnb\b", r"\bbinance coin"],
    "XRP": [r"\bxrp\b", r"\bripple\b"],
    "NVDA": [r"\bnvidia", r"\bnvda\b", r"jensen huang"],
    "AAPL": [r"\bapple\b", r"\baapl\b", r"\biphone", r"tim cook"],
    "TSLA": [r"\btesla", r"\btsla\b", r"elon musk", r"\brobotaxi"],
    "MSFT": [r"\bmicrosoft", r"\bmsft\b", r"\bazure\b", r"satya nadella"],
    "SPY": [r"s&p 500", r"\bs&p\b", r"wall street", r"\bfed\b", r"federal reserve", r"\bfomc\b", r"\binflation",
            r"\bcpi\b", r"interest rate", r"\bnasdaq", r"\bdow\b", r"treasury", r"\bjobs report", r"\brecession"],
}
CRYPTO_GENERIC = [r"\bcrypto", r"\bstablecoin", r"\bdigital asset"]

_an: SentimentIntensityAnalyzer | None = None


def analyzer() -> SentimentIntensityAnalyzer:
    global _an
    if _an is None:
        _an = SentimentIntensityAnalyzer()
        _an.lexicon.update({k: v for k, v in FIN_LEXICON.items() if " " not in k})
    return _an


def score(text: str) -> float:
    """Sentiment entre -1 (très négatif) et +1 (très positif)."""
    t = text or ""
    s = analyzer().polarity_scores(t)["compound"]
    low = t.lower()
    for phrase, v in FIN_LEXICON.items():
        if " " in phrase and phrase in low:
            s += v / 8
    return float(max(-1.0, min(1.0, s)))


def detect_asset(text: str, allowed: set[str] | None = None) -> str | None:
    """Actif le plus cité dans le texte (priorité aux actifs précis sur le marché global)."""
    low = (text or "").lower()
    hits: dict[str, int] = {}
    for sym, pats in ASSET_KEYWORDS.items():
        if allowed and sym not in allowed:
            continue
        n = sum(len(re.findall(p, low)) for p in pats)
        if n:
            hits[sym] = n
    specific = {k: v for k, v in hits.items() if k != "SPY"}
    if specific:
        return max(specific, key=specific.get)
    if any(re.search(p, low) for p in CRYPTO_GENERIC) and (not allowed or "BTC" in allowed):
        return "BTC"
    return "SPY" if "SPY" in hits else None


def market_mood(news_scores: list[float], crypto_fng: float | None, vix: float | None) -> int:
    """Indice peur/avidité 0-100 combinant actualités, Fear & Greed crypto et VIX."""
    parts, weights = [], []
    if news_scores:
        parts.append(50 + 50 * (sum(news_scores) / len(news_scores)) * 1.6)
        weights.append(1.0)
    if crypto_fng is not None:
        parts.append(crypto_fng)
        weights.append(1.0)
    if vix is not None:
        parts.append(max(0, min(100, 100 - (vix - 12) * 4)))
        weights.append(1.0)
    if not parts:
        return 50
    v = sum(p * w for p, w in zip(parts, weights)) / sum(weights)
    return int(round(max(0, min(100, v))))
