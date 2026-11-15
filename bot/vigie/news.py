"""Collecte d'actualités gratuites : flux RSS (presse, banques centrales, SEC), Google News, Reddit."""
from __future__ import annotations

import calendar
import hashlib
import html
import re
import time
from urllib.parse import quote_plus

import feedparser

from . import sentiment
from .util import http_get, log

FEEDS = [
    # (url, clé source, nom affiché, catégorie)
    ("https://www.federalreserve.gov/feeds/press_all.xml", "fed", "Federal Reserve", "official"),
    ("https://www.federalreserve.gov/feeds/speeches.xml", "fed", "Federal Reserve", "official"),
    ("https://www.sec.gov/news/pressreleases.rss", "sec", "SEC", "official"),
    ("https://www.ecb.europa.eu/rss/press.html", "ecb", "BCE", "official"),
    ("https://www.coindesk.com/arc/outboundfeeds/rss/", "coindesk", "CoinDesk", "crypto"),
    ("https://cointelegraph.com/rss", "cointelegraph", "Cointelegraph", "crypto"),
    ("https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839069", "cnbc", "CNBC", "stock"),
    ("https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114", "cnbc", "CNBC", "stock"),
    ("https://feeds.content.dowjones.io/public/rss/mw_topstories", "marketwatch", "MarketWatch", "stock"),
    ("https://finance.yahoo.com/news/rssindex", "yahoo", "Yahoo Finance", "stock"),
]
GNEWS_QUERIES = ["bitcoin OR ethereum OR crypto", "stock market OR Wall Street OR S&P 500", "Federal Reserve rates"]
REDDIT = [("wallstreetbets", "stock"), ("CryptoCurrency", "crypto"), ("stocks", "stock")]
SRC_FROM_NAME = {"reuters": "reuters", "cnbc": "cnbc", "coindesk": "coindesk", "yahoo": "yahoo", "marketwatch": "marketwatch",
                 "cointelegraph": "cointelegraph", "bloomberg": "other"}


def _clean(s: str) -> str:
    s = html.unescape(re.sub(r"<[^>]+>", " ", s or ""))
    return re.sub(r"\s+", " ", s).strip()


def _ts(entry) -> int:
    for k in ("published_parsed", "updated_parsed"):
        v = entry.get(k)
        if v:
            return int(calendar.timegm(v) * 1000)
    return int(time.time() * 1000)


def _id(url: str, title: str) -> str:
    return hashlib.sha1((url or title).encode("utf-8")).hexdigest()[:12]


def _parse(url: str):
    r = http_get(url, timeout=15, retries=1)
    if r is None:
        return []
    return feedparser.parse(r.content).entries


def fetch_rss(max_age_h: float = 36) -> list[dict]:
    items, cutoff = [], (time.time() - max_age_h * 3600) * 1000
    for url, key, name, cat in FEEDS:
        for e in _parse(url)[:25]:
            t = _ts(e)
            if t < cutoff:
                continue
            title = _clean(e.get("title", ""))
            if not title:
                continue
            items.append({"id": _id(e.get("link", ""), title), "t": t, "src": key, "srcName": name, "cat": cat,
                          "txt": title, "summary": _clean(e.get("summary", ""))[:400], "url": e.get("link", "")})
    log.info("RSS : %d articles", len(items))
    return items


def fetch_google_news(queries: list[str], cat: str = "stock", who: dict | None = None, max_age_h: float = 36) -> list[dict]:
    items, cutoff = [], (time.time() - max_age_h * 3600) * 1000
    for q in queries:
        url = f"https://news.google.com/rss/search?q={quote_plus(q + ' when:1d')}&hl=en-US&gl=US&ceid=US:en"
        for e in _parse(url)[:12]:
            t = _ts(e)
            if t < cutoff:
                continue
            title = _clean(e.get("title", ""))
            src_name = (e.get("source") or {}).get("title", "") if isinstance(e.get("source"), dict) else ""
            if " - " in title and not src_name:
                title, src_name = title.rsplit(" - ", 1)
            elif src_name and title.endswith(" - " + src_name):
                title = title[: -len(src_name) - 3]
            key = next((v for k, v in SRC_FROM_NAME.items() if k in src_name.lower()), "gnews")
            it = {"id": _id(e.get("link", ""), title), "t": t, "src": key, "srcName": src_name or "Google News", "cat": cat,
                  "txt": title, "summary": "", "url": e.get("link", "")}
            if who and q in who:
                it["who"] = who[q]
                it["person"] = True
            items.append(it)
    return items


def fetch_reddit(max_age_h: float = 24) -> list[dict]:
    items, cutoff = [], (time.time() - max_age_h * 3600) * 1000
    for sub, cat in REDDIT:
        r = http_get(f"https://www.reddit.com/r/{sub}/top.json", params={"t": "day", "limit": 15}, timeout=12, retries=1)
        if r is None:
            # repli sur le flux RSS public
            for e in _parse(f"https://www.reddit.com/r/{sub}/top/.rss?t=day")[:10]:
                title = _clean(e.get("title", ""))
                items.append({"id": _id(e.get("link", ""), title), "t": _ts(e), "src": "reddit", "srcName": f"Reddit r/{sub}",
                              "cat": "social", "txt": title, "summary": "", "url": e.get("link", ""), "who": f"r/{sub}"})
            continue
        try:
            for c in r.json()["data"]["children"]:
                d = c["data"]
                t = int(d.get("created_utc", 0) * 1000)
                if t < cutoff or d.get("stickied"):
                    continue
                items.append({"id": _id(d.get("permalink", ""), d["title"]), "t": t, "src": "reddit", "srcName": f"Reddit r/{sub}",
                              "cat": "social", "txt": _clean(d["title"]), "summary": _clean(d.get("selftext", ""))[:300],
                              "url": "https://www.reddit.com" + d.get("permalink", ""), "who": f"r/{sub} · {d.get('score', 0):,} votes".replace(",", " ")})
        except Exception as e:
            log.warning("Reddit %s : %s", sub, e)
    log.info("Reddit : %d messages", len(items))
    return items


def collect(people: list[tuple[str, str]], assets: set[str]) -> list[dict]:
    items = fetch_rss() + fetch_reddit()
    items += fetch_google_news(GNEWS_QUERIES[:2], "stock")
    items += fetch_google_news([GNEWS_QUERIES[2]], "official")
    who = {f'"{q}"': label for q, label in people}
    items += fetch_google_news(list(who.keys()), "stock", who=who)
    # dédoublonnage (même titre)
    seen, out = set(), []
    for it in sorted(items, key=lambda x: -x["t"]):
        k = re.sub(r"\W+", "", it["txt"].lower())[:80]
        if k in seen or it["id"] in seen:
            continue
        seen.add(k)
        seen.add(it["id"])
        text = it["txt"] + " " + it.get("summary", "")
        it["asset"] = sentiment.detect_asset(text, assets)
        it["s"] = round(sentiment.score(it["txt"] + ". " + it.get("summary", "")[:200]), 2)
        if not it["asset"] and it["cat"] != "official":
            continue  # hors sujet pour les actifs suivis
        if it["asset"] and it["cat"] in ("stock", "crypto") and it["asset"] in assets:
            it["cat"] = "crypto" if it["asset"] in ("BTC", "ETH", "SOL", "BNB", "XRP") else it["cat"]
        out.append(it)
    log.info("Actualités retenues : %d", len(out))
    return out
