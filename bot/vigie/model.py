"""Modèle de probabilité (gradient boosting) validé en walk-forward, avec calibration et backtest."""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression

from . import features as F

FEE = 0.001


def _clf() -> HistGradientBoostingClassifier:
    return HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05, max_iter=160, min_samples_leaf=60,
                                          l2_regularization=1.0, random_state=7)


def _logit(p: np.ndarray) -> np.ndarray:
    p = np.clip(p, 1e-4, 1 - 1e-4)
    return np.log(p / (1 - p)).reshape(-1, 1)


@dataclass
class HorizonResult:
    p: float                      # probabilité de hausse (0-1), calibrée
    conf: float                   # confiance 0-1
    acc: float | None             # réussite hors échantillon (toutes prédictions)
    sig_acc: float | None         # réussite quand le modèle s'engage (|p-0.5| >= 0.05)
    n_sig: int
    oos: pd.DataFrame = field(default_factory=pd.DataFrame)  # p, y, ret (hors échantillon)


def fit_predict(df: pd.DataFrame, h: int, ctx: pd.Series | None = None, folds: int = 4,
                min_train: int = 400) -> HorizonResult | None:
    """Entraîne et évalue le modèle pour un horizon de h bougies.

    Walk-forward : le modèle est entraîné uniquement sur le passé (avec un « embargo » de h
    bougies pour éviter toute fuite d'information), puis testé sur la période suivante.
    """
    if df is None or len(df) < min_train + 100:
        return None
    X = F.build(df, ctx)[F.FEATURES]
    y = F.target(df, h)
    ret = F.future_return(df, h)
    data = pd.concat([X, y.rename("y"), ret.rename("ret")], axis=1)
    lab = data.dropna(subset=F.FEATURES[:-1] + ["y"])
    if len(lab) < min_train + 100:
        return None
    n = len(lab)
    start = max(min_train, int(n * 0.55))
    edges = np.linspace(start, n, folds + 1).astype(int)
    oos = []
    for a, b in zip(edges[:-1], edges[1:]):
        tr = lab.iloc[: max(0, a - h)]
        te = lab.iloc[a:b]
        if len(tr) < min_train or te.empty or tr["y"].nunique() < 2:
            continue
        m = _clf().fit(tr[F.FEATURES], tr["y"])
        oos.append(pd.DataFrame({"p": m.predict_proba(te[F.FEATURES])[:, 1], "y": te["y"], "ret": te["ret"]}, index=te.index))
    if not oos:
        return None
    oos_df = pd.concat(oos)
    # calibration (régression logistique sur la sortie du modèle, Platt scaling)
    cal = None
    if oos_df["y"].nunique() == 2 and len(oos_df) > 100:
        cal = LogisticRegression(C=1.0).fit(_logit(oos_df["p"].to_numpy()), oos_df["y"])
        oos_df["p"] = cal.predict_proba(_logit(oos_df["p"].to_numpy()))[:, 1]
    acc = float(((oos_df["p"] > 0.5) == (oos_df["y"] > 0.5)).mean())
    sig = oos_df[(oos_df["p"] - 0.5).abs() >= 0.05]
    sig_acc = float(((sig["p"] > 0.5) == (sig["y"] > 0.5)).mean()) if len(sig) >= 20 else None
    # modèle final sur tout l'historique étiqueté, prédiction sur la dernière bougie
    final = _clf().fit(lab[F.FEATURES], lab["y"])
    last = X.iloc[[-1]].fillna(0.0)
    p = float(final.predict_proba(last[F.FEATURES])[:, 1][0])
    if cal is not None:
        p = float(cal.predict_proba(_logit(np.array([p])))[:, 1][0])
    edge = max(0.0, (sig_acc or acc) - 0.5)
    conf = float(np.clip(0.35 + edge * 5 + abs(p - 0.5) * 0.9, 0.3, 0.92))
    return HorizonResult(p=p, conf=conf, acc=acc, sig_acc=sig_acc, n_sig=int(len(sig)), oos=oos_df)


def backtest_curve(oos: pd.DataFrame, h: int, threshold: float = 0.55, max_points: int = 150):
    """Stratégie simple : acheter quand p >= seuil, rester à l'écart sinon (pas de levier, frais inclus)."""
    if oos is None or oos.empty:
        return [], []
    step = oos.iloc[::max(1, h)].dropna(subset=["ret"])
    if step.empty:
        return [], []
    strat = np.where(step["p"] >= threshold, step["ret"] - 2 * FEE, 0.0)
    eq = 100 * np.cumprod(1 + strat)
    bh = 100 * np.cumprod(1 + step["ret"].to_numpy())
    t = (step.index.astype("int64") // 10**9).astype(int)
    idx = np.linspace(0, len(step) - 1, min(max_points, len(step))).astype(int)
    return ([[int(t[i]), round(float(eq[i]), 2)] for i in idx], [[int(t[i]), round(float(bh[i]), 2)] for i in idx])


def calibration(oos: pd.DataFrame) -> list[list[int]]:
    """Pour chaque niveau de probabilité annoncé, fréquence réellement observée (en %)."""
    if oos is None or len(oos) < 100:
        return []
    conf = np.maximum(oos["p"], 1 - oos["p"])
    hit = ((oos["p"] > 0.5) == (oos["y"] > 0.5)).astype(float)
    out = []
    for lo, hi, lab in [(0.5, 0.55, 52), (0.55, 0.6, 57), (0.6, 0.7, 65), (0.7, 1.01, 75)]:
        m = (conf >= lo) & (conf < hi)
        if m.sum() >= 25:
            out.append([lab, int(round(hit[m].mean() * 100))])
    return out
