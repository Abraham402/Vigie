"use strict";
/* =====================================================================
   Vigie Auto : robot trader fictif (onglet Portefeuille → Robot)
   Les commandes (démarrer, modifier, arrêter) passent par le message épinglé
   Telegram ; le robot tourne dans le bot GitHub et publie data/auto.json.
   ===================================================================== */
const STRAT_INFO = {
  breakout: ["Cassure 20 j", "Achète quand la clôture dépasse les 20 précédentes. Stop à 1,5 × ATR, objectif 2R.", "trader-scanner"],
  rebond: ["Rebond", "Achète un actif survendu (RSI < 30) qui commence à remonter.", "trader-scanner"],
  tendance: ["Tendance", "Suit le croisement EMA 20 / EMA 50 au-dessus de la moyenne 200 jours.", "uptrend-analyzer"],
  signal: ["Signal du bot", "Achète quand le modèle prévoit ≥ 60 % de hausse sur 24 h avec une confiance suffisante.", "modèle Vigie"],
  vcp: ["VCP (Minervini)", "Tendance de fond haussière, volatilité qui se resserre puis cassure avec volume.", "vcp-screener"],
  burst: ["Explosion de momentum", "Hausse ≥ 4 % (6 % en crypto) avec volume, clôture près du plus haut, après des jours calmes.", "stockbee-momentum-burst"],
  meanrev: ["Retour à la moyenne", "Prix à plus de 2 écarts-types sous sa moyenne 20 j, en tendance de fond haussière. Objectif : la moyenne.", "mean-reversion"],
  dca: ["Achat régulier (DCA)", "Achète un peu de BTC et de S&P 500 chaque jour sans chercher le bon moment : la référence à battre.", "référence"]
};
let pfMode = "me", robotChart, robotSeries;

/* la copie du portefeuille envoyée au bot contient aussi la commande du robot */
const _pfSnapshot = pfSnapshot;
pfSnapshot = function () { return { ..._pfSnapshot(), auto: CFG.autoCmd || null } };

function robotCmd(cmd) {
  CFG.autoCmd = { id: Date.now().toString(36), ...cmd }; saveCfg();
  return syncPfToBot(true).then(ok => { toast(ok ? "Commande transmise au robot ✓ (prise en compte sous 15 min)" : "Transmission impossible : vérifiez Telegram dans ⚙️"); renderRobot(); return ok });
}
function robotPending() { const a = D.auto || {}; return CFG.autoCmd && a.cmd !== CFG.autoCmd.id ? CFG.autoCmd : null }

/* argent rendu par le robot à l'arrêt : crédité une seule fois */
function robotCredit() {
  const r = D.auto && D.auto.returned; if (!r || !r.id) return;
  CFG.autoCredited = CFG.autoCredited || [];
  if (CFG.autoCredited.includes(r.id) || !CFG.autoCmd || CFG.autoCmd.id !== r.id) return;
  CFG.autoCredited.push(r.id); saveCfg();
  pf.cash += r.amount; pf.hist.unshift({ t: Date.now(), s: "ROBOT", side: "Vente", q: 1, px: r.amount, amt: r.amount, setup: "Retour du robot Vigie Auto" });
  savePf(); renderPf(); toast(`🤖 Le robot vous a rendu ${fusd(r.amount)}`);
}

function stratChecks(sel) {
  return Object.entries(STRAT_INFO).map(([k, [n, d, src]]) => `<label class="strat"><input type="checkbox" value="${k}" ${sel.includes(k) ? "checked" : ""}><span><b>${n}</b> <small class="muted">· ${src}</small><br><small>${d}</small></span></label>`).join("");
}
function robotSetupHTML() {
  const max = Math.floor(pf.cash);
  return `<div class="card"><div class="card-h"><h2>🤖 Confier un budget au robot</h2></div>
  <p class="muted sm" style="margin:0 0 10px">Le robot trade seul, avec de l'argent <b>fictif</b>, en appliquant les règles de skills de trading reconnus. Il vous envoie un rapport détaillé sur Telegram et tout s'affiche ici. Vous pouvez l'arrêter à tout moment : il vend tout et vous rend l'argent.</p>
  <label class="fld">Budget confié ($) · disponible ${fusd(max, 0)}<input class="input num" id="rbBudget" type="number" min="100" step="100" value="${Math.min(3000, max)}" inputmode="decimal"></label>
  <div class="quick" style="margin-top:6px">${[.1, .25, .5].map(k => `<button type="button" data-rbq="${k}">${k * 100} %</button>`).join("")}</div>
  <h3 class="mt">Stratégies du répertoire</h3><div class="strats" id="rbStrats">${stratChecks(Object.keys(STRAT_INFO))}</div>
  <div class="row2 mt">
   <label class="fld">Risque par trade<select class="input" id="rbRisk"><option value="0.5">Prudent · 0,5 %</option><option value="1" selected>Normal · 1 %</option><option value="2">Audacieux · 2 %</option></select></label>
   <label class="fld">Rapport Telegram<select class="input" id="rbRep"><option value="60">Toutes les heures</option><option value="120">Toutes les 2 h</option><option value="240">Toutes les 4 h</option><option value="720">Matin et soir</option></select></label>
  </div>
  <div class="sizer mt">Règles de sécurité appliquées : stop-loss sur chaque achat (1,5 × ATR), objectif à 2 fois le risque, 6 positions maximum, 25 % du budget maximum par position, arrêt des achats pour la journée après −3 %, frais de 0,1 % simulés. En marché crypto défensif, seules les stratégies de rebond restent actives (taille réduite de moitié).</div>
  <div class="btn-row"><button class="btn ai-b" id="rbStart">Lancer le robot</button></div></div>`;
}
function robotDashHTML(a) {
  const dca = (a.board || []).find(r => r.k === "dca"), me = (pfValue() / pf.cap - 1) * 100;
  const pend = robotPending();
  return `<div class="card"><div class="card-h"><h2>🤖 Vigie Auto</h2><span class="chip ${a.active ? "up" : "flat"}">${a.active ? "en marche" : "arrêté"}</span></div>
  ${pend ? `<div class="sizer" style="margin-bottom:10px">⏳ Commande « ${pend.action === "stop" ? "arrêter" : "modifier"} » envoyée : prise en compte au prochain passage du bot (15 min maximum).</div>` : ""}
  <div class="pf-kpis num"><div class="kpi"><small>Valeur du robot</small><b>${fusd(a.equity)}</b></div><div class="kpi"><small>Performance</small><b class="${cls(a.perf)}">${fpct(a.perf)}</b></div><div class="kpi"><small>Vous (portefeuille)</small><b class="${cls(me)}">${fpct(me)}</b></div><div class="kpi"><small>Liquidités du robot</small><b>${fusd(a.cash, 0)}</b></div></div>
  <div class="muted sm" style="margin-top:8px">Budget ${fusd(a.budget, 0)} · depuis le ${new Date(a.start).toLocaleDateString("fr-FR")} · risque ${nf(1).format(a.risk)} % par trade${a.regime ? ` · météo crypto <b>${a.regime.zone}</b> (${a.regime.score}/100)` : ""}${dca ? ` · référence DCA ${dca.pnl >= 0 ? "+" : ""}${fusd(dca.pnl)}` : ""}</div>
  <div id="robotChart" style="height:200px;margin-top:10px"></div></div>
  <div class="pf-grid2">
   <div class="card"><div class="card-h"><h2>Classement des stratégies</h2></div><div class="tbl-wrap"><table>${(a.board || []).length ? `<thead><tr><th>Stratégie</th><th class="r">Résultat</th><th class="r">Trades clos</th><th class="r">Réussite</th><th class="r">Ouvertes</th></tr></thead><tbody>${a.board.map((r, i) => `<tr><td>${r.pnl > 0 ? (["🥇", "🥈", "🥉"][i] || "") : ""} <b>${esc(r.name)}</b></td><td class="r num ${cls(r.pnl)}">${r.pnl >= 0 ? "+" : ""}${fusd(r.pnl)}</td><td class="r num">${r.trades}</td><td class="r num">${r.trades ? Math.round(r.wins / r.trades * 100) + " %" : "—"}</td><td class="r num">${r.open}</td></tr>`).join("")}</tbody>` : `<tr><td><div class="empty">Pas encore de trade.</div></td></tr>`}</table></div></div>
   <div class="card"><div class="card-h"><h2>Positions du robot</h2></div><div class="tbl-wrap"><table>${(a.pos || []).length ? `<thead><tr><th>Actif</th><th>Stratégie</th><th class="r">Entrée</th><th class="r">G/P</th><th class="r">Stop · objectif</th></tr></thead><tbody>${a.pos.map(p => `<tr><td><b>${esc(p.s)}</b></td><td class="muted">${esc((STRAT_INFO[p.strat] || [p.strat])[0])}</td><td class="r num">${fp(p.entry)}</td><td class="r num ${cls(p.pnl)}">${fpct(p.pct)}</td><td class="r num" style="font-size:11px">${p.sl ? `<span class="down">${fp(p.sl)}</span>` : "—"}${p.tp ? ` · <span class="up">${fp(p.tp)}</span>` : ""}</td></tr>`).join("")}</tbody>` : `<tr><td><div class="empty">Aucune position : le robot attend un signal qui remplit toutes ses conditions.</div></td></tr>`}</table></div></div>
  </div>
  <div class="card"><div class="card-h"><h2>Journal des décisions</h2><span class="muted sm">chaque achat et vente expliqué</span></div><div class="feed" style="max-height:420px">${(a.journal || []).filter(e => e.type !== "skip" || e.t > Date.now() - 864e5).slice(0, 60).map(e => {
    const n = (STRAT_INFO[e.strat] || [""])[0], h = new Date(e.t).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    const ic = e.type === "buy" ? "✅" : e.type === "sell" ? (e.pnl >= 0 ? "🟢" : "🔴") : e.type === "halt" ? "⛔" : e.type === "skip" ? "⏭️" : "ℹ️";
    const head = e.type === "buy" ? `<b>Achat ${esc(e.s)}</b> à ${fp(e.px)} $ (${fusd(e.val, 0)})` : e.type === "sell" ? `<b>Vente ${esc(e.s)}</b> à ${fp(e.px)} $ · <span class="${cls(e.pnl)}">${e.pnl >= 0 ? "+" : ""}${fusd(e.pnl)}</span>` : e.type === "skip" ? `<b>${esc(e.s || "")}</b> ignoré` : "";
    return `<div class="journal-item"><div class="meta">${h}${n ? ` · <span class="chip ai">${esc(n)}</span>` : ""}</div><div>${ic} ${head} ${head ? "· " : ""}${esc(e.reason || "")}${e.sl ? ` · stop ${fp(e.sl)} $ · objectif ${fp(e.tp)} $` : ""}</div></div>`
  }).join("") || `<div class="empty">Le journal se remplira au fil des décisions.</div>`}</div></div>
  ${a.active ? `<div class="card"><div class="card-h"><h2>Réglages du robot</h2></div><div class="strats" id="rbStrats">${stratChecks(a.strats || [])}</div>
  <div class="row2 mt"><label class="fld">Risque par trade<select class="input" id="rbRisk">${[[0.5, "Prudent · 0,5 %"], [1, "Normal · 1 %"], [2, "Audacieux · 2 %"]].map(([v, l]) => `<option value="${v}" ${+a.risk === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
  <label class="fld">Rapport Telegram<select class="input" id="rbRep">${[[60, "Toutes les heures"], [120, "Toutes les 2 h"], [240, "Toutes les 4 h"], [720, "Matin et soir"]].map(([v, l]) => `<option value="${v}" ${+a.report === v ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>
  <div class="btn-row"><button class="btn" id="rbUpd">Enregistrer les réglages</button><button class="btn sell" id="rbStop">Arrêter et récupérer l'argent</button></div></div>` : `<div class="btn-row"><button class="btn ai-b" id="rbNew">Relancer un robot</button></div>`}`;
}
function renderRobot() {
  const el = $("#robotPane"); if (!el || pfMode !== "robot") return;
  const a = D.auto, pend = robotPending();
  if (D.mode !== "live") { el.innerHTML = `<div class="card"><h2>🤖 Vigie Auto</h2><p class="muted">Le robot trade avec les données réelles. Quittez la démo (⚙️ → « passer au réel ») pour le lancer.</p></div>`; return }
  if (!CFG.tgToken || !CFG.tgChat) { el.innerHTML = `<div class="card"><h2>🤖 Vigie Auto</h2><p class="muted">Pour piloter le robot, Vigie utilise votre bot Telegram (commandes et rapports). Configurez-le d'abord : ⚙️ → jeton du bot → « Trouver mon chat id » → « Enregistrer ».</p><button class="btn ai-b" onclick="openSettings()">Ouvrir les réglages</button></div>`; return }
  if (pend && pend.action === "start") { el.innerHTML = `<div class="card"><h2>🤖 Démarrage en cours…</h2><p>Budget de <b>${fusd(pend.budget, 0)}</b> transmis. Le robot démarre au prochain passage du bot (15 min maximum) et vous écrira sur Telegram.</p><p class="muted sm">Stratégies : ${pend.strats.map(k => STRAT_INFO[k][0]).join(", ")}</p></div>`; return }
  if (!a || (!a.active && !a.journal)) { el.innerHTML = robotSetupHTML(); bindSetup(); return }
  el.innerHTML = robotDashHTML(a); bindDash(a);
}
function readStrats() { return $$("#rbStrats input:checked").map(i => i.value) }
function bindSetup() {
  $$("[data-rbq]").forEach(b => b.onclick = () => { $("#rbBudget").value = Math.floor(pf.cash * +b.dataset.rbq) });
  $("#rbStart").onclick = () => {
    const budget = Math.floor(+$("#rbBudget").value), strats = readStrats();
    if (!(budget >= 100)) return toast("Budget minimum : 100 $");
    if (budget > pf.cash) return toast("Budget supérieur à vos liquidités");
    if (!strats.length) return toast("Choisissez au moins une stratégie");
    if (!confirm(`Confier ${fusd(budget, 0)} fictifs au robot ?`)) return;
    pf.cash -= budget; pf.hist.unshift({ t: Date.now(), s: "ROBOT", side: "Achat", q: 1, px: budget, amt: budget, setup: "Budget confié au robot Vigie Auto" }); savePf(); renderPf();
    robotCmd({ action: "start", budget, strats, risk: +$("#rbRisk").value, report: +$("#rbRep").value });
  };
}
function bindDash(a) {
  if (LC && $("#robotChart")) {
    robotChart = LC.createChart($("#robotChart"), { ...baseChartOpts(), handleScroll: false, handleScale: false, localization: { locale: "fr-FR", priceFormatter: p => nf(0).format(p) + " $" } });
    const up = a.perf >= 0; robotSeries = robotChart.addSeries(LC.AreaSeries, { lineColor: up ? C.up : C.down, topColor: up ? "rgba(22,199,132,.25)" : "rgba(234,57,67,.25)", bottomColor: "rgba(0,0,0,0)", lineWidth: 2, priceLineVisible: false });
    const seen = new Set(), data = (a.eq || []).filter(([t]) => !seen.has(t) && seen.add(t)).map(([time, value]) => ({ time, value }));
    robotSeries.createPriceLine({ price: a.budget, color: C.muted, lineStyle: 2, lineWidth: 1, axisLabelVisible: false, title: "budget" });
    robotSeries.setData(data); robotChart.timeScale().fitContent();
  }
  const u = $("#rbUpd"); if (u) u.onclick = () => { const strats = readStrats(); if (!strats.length) return toast("Gardez au moins une stratégie"); robotCmd({ action: "update", strats, risk: +$("#rbRisk").value, report: +$("#rbRep").value }) };
  const s = $("#rbStop"); if (s) s.onclick = () => { if (confirm("Arrêter le robot ? Il vend toutes ses positions et vous rend l'argent.")) robotCmd({ action: "stop" }) };
  const n = $("#rbNew"); if (n) n.onclick = () => { $("#robotPane").innerHTML = robotSetupHTML(); bindSetup() };
}
function setPfMode(m) {
  pfMode = m;
  $$("[data-pfm]").forEach(b => b.setAttribute("aria-pressed", b.dataset.pfm === m));
  $$(".v-pf > *").forEach(el => { if (el.id !== "pfSwitch" && el.id !== "robotPane") el.hidden = m === "robot" });
  $("#robotPane").hidden = m !== "robot";
  if (m === "robot") renderRobot(); else { renderPf(); pfChart && pfChart.timeScale().fitContent() }
}
on("ready", () => {
  const v = $(".v-pf");
  v.insertAdjacentHTML("afterbegin", `<div class="segmented pf-switch" id="pfSwitch" role="group" aria-label="Portefeuille ou robot"><button aria-pressed="true" data-pfm="me">💼 Mon portefeuille</button><button aria-pressed="false" data-pfm="robot">🤖 Robot</button></div>`);
  v.insertAdjacentHTML("beforeend", `<div id="robotPane" hidden></div>`);
  $$("[data-pfm]").forEach(b => b.onclick = () => setPfMode(b.dataset.pfm));
  robotCredit();
});
window.addEventListener("vigie:data", () => { robotCredit(); renderRobot() });
