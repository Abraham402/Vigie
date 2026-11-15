"""Passage complet du bot : données → modèle → actualités → alertes → fichiers JSON pour l'application.

Lancement : python -m vigie.main   (depuis le dossier bot/)
"""
from __future__ import annotations

import datetime as dt
import time
from concurrent.futures import ThreadPoolExecutor
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from . import extras, llm, market, model, news, telegram, translate
from . import features as F
from .util import OUT_DIR, STATE_DIR, load_people, load_settings, log, now_ms, read_json, setup_logging, write_json

PARIS = ZoneInfo("Europe/Paris")
CRYPTO = {"BTC", "ETH", "SOL", "BNB", "XRP"}


def pct(x: float | None) -> float | None:
    return None if x is None else round(x * 100, 1)


def close_at(df: pd.DataFrame, t_ms: int) -> float | None:
    """Clôture de la première bougie horaire après l'instant t."""
    if df is None or df.empty:
        return None
    ts = pd.Timestamp(t_ms, unit="ms", tz="UTC")
    after = df.index.searchsorted(ts)
    if after >= len(df):
        return None
    return float(df["close"].iloc[after])


def analyse_asset(md: market.MarketData, ctx_h1: pd.Series | None, ctx_d1: pd.Series | None) -> dict | None:
    """Probabilités 1 h / 24 h / 7 j + backtest pour un actif."""
    if md.kind == "crypto":
        res = [model.fit_predict(md.h1, h, ctx_h1 if md.sym != "BTC" else None) for h in (1, 24, 168)]
        bt_h, bt_res = 24, res[1]
    else:
        res = [model.fit_predict(md.h1, 1, ctx_h1 if md.sym != "SPY" else None, min_train=300),
               model.fit_predict(md.d1, 1, ctx_d1 if md.sym != "SPY" else None, min_train=300),
               model.fit_predict(md.d1, 5, ctx_d1 if md.sym != "SPY" else None, min_train=300)]
        bt_h, bt_res = 1, res[1]
    if not any(res):
        return None
    out_p = []
    for r in res:
        out_p.append([round(r.p * 100), round(r.conf, 2)] if r else [50, 0.3])
    eq, bh = model.backtest_curve(bt_res.oos if bt_res else None, bt_h)
    bt = {"win": [pct(r.sig_acc if r and r.sig_acc is not None else (r.acc if r else None)) for r in res],
          "n": int(sum(len(r.oos) for r in res if r)), "equity": eq, "bh": bh,
          "calib": model.calibration(bt_res.oos if bt_res else None)}
    return {"p": out_p, "bt": bt}


def factors_for(md: market.MarketData, news_items: list[dict]) -> tuple[list, float]:
    src = md.h1 if len(md.h1) > 60 else md.d1
    out = []
    try:
        out.append(["Technique", *F.describe_technical(src)])
        out.append(["Volume", *F.describe_volume(src)])
        out.append(["Volatilité", *F.describe_volatility(src)])
    except Exception as e:
        log.warning("facteurs %s : %s", md.sym, e)
    cutoff = now_ms() - 12 * 3600 * 1000
    mine = [n for n in news_items if n.get("asset") == md.sym and n["t"] >= cutoff]
    gen = [n for n in mine if not n.get("person")]
    ppl = [n for n in mine if n.get("person")]
    sent = float(np.mean([n["s"] for n in gen])) if gen else 0.0
    if gen:
        posr = sum(1 for n in gen if n["s"] > 0.05) / len(gen) * 100
        out.append(["Sentiment actus", round(sent, 2), f"{len(gen)} article{'s' if len(gen) > 1 else ''} en 12 h, {posr:.0f} % positifs"])
    else:
        out.append(["Sentiment actus", 0.0, "Pas d'actualité marquante sur 12 h"])
    if ppl:
        ps = float(np.mean([n["s"] for n in ppl]))
        top = max(ppl, key=lambda n: abs(n["s"]))
        out.append(["Personnes influentes", round(ps, 2), f"{top.get('who', 'Personnalité')} : « {top.get('txt_en', top['txt'])[:90]} »"])
    else:
        out.append(["Personnes influentes", 0.0, "Aucune déclaration récente des personnes suivies"])
    adj_news = sent * 8 * min(1.0, len(gen) / 3)
    adj_ppl = (float(np.mean([n["s"] for n in ppl])) * 4) if ppl else 0.0
    return [[n, round(float(v), 2), w] for n, v, w in out], float(np.clip(adj_news + adj_ppl, -7, 7))


def track_live(state: dict, mds: dict, proba: dict) -> dict:
    """Mesure de la réussite réelle : chaque heure on note la prédiction 24 h, puis on la vérifie 24 h plus tard."""
    log_ = state.setdefault("pred_log", [])
    stats = state.setdefault("pred_stats", {})
    hour = now_ms() // 3600000
    for s, P in proba.items():
        md = mds.get(s)
        if md and md.quote and not any(e["s"] == s and e["h"] == hour for e in log_):
            log_.append({"s": s, "h": hour, "t": now_ms(), "p": P[1][0], "px": md.quote["price"]})
    keep = []
    for e in log_:
        md = mds.get(e["s"])
        if now_ms() - e["t"] < 24 * 3600 * 1000:
            keep.append(e)
            continue
        if not md:
            continue
        px = close_at(md.h1, e["t"] + 24 * 3600 * 1000)
        if px is None:
            if now_ms() - e["t"] < 4 * 86400 * 1000:
                keep.append(e)
            continue
        if e["p"] == 50:
            continue
        st = stats.setdefault(e["s"], {"n": 0, "w": 0})
        st["n"] += 1
        st["w"] += int((e["p"] > 50) == (px > e["px"]))
    state["pred_log"] = keep[-3000:]
    return {s: {"n": v["n"], "win": round(v["w"] / v["n"] * 100, 1) if v["n"] else None} for s, v in stats.items()}


def track_sources(state: dict, mds: dict, items: list[dict]) -> list[list]:
    """Fiabilité des sources : l'actu annonçait-elle le bon sens du prix sur 24 h ?"""
    log_ = state.setdefault("news_log", [])
    stats = state.setdefault("src_stats", {})
    known = {e["id"] for e in log_}
    for it in items:
        md = mds.get(it.get("asset") or "")
        if not md or abs(it["s"]) < 0.2 or it["id"] in known or now_ms() - it["t"] > 6 * 3600 * 1000:
            continue
        px0 = close_at(md.h1, it["t"]) or (md.quote or {}).get("price")
        if px0:
            log_.append({"id": it["id"], "t": it["t"], "src": it["srcName"].split(" r/")[0] if it["src"] != "reddit" else it["srcName"],
                         "a": it["asset"], "s": it["s"], "px": px0})
    keep = []
    for e in log_:
        if now_ms() - e["t"] < 24 * 3600 * 1000:
            keep.append(e)
            continue
        md = mds.get(e["a"])
        px = close_at(md.h1, e["t"] + 24 * 3600 * 1000) if md else None
        if px is None:
            if now_ms() - e["t"] < 4 * 86400 * 1000:
                keep.append(e)
            continue
        st = stats.setdefault(e["src"], {"n": 0, "w": 0})
        st["n"] += 1
        st["w"] += int((e["s"] > 0) == (px > e["px"]))
    state["news_log"] = keep[-4000:]
    rows = [[k, v["n"], round(v["w"] / v["n"] * 100) if v["n"] >= 5 else None] for k, v in stats.items() if v["n"] >= 1]
    return sorted(rows, key=lambda r: (r[2] is None, -(r[2] or 0), -r[1]))[:15]


def fr_pct(p: int) -> str:
    return f"HAUSSE {p} %" if p >= 50 else f"BAISSE {100 - p} %"


def run() -> None:
    t0 = time.time()
    setup_logging()
    settings, people = load_settings(), load_people()
    acfg = settings["alerts"]
    state = read_json(STATE_DIR / "state.json", {})
    assets = [market.MarketData(s, n, k) for s, n, k in settings["assets"]]
    errors: list[str] = []
    telegram.resolve_chat(state)

    # 1. données de marché (en parallèle)
    with ThreadPoolExecutor(max_workers=5) as ex:
        list(ex.map(lambda m: m.fetch(), assets))
    mds = {m.sym: m for m in assets if m.quote}
    for m in assets:
        if not m.quote:
            errors.append(f"Pas de données pour {m.sym}")
    btc = mds.get("BTC")
    spy = mds.get("SPY")

    # 2. actualités
    try:
        items = news.collect(people, set(mds))
    except Exception as e:
        log.exception("actualités")
        errors.append(f"actualités : {e}")
        items = []

    # 3. modèles
    proba, factors, backtest = {}, {}, {}
    for m in mds.values():
        try:
            ctx_h1 = (btc.h1["close"] if btc is not None else None) if m.kind == "crypto" else (spy.h1["close"] if spy is not None else None)
            ctx_d1 = (spy.d1["close"] if spy is not None else None)
            r = analyse_asset(m, ctx_h1, ctx_d1)
            if not r:
                continue
            fac, adj = factors_for(m, items)
            P = r["p"]
            P[0][0] = int(np.clip(P[0][0] + adj * 0.4, 3, 97))
            P[1][0] = int(np.clip(P[1][0] + adj, 3, 97))
            P[2][0] = int(np.clip(P[2][0] + adj * 0.4, 3, 97))
            proba[m.sym], factors[m.sym], backtest[m.sym] = P, fac, r["bt"]
            log.info("%s : 1 h %s · 24 h %s · 7 j %s", m.sym, P[0], P[1], P[2])
        except Exception as e:
            log.exception("modèle %s", m.sym)
            errors.append(f"modèle {m.sym} : {e}")
    live = track_live(state, mds, proba)
    for s, b in backtest.items():
        b["live"] = live.get(s, {"n": 0, "win": None})

    # 4. enrichissement des actualités (traduction + résumé IA), avec cache
    cache = state.setdefault("news_cache", {})
    fresh = [it for it in items[:60] if it["id"] not in cache]
    if fresh and llm.available():
        llm.enrich_news(fresh[:20], proba)
    todo = [it for it in fresh[:25] if not it.get("txt_en")]
    if todo:  # sans IA (ou en complément) : traduction gratuite des titres
        for it, fr_txt in zip(todo, translate.free_translate([it["txt"] for it in todo])):
            if fr_txt and fr_txt.strip().lower() != it["txt"].strip().lower():
                it["txt_en"], it["txt"] = it["txt"], fr_txt
        for it in todo:
            if it.get("txt_en") and it["id"] not in cache:
                cache[it["id"]] = {k: it[k] for k in ("txt", "ai", "txt_en") if k in it}
    for it in items:
        if it["id"] in cache:
            it.update(cache[it["id"]])
        elif it.get("ai") or it.get("txt_en"):
            cache[it["id"]] = {k: it[k] for k in ("txt", "ai", "txt_en") if k in it}
        a = it.get("asset")
        it["p"] = proba[a][1][0] if a in proba else None
        if not it.get("ai") and a and a in proba:
            p = proba[a][1][0]
            it["ai"] = (f"Ton {'positif' if it['s'] > 0.05 else 'négatif' if it['s'] < -0.05 else 'neutre'} pour {mds[a].name}. "
                        f"Le bot estime {p if p >= 50 else 100 - p} % de chances de {'hausse' if p >= 50 else 'baisse'} sur 24 h.")
    if len(cache) > 3000:
        for k in list(cache)[: len(cache) - 3000]:
            cache.pop(k)
    sources = track_sources(state, mds, items)

    # 5. sources complémentaires
    stocks = [m.sym for m in mds.values() if m.kind == "stock"]
    ins = []
    try:
        ins = extras.insiders(stocks) + extras.congress(stocks)
        ins.sort(key=lambda r: r[0], reverse=True)
        ins = [[extras.fr_date(dt.date.fromisoformat(r[0])), *r[1:]] for r in ins[:30]]
    except Exception as e:
        log.warning("initiés : %s", e)
    cal = []
    try:
        cal = sorted(extras.calendar_events() + extras.earnings(stocks), key=lambda e: e["t"])
        for e in cal:
            e["ev"] = translate.calendar_title(e["ev"])
    except Exception as e:
        log.warning("calendrier : %s", e)
    fng, vix = extras.crypto_fear_greed(), extras.vix()
    mood = market_mood_safe([n["s"] for n in items if n["t"] > now_ms() - 12 * 3600 * 1000], fng, vix)

    # 6. alertes Telegram
    sent = state.setdefault("alerts_sent", {})
    alerts = state.setdefault("alerts_hist", [])
    now = now_ms()
    for s, P in proba.items():
        p, c = P[1]
        if c < acfg["min_confidence"] or acfg["proba_low"] < p < acfg["proba_high"]:
            continue
        key = f"p:{s}:{'up' if p >= 50 else 'down'}"
        if now - sent.get(key, 0) < acfg["cooldown_hours"] * 3600 * 1000:
            continue
        top = sorted(factors.get(s, []), key=lambda f: -abs(f[1]))[:2]
        why = " ; ".join(f"{f[0]} : {f[2]}" for f in top)
        a = {"t": now, "a": s, "p": p, "c": c, "src": " + ".join(f[0] for f in top) or "modèle", "sum": why}
        alerts.insert(0, a)
        sent[key] = now
        px = f"{mds[s].quote['price']:,.2f}".replace(",", " ").replace(".", ",")
        telegram.send(f"{'🟢' if p >= 50 else '🔴'} <b>{s}</b> · {fr_pct(p)} (24 h)\nPrix : {px} $\n"
                      f"Confiance : {c:.2f}\n🤖 {why}\n\n<i>Estimation statistique, pas un conseil.</i>")
    for it in items:
        if (abs(it["s"]) >= acfg["news_min_sentiment"] and it.get("asset") and (it["cat"] == "official" or it.get("person"))
                and now - it["t"] < 3600 * 1000 and f"n:{it['id']}" not in sent):
            sent[f"n:{it['id']}"] = now
            telegram.send(f"📰 <b>{it.get('who') or it['srcName']}</b> · {it['asset']}\n{it['txt']}\n"
                          f"Sentiment {it['s']:+.2f}" + (f" · bot : {fr_pct(it['p'])} (24 h)" if it.get("p") else "") +
                          (f"\n🤖 {it['ai']}" if it.get("ai") else "") + (f"\n{it['url']}" if it.get("url") else ""))
    for e in cal:
        if e["imp"] == 3 and 0 < e["t"] - now <= 75 * 60 * 1000 and f"c:{e['ev']}:{e['t']}" not in sent:
            sent[f"c:{e['ev']}:{e['t']}"] = now
            hh = dt.datetime.fromtimestamp(e["t"] / 1000, PARIS).strftime("%H:%M")
            telegram.send(f"📅 <b>Bientôt ({hh}, heure de Paris)</b> : {e['ev']} ({e['c']})\nPrévu : {e['cons'] or '—'} · Précédent : {e['prev'] or '—'}\n"
                          f"Annonce à fort impact : prudence sur les nouvelles positions.")
    state["alerts_hist"] = alerts[:40]
    for k in [k for k, v in sent.items() if now - v > 7 * 86400 * 1000]:
        sent.pop(k)

    # 7. résumé du matin
    summary = state.get("summary")
    paris = dt.datetime.now(PARIS)
    today = paris.date().isoformat()
    if paris.hour >= acfg["morning_summary_hour_paris"] and state.get("summary_date") != today and proba:
        summary = make_summary(mds, proba, items, cal, mood)
        state["summary"], state["summary_date"] = summary, today
        telegram.send("☀️ <b>" + summary["title"] + "</b>\n" + "\n".join("• " + l for l in summary["lines"]))

    # 8. écriture des fichiers pour l'application
    gen = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    write_json(OUT_DIR / "market.json", {"generated": gen, "list": [[m.sym, m.name, m.kind] for m in mds.values()],
                                         "assets": {s: m.browser_payload() for s, m in mds.items()}})
    write_json(OUT_DIR / "analysis.json", {
        "generated": gen, "proba": proba, "factors": factors, "backtest": backtest, "sentiment": mood, "summary": summary,
        "status": {"last_run": gen, "telegram": telegram.configured(), "gemini": llm.available(), "errors": errors[:10],
                   "binance": market._binance_base, "duration_s": round(time.time() - t0)}})
    keys = ("id", "t", "src", "srcName", "cat", "who", "txt", "url", "asset", "s", "p", "ai")
    write_json(OUT_DIR / "feed.json", {
        "generated": gen, "news": [{k: it[k] for k in keys if it.get(k) is not None} for it in items[:90]],
        "alerts": state["alerts_hist"], "insiders": ins, "calendar": cal, "sources": sources,
        "people": [label for _, label in people]})
    write_json(STATE_DIR / "state.json", state)
    log.info("Terminé en %.0f s (%d actifs analysés, %d actus, %d erreurs)", time.time() - t0, len(proba), len(items), len(errors))


def market_mood_safe(scores, fng, vix) -> int:
    from .sentiment import market_mood
    try:
        return market_mood(scores, fng, vix)
    except Exception:
        return 50


def make_summary(mds: dict, proba: dict, items: list[dict], cal: list[dict], mood: int) -> dict:
    up = sorted(proba.items(), key=lambda kv: -kv[1][1][0])
    best, worst = up[0], up[-1]
    moves = sorted(mds.values(), key=lambda m: -abs((m.quote["price"] / m.quote["open"] - 1) if m.quote and m.quote.get("open") else 0))[:3]
    next_ev = [e for e in cal if e["t"] > now_ms() and e["imp"] == 3][:2]
    lines = [", ".join(f"{m.sym} {(m.quote['price'] / m.quote['open'] - 1) * 100:+.1f} %" for m in moves) + " sur 24 h",
             f"Signal le plus haussier : {best[0]} ({best[1][1][0]} % de hausse sur 24 h)",
             f"Signal le plus baissier : {worst[0]} ({100 - worst[1][1][0]} % de baisse sur 24 h)",
             f"Sentiment du marché : {mood}/100"]
    if next_ev:
        lines.append("À surveiller : " + " ; ".join(
            f"{e['ev']} à {dt.datetime.fromtimestamp(e['t'] / 1000, PARIS).strftime('%H:%M')}" for e in next_ev))
    if llm.available():
        txt = llm.ask("Rédige en français simple, pour un débutant, 2 phrases (40 mots max au total) qui résument ce point de "
                      "marché matinal, sans conseil d'achat :\n" + "\n".join(lines), max_tokens=300)
        if txt:
            lines.insert(0, txt.strip().replace("\n", " ")[:300])
    lines.append("🎓 Conseil du jour : " + TIPS[dt.date.today().toordinal() % len(TIPS)])
    return {"t": now_ms(), "title": "Résumé du matin", "lines": lines}


TIPS = ["ne risquez jamais plus de 1 % de votre capital sur un trade.", "décidez votre stop-loss avant d'entrer, jamais pendant.",
        "une probabilité de 65 % reste 35 % d'erreur possible.", "évitez d'ouvrir une position juste avant une annonce de la Fed.",
        "notez pourquoi vous entrez dans votre journal de trading.", "après 3 pertes d'affilée, faites une pause.",
        "visez un gain au moins 2× plus grand que votre risque."]


if __name__ == "__main__":
    run()
