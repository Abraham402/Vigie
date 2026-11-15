"""Tests du bot Vigie (sans réseau : données synthétiques)."""
import numpy as np
import pandas as pd
import pytest

from vigie import features as F
from vigie import model, sentiment
from vigie.main import close_at, fr_pct
from vigie.market import resample, to_rows


def synth(n=3000, drift=0.0, seed=1, momentum=0.0):
    rng = np.random.default_rng(seed)
    r = np.zeros(n)
    eps = rng.normal(0, 0.01, n)
    for i in range(1, n):
        r[i] = drift + momentum * r[i - 1] + eps[i]
    close = 100 * np.exp(np.cumsum(r))
    idx = pd.date_range("2024-01-01", periods=n, freq="h", tz="UTC")
    high = close * (1 + np.abs(rng.normal(0, 0.003, n)))
    low = close * (1 - np.abs(rng.normal(0, 0.003, n)))
    return pd.DataFrame({"open": np.r_[close[0], close[:-1]], "high": high, "low": low, "close": close,
                         "volume": rng.uniform(100, 200, n)}, index=idx)


def test_rsi_bounds_and_extremes():
    up = pd.Series(np.linspace(1, 100, 200))
    dn = pd.Series(np.linspace(100, 1, 200))
    assert F.rsi(up).iloc[-1] > 95
    assert F.rsi(dn).iloc[-1] < 5
    r = F.rsi(pd.Series(np.random.default_rng(0).normal(100, 1, 500)))
    assert r.between(0, 100).all()


def test_build_features_no_lookahead():
    df = synth(600)
    full = F.build(df)
    cut = F.build(df.iloc[:400])
    # les variables d'une date ne doivent pas dépendre des données futures
    pd.testing.assert_frame_equal(full.iloc[300:400], cut.iloc[300:400])
    assert list(full.columns) == F.FEATURES


def test_target_alignment():
    df = synth(50)
    y = F.target(df, 3)
    assert y.iloc[-3:].isna().all()
    assert y.iloc[0] == float(df["close"].iloc[3] > df["close"].iloc[0])


def test_model_learns_momentum():
    df = synth(4000, momentum=0.35, seed=3)
    r = model.fit_predict(df, 1)
    assert r is not None
    assert 0 <= r.p <= 1 and 0.3 <= r.conf <= 0.92
    assert r.acc > 0.55, r.acc  # un marché à élan doit être partiellement prévisible


def test_model_random_walk_stays_humble():
    df = synth(4000, seed=11)
    r = model.fit_predict(df, 24)
    assert r is not None
    assert 0.4 < r.acc < 0.6  # pas de fausse précision sur un marché aléatoire


def test_model_insufficient_data():
    assert model.fit_predict(synth(200), 1) is None


def test_backtest_and_calibration():
    df = synth(4000, momentum=0.3, seed=5)
    r = model.fit_predict(df, 24)
    eq, bh = model.backtest_curve(r.oos, 24)
    assert eq and bh and len(eq) == len(bh) <= 150
    assert all(isinstance(x[0], int) for x in eq)
    cal = model.calibration(r.oos)
    assert all(50 <= a <= 100 and 0 <= b <= 100 for a, b in cal)


@pytest.mark.parametrize("text,asset", [
    ("Bitcoin ETF inflows hit record", "BTC"),
    ("Nvidia beats earnings expectations", "NVDA"),
    ("Fed signals rate cut as inflation cools", "SPY"),
    ("Crypto market rebounds after selloff", "BTC"),
    ("Tesla recalls 100,000 vehicles", "TSLA"),
    ("Weather is nice today", None),
])
def test_detect_asset(text, asset):
    assert sentiment.detect_asset(text) == asset


def test_sentiment_direction():
    assert sentiment.score("Bitcoin soars to all-time high as inflows surge") > 0.3
    assert sentiment.score("Exchange hacked, tokens plunge amid fraud probe") < -0.3


def test_market_mood_range():
    assert sentiment.market_mood([], None, None) == 50
    assert 0 <= sentiment.market_mood([0.9] * 5, 90, 10) <= 100
    assert sentiment.market_mood([-0.9] * 5, 10, 40) < 30


def test_resample_and_rows():
    df = synth(48)
    r4 = resample(df, "4h")
    assert len(r4) == 12
    assert r4["high"].iloc[0] == df["high"].iloc[:4].max()
    rows = to_rows(df, 10)
    assert len(rows) == 10 and len(rows[0]) == 6


def test_close_at_and_labels():
    df = synth(100)
    t = int(df.index[10].timestamp() * 1000)
    assert close_at(df, t) == df["close"].iloc[10]
    assert close_at(df, int(df.index[-1].timestamp() * 1000) + 10**7) is None
    assert fr_pct(64) == "HAUSSE 64 %" and fr_pct(30) == "BAISSE 70 %"


def test_calendar_translation():
    from vigie.translate import calendar_title
    assert calendar_title("Core Retail Sales m/m") == "Ventes au détail hors automobile (sur un mois)"
    assert calendar_title("Fed Chairman Warsh Speaks") == "Discours du président de la Fed (Warsh)"
    assert calendar_title("Unknown Event") == "Unknown Event"


def test_epoch_seconds_any_unit():
    from vigie.market import epoch_s
    for unit in ("ns", "ms", "s"):
        idx = pd.DatetimeIndex(["2026-01-01 00:00:00", "2026-01-01 00:05:00"], tz="UTC").as_unit(unit)
        assert list(epoch_s(idx)) == [1767225600, 1767225900]
    rows = to_rows(synth(5).set_axis(pd.date_range("2026-01-01", periods=5, freq="5min", tz="UTC").as_unit("ms")), 5)
    assert rows[1][0] - rows[0][0] == 300


def test_insider_roles_in_french():
    from vigie.extras import role_fr
    assert role_fr("Chief Financial Officer") == "Directeur financier"
    assert role_fr("Officer and Director") == "Administrateur"
    assert role_fr("Director") == "Administrateur"
