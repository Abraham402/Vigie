"""Vigie Auto : robot trader FICTIF.

Il gère un budget confié depuis l'application (portefeuille fictif), applique un répertoire de
stratégies reprises de skills de trading publics (règles réécrites ici, aucun code tiers exécuté),
respecte des règles de risque strictes et rend compte de chaque décision.

Sources des règles :
- Cassure 20 j, Rebond : trader-scanner (github.com/Jakeschincariol/day-trader-skill, MIT)
- Stop ATR, objectif 2R, contrôle du risque : trader-exit / trader-risk (même dépôt)
- VCP (Minervini), Explosion de momentum (Stockbee), Tendance, Météo crypto, taille de position :
  github.com/tradermonty/claude-trading-skills
- Retour à la moyenne (z-score) : github.com/agiprolabs/claude-trading-skills
"""
from __future__ import annotations

import datetime as dt
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from . import telegram
from .daytrader import atr as atr_fn
from .daytrader import rsi_wilder
from .util import log, now_ms

FEE = 0.001
NY = ZoneInfo("America/New_York")
PARIS = ZoneInfo("Europe/Paris")

STRATS = {
    "breakout": ("Cassure 20 j", "clôture au-dessus des 20 précédentes"),
    "rebond": ("Rebond", "RSI sous 30 puis clôture en hausse"),
    "tendance": ("Tendance", "EMA 20 qui croise au-dessus de l'EMA 50, au-dessus de la moyenne 200 j"),
    "signal": ("Signal du bot", "modèle ≥ 60 % de hausse sur 24 h avec une confiance suffisante"),
    "vcp": ("VCP (Minervini)", "tendance de fond haussière, volatilité qui se resserre puis cassure avec volume"),
    "burst": ("Explosion de momentum", "hausse ≥ 4 % (6 % en crypto) avec volume, clôture près du plus haut"),
    "meanrev": ("Retour à la moyenne", "prix à plus de 2 écarts-types sous sa moyenne 20 j, tendance de fond haussière"),
    "dca": ("Achat régulier (DCA)", "achète un peu chaque jour sans chercher le bon moment : la référence à battre"),
}
MAX_DAYS = {"breakout": 10, "rebond": 7, "tendance": 20, "signal": 2, "vcp": 15, "burst": 5, "meanrev": 7}


# ----------------------------------------------------------------------------- outils

def complete_daily(md) -> pd.DataFrame:
    """Bougies journalières terminées (la séance en cours est écartée)."""
    d = md.d1
    if d is None or d.empty:
        return d
    now = dt.datetime.now(dt.timezone.utc)
    last = d.index[-1]
    if md.kind == "crypto":
        if last.date() >= now.date():
            d = d.iloc[:-1]
    else:
        ny = now.astimezone(NY)
        if last.tz_convert(NY).date() >= ny.date() and (ny.hour, ny.minute) < (16, 0):
            d = d.iloc[:-1]
    return d


def market_open(kind: str, now: dt.datetime | None = None) -> bool:
    if kind == "crypto":
        return True
    ny = (now or dt.datetime.now(dt.timezone.utc)).astimezone(NY)
    return ny.weekday() < 5 and (9, 30) <= (ny.hour, ny.minute) < (16, 0)


def fmt(v: float, d: int = 2) -> str:
    return f"{v:,.{d}f}".replace(",", " ").replace(".", ",")


def money(v: float, d: int = 0) -> str:
    return ("−" if v < 0 else "") + fmt(abs(v), d) + " $"


def pct(v: float) -> str:
    return f"{v:+.2f} %".replace(".", ",").replace("-", "−")


def pfmt(p: float) -> str:
    return fmt(p, 4 if p < 10 else 2 if p < 1000 else 0)


# ----------------------------------------------------------------------------- signaux

def signals(md, proba_p24: tuple | None) -> list[dict]:
    """Signaux d'entrée pour un actif. Chaque signal : strat, stop, target, reason, key (anti-doublon)."""
    out = []
    d = complete_daily(md)
    if d is None or len(d) < 60:
        return out
    c, h, l, v = d["close"].to_numpy(float), d["high"].to_numpy(float), d["low"].to_numpy(float), d["volume"].to_numpy(float)
    day = d.index[-1].date().isoformat()
    a = atr_fn(d) or (c[-1] * 0.03)
    last = c[-1]
    ma20, ma50 = c[-20:].mean(), c[-50:].mean()
    ma150 = c[-150:].mean() if len(c) >= 150 else None
    ma200 = c[-200:].mean() if len(c) >= 200 else None
    ema = lambda n: pd.Series(c).ewm(span=n, adjust=False).mean().to_numpy()
    e20, e50 = ema(20), ema(50)
    r, r_prev = rsi_wilder(list(c)), rsi_wilder(list(c[:-1]))

    def add(strat, stop, target, reason):
        if stop < last and target > last:
            out.append({"strat": strat, "stop": float(stop), "target": float(target), "reason": reason, "key": f"{strat}:{md.sym}:{day}"})

    r2 = lambda stop: last + 2 * (last - stop)   # objectif à 2 fois le risque (2R)
    # Cassure 20 jours (trader-scanner)
    if last > c[-21:-1].max():
        stop = last - 1.5 * a
        add("breakout", stop, r2(stop), f"clôture {pfmt(last)} $ au-dessus du plus haut des 20 séances ({pfmt(c[-21:-1].max())} $)")
    # Rebond après survente (trader-scanner)
    if r_prev is not None and r_prev < 30 and last > c[-2]:
        stop = min(l[-3:].min(), last - 1.5 * a)
        add("rebond", stop, r2(stop), f"RSI {r_prev:.0f} hier (survente) et clôture en hausse aujourd'hui")
    # Tendance : croisement EMA 20/50 récent, au-dessus de la moyenne 200 j (uptrend-analyzer)
    if (e20[-1] > e50[-1] and e20[-3] <= e50[-3]) and (ma200 is None or last > ma200):
        stop = last - 2 * a
        add("tendance", stop, r2(stop), "EMA 20 vient de croiser au-dessus de l'EMA 50" + (", prix au-dessus de la moyenne 200 j" if ma200 else ""))
    # VCP de Minervini (vcp-screener) : trend template + contraction + cassure avec volume
    if ma150 is not None and ma200 is not None and len(c) >= 220:
        lo52, hi52 = l[-252:].min(), h[-252:].max()
        trend_ok = last > ma50 > ma150 > ma200 and ma200 > c[-220:-20].mean() and last >= 1.25 * lo52 and last >= 0.75 * hi52
        rng = lambda x: (h[x].max() - l[x].min()) / c[-1]
        contraction = rng(slice(-10, -1)) < 0.6 * rng(slice(-40, -10)) and rng(slice(-10, -1)) < 0.12
        pivot = h[-11:-1].max()
        vol_ok = v[-1] > 1.5 * v[-51:-1].mean() if v[-51:-1].mean() > 0 else False
        if trend_ok and contraction and last > pivot and vol_ok:
            stop = last - 1.5 * a
            add("vcp", stop, r2(stop), f"tendance de fond haussière, base resserrée puis cassure du pivot {pfmt(pivot)} $ avec volume ×{v[-1] / v[-51:-1].mean():.1f}")
    # Explosion de momentum (stockbee-momentum-burst-screener)
    thr = 0.06 if md.kind == "crypto" else 0.04
    chg = last / c[-2] - 1
    rng_day = h[-1] - l[-1]
    close_loc = (last - l[-1]) / rng_day if rng_day > 0 else 0
    calm = (h[-4:-1].max() - l[-4:-1].min()) / c[-2] < 0.08
    if chg >= thr and v[-1] > v[-2] and close_loc >= 0.7 and calm:
        stop = l[-1]
        add("burst", stop, r2(stop), f"+{chg * 100:.1f} % en une séance, volume en hausse, clôture dans le haut de la bougie, après 3 jours calmes")
    # Retour à la moyenne (mean-reversion, z-score) uniquement en tendance de fond haussière
    sd20 = c[-20:].std()
    if sd20 > 0 and ma200 is not None:
        z = (last - ma20) / sd20
        if z < -2 and last > ma200:
            stop = last - 1.5 * a
            if ma20 > last:
                add("meanrev", stop, ma20, f"z-score {z:.1f} sous la moyenne 20 j (excès de baisse), au-dessus de la moyenne 200 j")
    # Signal du modèle (probabilités du bot)
    if proba_p24 and proba_p24[0] >= 60 and proba_p24[1] >= 0.55:
        stop = last - 1.5 * a
        hour = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H")
        s = {"strat": "signal", "stop": float(stop), "target": float(r2(stop)),
             "reason": f"le modèle estime {proba_p24[0]} % de hausse sur 24 h (confiance {proba_p24[1]:.2f})", "key": f"signal:{md.sym}:{hour}"}
        if stop < last:
            out.append(s)
    return out


def crypto_regime(mds: dict) -> dict:
    """Météo du marché crypto (simplifiée de crypto-regime-analyzer) : 0 = défensif, 100 = favorable."""
    btc = mds.get("BTC")
    parts = []
    if btc is not None and len(btc.d1) >= 220:
        c = btc.d1["close"].to_numpy(float)
        ma50, ma200, ma200_prev = c[-50:].mean(), c[-200:].mean(), c[-220:-20].mean()
        parts.append((0.4, 100 * (0.4 * (c[-1] > ma200) + 0.3 * (ma50 > ma200) + 0.3 * (ma200 > ma200_prev))))
    cryptos = [m for m in mds.values() if m.kind == "crypto" and len(m.d1) >= 60]
    if cryptos:
        above = np.mean([m.d1["close"].iloc[-1] > m.d1["close"].iloc[-50:].mean() for m in cryptos])
        mom = np.mean([m.d1["close"].iloc[-1] > m.d1["close"].iloc[-31] for m in cryptos])
        parts.append((0.3, 100 * above))
        parts.append((0.3, 100 * mom))
    if not parts:
        return {"score": 50, "zone": "neutre"}
    score = sum(w * x for w, x in parts) / sum(w for w, _ in parts)
    return {"score": round(score), "zone": "défensif" if score < 40 else "favorable" if score >= 80 else "neutre"}


# ----------------------------------------------------------------------------- compte

def new_account(cmd: dict) -> dict:
    budget = float(cmd.get("budget") or 0)
    return {"active": True, "start": now_ms(), "budget": budget, "cash": budget, "pos": {}, "journal": [], "eq": [],
            "stats": {}, "seen": [], "strats": cmd.get("strats") or list(STRATS), "risk": float(cmd.get("risk") or 1),
            "report": int(cmd.get("report") or 60), "last_report": 0, "day": "", "day_start": budget, "dca_last": {}}


def equity(acc: dict, prices: dict) -> float:
    return acc["cash"] + sum(p["q"] * pos_price(k, p, prices) for k, p in acc["pos"].items())


def log_event(acc, **ev):
    ev["t"] = now_ms()
    acc["journal"].append(ev)
    acc["journal"] = acc["journal"][-300:]


def stat(acc, strat) -> dict:
    return acc["stats"].setdefault(strat, {"trades": 0, "wins": 0, "pnl": 0.0, "buys": 0})


def sell(acc, s, px, why):
    p = acc["pos"].pop(s)
    val = p["q"] * px
    fee = val * FEE
    pnl = val - fee - p["cost"]
    acc["cash"] += val - fee
    st = stat(acc, p["strat"])
    st["trades"] += 1
    st["pnl"] += pnl
    st["wins"] += int(pnl > 0)
    log_event(acc, type="sell", s=p.get("sym", s), strat=p["strat"], px=px, q=p["q"], val=val, pnl=pnl, reason=why)
    return pnl


def buy(acc, s, px, q, strat, stop, target, reason, kind):
    val = q * px
    fee = val * FEE
    acc["cash"] -= val + fee
    acc["pos"][s] = {"q": q, "entry": px, "cost": val + fee, "strat": strat, "sl": stop, "tp": target, "t": now_ms(), "kind": kind}
    stat(acc, strat)["buys"] += 1
    log_event(acc, type="buy", s=s.split(":")[-1], strat=strat, px=px, q=q, val=val, sl=stop, tp=target, reason=reason)


def process_command(state: dict, snap: dict | None, prices: dict) -> None:
    cmd = (snap or {}).get("auto")
    if not cmd or not cmd.get("id") or cmd["id"] == state.get("auto_cmd"):
        return
    state["auto_cmd"] = cmd["id"]
    acc = state.get("auto")
    action = cmd.get("action")
    if action == "start" and not (acc and acc.get("active")) and float(cmd.get("budget") or 0) > 0:
        state["auto"] = new_account(cmd)
        log_event(state["auto"], type="info", reason=f"Robot démarré avec {money(float(cmd['budget']))} et {len(state['auto']['strats'])} stratégies.")
        telegram.send(f"🤖 <b>Vigie Auto démarre</b>\nBudget fictif : {money(float(cmd['budget']))}\nStratégies : "
                      + ", ".join(STRATS[k][0] for k in state["auto"]["strats"] if k in STRATS)
                      + f"\nRisque par trade : {state['auto']['risk']:g} % · rapport toutes les {state['auto']['report']} min")
    elif action == "update" and acc and acc.get("active"):
        for k in ("strats", "risk", "report"):
            if cmd.get(k) is not None:
                acc[k] = cmd[k] if k == "strats" else float(cmd[k]) if k == "risk" else int(cmd[k])
        log_event(acc, type="info", reason="Réglages mis à jour depuis l'application.")
    elif action == "stop" and acc and acc.get("active"):
        for s in list(acc["pos"]):
            sell(acc, s, pos_price(s, acc["pos"][s], prices), "arrêt du robot demandé")
        acc["active"] = False
        state["auto_returned"] = {"id": cmd["id"], "amount": round(acc["cash"], 2), "t": now_ms()}
        perf = (acc["cash"] / acc["budget"] - 1) * 100
        log_event(acc, type="info", reason=f"Robot arrêté : {money(acc['cash'], 2)} rendus au portefeuille ({pct(perf)}).")
        telegram.send(f"🤖 <b>Vigie Auto arrêté</b>\n{money(acc['cash'], 2)} rendus à votre portefeuille fictif · résultat {pct(perf)}")


def run(state: dict, mds: dict, proba: dict, snap: dict | None) -> dict | None:
    prices = {s: float(m.quote["price"]) for s, m in mds.items() if m.quote}
    process_command(state, snap, prices)
    acc = state.get("auto")
    if not acc:
        return None
    if not acc.get("active"):
        return export(state, acc, prices, None)
    now = dt.datetime.now(dt.timezone.utc)
    today = now.astimezone(PARIS).date().isoformat()
    if acc["day"] != today:
        acc["day"], acc["day_start"] = today, equity(acc, prices)
    regime = crypto_regime(mds)

    # 1. sorties : stop-loss, objectif, durée maximale
    for s in list(acc["pos"]):
        p, md = acc["pos"][s], mds.get(s)
        if not md or p["strat"] == "dca" or not market_open(p["kind"], now):
            continue
        px = prices[s]
        lo, hi = px, px
        if md.kind == "crypto" and not md.h1.empty:
            bar = md.h1.iloc[-1]
            lo, hi = min(px, float(bar["low"])), max(px, float(bar["high"]))
        days = (now_ms() - p["t"]) / 864e5
        if p["sl"] and lo <= p["sl"]:
            sell(acc, s, min(p["sl"], px) if px < p["sl"] else p["sl"], f"stop-loss touché à {pfmt(p['sl'])} $")
        elif p["tp"] and hi >= p["tp"]:
            sell(acc, s, p["tp"], f"objectif atteint à {pfmt(p['tp'])} $")
        elif days > MAX_DAYS.get(p["strat"], 10):
            sell(acc, s, px, f"durée maximale de {MAX_DAYS.get(p['strat'], 10)} jours atteinte")

    # 2. entrées
    eq = equity(acc, prices)
    enabled = [k for k in acc["strats"] if k in STRATS]
    sleeve = acc["budget"] / max(1, len(enabled))
    halted = eq < acc["day_start"] * 0.97
    if halted and not any(e.get("type") == "halt" and e["t"] > now_ms() - 12 * 3600e3 for e in acc["journal"]):
        log_event(acc, type="halt", reason="perte du jour supérieure à 3 % : aucune nouvelle position avant demain (règle de trader-risk)")
    seen = set(acc["seen"])
    if not halted:
        cands = []
        for s, md in mds.items():
            if s in acc["pos"] or not market_open(md.kind, now) or s not in prices:
                continue
            p24 = tuple(proba[s][1]) if s in proba else None
            for sig in signals(md, p24):
                if sig["strat"] in enabled and sig["key"] not in seen:
                    cands.append((s, md, sig))
        order = {k: i for i, k in enumerate(["vcp", "breakout", "burst", "tendance", "signal", "rebond", "meanrev"])}
        cands.sort(key=lambda x: order.get(x[2]["strat"], 9))
        for s, md, sig in cands:
            seen.add(sig["key"])
            if s in acc["pos"] or len([p for p in acc["pos"].values() if p["strat"] != "dca"]) >= 6:
                continue
            defensive = md.kind == "crypto" and regime["zone"] == "défensif"
            if defensive and sig["strat"] not in ("rebond", "meanrev"):
                log_event(acc, type="skip", s=s, strat=sig["strat"], reason=f"signal ignoré : météo crypto défensive ({regime['score']}/100)")
                continue
            px = prices[s]
            stop = min(sig["stop"], px * 0.995)
            risk_amt = eq * acc["risk"] / 100 * (0.5 if defensive else 1)
            q = risk_amt / max(px - stop, px * 0.002)
            used = sum(p["cost"] for p in acc["pos"].values() if p["strat"] == sig["strat"])
            cap = min(acc["cash"] / (1 + FEE), eq * 0.25, max(0.0, sleeve - used))
            q = min(q, cap / px)
            if q * px < 20:
                log_event(acc, type="skip", s=s, strat=sig["strat"], reason="signal ignoré : plus assez de budget alloué à cette stratégie")
                continue
            buy(acc, s, px, q, sig["strat"], stop, sig["target"], sig["reason"], md.kind)
        # Achat régulier (DCA) : un peu chaque jour sur BTC et l'ETF S&P 500
        if "dca" in enabled:
            for s in ("BTC", "SPY"):
                md = mds.get(s)
                if not md or s not in prices or not market_open(md.kind, now) or acc["dca_last"].get(s) == today:
                    continue
                amt = min(sleeve / 2 / 30, acc["cash"] / (1 + FEE))
                if amt < 5:
                    continue
                acc["dca_last"][s] = today
                px = prices[s]
                key = "dca:" + s
                p = acc["pos"].get(key)
                if p:
                    p["q"] += amt / px
                    p["cost"] += amt * (1 + FEE)
                    acc["cash"] -= amt * (1 + FEE)
                    p["entry"] = p["cost"] / p["q"]
                    stat(acc, "dca")["buys"] += 1
                    log_event(acc, type="buy", s=s, strat="dca", px=px, q=amt / px, val=amt, reason="achat régulier du jour")
                else:
                    buy(acc, key, px, amt / px, "dca", 0, 0, "achat régulier du jour", md.kind)
                    acc["pos"][key]["sym"] = s
    acc["seen"] = list(seen)[-800:]

    # 3. suivi de la valeur
    eq = equity(acc, prices)
    acc["eq"].append([now_ms() // 1000, round(eq, 2)])
    acc["eq"] = acc["eq"][-2000:]
    report(state, acc, prices, regime, snap)
    return export(state, acc, prices, regime)


def pos_price(k, p, prices):
    return prices.get(p.get("sym", k), p["entry"])


def open_pnl(acc, prices, strat=None):
    return sum(p["q"] * pos_price(k, p, prices) - p["cost"] for k, p in acc["pos"].items() if strat is None or p["strat"] == strat)


def leaderboard(acc, prices):
    rows = []
    for k in acc["strats"]:
        if k not in STRATS:
            continue
        st = acc["stats"].get(k, {"trades": 0, "wins": 0, "pnl": 0.0, "buys": 0})
        tot = st["pnl"] + open_pnl(acc, prices, k)
        rows.append({"k": k, "name": STRATS[k][0], "pnl": round(tot, 2), "realized": round(st["pnl"], 2), "trades": st["trades"],
                     "wins": st["wins"], "buys": st["buys"], "open": sum(1 for p in acc["pos"].values() if p["strat"] == k)})
    return sorted(rows, key=lambda r: -r["pnl"])


def report(state, acc, prices, regime, snap):
    if now_ms() - acc.get("last_report", 0) < (acc["report"] - 7) * 60000:
        return
    since = acc.get("last_report") or acc["start"]
    acc["last_report"] = now_ms()
    eq = acc["cash"] + sum(p["q"] * pos_price(k, p, prices) for k, p in acc["pos"].items())
    perf = (eq / acc["budget"] - 1) * 100
    now = dt.datetime.now(PARIS)
    lines = [f"🤖 <b>Vigie Auto · {now.strftime('%H:%M')}</b>",
             f"Budget {money(acc['budget'])} → <b>{money(eq)}</b> ({pct(perf)})",
             f"Météo crypto : {regime['zone']} ({regime['score']}/100) · liquidités {money(acc['cash'])}", ""]
    ev = [e for e in acc["journal"] if e["t"] > since and e["type"] in ("buy", "sell", "halt")]
    for e in ev[-10:]:
        name = STRATS.get(e.get("strat", ""), ("", ""))[0]
        if e["type"] == "buy":
            lines.append(f"✅ <b>Acheté {e['s']}</b> à {pfmt(e['px'])} $ ({money(e['val'])}) · <i>{name}</i> : {e['reason']}"
                         + (f" · stop {pfmt(e['sl'])} $ · objectif {pfmt(e['tp'])} $" if e.get("sl") else ""))
        elif e["type"] == "sell":
            lines.append(f"{'🟢' if e['pnl'] >= 0 else '🔴'} <b>Vendu {e['s']}</b> à {pfmt(e['px'])} $ · {e['reason']} · {money(e['pnl'], 2)} · <i>{name}</i>")
        else:
            lines.append(f"⛔ {e['reason']}")
    if not ev:
        lines.append("Aucune opération depuis le dernier rapport : aucun signal ne remplit toutes les conditions, le robot attend.")
    if acc["pos"]:
        lines += ["", "<b>Positions</b>"]
        for k, p in acc["pos"].items():
            px = pos_price(k, p, prices)
            g = (p["q"] * px / p["cost"] - 1) * 100
            lines.append(f"• {p.get('sym', k)} ({STRATS[p['strat']][0]}) {pct(g)}" + (f" · stop {pfmt(p['sl'])} $" if p["sl"] else ""))
    lb = leaderboard(acc, prices)
    if lb:
        lines += ["", "<b>Classement des stratégies</b>"]
        for i, r in enumerate(lb[:4]):
            lines.append(f"{['🥇', '🥈', '🥉', '4.'][i]} {r['name']} {money(r['pnl'], 2)} ({r['trades']} trade{'s' if r['trades'] > 1 else ''} clos)")
    lines.append("\n<i>Robot fictif : estimations statistiques, aucun ordre réel.</i>")
    telegram.send("\n".join(lines), silent=now.hour >= 23 or now.hour < 7)


def export(state, acc, prices, regime) -> dict:
    eq = acc["cash"] + sum(p["q"] * pos_price(k, p, prices) for k, p in acc["pos"].items())
    pos = []
    for k, p in acc["pos"].items():
        px = pos_price(k, p, prices)
        pos.append({"s": p.get("sym", k), "strat": p["strat"], "q": p["q"], "entry": p["entry"], "px": px, "val": p["q"] * px,
                    "pnl": p["q"] * px - p["cost"], "pct": (p["q"] * px / p["cost"] - 1) * 100, "sl": p["sl"], "tp": p["tp"], "t": p["t"]})
    return {"active": acc["active"], "start": acc["start"], "budget": acc["budget"], "cash": round(acc["cash"], 2),
            "equity": round(eq, 2), "perf": round((eq / acc["budget"] - 1) * 100, 2) if acc["budget"] else 0,
            "strats": acc["strats"], "risk": acc["risk"], "report": acc["report"], "pos": pos,
            "journal": acc["journal"][-120:][::-1], "eq": acc["eq"][-600:], "board": leaderboard(acc, prices),
            "regime": regime, "cmd": state.get("auto_cmd"), "returned": state.get("auto_returned"),
            "names": {k: v[0] for k, v in STRATS.items()}, "rules": {k: v[1] for k, v in STRATS.items()}}
