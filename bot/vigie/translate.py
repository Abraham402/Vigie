"""Traduction en français : IA si une clé est configurée, sinon service de traduction public gratuit."""
from __future__ import annotations

import re

from .util import http_get, log

CAL_FR = [
    (r"^Fed Chair(man)? (\w+) Speaks", r"Discours du président de la Fed (\2)"),
    (r"^FOMC Member (\w+) Speaks", r"Discours d'un membre de la Fed (\1)"),
    (r"^ECB President (\w+) Speaks", r"Discours de la présidente de la BCE (\1)"),
    (r"(\w+) Speaks$", r"Discours (\1)"),
    (r"^Federal Funds Rate", "Décision de taux de la Fed"),
    (r"^FOMC Statement", "Communiqué de la Fed (FOMC)"),
    (r"^FOMC Meeting Minutes", "Compte rendu de la Fed (FOMC)"),
    (r"^FOMC Press Conference", "Conférence de presse de la Fed"),
    (r"^Main Refinancing Rate", "Décision de taux de la BCE"),
    (r"^Monetary Policy Statement", "Communiqué de politique monétaire"),
    (r"^Core CPI", "Inflation sous-jacente (IPC)"),
    (r"^CPI", "Inflation (IPC)"),
    (r"^Core PPI", "Prix à la production sous-jacents"),
    (r"^PPI", "Prix à la production"),
    (r"^Core PCE Price Index", "Inflation PCE sous-jacente"),
    (r"^PCE Price Index", "Inflation PCE"),
    (r"^Non-Farm Employment Change", "Créations d'emplois (NFP)"),
    (r"^Unemployment Rate", "Taux de chômage"),
    (r"^Unemployment Claims", "Inscriptions au chômage"),
    (r"^Average Hourly Earnings", "Salaire horaire moyen"),
    (r"^Core Retail Sales", "Ventes au détail hors automobile"),
    (r"^Retail Sales", "Ventes au détail"),
    (r"^Advance GDP", "PIB (première estimation)"),
    (r"^Prelim GDP", "PIB (estimation préliminaire)"),
    (r"^Final GDP", "PIB (estimation finale)"),
    (r"^GDP", "PIB"),
    (r"^ISM Manufacturing PMI", "Indice ISM manufacturier"),
    (r"^ISM Services PMI", "Indice ISM des services"),
    (r"^Flash Manufacturing PMI", "PMI manufacturier (flash)"),
    (r"^Flash Services PMI", "PMI des services (flash)"),
    (r"^JOLTS Job Openings", "Offres d'emploi (JOLTS)"),
    (r"^ADP Non-Farm Employment Change", "Emplois privés ADP"),
    (r"^CB Consumer Confidence", "Confiance des consommateurs (Conference Board)"),
    (r"^Prelim UoM Consumer Sentiment", "Moral des consommateurs (Michigan)"),
    (r"^Revised UoM Consumer Sentiment", "Moral des consommateurs (Michigan, révisé)"),
    (r"^Empire State Manufacturing Index", "Indice manufacturier Empire State"),
    (r"^Philly Fed Manufacturing Index", "Indice manufacturier de la Fed de Philadelphie"),
    (r"^Durable Goods Orders", "Commandes de biens durables"),
    (r"^Core Durable Goods Orders", "Commandes de biens durables (hors transport)"),
    (r"^Building Permits", "Permis de construire"),
    (r"^Existing Home Sales", "Ventes de logements existants"),
    (r"^New Home Sales", "Ventes de logements neufs"),
    (r"^Trade Balance", "Balance commerciale"),
    (r"^German ", "Allemagne : "),
    (r"^French ", "France : "),
]
SUFFIX = [(r" m/m$", " (sur un mois)"), (r" q/q$", " (sur un trimestre)"), (r" y/y$", " (sur un an)")]


def calendar_title(t: str) -> str:
    out = t
    for pat, rep in CAL_FR:
        new = re.sub(pat, rep, out)
        if new != out:
            out = new
            break
    for pat, rep in SUFFIX:
        out = re.sub(pat, rep, out)
    return out


def free_translate(texts: list[str], target: str = "fr") -> list[str | None]:
    """Traduction via le point d'accès public de Google Translate (gratuit, sans clé, à usage modéré)."""
    out: list[str | None] = []
    for t in texts:
        r = http_get("https://translate.googleapis.com/translate_a/single",
                     params={"client": "gtx", "sl": "auto", "tl": target, "dt": "t", "q": t[:450]}, timeout=10, retries=0)
        try:
            out.append("".join(seg[0] for seg in r.json()[0] if seg and seg[0]) if r is not None else None)
        except Exception as e:
            log.warning("traduction : %s", e)
            out.append(None)
    return out
