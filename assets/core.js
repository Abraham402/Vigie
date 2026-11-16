window.VIGIE_VERSION = "12 · day trader";
"use strict";
/* =====================================================================
   Vigie — interface (commune au mode démo et au mode réel)
   ===================================================================== */
let D, ASSETS = [], BY = {}, current = "BTC";

/* ---------------- utilitaires ---------------- */
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const nf = d => new Intl.NumberFormat("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
function dec(p) { return p < 1 ? 4 : p < 10 ? 3 : p < 1000 ? 2 : 0 }
function fp(p) { return p == null || isNaN(p) ? "—" : nf(dec(p)).format(p) }
function fusd(v, d = 2) { return nf(d).format(v) + " $" }
function fpct(v) { return v == null || isNaN(v) ? "—" : (v >= 0 ? "+" : "") + nf(2).format(v) + " %" }
function cls(v) { return v > 0 ? "up" : v < 0 ? "down" : "muted" }
function pcls(p) { return p >= 55 ? "up" : p <= 45 ? "down" : "flat" }
function confTxt(c) { return c >= .7 ? "élevée" : c >= .55 ? "moyenne" : "faible" }
function chg(a) { return a.open ? (a.price / a.open - 1) * 100 : 0 }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])) }
function ago(t) { const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 1 ? "à l'instant" : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.floor(m / 60)} h` : `il y a ${Math.floor(m / 1440)} j` }
function hhmm(t) { return new Date(t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) }
const isDesk = () => innerWidth >= 1100;
function toast(t) { const el = $("#toast"); el.textContent = t; el.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("show"), 2600) }
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d } catch (e) { return d } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) { } }
};
const CFG = LS.get("vigie-cfg", { gemini: "", geminiModel: "gemini-flash-latest", tgToken: "", tgChat: "", notif: false });
function saveCfg() { LS.set("vigie-cfg", CFG) }
const bus = new EventTarget();
const emit = (n, d) => bus.dispatchEvent(new CustomEvent(n, { detail: d }));
const on = (n, f) => bus.addEventListener(n, e => f(e.detail));

/* ---------------- navigation ---------------- */
function go(v, sel) {
  $$(".view").forEach(s => s.classList.toggle("active", s.dataset.v === v));
  $$(".bottom-nav button").forEach(b => b.setAttribute("aria-current", b.dataset.go === v));
  if (v === "news") $("#newsBadge").hidden = true;
  const target = sel ? $(sel) : (isDesk() ? $(`.view[data-v="${v}"]`) : null);
  if (target) requestAnimationFrame(() => target.scrollIntoView({ behavior: "smooth", block: isDesk() || sel ? "center" : "start" }));
  else window.scrollTo({ top: 0 });
  requestAnimationFrame(() => { if (v === "chart") { chart && chart.timeScale().scrollToRealTime(); btChart && btChart.timeScale().fitContent() } if (v === "pf") pfChart && pfChart.timeScale().fitContent() });
  emit("view", v);
}

/* ---------------- en-tête ---------------- */
function renderTape() { const h = ASSETS.map(a => `<span><b>${a.s}</b><span class="num">${fp(a.price)}</span> <span class="num ${cls(chg(a))}">${fpct(chg(a))}</span></span>`).join(""); $("#tape").innerHTML = h + h }
function renderStatus() {
  const st = D.status || {};
  const tag = $("#modeTag");
  if (D.mode === "demo") { tag.className = "demo-tag"; tag.innerHTML = `Démo<span class="long"> · données fictives</span>` }
  else { tag.className = "demo-tag live"; tag.innerHTML = `Réel<span class="long"> · données de marché</span>` }
  const last = st.last_run ? new Date(st.last_run).getTime() : null;
  $("#botStatus").textContent = D.mode === "demo" ? " · scan il y a 2 min" : last ? ` · analyse ${ago(last)}` : " · en attente du 1er passage";
  const stale = D.mode === "live" && (!last || Date.now() - last > 45 * 60000);
  $(".botstat .pulse").style.background = stale ? "var(--flat)" : "";
}

/* ---------------- watchlist ---------------- */
let wFilter = "all";
function spark(a) {
  const d = a.spark && a.spark.length > 1 ? a.spark : [a.open || a.price, a.price];
  const mn = Math.min(...d), mx = Math.max(...d), w = 64, h = 26;
  const pts = d.map((v, i) => `${(i / (d.length - 1) * w).toFixed(1)},${(h - 2 - (v - mn) / (mx - mn || 1) * (h - 4)).toFixed(1)}`).join(" ");
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${chg(a) >= 0 ? "#16C784" : "#EA3943"}" stroke-width="1.5" stroke-linejoin="round"/></svg>`
}
function probaOf(s, i = 1) { const P = D.proba[s]; return P && P[i] ? P[i] : null }
function renderWatch() {
  $("#watchlist").innerHTML = ASSETS.filter(a => wFilter === "all" || a.t === wFilter).map(a => {
    const pr = probaOf(a.s);
    const chip = pr ? `<span class="chip ${pcls(pr.p)}" title="Probabilité de hausse sur 24 h">${pr.p >= 50 ? "▲" : "▼"} ${pr.p} %</span>` : "";
    return `<li><button data-s="${a.s}" aria-current="${a.s === current}">
   <div style="min-width:0"><div class="sym">${a.s} ${chip}</div><div class="name">${esc(a.n)}${a.delayed ? ' <span class="dly" title="Cours différé d\'environ 15 minutes">diff.</span>' : ""}</div></div>
   ${spark(a)}
   <div class="px num"><b data-px="${a.s}">${fp(a.price)}</b><small class="${cls(chg(a))}" data-chg="${a.s}">${fpct(chg(a))}</small></div></button></li>`
  }).join("");
  $$("#watchlist button").forEach(b => b.onclick = () => { selectAsset(b.dataset.s); if (!isDesk()) go("chart") });
}

/* ---------------- carte de chaleur ---------------- */
const WEIGHT = { BTC: 4, ETH: 2, SPY: 2, NVDA: 2, AAPL: 2, MSFT: 2 };
function heatColor(c) { const k = Math.min(Math.abs(c) / 3, 1); return c >= 0 ? `rgba(22,199,132,${.18 + k * .72})` : `rgba(234,57,67,${.18 + k * .72})` }
function renderHeat() {
  const el = $("#heatmap"); if (!el) return;
  el.innerHTML = [...ASSETS].sort((a, b) => (WEIGHT[b.s] || 1) - (WEIGHT[a.s] || 1)).map(a => { const w = WEIGHT[a.s] || 1, c = chg(a); return `<button class="${w >= 4 ? "w4" : w >= 2 ? "w2" : ""}" style="background:${heatColor(c)}" data-hs="${a.s}">${a.s}<small class="num">${fpct(c)}</small></button>` }).join("");
  $$("[data-hs]").forEach(b => b.onclick = () => { selectAsset(b.dataset.hs); go("chart") });
}

/* ---------------- calendrier économique ---------------- */
let bells = LS.get("vigie-bells", {});
function renderCalendar() {
  const el = $("#calendar"); if (!el) return;
  const items = (D.calendar || []).filter(e => e.t > Date.now() - 36e5).sort((a, b) => a.t - b.t).slice(0, 10);
  if (!items.length) { el.innerHTML = `<div class="empty">Aucune annonce majeure dans les prochains jours.</div>`; return }
  let lastDay = "";
  el.innerHTML = items.map(e => {
    const d = new Date(e.t), dayTxt = d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
    const head = dayTxt !== lastDay ? `<div class="cal-day">${dayTxt}</div>` : ""; lastDay = dayTxt;
    const id = e.ev + e.t;
    return `${head}<div class="cal-item"><span class="num muted">${hhmm(e.t)}</span><div><b>${esc(e.ev)}</b> <span class="muted">${esc(e.c || "")}</span><div class="muted" style="font-size:11px"><span class="imp">${[1, 2, 3].map(i => `<i class="${i <= e.imp ? "on" : ""}"></i>`).join("")}</span> ${e.cons ? `Prévu ${esc(e.cons)}` : ""}${e.prev ? ` · Précédent ${esc(e.prev)}` : ""}${e.assets ? ` · ${esc(e.assets)}` : ""}</div></div><button class="bell" aria-pressed="${!!bells[id]}" data-bell="${esc(id)}" aria-label="Rappel">🔔</button></div>`
  }).join("");
  $$("[data-bell]").forEach(b => b.onclick = () => { const k = b.dataset.bell; bells[k] = !bells[k]; LS.set("vigie-bells", bells); b.setAttribute("aria-pressed", !!bells[k]); toast(bells[k] ? "Rappel activé : notification 30 min avant" : "Rappel retiré"); if (bells[k]) { askNotif(); emit("mission", "m7") } });
}
setInterval(() => { (D && D.calendar || []).forEach(e => { const id = e.ev + e.t; if (bells[id] && !bells[id + ":done"] && e.t - Date.now() < 30 * 60000 && e.t > Date.now()) { bells[id + ":done"] = 1; LS.set("vigie-bells", bells); notify(`📅 Dans 30 min : ${e.ev}`, `Impact ${"●".repeat(e.imp)} · ${e.assets || ""}`) } }) }, 30000);

/* =====================================================================
   GRAPHIQUE
   ===================================================================== */
const LC = window.LightweightCharts;
let chart, candle, vol, ema20, ema50, bbU, bbL, rsiS, macdS, macdSig, macdH, vwapS, ichi = [], cmpS, markers;
let tf = LS.get("vigie-tf", 60), bars = [], style = LS.get("vigie-style", "candles"), unsubK = null, chartKey = "";
const show = Object.assign({ ema: true, bb: false, rsi: true, sig: true, macd: false, vwap: false, ichi: false, fib: false }, LS.get("vigie-ind", {}));
const C = { up: "#16C784", down: "#EA3943", ai: "#9B8AFB", amber: "#F5B83D", blue: "#5EB5F7", pink: "#E879F9", muted: "#8492A8", line: "#1E2B44" };

function emaArr(vals, n) { const k = 2 / (n + 1); let e = vals[0]; return vals.map(v => e = v * k + e * (1 - k)) }
function emaCalc(d, n) { const e = emaArr(d.map(b => b.close), n); return d.map((b, i) => ({ time: b.time, value: e[i] })) }
function bbCalc(d, n = 20) { const u = [], l = []; for (let i = n - 1; i < d.length; i++) { const s = d.slice(i - n + 1, i + 1).map(b => b.close), m = s.reduce((a, b) => a + b) / n, sd = Math.sqrt(s.reduce((a, b) => a + (b - m) ** 2, 0) / n); u.push({ time: d[i].time, value: m + 2 * sd }); l.push({ time: d[i].time, value: m - 2 * sd }) } return [u, l] }
function rsiCalc(d, n = 14) { let g = 0, l = 0; const out = []; for (let i = 1; i < d.length; i++) { const ch = d[i].close - d[i - 1].close, G = Math.max(ch, 0), L = Math.max(-ch, 0); if (i <= n) { g += G / n; l += L / n } else { g = (g * (n - 1) + G) / n; l = (l * (n - 1) + L) / n } if (i >= n) out.push({ time: d[i].time, value: 100 - 100 / (1 + g / (l || 1e-9)) }) } return out }
function macdCalc(d) { const c = d.map(b => b.close), a = emaArr(c, 12), b = emaArr(c, 26), m = a.map((v, i) => v - b[i]), s = emaArr(m, 9); return d.map((x, i) => ({ time: x.time, m: m[i], s: s[i], h: m[i] - s[i] })).slice(26) }
function vwapCalc(d) { let pv = 0, vv = 0, day = null; const out = []; d.forEach((b, i) => { const dd = Math.floor(b.time / 86400); if (tf >= 86400) { const w = d.slice(Math.max(0, i - 19), i + 1); const P = w.reduce((s, x) => s + (x.high + x.low + x.close) / 3 * x.value, 0), V = w.reduce((s, x) => s + x.value, 0); out.push({ time: b.time, value: P / (V || 1) }); return } if (dd !== day) { day = dd; pv = 0; vv = 0 } pv += (b.high + b.low + b.close) / 3 * b.value; vv += b.value; out.push({ time: b.time, value: pv / (vv || 1) }) }); return out }
function ichiCalc(d) {
  const mid = (i, n) => { const w = d.slice(Math.max(0, i - n + 1), i + 1); return (Math.max(...w.map(x => x.high)) + Math.min(...w.map(x => x.low))) / 2 };
  const T = [], K = [], A = [], B = [], sh = 26 * (d.length > 1 ? d[1].time - d[0].time : tf);
  d.forEach((b, i) => { if (i < 51) return; const t = mid(i, 9), k = mid(i, 26); T.push({ time: b.time, value: t }); K.push({ time: b.time, value: k }); A.push({ time: b.time + sh, value: (t + k) / 2 }); B.push({ time: b.time + sh, value: mid(i, 52) }) });
  return [T, K, A, B];
}
function haCalc(d) { const out = []; let po, pc; d.forEach((b, i) => { const c = (b.open + b.high + b.low + b.close) / 4, o = i ? (po + pc) / 2 : (b.open + b.close) / 2; out.push({ time: b.time, open: o, high: Math.max(b.high, o, c), low: Math.min(b.low, o, c), close: c }); po = o; pc = c }); return out }
function sigMarkers(d) {
  const e20 = emaCalc(d, 20), e50 = emaCalc(d, 50), m = [];
  for (let i = 51; i < d.length; i++) {
    const up = e20[i - 1].value <= e50[i - 1].value && e20[i].value > e50[i].value, dn = e20[i - 1].value >= e50[i - 1].value && e20[i].value < e50[i].value;
    if (up) m.push({ time: d[i].time, position: "belowBar", color: C.up, shape: "arrowUp", text: "Achat" });
    if (dn) m.push({ time: d[i].time, position: "aboveBar", color: C.down, shape: "arrowDown", text: "Vente" });
  }
  return m;
}
const CS = { upColor: C.up, downColor: C.down, borderVisible: false, wickUpColor: C.up, wickDownColor: C.down };
const STYLES = {
  candles: () => [LC.CandlestickSeries, CS], ha: () => [LC.CandlestickSeries, CS],
  bars: () => [LC.BarSeries, { upColor: C.up, downColor: C.down, thinBars: false }],
  line: () => [LC.LineSeries, { color: "#E6ECF5", lineWidth: 2 }],
  area: () => [LC.AreaSeries, { lineColor: C.up, topColor: "rgba(22,199,132,.28)", bottomColor: "rgba(22,199,132,0)", lineWidth: 2 }]
};
function seriesData(d = bars) { if (style === "line" || style === "area") return d.map(b => ({ time: b.time, value: b.close })); if (style === "ha") return haCalc(d); return d.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })) }
function lastPoint() { const b = bars[bars.length - 1]; if (style === "line" || style === "area") return { time: b.time, value: b.close }; if (style === "ha") return haCalc(bars.slice(-120)).pop(); return { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close } }
const volPoint = b => ({ time: b.time, value: b.value, color: b.close >= b.open ? "rgba(22,199,132,.35)" : "rgba(234,57,67,.35)" });
const LO = { lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };

function baseChartOpts() {
  return {
    autoSize: true, layout: { background: { type: "solid", color: "transparent" }, textColor: C.muted, fontFamily: "IBM Plex Sans, system-ui", fontSize: 11, panes: { separatorColor: C.line }, attributionLogo: false },
    grid: { vertLines: { color: "rgba(30,43,68,.55)" }, horzLines: { color: "rgba(30,43,68,.55)" } }, rightPriceScale: { borderColor: C.line }, leftPriceScale: { borderColor: C.line }, timeScale: { borderColor: C.line, timeVisible: true, rightOffset: 6 }, crosshair: { mode: 0 },
    localization: { locale: "fr-FR", priceFormatter: p => fp(p) }
  }
}
function initChart() {
  if (!LC) { $("#chart").innerHTML = '<div class="empty">Le graphique n\'a pas pu se charger (connexion). Rechargez la page.</div>'; return }
  chart = LC.createChart($("#chart"), baseChartOpts());
  vol = chart.addSeries(LC.HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "", lastValueVisible: false, priceLineVisible: false });
  vol.priceScale().applyOptions({ scaleMargins: { top: .82, bottom: 0 } });
  ema20 = chart.addSeries(LC.LineSeries, { ...LO, color: C.amber }); ema50 = chart.addSeries(LC.LineSeries, { ...LO, color: C.ai });
  bbU = chart.addSeries(LC.LineSeries, { ...LO, lineWidth: 1, color: "rgba(132,146,168,.6)", lineStyle: 2 }); bbL = chart.addSeries(LC.LineSeries, { ...LO, lineWidth: 1, color: "rgba(132,146,168,.6)", lineStyle: 2 });
  vwapS = chart.addSeries(LC.LineSeries, { ...LO, color: C.pink, lineWidth: 2, lineStyle: 0 });
  ichi = [["#F87171", 0], ["#60A5FA", 0], ["rgba(22,199,132,.7)", 2], ["rgba(234,57,67,.7)", 2]].map(([c, ls]) => chart.addSeries(LC.LineSeries, { ...LO, lineWidth: 1, color: c, lineStyle: ls }));
  createMain();
  chart.subscribeClick(onChartClick);
  chart.subscribeCrosshairMove(onCrosshair);
  $$("[data-st]").forEach(x => x.setAttribute("aria-pressed", x.dataset.st === style));
  $$("[data-tf]").forEach(x => x.setAttribute("aria-pressed", +x.dataset.tf === tf));
  $$("[data-ind]").forEach(x => x.setAttribute("aria-pressed", !!show[x.dataset.ind]));
}
function createMain() { if (candle) chart.removeSeries(candle); const [T, o] = STYLES[style](); candle = chart.addSeries(T, o, 0); markers = LC.createSeriesMarkers(candle, []); hRefs = []; fibRefs = []; drawHLines(); }
function rebuildPanes() {
  [rsiS, macdS, macdSig, macdH].forEach(s => { if (s) chart.removeSeries(s) }); rsiS = macdS = macdSig = macdH = null;
  let idx = 1;
  if (show.rsi) { rsiS = chart.addSeries(LC.LineSeries, { color: C.ai, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, priceFormat: { type: "price", precision: 1, minMove: .1 } }, idx++); rsiS.createPriceLine({ price: 70, color: "rgba(234,57,67,.5)", lineStyle: 2, lineWidth: 1, axisLabelVisible: false }); rsiS.createPriceLine({ price: 30, color: "rgba(22,199,132,.5)", lineStyle: 2, lineWidth: 1, axisLabelVisible: false }) }
  if (show.macd) { macdH = chart.addSeries(LC.HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, idx); macdS = chart.addSeries(LC.LineSeries, { color: C.blue, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false }, idx); macdSig = chart.addSeries(LC.LineSeries, { color: C.amber, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false }, idx) }
  const ps = chart.panes(); ps.forEach((p, i) => p.setStretchFactor(i ? 1 : (ps.length > 2 ? 3.4 : 3.2)));
}
function refreshIndicators() {
  if (!chart || !bars.length) return;
  ema20.setData(show.ema ? emaCalc(bars, 20) : []); ema50.setData(show.ema ? emaCalc(bars, 50) : []);
  const [u, l] = bbCalc(bars); bbU.setData(show.bb ? u : []); bbL.setData(show.bb ? l : []);
  vwapS.setData(show.vwap ? vwapCalc(bars) : []);
  const ic = show.ichi ? ichiCalc(bars) : [[], [], [], []]; ichi.forEach((s, i) => s.setData(ic[i]));
  if (rsiS) rsiS.setData(rsiCalc(bars));
  if (macdS) { const m = macdCalc(bars); macdS.setData(m.map(x => ({ time: x.time, value: x.m }))); macdSig.setData(m.map(x => ({ time: x.time, value: x.s }))); macdH.setData(m.map(x => ({ time: x.time, value: x.h, color: x.h >= 0 ? "rgba(22,199,132,.55)" : "rgba(234,57,67,.55)" }))) }
  markers.setMarkers(show.sig ? sigMarkers(bars) : []);
  drawFib();
}
function effTf(a) { if (D.mode === "live" && a.t === "stock" && tf < 300) return 300; if (D.mode === "live" && a.t === "crypto" && D.wsOk && !D.wsOk() && a.delayed && tf < 3600) return 3600; return tf }
async function loadChart() {
  if (!chart) return;
  const a = BY[current], t = effTf(a), key = current + ":" + t;
  if (RP) stopReplay(true);
  if (key !== chartKey) clearDrawings();
  chartKey = key;
  $("#chartMsg").hidden = t === tf; if (t !== tf) $("#chartMsg").textContent = a.t === "stock" ? "Actions : données gratuites différées d'environ 15 min, unité minimale 5 min." : "Binance est injoignable depuis votre connexion : affichage des bougies 1 h du bot.";
  $("#chartLoading").hidden = false;
  let data;
  try { data = cleanBars(await D.getBars(a, t)) } catch (e) { console.error(e); data = [] }
  if (chartKey !== key) return;
  $("#chartLoading").hidden = true;
  try { drawChart(a, t, data, key) } catch (e) { console.error(e); $("#chartMsg").hidden = false; $("#chartMsg").textContent = "Erreur d'affichage du graphique : rechargez la page." }
}
/* bougies propres : valeurs numériques, temps croissants et uniques */
function cleanBars(d) {
  const ok = (d || []).filter(b => b && [b.time, b.open, b.high, b.low, b.close].every(v => typeof v === "number" && isFinite(v))).map(b => ({ ...b, value: isFinite(b.value) ? b.value : 0 }));
  ok.sort((x, y) => x.time - y.time);
  return ok.filter((b, i) => i === 0 || b.time > ok[i - 1].time);
}
function drawChart(a, t, data, key) {
  if (!data.length) { $("#chartMsg").hidden = false; $("#chartMsg").textContent = "Données indisponibles pour le moment. Nouvel essai automatique dans 1 minute."; setTimeout(() => chartKey === key && (chartKey = "", loadChart()), 60000); return }
  bars = data;
  chart.applyOptions({ timeScale: { timeVisible: t < 86400, secondsVisible: t < 60 } });
  candle.setData(seriesData()); vol.setData(bars.map(volPoint));
  rebuildPanes(); refreshIndicators(); applyCompare();
  chart.timeScale().setVisibleLogicalRange({ from: bars.length - (innerWidth < 600 ? 70 : 120), to: bars.length + 4 });
  if (unsubK) unsubK(); unsubK = null;
  if (D.klineStream && a.t === "crypto") unsubK = D.klineStream(a.s, t, applyKline);
  onCrosshair(null);
  emit("chart", { s: current, tf: t });
}
function applyKline(k) {
  if (RP || !bars.length) return;
  const last = bars[bars.length - 1];
  if (k.time < last.time) return;
  let isNew = false;
  if (k.time > last.time) { bars.push(k); isNew = true } else Object.assign(last, k);
  candle.update(lastPoint()); vol.update(volPoint(bars[bars.length - 1]));
  if (isNew) { refreshIndicators(); if (bars.length > 1500) bars.splice(0, bars.length - 1500) }
}
function liveFromPrice(price) {
  if (D.klineStream || RP || !bars.length) return;
  const now = Math.floor(Date.now() / 1000), t = effTf(BY[current]), bt = Math.floor(now / t) * t, b = bars[bars.length - 1];
  if (bt > b.time) applyKline({ time: bt, open: b.close, high: Math.max(b.close, price), low: Math.min(b.close, price), close: price, value: .25 });
  else applyKline({ time: b.time, open: b.open, high: Math.max(b.high, price), low: Math.min(b.low, price), close: price, value: b.value + Math.random() * .12 });
}
function onCrosshair(p) {
  const el = $("#ohlc"); if (!el) return;
  const d = p && p.time ? bars.find(b => b.time === p.time) : bars[bars.length - 1];
  if (!d) return; const c = d.close >= d.open ? "up" : "down";
  el.innerHTML = `O <b class="${c}">${fp(d.open)}</b> H <b class="${c}">${fp(d.high)}</b> B <b class="${c}">${fp(d.low)}</b> C <b class="${c}">${fp(d.close)}</b> <span class="${c}">${fpct((d.close / d.open - 1) * 100)}</span>`;
}

/* ---------- tracés ---------- */
let drawMode = null, tStart = null, drawings = [], hRefs = [], trendS = [], fibRefs = [];
function setDraw(m) { drawMode = drawMode === m ? null : m; tStart = null; $$("[data-draw]").forEach(b => b.setAttribute("aria-pressed", b.dataset.draw === drawMode)); $("#drawHint").hidden = !drawMode; $("#drawHint").textContent = drawMode === "h" ? "Touchez le graphique à la hauteur du support ou de la résistance." : drawMode === "t" ? "Touchez le premier point de la ligne de tendance." : "" }
function drawHLines() { hRefs.forEach(l => { try { candle.removePriceLine(l) } catch (e) { } }); hRefs = drawings.filter(d => d.type === "h").map(d => candle.createPriceLine({ price: d.price, color: C.blue, lineWidth: 1.5, lineStyle: 0, axisLabelVisible: true, title: "Niveau" })) }
function clearDrawings() { drawings = []; if (candle) drawHLines(); trendS.forEach(s => chart.removeSeries(s)); trendS = []; setDraw(null) }
function onChartClick(p) {
  if (!drawMode || !p.point) return;
  const price = candle.coordinateToPrice(p.point.y); if (price == null) return;
  if (drawMode === "h") { drawings.push({ type: "h", price }); drawHLines(); setDraw(null); toast("Niveau tracé à " + fp(price) + " $"); emit("mission", "m3") }
  else if (drawMode === "t") {
    if (!p.time) return;
    if (!tStart) { tStart = { time: p.time, value: price }; $("#drawHint").textContent = "Touchez le second point." }
    else { if (p.time === tStart.time) return; const pts = [tStart, { time: p.time, value: price }].sort((a, b) => a.time - b.time); const s = chart.addSeries(LC.LineSeries, { color: C.blue, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, 0); s.setData(pts); trendS.push(s); setDraw(null); toast("Ligne de tendance tracée"); emit("mission", "m3") }
  }
}
function drawFib() {
  fibRefs.forEach(l => { try { candle.removePriceLine(l) } catch (e) { } }); fibRefs = [];
  if (!show.fib || !bars.length) return;
  const w = bars.slice(-120), hi = Math.max(...w.map(b => b.high)), lo = Math.min(...w.map(b => b.low));
  [0, .236, .382, .5, .618, .786, 1].forEach(l => fibRefs.push(candle.createPriceLine({ price: hi - (hi - lo) * l, color: l === .618 || l === .5 ? "rgba(245,184,61,.8)" : "rgba(245,184,61,.4)", lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: `Fib ${nf(1).format(l * 100)} %` })));
}

/* ---------- comparaison ---------- */
let cmpWith = "";
async function applyCompare() {
  if (cmpS) { chart.removeSeries(cmpS); cmpS = null }
  chart.applyOptions({ rightPriceScale: { mode: cmpWith && cmpWith !== current ? 2 : 0 } });
  $("#cmpLegend").innerHTML = "";
  if (!cmpWith || cmpWith === current) return;
  const o = BY[cmpWith], want = chartKey; let d = [];
  try { d = cleanBars(await D.getBars(o, effTf(BY[current]))) } catch (e) { }
  if (!chart || cmpS || want !== chartKey || !bars.length) return;
  cmpS = chart.addSeries(LC.LineSeries, { color: C.blue, lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: o.s }, 0);
  const t0 = bars[0].time; cmpS.setData(d.filter(b => b.time >= t0).map(b => ({ time: b.time, value: b.close })));
  $("#cmpLegend").innerHTML = `<span><i style="background:${C.blue}"></i>${o.s} (comparaison en %)</span>`;
}

/* ---------- replay (entraînement) ---------- */
let RP = null;
function startReplay() {
  if (!chart || bars.length < 120) return toast("Pas assez d'historique pour rejouer");
  if (unsubK) { unsubK(); unsubK = null }
  const all = bars.slice(), start = all.length - 90;
  RP = { all, i: start, timer: null, ok: 0, n: 0 };
  bars = all.slice(0, start);
  candle.setData(seriesData()); vol.setData(bars.map(volPoint)); refreshIndicators();
  chart.timeScale().setVisibleLogicalRange({ from: bars.length - 70, to: bars.length + 12 });
  $("#replayBar").hidden = false; $("#replayBtn").setAttribute("aria-pressed", "true"); $("#rpFb").textContent = ""; updRP();
  toast("Mode Rejouer : devinez la couleur de la prochaine bougie");
}
function stepRP() {
  if (!RP) return; if (RP.i >= RP.all.length) { const s = RP; stopReplay(); toast(`Replay terminé : ${s.ok}/${s.n} bonnes réponses`); return }
  const b = RP.all[RP.i++]; bars.push(b); candle.update(lastPoint()); vol.update(volPoint(b)); if (RP.i % 3 === 0) refreshIndicators(); updRP();
}
function guessRP(up) {
  if (!RP || RP.i >= RP.all.length) return;
  const nx = RP.all[RP.i], ok = (nx.close >= nx.open) === up; RP.n++; if (ok) RP.ok++;
  const n = RP.n; stepRP(); $("#rpFb").innerHTML = ok ? `<span class="up">Bien vu ✓</span>` : `<span class="down">Raté : elle était ${up ? "rouge" : "verte"}</span>`;
  emit("replayGuess", { ok, n });
}
function updRP() { if (!RP) return; $("#rpScore").textContent = `Score ${RP.ok}/${RP.n}` + (RP.n ? ` (${Math.round(RP.ok / RP.n * 100)} %)` : ""); $("#rpLeft").textContent = `${RP.all.length - RP.i} restantes` }
function playRP() { if (!RP) return; if (RP.timer) { clearInterval(RP.timer); RP.timer = null; $("#rpPlay").textContent = "▶ Lecture" } else { RP.timer = setInterval(stepRP, 600); $("#rpPlay").textContent = "⏸ Pause" } }
function stopReplay(silent) { if (!RP) return; clearInterval(RP.timer); bars = RP.all; RP = null; $("#replayBar").hidden = true; $("#replayBtn").setAttribute("aria-pressed", "false"); $("#rpPlay").textContent = "▶ Lecture"; if (!silent) { chartKey = ""; loadChart() } }

/* ---------------- en-tête actif ---------------- */
function renderAsset() {
  const a = BY[current], c = chg(a);
  $("#aSym").textContent = a.s; $("#aName").textContent = a.n; $("#aPrice").textContent = fp(a.price) + " $";
  $("#aChg").innerHTML = `<span class="${cls(c)}">${fpct(c)}</span> <span class="muted" style="font-weight:400;font-size:12px">24 h</span>`;
  $("#aHi").textContent = fp(a.hi); $("#aLo").textContent = fp(a.lo); $("#aVol").textContent = a.volTxt || "—";
  $("#aDelay").hidden = !a.delayed;
}

/* ---------------- probabilités ---------------- */
function gaugeSVG(p) { const ang = Math.PI * (1 - p / 100), x = 60 + 48 * Math.cos(ang), y = 60 - 48 * Math.sin(ang); const col = p >= 55 ? C.up : p <= 45 ? C.down : C.amber; const len = Math.PI * 48; return `<svg viewBox="0 0 120 70" aria-hidden="true"><path d="M12 60a48 48 0 0 1 96 0" fill="none" stroke="${C.line}" stroke-width="9" stroke-linecap="round"/><path d="M12 60a48 48 0 0 1 96 0" fill="none" stroke="${col}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${len * p / 100} ${len}" style="transition:stroke-dasharray .6s"/><circle cx="${x}" cy="${y}" r="4.5" fill="#E6ECF5"/></svg>` }
function renderProba() {
  const a = BY[current], P = D.proba[current];
  if (!P) { $("#gauges").innerHTML = `<div class="empty" style="grid-column:1/-1">Le bot n'a pas encore analysé ${esc(a.n)}. Résultat au prochain passage (toutes les 15 min).</div>`; $("#verdict").textContent = "En attente de l'analyse du bot."; $("#factors").innerHTML = ""; return }
  $("#gauges").innerHTML = ["1 heure", "24 heures", "7 jours"].map((h, i) => {
    const { p, c } = P[i]; const dots = [.5, .6, .7, .8].map(t => `<i class="${c >= t - .05 ? "on" : ""}"></i>`).join("");
    const lbl = p >= 50 ? "chance de hausse" : `de hausse · ${100 - p} % de baisse`;
    return `<div class="gauge"><div class="h">${h}</div>${gaugeSVG(p)}<div class="p num ${pcls(p)}">${p} %</div><div class="lbl ${pcls(p)}">${lbl}</div><div class="conf">Confiance ${confTxt(c)}<span class="conf-dots">${dots}</span></div></div>`
  }).join("");
  const p24 = P[1].p;
  $("#verdict").innerHTML = `<b>${esc(a.n)}</b> : le bot estime <b class="${pcls(p24)}">${p24 >= 50 ? p24 + " % de chances de hausse" : (100 - p24) + " % de chances de baisse"}</b> sur 24 h, avec une confiance ${confTxt(P[1].c)}. ${p24 >= 60 ? "Les signaux techniques et l'actualité vont dans le même sens." : p24 <= 40 ? "Plusieurs signaux négatifs se cumulent : prudence." : "Les signaux se contredisent : pas de tendance nette."} <span class="muted">Estimation statistique, pas un conseil.</span>`;
  const F = (D.factors && D.factors[current]) || [];
  $("#factors").innerHTML = (F.length ? '<h3>Ce qui fait bouger la probabilité (24 h)</h3>' : "") + F.map(([n, v, w]) => { const pct = Math.min(Math.abs(v), 1) * 50; return `<div class="factor"><span>${esc(n)}</span><div class="bar"><span style="${v >= 0 ? `left:50%;width:${pct}%;background:var(--up)` : `right:50%;width:${pct}%;background:var(--down)`}"></span></div><em class="num ${cls(v)}">${v > 0 ? "+" : ""}${Math.round(v * 10)}</em><div class="why">${esc(w)}</div></div>` }).join("");
}

/* ---------------- backtest ---------------- */
let btChart, btS, btH;
function renderBacktest() {
  const bt = D.backtest(current);
  if (!bt) { $("#btKpis").innerHTML = `<div class="empty" style="grid-column:1/-1">Backtest disponible après le premier passage du bot.</div>`; $("#calib").innerHTML = ""; $("#btNote").textContent = ""; if (btS) { btS.setData([]); btH.setData([]) } return }
  const live = bt.live && bt.live.n ? `${nf(1).format(bt.live.win)} %<small class="muted" style="display:inline;font-size:11px"> sur ${bt.live.n}</small>` : `<small class="muted" style="display:inline;font-size:12px;font-weight:500">mesure en cours</small>`;
  $("#btKpis").innerHTML = [["Réussite 1 h", bt.win[0]], ["Réussite 24 h", bt.win[1]], ["Réussite 7 j", bt.win[2]]].map(([k, v]) => `<div class="kpi"><small>${k}</small><b class="${v == null ? "muted" : v >= 52 ? "up" : v < 50 ? "down" : "flat"}">${v == null ? "—" : nf(1).format(v) + " %"}</b></div>`).join("") + `<div class="kpi"><small>En conditions réelles (24 h)</small><b>${live}</b></div>`;
  $("#btNote").textContent = `Testé sur ${nf(0).format(bt.n || 0)} signaux passés, en « walk-forward » : le modèle n'a jamais vu les données qu'il prédit.`;
  if (LC) {
    if (!btChart) {
      btChart = LC.createChart($("#btchart"), { ...baseChartOpts(), grid: { vertLines: { visible: false }, horzLines: { color: "rgba(30,43,68,.55)" } }, handleScroll: false, handleScale: false, localization: { locale: "fr-FR" } });
      btS = btChart.addSeries(LC.AreaSeries, { lineColor: C.ai, topColor: "rgba(155,138,251,.28)", bottomColor: "rgba(155,138,251,0)", lineWidth: 2, priceLineVisible: false });
      btH = btChart.addSeries(LC.LineSeries, { color: C.muted, lineWidth: 1.5, lineStyle: 2, priceLineVisible: false })
    }
    btS.setData(bt.equity || []); btH.setData(bt.bh || []); btChart.timeScale().fitContent();
  }
  $("#calib").innerHTML = (bt.calib || []).map(([p, o]) => `<div><div class="pair"><span style="height:${Math.max(2, (p - 35) * 1.4)}px;background:var(--ai)"></span><span style="height:${Math.max(2, (o - 35) * 1.4)}px;background:var(--up)"></span></div>${p} % → ${Math.round(o)} %</div>`).join("") || `<div class="muted" style="font-size:12px">Pas encore assez de données.</div>`;
}

/* ---------------- actualités ---------------- */
const SRC = { reuters: ["R", "#FF8000", "Reuters"], reddit: ["r/", "#FF4500", "Reddit"], fed: ["Fed", "#2B5BA8", "Federal Reserve"], sec: ["SEC", "#1A3E72", "SEC"], coindesk: ["CD", "#0A5CF5", "CoinDesk"], yahoo: ["Y!", "#6001D2", "Yahoo Finance"], gnews: ["G", "#34A853", "Google News"], cnbc: ["C", "#005594", "CNBC"], cointelegraph: ["CT", "#0b8a5b", "Cointelegraph"], marketwatch: ["MW", "#3a7d44", "MarketWatch"], ecb: ["BCE", "#003399", "BCE"], other: ["•", "#475569", "Presse"] };
let nFilter = "all";
function newsHTML(n, fresh) {
  const [ic, col, name] = SRC[n.src] || SRC.other, sc = n.s > .05 ? "up" : n.s < -.05 ? "down" : "flat";
  const pr = n.p != null ? `<span class="chip ${pcls(n.p)}">${n.p >= 50 ? "▲ " + n.p + " % hausse" : "▼ " + (100 - n.p) + " % baisse"} · 24 h</span>` : "";
  const title = n.url ? `<a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.txt)}</a>` : esc(n.txt);
  return `<article class="news${fresh ? " fresh" : ""}"><div class="news-top"><span class="src"><i style="background:${col}">${ic}</i>${esc(n.srcName || name)}</span><span>${ago(n.t)}</span></div>${n.who ? `<div class="who">${esc(n.who)}</div>` : ""}<p>${title}</p><div class="news-foot">${n.asset ? `<button class="chip ai" data-goasset="${esc(n.asset)}" style="border:0">${esc(n.asset)}</button>` : ""}<span class="chip ${sc}">Sentiment ${n.s > 0 ? "+" : ""}${nf(2).format(n.s || 0)}</span>${pr}</div>${n.ai ? `<div class="aisum">${esc(n.ai)}</div>` : ""}</article>`
}
function renderNews() {
  const list = (D.news || []).filter(n => nFilter === "all" || n.cat === nFilter || (n.asset && BY[n.asset] && ((nFilter === "crypto" && BY[n.asset].t === "crypto") || (nFilter === "stock" && BY[n.asset].t === "stock"))));
  $("#feed").innerHTML = list.length ? list.slice(0, 60).map(n => newsHTML(n, n.fresh)).join("") : `<div class="empty">Aucune actualité pour ce filtre.</div>`;
  $$("[data-goasset]").forEach(b => b.onclick = () => { if (!BY[b.dataset.goasset]) return; selectAsset(b.dataset.goasset); go("chart") });
}
function pushNews(n) { (D.news || []).forEach(x => x.fresh = false); n.fresh = true; D.news.unshift(n); renderNews(); const b = $("#newsBadge"); b.hidden = false; b.textContent = (+b.textContent || 0) + 1; toast(`Nouvelle actu analysée : ${n.asset || n.srcName || ""}`) }

/* ---------------- alertes (fil Telegram) ---------------- */
let localAlerts = [];
function tgCard(head, lines, t) { return `<div class="tg"><div class="tg-head"><b>Vigie Bot</b><span>${hhmm(t)}</span></div>${head ? `<p>${head}</p>` : ""}${lines.map(l => `<p>${l}</p>`).join("")}</div>` }
function renderAlerts() {
  const sum = D.summary, parts = [];
  if (sum) parts.push({ t: sum.t, h: tgCard(`☀️ <b>${esc(sum.title || "Résumé du matin")}</b>`, sum.lines.map(l => "• " + esc(l)), sum.t) });
  localAlerts.forEach(x => parts.push({ t: x.t, h: tgCard(`🔔 <b>Alerte prix</b> · ${esc(x.s)}`, [esc(x.msg)], x.t) }));
  (D.alerts || []).forEach(x => parts.push({ t: x.t, h: tgCard(`${x.p >= 50 ? "🟢" : "🔴"} <b>${esc(x.a)}</b> · ${x.p >= 50 ? "HAUSSE " + x.p : "BAISSE " + (100 - x.p)} % (24 h)`, [`Confiance : ${nf(2).format(x.c)} · Source : ${esc(x.src)}`, `<span style="color:#aebccb">🤖 ${esc(x.sum)}</span>`], x.t) }));
  parts.sort((a, b) => b.t - a.t);
  $("#alerts").innerHTML = parts.map(p => p.h).join("") || `<div class="empty">Aucune alerte pour l'instant.</div>`;
}

/* ---------------- alertes de prix personnelles ---------------- */
let pAlerts = null;
function renderPA() {
  const el = $("#paList");
  el.innerHTML = pAlerts.length ? pAlerts.map((x, i) => `<div class="pa"><span><b>${esc(x.s)}</b> ${x.c === "above" ? "passe au-dessus de" : "passe en dessous de"} <b class="num">${fp(x.p)} $</b>${x.done ? ` <span class="chip up">déclenchée</span>` : ""}</span><button class="toggle" data-pa="${i}">Supprimer</button></div>`).join("") : `<div class="empty">Aucune alerte. Créez-en une ci-dessus.</div>`;
  $$("[data-pa]").forEach(b => b.onclick = () => { pAlerts.splice(+b.dataset.pa, 1); LS.set(MK("vigie-palerts"), pAlerts); renderPA() });
}
function checkPA() {
  let ch = false;
  pAlerts.forEach(x => { if (x.done) return; const a = BY[x.s]; if (!a) return; if ((x.c === "above" && a.price >= x.p) || (x.c === "below" && a.price <= x.p)) { x.done = true; ch = true; const msg = `${a.n} est passé ${x.c === "above" ? "au-dessus" : "en dessous"} de ${fp(x.p)} $ (prix actuel ${fp(a.price)} $).`; localAlerts.unshift({ t: Date.now(), s: x.s, msg }); localAlerts = localAlerts.slice(0, 30); LS.set(MK("vigie-fired"), localAlerts); notify(`🔔 ${x.s} : ${fp(a.price)} $`, msg); sendTelegram(`🔔 Alerte prix ${x.s}\n${msg}`); renderAlerts(); toast("🔔 " + msg) } });
  if (ch) { LS.set(MK("vigie-palerts"), pAlerts); renderPA() }
}

/* ---------------- notifications & Telegram (navigateur) ---------------- */
function askNotif() { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().then(p => { CFG.notif = p === "granted"; saveCfg() }) }
function notify(title, body) { try { if ("Notification" in window && Notification.permission === "granted") { if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.ready.then(r => r.showNotification(title, { body, icon: "icons/icon-192.png" })); else new Notification(title, { body, icon: "icons/icon-192.png" }) } } catch (e) { } }
/* Envoi Telegram depuis le navigateur : requête simple (GET), puis mode « no-cors » si le navigateur bloque la lecture de la réponse */
async function sendTelegram(text) {
  if (!CFG.tgToken || !CFG.tgChat) return false;
  const url = `https://api.telegram.org/bot${CFG.tgToken}/sendMessage?chat_id=${encodeURIComponent(CFG.tgChat)}&text=${encodeURIComponent(text)}`;
  try { const r = await fetch(url); const j = await r.json(); return j.ok ? true : (j.description || false) }
  catch (e) { try { await fetch(url, { mode: "no-cors" }); return "envoyé (sans confirmation)" } catch (e2) { return false } }
}
/* Identifiant de discussion : demandé à Telegram, sinon repris de la mémoire du bot */
async function findTgChat(token) {
  try { const j = await (await fetch(`https://api.telegram.org/bot${token}/getUpdates`)).json(); const u = (j.result || []).reverse().find(x => x.message && x.message.chat && x.message.chat.type === "private"); if (u) return String(u.message.chat.id) } catch (e) { }
  try { const owner = location.hostname.endsWith("github.io") ? location.hostname.split(".")[0] : "Abraham402", repo = location.pathname.split("/")[1] || "Vigie"; const st = await (await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/data/state/state.json?t=${Date.now()}`)).json(); if (st.tg_chat) return String(st.tg_chat) } catch (e) { }
  return null;
}

/* ---------------- initiés, sources, personnes ---------------- */
function renderInsiders() { const rows = D.insiders || []; $("#insiders").innerHTML = rows.length ? `<thead><tr><th>Date</th><th>Qui</th><th>Type</th><th>Actif</th><th>Opération</th><th class="r">Montant</th></tr></thead><tbody>` + rows.map(r => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td class="muted">${esc(r[2])}</td><td><b>${esc(r[3])}</b></td><td class="${/achat/i.test(r[4]) ? "up" : "down"}">${esc(r[4])}</td><td class="r num">${esc(r[5])}</td></tr>`).join("") + "</tbody>" : `<tr><td><div class="empty">Aucune transaction récente trouvée.</div></td></tr>` }
function renderSources() {
  const rows = D.sources || [];
  $("#srcRank").innerHTML = rows.length ? `<thead><tr><th>Source</th><th class="r">Signaux mesurés</th><th>Fiabilité</th></tr></thead><tbody>` + rows.map(([n, c, r]) => `<tr><td>${esc(n)}</td><td class="r num">${nf(0).format(c)}</td><td style="min-width:130px">${r == null ? '<span class="muted">mesure en cours</span>' : `<div class="meter"><span style="width:${r}%;background:${r >= 55 ? "var(--up)" : r >= 50 ? "var(--flat)" : "var(--down)"}"></span></div><span class="num ${r >= 55 ? "up" : r >= 50 ? "flat" : "down"}">${nf(0).format(r)} %</span>`}</td></tr>`).join("") + "</tbody>" : `<tr><td><div class="empty">Mesure en cours : il faut 24 h de recul après chaque actualité.</div></td></tr>`;
}
let people = [];
function renderPeople() { $("#people").innerHTML = people.map((p, i) => `<span class="person">${esc(p)}<button aria-label="Retirer ${esc(p)}" data-rm="${i}">×</button></span>`).join(""); $$("[data-rm]").forEach(b => b.onclick = () => { people.splice(+b.dataset.rm, 1); LS.set("vigie-people", people); renderPeople() }) }

/* ---------------- carnet d'ordres & baleines ---------------- */
let unsubBook = null, whales = [];
function startBook() {
  if (unsubBook) unsubBook(); unsubBook = null; whales = []; $("#whales").innerHTML = "";
  const a = BY[current];
  if (a.t !== "crypto") { $("#orderbook").innerHTML = `<div class="empty">Le carnet d'ordres en direct est disponible gratuitement pour la crypto (Binance). Pour les actions, les données gratuites sont différées.</div>`; $("#spread").textContent = ""; $("#obRatio").innerHTML = ""; return }
  $("#orderbook").innerHTML = `<div class="muted" style="font-size:12px">Connexion au carnet d'ordres…</div>`; renderWhales();
  unsubBook = D.book(a.s, renderBook, w => { whales.unshift({ ...w, fresh: true }); whales = whales.slice(0, 8); renderWhales() });
}
function renderBook(b) {
  const a = BY[current], asks = b.asks.slice().sort((x, y) => x[0] - y[0]).slice(0, 8), bids = b.bids.slice().sort((x, y) => y[0] - x[0]).slice(0, 8);
  if (!asks.length || !bids.length) return;
  const mx = Math.max(...asks.map(x => x[1]), ...bids.map(x => x[1]));
  const row = ([p, q], side) => `<div class="ob-row"><i style="width:${q / mx * 100}%;background:${side === "a" ? "rgba(234,57,67,.16)" : "rgba(22,199,132,.16)"}"></i><span class="${side === "a" ? "down" : "up"}">${fp(p)}</span><span>${nf(q < 10 ? 3 : 1).format(q)}</span><span class="muted">${nf(0).format(p * q)} $</span></div>`;
  const sp = asks[0][0] - bids[0][0];
  $("#orderbook").innerHTML = `<div class="ob-row ob-head"><span>Prix ($)</span><span>Quantité (${a.s})</span><span>Total</span></div>` + [...asks].reverse().map(x => row(x, "a")).join("") + `<div class="ob-mid"><span class="num">${fp((asks[0][0] + bids[0][0]) / 2)} $</span><span class="muted" style="font-size:11px;font-weight:500">écart ${fp(sp)} $</span></div>` + bids.map(x => row(x, "b")).join("");
  const bv = bids.reduce((s, x) => s + x[1], 0), av = asks.reduce((s, x) => s + x[1], 0), r = bv / (bv + av) * 100;
  $("#spread").textContent = `Spread ${nf(3).format(sp / asks[0][0] * 100)} %`;
  $("#obRatio").innerHTML = `<div class="obbar"><span style="width:${r}%;background:var(--up)"></span><span style="width:${100 - r}%;background:var(--down)"></span></div><div class="muted" style="font-size:11px;margin-top:4px;display:flex;justify-content:space-between"><span class="up">Acheteurs ${Math.round(r)} %</span><span class="down">Vendeurs ${Math.round(100 - r)} %</span></div>`;
}
function renderWhales() {
  const a = BY[current];
  $("#whales").innerHTML = whales.length ? whales.map((w, i) => `<div class="whale${i === 0 && w.fresh ? " fresh" : ""}"><span class="${w.side === "buy" ? "up" : "down"}">🐋 ${w.side === "buy" ? "Achat" : "Vente"} ${nf(w.q < 10 ? 2 : 0).format(w.q)} ${a.s}</span><span class="num">${nf(2).format(w.q * w.p / 1e6)} M$</span><span class="muted">${hhmm(w.t)}</span></div>`).join("") : `<div class="muted" style="font-size:12px">En attente d'une grosse transaction…</div>`;
  whales.forEach(w => w.fresh = false);
}

/* =====================================================================
   PORTEFEUILLE FICTIF
   ===================================================================== */
const FEE = .001;
let pf = null;
const MK = k => k + (D && D.mode === "demo" ? "-demo" : "-live");
function newPf(cap) { return { cap, cash: cap, pos: {}, hist: [], orders: [], eq: [{ t: Date.now(), v: cap }], start: Date.now() } }
function pfInit() {
  pf = LS.get(MK("vigie-pf"), null);
  if (!pf) {
    pf = newPf(10000);
    if (D.mode === "demo") {
      [["BTC", 3000, .985, "Signal du bot"], ["NVDA", 2000, 1.03, "Actualité"], ["TSLA", 1500, .96, "Rebond sur support"]].forEach(([s, amt, f, setup], k) => { const px = BY[s].price * f, q = amt / px; pf.cash -= amt; pf.pos[s] = { q, cost: amt }; pf.hist.unshift({ t: Date.now() - 864e5 * (4 - k), s, side: "Achat", q, px, amt, setup }) });
      for (let i = 14; i > 0; i--) pf.eq.unshift({ t: Date.now() - i * 864e5, v: 10000 * (1 + Math.sin(i / 2.5) * .012 + (14 - i) * .0012) });
    }
    savePf();
  }
  pf.orders = pf.orders || [];
}
function savePf() { LS.set(MK("vigie-pf"), pf) }
function pfValue() { let v = pf.cash; for (const s in pf.pos) if (BY[s]) v += pf.pos[s].q * BY[s].price; return v }
function pushEq() { const v = pfValue(), last = pf.eq[pf.eq.length - 1]; if (!last || Date.now() - last.t > 60000) pf.eq.push({ t: Date.now(), v }); else last.v = v; if (pf.eq.length > 2000) pf.eq.splice(0, pf.eq.length - 2000) }
function execBuy(s, amt, px, meta = {}) {
  const f = amt * FEE; if (amt + f > pf.cash + 1e-6) { toast("Liquidités insuffisantes (frais de 0,1 % inclus)"); return false }
  const q = amt / px; pf.cash -= amt + f; const p = pf.pos[s] || { q: 0, cost: 0 }; p.q += q; p.cost += amt + f;
  if (meta.sl) p.sl = px * (1 - meta.sl / 100); if (meta.tp) p.tp = px * (1 + meta.tp / 100);
  pf.pos[s] = p; pf.hist.unshift({ t: Date.now(), s, side: "Achat", q, px, amt, fee: f, setup: meta.setup, note: meta.note, sl: p.sl, tp: p.tp, proba: probaOf(s) ? probaOf(s).p : null });
  pushEq(); savePf(); renderPf(); emit("trade", { side: "buy", s, meta });
  return true;
}
function execSell(s, amt, px, meta = {}) {
  const p = pf.pos[s]; if (!p) { toast(`Vous ne détenez pas de ${s}`); return false }
  const max = p.q * px; if (amt > max) amt = max;
  const q = amt / px, frac = q / p.q, costPart = p.cost * frac, f = amt * FEE, pnl = amt - f - costPart;
  pf.cash += amt - f; p.cost -= costPart; p.q -= q; if (p.q * px < .01) delete pf.pos[s];
  pf.hist.unshift({ t: Date.now(), s, side: "Vente", q, px, amt, fee: f, pnl, setup: meta.setup, note: meta.note, auto: meta.auto });
  pushEq(); savePf(); renderPf(); emit("trade", { side: "sell", s, meta, pnl });
  return true;
}
function checkOrders() {
  for (const s in pf.pos) { const p = pf.pos[s], a = BY[s]; if (!a) continue; if (p.sl && a.price <= p.sl) { const r = `Stop-loss déclenché sur ${s} à ${fp(a.price)} $`; execSell(s, p.q * a.price, a.price, { setup: "Stop-loss automatique", auto: true }); toast("🛑 " + r); notify("🛑 Stop-loss " + s, r) } else if (p.tp && a.price >= p.tp) { const r = `Objectif atteint sur ${s} à ${fp(a.price)} $`; execSell(s, p.q * a.price, a.price, { setup: "Take-profit automatique", auto: true }); toast("🎯 " + r); notify("🎯 Take-profit " + s, r) } }
  const before = pf.orders.length;
  pf.orders = pf.orders.filter(o => { const a = BY[o.s]; if (!a) return true; const hit = o.side === "buy" ? a.price <= o.limit : a.price >= o.limit; if (!hit) return true; const ok = o.side === "buy" ? execBuy(o.s, o.amt, a.price, o) : execSell(o.s, o.amt, a.price, o); if (ok) toast(`Ordre limite exécuté : ${o.side === "buy" ? "achat" : "vente"} ${o.s} à ${fp(a.price)} $`); return false });
  if (pf.orders.length !== before) { savePf(); renderPf() }
}
let pfChart, pfS;
const PAL = ["#9B8AFB", "#16C784", "#5EB5F7", "#F5B83D", "#E879F9", "#EA3943", "#2DD4BF", "#FB923C", "#A3E635", "#F472B6"];
function renderPf() {
  const v = pfValue(), pl = v - pf.cap, inv = Object.keys(pf.pos).reduce((a, s) => a + (BY[s] ? pf.pos[s].q * BY[s].price : 0), 0);
  $("#pfKpis").innerHTML = [["Valeur totale", fusd(v), ""], ["Gain / perte", `${pl >= 0 ? "+" : ""}${fusd(pl)}`, cls(pl)], ["Performance", fpct(pl / pf.cap * 100), cls(pl)], ["Liquidités", fusd(pf.cash), ""]].map(([k, val, c]) => `<div class="kpi"><small>${k}</small><b class="${c}">${val}</b></div>`).join("");
  const rows = Object.entries(pf.pos).filter(([s]) => BY[s]);
  $("#positions").innerHTML = rows.length ? `<thead><tr><th>Actif</th><th class="r">Quantité</th><th class="r">Prix moyen</th><th class="r">Prix</th><th class="r">Valeur</th><th class="r">G/P</th><th>Protection</th><th>Avis du bot (24 h)</th></tr></thead><tbody>` + rows.map(([s, p]) => {
    const a = BY[s], val = p.q * a.price, g = val - p.cost, pr = probaOf(s); const ok = !pr ? "—" : pr.p >= 55 ? "Hausse probable : cohérent" : pr.p <= 45 ? "Baisse probable : à surveiller" : "Neutre";
    return `<tr><td><b>${s}</b></td><td class="r num">${nf(a.price > 1000 ? 5 : 3).format(p.q)}</td><td class="r num">${fp(p.cost / p.q)}</td><td class="r num">${fp(a.price)}</td><td class="r num">${fusd(val)}</td><td class="r num ${cls(g)}">${g >= 0 ? "+" : ""}${fusd(g)}<br><small>${fpct(g / p.cost * 100)}</small></td><td class="num" style="font-size:11px">${p.sl ? `<span class="down">Stop ${fp(p.sl)}</span>` : '<span class="flat">Sans stop</span>'}${p.tp ? `<br><span class="up">Obj. ${fp(p.tp)}</span>` : ""}<br><button class="prot-btn" data-prot="${s}">${p.sl || p.tp ? "Modifier" : "+ Protéger"}</button></td><td>${pr ? `<span class="chip ${pcls(pr.p)}">${pr.p} %</span> ` : ""}<span class="muted" style="font-size:11px">${ok}</span></td></tr>`
  }).join("") + "</tbody>" : `<tr><td><div class="empty">Aucune position. Passez un ordre virtuel pour commencer.</div></td></tr>`;
  $("#history").innerHTML = pf.hist.length ? `<thead><tr><th>Date</th><th>Opération</th><th>Actif</th><th class="r">Quantité</th><th class="r">Prix</th><th class="r">Montant</th><th class="r">Résultat</th></tr></thead><tbody>` + pf.hist.slice(0, 40).map(h => `<tr><td class="muted">${new Date(h.t).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td><td class="${h.side === "Achat" ? "up" : "down"}">${h.side}${h.auto ? " (auto)" : ""}</td><td><b>${h.s}</b></td><td class="r num">${nf(4).format(h.q)}</td><td class="r num">${fp(h.px)}</td><td class="r num">${fusd(h.amt)}</td><td class="r num ${h.pnl != null ? cls(h.pnl) : "muted"}">${h.pnl != null ? (h.pnl >= 0 ? "+" : "") + fusd(h.pnl) : "—"}</td></tr>`).join("") + "</tbody>" : `<tr><td><div class="empty">Aucune opération pour l'instant.</div></td></tr>`;
  $("#pfSince").textContent = "depuis le " + new Date(pf.eq[0].t).toLocaleDateString("fr-FR");
  if (document.activeElement !== $("#pfCap")) $("#pfCap").value = pf.cap;
  const worst = rows.map(([s]) => [s, probaOf(s) ? probaOf(s).p : 50]).sort((a, b) => a[1] - b[1])[0], expo = v ? inv / v * 100 : 0;
  $("#pfAi").innerHTML = rows.length ? `Votre portefeuille est investi à <b>${Math.round(expo)} %</b>${expo > 70 ? ", une exposition élevée" : ""}. ${worst && worst[1] <= 45 ? `Point d'attention : <b>${worst[0]}</b>, pour lequel le bot voit ${100 - worst[1]} % de chances de baisse sur 24 h.` : "Vos positions vont dans le sens des prédictions du bot."} ${rows.some(([, p]) => !p.sl) ? "Certaines positions n'ont <b>pas de stop-loss</b> : c'est la première chose qu'un pro corrigerait." : "Toutes vos positions sont protégées par un stop-loss 👍"} Performance totale <b class="${cls(pl)}">${fpct(pl / pf.cap * 100)}</b>.` : "Commencez par un achat virtuel : je commenterai vos choix au regard des probabilités du bot.";
  if (LC) {
    if (!pfChart) { pfChart = LC.createChart($("#pfchart"), { ...baseChartOpts(), grid: { vertLines: { visible: false }, horzLines: { color: "rgba(30,43,68,.55)" } }, handleScroll: false, handleScale: false, localization: { locale: "fr-FR", priceFormatter: p => nf(0).format(p) + " $" } }); pfS = pfChart.addSeries(LC.AreaSeries, { lineWidth: 2, priceLineVisible: false }) }
    const seen = new Set(), data = []; [...pf.eq, { t: Date.now(), v }].forEach(e => { const time = Math.floor(e.t / 1000); if (!seen.has(time)) { seen.add(time); data.push({ time, value: e.v }) } }); data.sort((a, b) => a.time - b.time);
    const up = v >= pf.cap; pfS.applyOptions({ lineColor: up ? C.up : C.down, topColor: up ? "rgba(22,199,132,.25)" : "rgba(234,57,67,.25)", bottomColor: "rgba(0,0,0,0)" }); pfS.setData(data); pfChart.timeScale().fitContent();
  }
  renderRisk(); renderOrders(); renderJournal(); updateTradeInfo();
  $$("[data-prot]").forEach(b => b.onclick = () => openProtect(b.dataset.prot));
  renderPosChart();
}
/* Ajouter ou modifier le stop-loss / l'objectif d'une position déjà ouverte */
function openProtect(s) {
  const p = pf.pos[s], a = BY[s]; if (!p || !a) return;
  const val = p.q * a.price, d = dec(a.price);
  openModal(`<div class="lesson"><h2>Protéger ma position ${s}</h2>
  <p class="kicker">Prix actuel ${fp(a.price)} $ · position ${fusd(val, 0)} · prix moyen d'achat ${fp(p.cost / p.q)} $</p>
  <label class="fld">Stop-loss : vendre automatiquement si le prix descend à ($)<input class="input num" id="pSL" type="number" step="any" inputmode="decimal" value="${p.sl ? +p.sl.toFixed(d) : +(a.price * .95).toFixed(d)}"></label>
  <div class="quick" style="margin-top:6px">${[3, 5, 8, 10].map(k => `<button type="button" data-psl="${k}">−${k} %</button>`).join("")}<button type="button" data-psl="0">Aucun</button></div>
  <label class="fld">Objectif : vendre automatiquement si le prix monte à ($, facultatif)<input class="input num" id="pTP" type="number" step="any" inputmode="decimal" value="${p.tp ? +p.tp.toFixed(d) : ""}" placeholder="ex. ${+(a.price * 1.1).toFixed(d)}"></label>
  <div class="quick" style="margin-top:6px">${[5, 10, 20].map(k => `<button type="button" data-ptp="${k}">+${k} %</button>`).join("")}<button type="button" data-ptp="0">Aucun</button></div>
  <div class="sizer" id="pInfo" style="margin-top:12px"></div>
  <div class="btn-row"><button class="btn ai-b" id="pSave">Enregistrer la protection</button></div>
  <p class="kicker" style="margin-top:10px">Le bot surveille aussi vos protections toutes les 15 min, même application fermée : il vous prévient sur Telegram et la vente est enregistrée au prix de déclenchement à la prochaine ouverture.</p></div>`);
  const info = () => {
    const sl = +$("#pSL").value, tp = +$("#pTP").value; let h = "";
    if (sl > 0) h += sl >= a.price ? `<b class="down">Le stop-loss doit être sous le prix actuel.</b>` : `Si le stop-loss se déclenche : perte d'environ <b class="down">${fusd((sl - a.price) * p.q, 0)}</b> par rapport à maintenant (${fpct((sl / a.price - 1) * 100)}), soit ${nf(1).format(Math.abs((sl - a.price) * p.q) / pfValue() * 100)} % de votre capital.`;
    if (tp > 0) h += (h ? "<br>" : "") + (tp <= a.price ? `<b class="down">L'objectif doit être au-dessus du prix actuel.</b>` : `À l'objectif : gain d'environ <b class="up">+${fusd((tp - a.price) * p.q, 0)}</b>.`);
    if (sl > 0 && tp > 0 && sl < a.price && tp > a.price) { const rr = (tp - a.price) / (a.price - sl); h += `<br>Ratio risque/rendement <b class="${rr >= 2 ? "up" : "flat"}">1:${nf(1).format(rr)}</b>${rr >= 2 ? " ✓" : " · visez au moins 1:2"}` }
    $("#pInfo").innerHTML = h || "Choisissez un niveau de stop-loss : c'est la protection n°1 des pros.";
  };
  $$("[data-psl]").forEach(b => b.onclick = () => { const k = +b.dataset.psl; $("#pSL").value = k ? +(a.price * (1 - k / 100)).toFixed(d) : ""; info() });
  $$("[data-ptp]").forEach(b => b.onclick = () => { const k = +b.dataset.ptp; $("#pTP").value = k ? +(a.price * (1 + k / 100)).toFixed(d) : ""; info() });
  $("#pSL").oninput = info; $("#pTP").oninput = info; info();
  $("#pSave").onclick = () => {
    const sl = +$("#pSL").value || 0, tp = +$("#pTP").value || 0;
    if (sl && sl >= a.price) return toast("Le stop-loss doit être sous le prix actuel");
    if (tp && tp <= a.price) return toast("L'objectif doit être au-dessus du prix actuel");
    if (sl) p.sl = sl; else delete p.sl;
    if (tp) p.tp = tp; else delete p.tp;
    savePf(); renderPf(); closeModal(); syncPfToBot();
    toast(sl ? `Stop-loss ${s} placé à ${fp(sl)} $` : "Protection mise à jour");
    if (sl) emit("mission", "m5");
  };
}
function renderRisk() {
  const v = pfValue(), items = Object.entries(pf.pos).filter(([s]) => BY[s]).map(([s, p]) => [s, p.q * BY[s].price]).sort((a, b) => b[1] - a[1]);
  const all = [...items, ["Liquidités", pf.cash]];
  let acc = 0; const R = 15.9, L = 2 * Math.PI * R;
  const arcs = all.map(([s, x], i) => { const f = v ? x / v : 0, el = `<circle r="${R}" cx="20" cy="20" fill="none" stroke="${s === "Liquidités" ? "#334155" : PAL[i % PAL.length]}" stroke-width="7" stroke-dasharray="${f * L} ${L}" stroke-dashoffset="${-acc * L}" transform="rotate(-90 20 20)"/>`; acc += f; return el }).join("");
  const inv = items.reduce((s, x) => s + x[1], 0), hhi = inv ? items.reduce((s, [, x]) => s + (x / inv) ** 2, 0) : 1, div = Math.round((1 - hhi) * 100);
  const crypto = items.filter(([s]) => BY[s].t === "crypto").reduce((s, x) => s + x[1], 0), stocks = inv - crypto;
  const s10 = stocks * .1 + crypto * .18, s30 = crypto * .3;
  let peak = 0, mdd = 0; pf.eq.forEach(e => { peak = Math.max(peak, e.v); mdd = Math.max(mdd, (peak - e.v) / peak) });
  const big = items[0] && v ? items[0][1] / v * 100 : 0;
  const unprot = Object.entries(pf.pos).filter(([s, p]) => BY[s] && !p.sl).map(([s]) => s);
  $("#risk").innerHTML = `<div class="risk-grid"><svg viewBox="0 0 40 40" width="120" height="120" aria-hidden="true"><circle r="${R}" cx="20" cy="20" fill="none" stroke="var(--line)" stroke-width="7"/>${arcs}<text x="20" y="21.5" text-anchor="middle" font-size="5" fill="#E6ECF5" font-weight="700">${Math.round(v ? inv / v * 100 : 0)} %</text><text x="20" y="26.5" text-anchor="middle" font-size="2.8" fill="#8492A8">investi</text></svg>
  <ul class="alloc">${all.map(([s, x], i) => `<li><i style="background:${s === "Liquidités" ? "#334155" : PAL[i % PAL.length]}"></i>${s}<span class="num">${nf(1).format(v ? x / v * 100 : 0)} %</span></li>`).join("")}</ul></div>
  <div class="risk-stats">
   <div><small>Diversification</small><div class="meter"><span style="width:${div}%;background:${div >= 65 ? "var(--up)" : div >= 40 ? "var(--flat)" : "var(--down)"}"></span></div><b class="num">${div}/100</b> <span class="muted">${div >= 65 ? "bien répartie" : div >= 40 ? "moyenne" : "concentrée"}</span></div>
   <div><small>Si les marchés chutent de 10 %</small><b class="down num">−${fusd(s10, 0)}</b> <span class="muted">(la crypto baisse en général ~1,8× plus)</span></div>
   <div><small>Si la crypto chute de 30 %</small><b class="down num">−${fusd(s30, 0)}</b></div>
   <div><small>Pire baisse subie (drawdown)</small><b class="num ${mdd > .1 ? "down" : ""}">−${nf(1).format(mdd * 100)} %</b></div>
  </div>
  ${big > 30 ? `<div class="warn">⚠️ ${items[0][0]} pèse ${Math.round(big)} % du portefeuille : les pros dépassent rarement 20 à 30 % sur une seule ligne.</div>` : ""}
  ${unprot.length ? `<div class="warn">⚠️ Sans stop-loss : ${unprot.join(", ")}. Une chute brutale n'aurait aucune limite.</div>` : ""}`;
}
function renderOrders() {
  const el = $("#orders"); const prot = Object.entries(pf.pos).filter(([s, p]) => BY[s] && (p.sl || p.tp));
  if (!pf.orders.length && !prot.length) { el.innerHTML = `<div class="empty">Aucun ordre en attente. Les ordres limites, stop-loss et take-profit apparaîtront ici.</div>`; return }
  el.innerHTML = pf.orders.map((o, i) => `<div class="pa"><span><span class="chip ${o.side === "buy" ? "up" : "down"}">${o.side === "buy" ? "Achat" : "Vente"} limite</span> <b>${o.s}</b> ${fusd(o.amt, 0)} à <b class="num">${fp(o.limit)} $</b> <span class="muted">(actuel ${fp(BY[o.s] ? BY[o.s].price : 0)})</span></span><button class="toggle" data-co="${i}">Annuler</button></div>`).join("") +
    prot.map(([s, p]) => `<div class="pa"><span><b>${s}</b> ${p.sl ? `<span class="chip down">Stop ${fp(p.sl)}</span>` : ""} ${p.tp ? `<span class="chip up">Objectif ${fp(p.tp)}</span>` : ""} <span class="muted">actuel ${fp(BY[s].price)}</span></span><button class="toggle" data-cp="${s}">Retirer</button></div>`).join("");
  $$("[data-co]").forEach(b => b.onclick = () => { pf.orders.splice(+b.dataset.co, 1); savePf(); renderOrders(); toast("Ordre annulé") });
  $$("[data-cp]").forEach(b => b.onclick = () => { const p = pf.pos[b.dataset.cp]; delete p.sl; delete p.tp; savePf(); renderPf() });
}
function renderJournal() {
  const el = $("#journal"), H = pf.hist.filter(h => h.setup || h.note);
  el.innerHTML = H.length ? H.slice(0, 15).map(h => `<div class="journal-item"><div class="meta">${new Date(h.t).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} · <span class="${h.side === "Achat" ? "up" : "down"}">${h.side}</span> <b>${h.s}</b> à ${fp(h.px)} $${h.proba != null ? ` · bot ${h.proba} %` : ""}${h.pnl != null ? ` · <span class="${cls(h.pnl)}">${h.pnl >= 0 ? "+" : ""}${fusd(h.pnl)}</span>` : ""}</div><div><span class="chip ai">${esc(h.setup || "—")}</span> ${esc(h.note || "")}</div></div>`).join("") : `<div class="empty">Indiquez la raison de vos trades dans le formulaire : votre journal se remplira ici.</div>`;
  const sells = pf.hist.filter(h => h.pnl != null), by = {};
  sells.forEach(h => { const k = h.setup || "Non précisé"; by[k] = by[k] || { n: 0, w: 0, p: 0 }; by[k].n++; by[k].p += h.pnl; if (h.pnl > 0) by[k].w++ });
  const best = Object.entries(by).sort((a, b) => b[1].p - a[1].p)[0], wr = sells.length ? sells.filter(h => h.pnl > 0).length / sells.length * 100 : 0, intu = pf.hist.filter(h => h.setup === "Intuition").length;
  $("#journalAi").innerHTML = sells.length ? `Sur ${sells.length} vente${sells.length > 1 ? "s" : ""}, vous gagnez dans <b class="${wr >= 50 ? "up" : "down"}">${Math.round(wr)} %</b> des cas. ${best ? `Méthode la plus rentable : <b>${esc(best[0])}</b> (${best[1].p >= 0 ? "+" : ""}${fusd(best[1].p, 0)}).` : ""} ${intu ? `Vous avez pris ${intu} décision${intu > 1 ? "s" : ""} « à l'intuition » : comparez leurs résultats aux autres.` : ""} ${wr < 50 && sells.length >= 5 ? "Un taux sous 50 % reste rentable si vos gains moyens sont au moins 2× plus grands que vos pertes : placez votre take-profit 2× plus loin que votre stop." : ""}` : `Fermez quelques positions pour que je puisse mesurer quelle méthode fonctionne le mieux pour vous.`;
}
let otype = "market";
function sizerHTML() {
  const sl = +$("#tSL").value, tp = +$("#tTP").value, v = pfValue();
  if (!(sl > 0)) return `Ajoutez un <b>stop-loss</b> : je calculerai la taille de position qui ne risque que 1 % de votre capital (règle des pros).`;
  const size = Math.min(v * .01 / (sl / 100), pf.cash / (1 + FEE));
  const rr = tp > 0 ? tp / sl : null;
  return `Pour ne risquer que <b>1 % (${fusd(v * .01, 0)})</b> avec un stop à ${nf(1).format(sl)} %, investissez au maximum <b>${fusd(size, 0)}</b><button type="button" id="useSize">Utiliser</button>${rr ? `<br>Ratio risque/rendement <b class="${rr >= 2 ? "up" : rr >= 1 ? "flat" : "down"}">1:${nf(1).format(rr)}</b> ${rr >= 2 ? "✓ conforme aux standards pros" : "· visez au moins 1:2"}` : ""}`;
}
function updateTradeInfo() {
  const s = $("#tAsset").value, a = BY[s]; if (!a) return; const amt = +$("#tAmount").value || 0, pr = D.proba[s];
  $("#tPrice").value = fp(a.price) + " $";
  const held = pf.pos[s];
  $("#tInfo").innerHTML = `≈ ${nf(a.price > 1000 ? 5 : 3).format(amt / a.price)} ${s} · frais ${fusd(amt * FEE)} · Liquidités ${fusd(pf.cash)}${held ? ` · Détenu ${fusd(held.q * a.price)}` : ""}${pr ? `<br>Avis du bot : <span class="${pcls(pr[1].p)}">${pr[1].p} % de hausse sur 24 h</span>, <span class="${pcls(pr[2].p)}">${pr[2].p} % sur 7 j</span>` : ""}`;
  $("#sizer").innerHTML = sizerHTML();
  const u = $("#useSize"); if (u) u.onclick = () => { const sl = +$("#tSL").value; $("#tAmount").value = Math.floor(Math.min(pfValue() * .01 / (sl / 100), pf.cash / (1 + FEE))); updateTradeInfo() };
}
function tradeMeta() { return { sl: +$("#tSL").value || null, tp: +$("#tTP").value || null, setup: $("#tSetup").value, note: $("#tNote").value.trim() } }
function placeOrder(side) {
  const s = $("#tAsset").value, a = BY[s], amt = +$("#tAmount").value, meta = tradeMeta();
  if (!(amt > 0)) return toast("Indiquez un montant");
  if (otype === "limit") {
    const lim = +$("#tLimit").value; if (!(lim > 0)) return toast("Indiquez le prix limite");
    if (side === "sell" && !pf.pos[s]) return toast(`Vous ne détenez pas de ${s}`);
    pf.orders.push({ s, side, amt, limit: lim, ...meta, t: Date.now() }); savePf(); renderOrders(); toast(`Ordre limite placé : ${side === "buy" ? "achat" : "vente"} ${s} à ${fp(lim)} $`);
  } else {
    const ok = side === "buy" ? execBuy(s, amt, a.price, meta) : execSell(s, amt, a.price, meta);
    if (!ok) return;
    toast(`${side === "buy" ? "Achat" : "Vente"} de ${fusd(amt)} de ${s} à ${fp(a.price)} $`);
  }
  $("#tNote").value = "";
}

/* =====================================================================
   IA ANALYSTE
   ===================================================================== */
function ruleReply(q) {
  const t = q.toLowerCase(); const a0 = ASSETS.find(a => t.includes(a.s.toLowerCase()) || t.includes(a.n.toLowerCase())); const s = a0 ? a0.s : current; const a = BY[s], P = D.proba[s], F = (D.factors && D.factors[s]) || [];
  if (/portef|positions|mon compte/.test(t)) { const v = pfValue(), pl = v - pf.cap; return `<p>Votre portefeuille vaut <b>${fusd(v)}</b> (${fpct(pl / pf.cap * 100)}).</p><ul>${Object.keys(pf.pos).filter(k => BY[k]).map(k => { const pr = probaOf(k); return `<li><b>${k}</b> : ${pr ? `le bot voit ${pr.p} % de hausse sur 24 h. ${pr.p <= 45 ? "Envisagez de réduire ou de resserrer le stop-loss." : "Position cohérente avec le modèle."}` : "pas encore d'analyse."} ${pf.pos[k].sl ? "" : "<b>Pas de stop-loss.</b>"}</li>` }).join("") || "<li>Aucune position ouverte.</li>"}</ul><p>Règle de méthode : pas plus de 20 à 30 % du capital sur un seul actif, et 1 % de risque maximum par trade.</p>` }
  if (/actu|news|résum|resum|nouvelles/.test(t)) { const N = (D.news || []).slice(0, 4); return `<p>En bref, les dernières actualités analysées :</p><ul>${N.map(n => `<li><b>${esc(n.asset || "")}</b> ${esc(n.txt.slice(0, 120))} <span class="${n.s >= 0 ? "up" : "down"}">(${n.s >= 0 ? "positif" : "négatif"})</span></li>`).join("")}</ul><p>Sentiment global : <b>${D.sentiment}/100</b>.</p>` }
  if (/risque|danger|perdre/.test(t)) return `<p>Pour <b>${esc(a.n)}</b>, le principal risque est la volatilité. ${P ? `Sur 7 jours, le modèle n'a qu'une confiance ${confTxt(P[2].c)} (${nf(2).format(P[2].c)}). Une probabilité de ${P[1].p} % signifie aussi ${100 - P[1].p} % de chances que ça ne se passe pas comme prévu.` : ""}</p><p>Protégez toujours une position avec un stop-loss décidé à l'avance.</p>`;
  if (!P) return `<p><b>${esc(a.n)}</b> à ${fp(a.price)} $ (${fpct(chg(a))} sur 24 h). Le bot ne l'a pas encore analysé.</p>`;
  const top = [...F].sort((x, y) => Math.abs(y[1]) - Math.abs(x[1])).slice(0, 2);
  return `<p><b>${esc(a.n)} (${s})</b> à ${fp(a.price)} $, ${fpct(chg(a))} sur 24 h.</p><p>Le bot estime <b class="${pcls(P[1].p)}">${P[1].p} % de chances de hausse sur 24 h</b> (confiance ${confTxt(P[1].c)}) et ${P[2].p} % sur 7 jours.</p>${top.length ? `<p>Pourquoi ? Surtout :</p><ul>${top.map(([n, v, w]) => `<li><b>${esc(n)}</b> (${v > 0 ? "positif" : "négatif"}) : ${esc(w)}.</li>`).join("")}</ul>` : ""}<p class="muted">En clair : ${P[1].p >= 60 ? "contexte plutôt favorable, mais rien n'est garanti." : P[1].p <= 40 ? "contexte plutôt défavorable : prudence." : "pas de signal clair, mieux vaut attendre."}</p>`;
}
function mdToHtml(s) { return esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/^\s*[-*] (.+)$/gm, "<li>$1</li>").replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`).split(/\n{2,}/).map(p => p.startsWith("<ul>") ? p : `<p>${p.replace(/\n/g, "<br>")}</p>`).join("") }
function aiContext() {
  const a = BY[current], P = D.proba[current];
  return `Tu es l'analyste IA de Vigie, une plateforme d'apprentissage du trading avec portefeuille FICTIF. Réponds en français simple, concis (150 mots max), pédagogique, sans jamais garantir un gain. Explique chaque terme technique. Données actuelles :
Actif affiché : ${a.n} (${a.s}) prix ${a.price} $, variation 24 h ${chg(a).toFixed(2)} %.
Probabilités du bot : ${P ? P.map((x, i) => ["1h", "24h", "7j"][i] + " " + x.p + "% (confiance " + x.c + ")").join(", ") : "pas encore calculées"}.
Facteurs : ${((D.factors || {})[current] || []).map(f => f[0] + " " + Number(f[1]).toFixed(2) + " (" + f[2] + ")").join("; ")}.
Watchlist : ${ASSETS.map(x => x.s + " " + fp(x.price) + "$ " + fpct(chg(x)) + (probaOf(x.s) ? " p24h " + probaOf(x.s).p + "%" : "")).join(" | ")}.
Actus récentes : ${(D.news || []).slice(0, 6).map(n => (n.asset || "") + ": " + n.txt.slice(0, 140) + " (sentiment " + n.s + ")").join(" | ")}.
Portefeuille fictif : valeur ${pfValue().toFixed(0)} $, capital ${pf.cap} $, liquidités ${pf.cash.toFixed(0)} $, positions ${Object.entries(pf.pos).map(([s, p]) => s + " " + (p.q * (BY[s] ? BY[s].price : 0)).toFixed(0) + "$" + (p.sl ? " stop " + p.sl.toFixed(2) : " sans stop")).join(", ") || "aucune"}.
Sentiment de marché : ${D.sentiment}/100.
Fonctions de l'application à connaître : l'utilisateur peut recevoir sur Telegram un point automatique sur son portefeuille (toutes les heures, 2 h, 4 h ou matin et soir). S'il le demande, ne dis jamais que c'est impossible : dis-lui d'écrire « envoie-moi un point sur mon portefeuille toutes les heures sur Telegram » ou d'aller dans ⚙️ → « Suivi de mon portefeuille sur Telegram ». Suivi actuel : ${CFG.tgReport ? "activé, toutes les " + CFG.tgReport + " min" : "désactivé"}.`;
}
let aiHist = [];
const GEM_MODELS = ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-2.5-flash", "gemini-2.5-flash-lite"];
const gemNoThink = {};
/* Appel Gemini : modèle choisi puis modèles de secours ; 25 s max par modèle ; sans « réflexion » (plus rapide) */
async function geminiReply(q) {
  const models = [CFG.geminiModel || GEM_MODELS[0], ...GEM_MODELS.filter(m => m !== (CFG.geminiModel || GEM_MODELS[0]))];
  const contents = [...aiHist.slice(-6), { role: "user", parts: [{ text: q }] }];
  let last = "";
  for (const m of models) {
    for (let k = 0; k < 2; k++) {
      const gc = { temperature: .6, maxOutputTokens: 800 };
      if (gemNoThink[m] !== false) gc.thinkingConfig = { thinkingBudget: 0 };
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 25000);
      let r;
      try {
        r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(CFG.gemini)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ systemInstruction: { parts: [{ text: aiContext() }] }, contents, generationConfig: gc }), signal: ctl.signal });
      } catch (e) { last = e.name === "AbortError" ? "délai dépassé" : e.message; clearTimeout(timer); break }
      clearTimeout(timer);
      if (r.status === 400 && gemNoThink[m] !== false) { gemNoThink[m] = false; continue }
      if (!r.ok) { last = "code " + r.status; if (r.status === 400 || r.status === 403) { const t = await r.text(); if (/API key/i.test(t)) throw new Error("clé refusée par Google : vérifiez-la dans ⚙️") } break }
      const j = await r.json(); const txt = ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).filter(p => !p.thought).map(p => p.text).join("");
      if (!txt) { last = "réponse vide"; break }
      aiHist.push({ role: "user", parts: [{ text: q }] }, { role: "model", parts: [{ text: txt }] });
      return mdToHtml(txt);
    }
  }
  throw new Error("Google est saturé pour le moment (" + last + ")");
}
const aiHooks = [];
async function aiAnswer(q) {
  for (const h of aiHooks) { const r = h(q); if (r) return r }
  if (CFG.gemini) { try { return await geminiReply(q) } catch (e) { console.warn(e); return ruleReply(q) + `<p class="muted" style="font-size:11px">IA Gemini indisponible : ${esc(e.message)}. Réponse de secours ; réessayez dans quelques minutes.</p>` } }
  return ruleReply(q);
}
function addMsg(html, who) { const d = document.createElement("div"); d.className = "msg " + who; d.innerHTML = html; $("#chat").appendChild(d); $("#chat").scrollTop = 1e6; return d }
async function ask(q) { addMsg(esc(q), "me"); const t = addMsg('<span class="typing"><span></span><span></span><span></span></span>', "bot"); const [html] = await Promise.all([aiAnswer(q), new Promise(r => setTimeout(r, 700))]); t.innerHTML = html; $("#chat").scrollTop = 1e6; emit("ask", q) }
function setSugg(list) { $("#sugg").innerHTML = list.map(s => `<button type="button">${esc(s)}</button>`).join(""); $$("#sugg button").forEach(b => b.onclick = () => ask(b.textContent)) }

/* =====================================================================
   RÉGLAGES & MODALE
   ===================================================================== */
function openModal(html, onClose) { $("#modalBody").innerHTML = html; $("#modal").hidden = false; $("#modal")._onClose = onClose; document.body.classList.add("noscroll"); $(".modal-box").scrollTop = 0 }
function closeModal() { $("#modal").hidden = true; document.body.classList.remove("noscroll"); const f = $("#modal")._onClose; $("#modal")._onClose = null; f && f() }
function openSettings() {
  const st = D.status || {};
  openModal(`<div class="lesson"><h2>Réglages</h2>
  <p class="kicker">Ce que vous saisissez ici reste <b>uniquement dans ce navigateur</b>, puis est envoyé seulement à Google (IA) ou Telegram.</p>
  <h3 class="mt">État du système</h3>
  <ul class="checklist">
   <li class="ok">Mode : <b>${D.mode === "live" ? "données réelles" : "démo (données fictives)"}</b> · <a href="${D.mode === "live" ? "?demo=1" : "./"}">${D.mode === "live" ? "voir la démo" : "passer au réel"}</a></li>
   ${D.mode === "live" ? `<li class="${st.last_run ? "ok" : "ko"}">Dernière analyse du bot : <b>${st.last_run ? ago(new Date(st.last_run).getTime()) : "pas encore"}</b></li>
   <li class="${st.telegram ? "ok" : "ko"}">Alertes Telegram du bot : <b>${st.telegram ? "actives" : "à configurer (secret GitHub)"}</b></li>
   <li class="${st.gemini ? "ok" : "ko"}">Résumés IA du bot : <b>${st.gemini ? "actifs" : "à configurer (secret GitHub)"}</b></li>
   <li class="${D.wsOk && D.wsOk() ? "ok" : "ko"}">Crypto en direct (Binance) : <b>${D.wsOk && D.wsOk() ? "connecté" : "données du bot (différées)"}</b></li>` : ""}
   <li class="${CFG.gemini ? "ok" : "ko"}">IA dans l'application : <b>${CFG.gemini ? "Gemini connecté" : "mode simple"}</b></li>
  </ul>
  <h3 class="mt">IA dans l'application (Gemini, gratuit)</h3>
  <label class="fld">Clé API Gemini<input class="input" id="sGem" type="password" autocomplete="off" placeholder="AIza…" value="${esc(CFG.gemini)}"></label>
  <label class="fld">Modèle<input class="input" id="sGemM" value="${esc(CFG.geminiModel || "gemini-flash-latest")}"></label>
  <h3 class="mt">Telegram pour vos alertes de prix (facultatif)</h3>
  <label class="fld">Jeton du bot (donné par BotFather)<input class="input" id="sTgT" type="password" autocomplete="off" value="${esc(CFG.tgToken)}"></label>
  <label class="fld">Votre identifiant de discussion (chat id)<input class="input" id="sTgC" inputmode="numeric" value="${esc(CFG.tgChat)}"></label>
  <label class="fld">Suivi de mon portefeuille sur Telegram<select class="input" id="sRep">${[[0, "Désactivé"], [60, "Toutes les heures"], [120, "Toutes les 2 heures"], [240, "Toutes les 4 heures"], [720, "Matin et soir"]].map(([v, l]) => `<option value="${v}" ${(CFG.tgReport || 0) == v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
  <div class="btn-row"><button class="btn ai-b" id="sSave">Enregistrer</button><button class="btn" id="sFind">Trouver mon chat id</button><button class="btn" id="sTest">Tester Telegram</button><button class="btn" id="sNotif">Activer les notifications</button></div>
  <p class="kicker" style="margin-top:14px">Version de l'application : <b>${window.VIGIE_VERSION || "?"}</b></p>
  <h3 class="mt">Sauvegarde</h3>
  <p class="kicker">Portefeuille, alertes et progression sont stockés dans ce navigateur. Exportez-les pour les garder ou les transférer.</p>
  <div class="btn-row"><button class="btn" id="sExp">Exporter</button><label class="btn" style="cursor:pointer">Importer<input type="file" id="sImp" accept="application/json" hidden></label></div>
  </div>`);
  $("#sSave").onclick = () => { CFG.gemini = $("#sGem").value.trim(); CFG.geminiModel = $("#sGemM").value.trim() || "gemini-flash-latest"; CFG.tgToken = $("#sTgT").value.trim(); CFG.tgChat = $("#sTgC").value.trim(); const rep = +$("#sRep").value; const repCh = rep !== (CFG.tgReport || 0); CFG.tgReport = rep; saveCfg(); aiHist = []; toast("Réglages enregistrés"); renderAiHead(); if (repCh || rep) syncPfToBot(true) };
  $("#sTest").onclick = async () => {
    CFG.tgToken = $("#sTgT").value.trim(); CFG.tgChat = $("#sTgC").value.trim();
    if (!CFG.tgToken) return toast("Collez le jeton du bot");
    if (!CFG.tgChat) { const id = await findTgChat(CFG.tgToken); if (id) { CFG.tgChat = id; $("#sTgC").value = id } else return toast("Chat id manquant : envoyez /start au bot, puis « Trouver mon chat id »") }
    saveCfg(); const r = await sendTelegram("✅ Vigie est bien connecté à votre Telegram.");
    toast(r === true ? "Message envoyé sur Telegram ✓" : r ? "Message " + r + " : regardez Telegram" : "Échec : vérifiez le jeton (sans espace) et le chat id");
  };
  $("#sFind").onclick = async () => { const tk = $("#sTgT").value.trim(); if (!tk) return toast("Collez d'abord le jeton du bot"); toast("Recherche…"); const id = await findTgChat(tk); if (id) { $("#sTgC").value = id; CFG.tgToken = tk; CFG.tgChat = id; saveCfg(); toast("Chat id trouvé et enregistré ✓") } else toast("Introuvable : envoyez /start à votre bot dans Telegram, puis réessayez") };
  $("#sNotif").onclick = () => { askNotif(); setTimeout(() => notify("Vigie", "Les notifications fonctionnent ✓"), 1200) };
  $("#sExp").onclick = () => { const b = new Blob([JSON.stringify({ pf, pAlerts, learn: LS.get("vigie-learn", null) }, null, 1)], { type: "application/json" }); const u = URL.createObjectURL(b), l = document.createElement("a"); l.href = u; l.download = `vigie-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`; l.click(); setTimeout(() => URL.revokeObjectURL(u), 1000) };
  $("#sImp").onchange = e => { const f = e.target.files[0]; if (!f) return; f.text().then(t => { try { const j = JSON.parse(t); if (j.pf) LS.set(MK("vigie-pf"), j.pf); if (j.pAlerts) LS.set(MK("vigie-palerts"), j.pAlerts); if (j.learn) LS.set("vigie-learn", j.learn); toast("Sauvegarde importée"); setTimeout(() => location.reload(), 600) } catch (err) { toast("Fichier invalide") } }) };
}
function renderAiHead() { $("#aiSub").textContent = CFG.gemini ? "Gemini connecté · répond avec les données en direct" : (D.mode === "demo" ? "Réponses simulées dans la démo" : "Mode simple · ajoutez une clé Gemini gratuite dans ⚙️") }

/* ---------------- sentiment ---------------- */
function renderSent(v) { $("#sentVal").textContent = v; $("#sentNeedle").style.transform = `rotate(${(v - 50) * 1.8}deg)`; const c = $("#sentChip"); c.textContent = v >= 75 ? "Avidité extrême" : v >= 58 ? "Avidité" : v <= 25 ? "Peur extrême" : v <= 42 ? "Peur" : "Neutre"; c.className = "chip " + (v >= 58 ? "up" : v <= 42 ? "down" : "flat") }

/* =====================================================================
   SÉLECTION & BOUCLES
   ===================================================================== */
function selectAsset(s) { if (!BY[s]) return; current = s; LS.set("vigie-cur", s); renderWatch(); renderAsset(); renderProba(); loadChart(); renderBacktest(); startBook(); $("#tAsset").value = s; $("#cmpSel").value = cmpWith; updateTradeInfo(); emit("asset", s) }
function onPrice(sym) { if (sym === current && !D.klineStream) liveFromPrice(BY[sym].price) }
function tickUI() {
  ASSETS.forEach(a => {
    const prev = a.shown ?? a.price; a.shown = a.price;
    const el = document.querySelector(`[data-px="${a.s}"]`);
    if (el && prev !== a.price) { el.textContent = fp(a.price); el.classList.remove("flash-up", "flash-down"); void el.offsetWidth; el.classList.add(a.price >= prev ? "flash-up" : "flash-down"); const c = document.querySelector(`[data-chg="${a.s}"]`); c.textContent = fpct(chg(a)); c.className = cls(chg(a)) }
  });
  renderAsset(); renderTape(); renderHeat(); checkPA(); checkOrders();
  if (document.activeElement !== $("#tAmount")) updateTradeInfo();
}

/* =====================================================================
   DÉMARRAGE
   ===================================================================== */
function bindUI() {
  $$(".bottom-nav button").forEach(b => b.onclick = () => go(b.dataset.go));
  $$("[data-wf]").forEach(b => b.onclick = () => { wFilter = b.dataset.wf; $$("[data-wf]").forEach(x => x.setAttribute("aria-pressed", x === b)); renderWatch() });
  $$("[data-tf]").forEach(b => b.onclick = () => { tf = +b.dataset.tf; LS.set("vigie-tf", tf); $$("[data-tf]").forEach(x => x.setAttribute("aria-pressed", x === b)); loadChart() });
  $$("[data-st]").forEach(b => b.onclick = () => { style = b.dataset.st; LS.set("vigie-style", style); $$("[data-st]").forEach(x => x.setAttribute("aria-pressed", x === b)); createMain(); if (bars.length) { candle.setData(seriesData()); refreshIndicators() } emit("style", style) });
  $$("[data-ind]").forEach(b => b.onclick = () => { const k = b.dataset.ind; show[k] = !show[k]; LS.set("vigie-ind", show); b.setAttribute("aria-pressed", show[k]); if (k === "rsi" || k === "macd") rebuildPanes(); refreshIndicators(); emit("ind", { k, on: show[k] }) });
  $$("[data-draw]").forEach(b => b.onclick = () => setDraw(b.dataset.draw));
  $("#clearDraw").onclick = () => { clearDrawings(); toast("Tracés effacés") };
  $("#cmpSel").innerHTML = `<option value="">Comparer avec…</option>` + ASSETS.map(a => `<option value="${a.s}">${a.s} · ${esc(a.n)}</option>`).join("");
  $("#cmpSel").onchange = e => { cmpWith = e.target.value; applyCompare() };
  $("#replayBtn").onclick = () => RP ? stopReplay() : startReplay();
  $("#rpPlay").onclick = playRP; $("#rpUp").onclick = () => guessRP(true); $("#rpDn").onclick = () => guessRP(false); $("#rpQuit").onclick = () => stopReplay();
  const fs = () => { const c = $("#chartCard"), onFs = c.classList.toggle("fs"); document.body.classList.toggle("noscroll", onFs); $("#fsBtn").textContent = onFs ? "✕ Quitter" : "⛶ Plein écran" };
  $("#fsBtn").onclick = fs;
  document.addEventListener("keydown", e => { if (e.key === "Escape") { if (!$("#modal").hidden) closeModal(); else if ($("#chartCard").classList.contains("fs")) fs() } });
  $$("[data-nf]").forEach(b => b.onclick = () => { nFilter = b.dataset.nf; $$("[data-nf]").forEach(x => x.setAttribute("aria-pressed", x === b)); renderNews() });
  $$("[data-tab]").forEach(b => b.onclick = () => { $$("[data-tab]").forEach(x => x.setAttribute("aria-selected", x === b)); $$("[data-panel]").forEach(p => p.hidden = p.dataset.panel !== b.dataset.tab) });
  $("#addPerson").onsubmit = e => { e.preventDefault(); const v = $("#personInput").value.trim(); if (v) { people.push(v); LS.set("vigie-people", people); $("#personInput").value = ""; renderPeople(); toast("Ajouté à votre liste") } };
  $("#paAsset").innerHTML = $("#tAsset").innerHTML = ASSETS.map(a => `<option value="${a.s}">${a.s} · ${esc(a.n)}</option>`).join("");
  const paFill = () => { const a = BY[$("#paAsset").value]; $("#paPrice").value = +(a.price * ($("#paCond").value === "above" ? 1.01 : .99)).toFixed(dec(a.price)) };
  $("#paAsset").onchange = paFill; $("#paCond").onchange = paFill;
  $("#paForm").onsubmit = e => { e.preventDefault(); const p = +$("#paPrice").value; if (!(p > 0)) return; pAlerts.push({ s: $("#paAsset").value, c: $("#paCond").value, p }); LS.set(MK("vigie-palerts"), pAlerts); renderPA(); askNotif(); toast("Alerte créée") };
  $("#tAsset").onchange = updateTradeInfo; ["#tAmount", "#tSL", "#tTP"].forEach(s => $(s).oninput = updateTradeInfo);
  $$("[data-q]").forEach(b => b.onclick = () => { $("#tAmount").value = Math.floor(pf.cash / (1 + FEE) * +b.dataset.q); updateTradeInfo() });
  $$("[data-ot]").forEach(b => b.onclick = () => { otype = b.dataset.ot; $$("[data-ot]").forEach(x => x.setAttribute("aria-pressed", x === b)); $("#limitWrap").hidden = otype !== "limit"; if (otype === "limit") { const a = BY[$("#tAsset").value]; $("#tLimit").value = +(a.price * .99).toFixed(dec(a.price)) } });
  $("#bBuy").onclick = () => placeOrder("buy"); $("#bSell").onclick = () => placeOrder("sell");
  $("#pfCapBtn").onclick = () => { const c = +$("#pfCap").value; if (c >= 100 && confirm(`Repartir de zéro avec ${fusd(c, 0)} ?`)) { pf = newPf(c); savePf(); renderPf(); toast(`Nouveau portefeuille : ${fusd(c, 0)}`) } };
  $("#pfReset").onclick = () => { if (confirm("Effacer le portefeuille fictif et repartir de zéro ?")) { pf = newPf(pf.cap); savePf(); renderPf() } };
  $("#aiForm").onsubmit = e => { e.preventDefault(); const q = $("#aiInput").value.trim(); if (q) { ask(q); $("#aiInput").value = "" } };
  $("#settingsBtn").onclick = openSettings;
  $("#modal").onclick = e => { if (e.target.id === "modal") closeModal() }; $(".modal-x").onclick = closeModal;
}

async function startApp(data) {
  D = data; ASSETS = D.assets; BY = Object.fromEntries(ASSETS.map(a => [a.s, a]));
  current = BY[LS.get("vigie-cur", "BTC")] ? LS.get("vigie-cur", "BTC") : ASSETS[0].s;
  people = LS.get("vigie-people", D.people || ["Président de la Fed", "Secrétaire au Trésor US", "Président des États-Unis", "PDG de Tesla", "PDG de Nvidia", "Présidente de la BCE", "Dirigeant de BlackRock", "Membres du Congrès US"]);
  pAlerts = LS.get(MK("vigie-palerts"), null); localAlerts = LS.get(MK("vigie-fired"), []);
  if (pAlerts === null) { pAlerts = BY.BTC ? [{ s: "BTC", c: "above", p: +(BY.BTC.price * 1.0004).toFixed(0) }] : []; LS.set(MK("vigie-palerts"), pAlerts) }
  pfInit(); bindUI();
  renderStatus(); renderTape(); renderWatch(); renderHeat(); renderCalendar(); renderAsset(); renderProba(); renderNews(); renderAlerts(); renderInsiders(); renderSources(); renderPeople(); renderPA(); renderSent(D.sentiment ?? 50);
  $("#tAsset").value = current; $("#paAsset").onchange(); renderPf(); renderAiHead();
  try { initChart(); await loadChart(); renderBacktest() } catch (e) { console.error(e) }
  startBook();
  setSugg(["Explique le signal sur " + current, "Résume l'actualité", "Commente mon portefeuille", "Quels risques sur Tesla ?"]);
  const best = ASSETS.filter(a => probaOf(a.s)).sort((a, b) => Math.abs(probaOf(b.s).p - 50) - Math.abs(probaOf(a.s).p - 50))[0];
  addMsg(`<p>Bonjour 👋 Je suis votre analyste. Je surveille ${ASSETS.length} actifs et ${people.length} personnes influentes.</p>${best ? (() => { const p = probaOf(best.s).p; return `<p>Signal le plus marqué : <b>${esc(best.n)}</b>, avec <b class="${pcls(p)}">${p >= 50 ? p + " % de chances de hausse" : (100 - p) + " % de chances de baisse"} sur 24 h</b>. Demandez-moi pourquoi, ou touchez une suggestion.</p>` })() : ""}`, "bot");
  D.start(onPrice);
  window.addEventListener("vigie:news", e => pushNews(e.detail));
  window.addEventListener("vigie:data", () => { renderStatus(); renderWatch(); renderProba(); renderNews(); renderAlerts(); renderInsiders(); renderSources(); renderCalendar(); renderBacktest(); renderSent(D.sentiment ?? 50) });
  setInterval(tickUI, 1000);
  setInterval(renderStatus, 30000);
  emit("ready");
}


/* =====================================================================
   SUIVI DU PORTEFEUILLE SUR TELEGRAM
   L'application dépose une copie de votre portefeuille dans un message
   épinglé (silencieux) de votre discussion avec le bot. Le bot GitHub le
   lit et vous envoie un point au rythme choisi, même application fermée.
   ===================================================================== */
async function tgCall(method, params) {
  const u = `https://api.telegram.org/bot${CFG.tgToken}/${method}?` + new URLSearchParams(params);
  const r = await fetch(u); return r.json();
}
function pfSnapshot() {
  const pos = {}; for (const s in pf.pos) { const p = pf.pos[s]; pos[s] = [+p.q.toPrecision(8), +p.cost.toFixed(2), p.sl ? +p.sl.toPrecision(8) : 0, p.tp ? +p.tp.toPrecision(8) : 0] }
  return { v: 1, t: Date.now(), freq: CFG.tgReport || 0, cap: pf.cap, cash: +pf.cash.toFixed(2), pos };
}
let syncTimer = null;
function syncText(snap) {
  const n = (v, d) => nf(d).format(v), ex = h => h.replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
  const freq = { 60: "toutes les heures", 120: "toutes les 2 heures", 240: "toutes les 4 heures", 720: "matin et soir" }[snap.freq] || "désactivé";
  const rows = Object.entries(snap.pos).map(([s, [q, cost, sl, tp]]) => {
    const a = BY[s], unit = a && a.t === "stock" ? (q > 1 ? "actions" : "action") : (q > 1 ? "unités" : "unité");
    return `• <b>${s}</b> : ${n(q, q < 10 ? 2 : 0)} ${unit}, achat ${n(cost, 0)} $` + (sl ? ` · stop-loss à ${fp(sl)} $` : "") + (tp ? ` · objectif ${fp(tp)} $` : "");
  });
  const data = btoa(JSON.stringify(snap)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `📌 <b>Votre portefeuille Vigie</b> · suivi ${freq}\n💰 Liquidités : ${n(snap.cash, 0)} $\n${rows.join("\n") || "Aucune position ouverte."}\n\nℹ️ Ce message permet au bot de suivre votre portefeuille fictif. Il se met à jour tout seul : ne le supprimez pas.\n<a href="https://abraham402.github.io/Vigie/#s=${data}">Ouvrir Vigie</a>`;
}
async function syncPfToBot(now) {
  if (D.mode !== "live" || !CFG.tgToken || !CFG.tgChat) return false;
  if (!now) { clearTimeout(syncTimer); syncTimer = setTimeout(() => syncPfToBot(true), 4000); return }
  const text = syncText(pfSnapshot()), common = { chat_id: CFG.tgChat, text, parse_mode: "HTML", disable_web_page_preview: true };
  try {
    if (CFG.tgSyncId) { const r = await tgCall("editMessageText", { ...common, message_id: CFG.tgSyncId }); if (r.ok || /not modified/i.test(r.description || "")) return true }
    const r = await tgCall("sendMessage", { ...common, disable_notification: true });
    if (!r.ok) return false;
    CFG.tgSyncId = r.result.message_id; saveCfg();
    await tgCall("pinChatMessage", { chat_id: CFG.tgChat, message_id: CFG.tgSyncId, disable_notification: true });
    return true;
  } catch (e) { console.warn("synchronisation Telegram", e); return false }
}
on("trade", () => { if (CFG.tgReport) syncPfToBot() });
on("ready", () => { if (CFG.tgReport) syncPfToBot(); applyBotProtections() });
/* Stop-loss / objectifs atteints pendant que l'application était fermée (constatés par le bot) */
async function applyBotProtections() {
  if (D.mode !== "live") return;
  let st;
  try { const owner = location.hostname.endsWith("github.io") ? location.hostname.split(".")[0] : "Abraham402", repo = location.pathname.split("/")[1] || "Vigie"; st = await (await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/data/state/state.json?t=${Date.now()}`)).json() } catch (e) { return }
  const done = new Set(CFG.protDone || []); let n = 0;
  (st.prot_events || []).forEach(ev => {
    if (done.has(ev.id)) return;
    const p = pf.pos[ev.s], lvl = p && (ev.kind === "sl" ? p.sl : p.tp);
    if (p && lvl && Math.abs(lvl - ev.level) / ev.level < 1e-6) { execSell(ev.s, p.q * ev.px, ev.px, { setup: ev.kind === "sl" ? "Stop-loss automatique (bot)" : "Take-profit automatique (bot)", auto: true }); n++ }
    done.add(ev.id);
  });
  CFG.protDone = [...done].slice(-200); saveCfg();
  if (n) { toast(`${n} protection${n > 1 ? "s" : ""} déclenchée${n > 1 ? "s" : ""} pendant votre absence : vente${n > 1 ? "s" : ""} enregistrée${n > 1 ? "s" : ""}`); syncPfToBot() }
}
/* l'IA comprend les demandes de suivi : « envoie-moi un point toutes les heures sur Telegram » */
aiHooks.push(q => {
  const t = q.toLowerCase();
  if (!/telegram|notif|suivi|point|message|tiens[- ]moi|informe/.test(t) || !/heure|matin|soir|chaque|tous les|toutes les|arr[eê]t|stop|plus de|désactiv|suivi/.test(t)) return null;
  if (!/portef|invest|position|bitcoin|btc|wallet|suivi|point|avancée|évolution|gains?|pertes?/.test(t)) return null;
  let f = null;
  if (/arr[eê]t|stop|plus de|désactiv|coupe/.test(t)) f = 0;
  else if (/matin et soir|2 fois par jour|deux fois par jour/.test(t)) f = 720;
  else { const m = t.match(/(\d+)\s*h|(\d+)\s*heure/); f = m ? Math.min(720, Math.max(60, +(m[1] || m[2]) * 60)) : 60 }
  if (D.mode !== "live") return `<p>Le suivi sur Telegram fonctionne avec les données réelles. Quittez la démo (⚙️ → « passer au réel ») puis redemandez-moi.</p>`;
  if (!CFG.tgToken || !CFG.tgChat) return `<p>Pour vous envoyer le suivi, j'ai besoin de Telegram : ⚙️ → collez le jeton du bot → « Trouver mon chat id » → « Enregistrer ». Puis redemandez-moi.</p>`;
  CFG.tgReport = f; saveCfg();
  syncPfToBot(true).then(ok => toast(ok ? "Portefeuille transmis au bot ✓" : "Transmission au bot impossible : vérifiez Telegram dans ⚙️"));
  if (!f) return `<p>C'est noté : j'arrête les points sur le portefeuille dans Telegram. Les signaux et le résumé du matin continuent.</p>`;
  const lbl = f === 60 ? "toutes les heures" : f === 720 ? "matin et soir" : `toutes les ${f / 60} heures`;
  return `<p>C'est noté ✅ Je vous envoie un point sur votre portefeuille <b>${lbl}</b> dans votre discussion avec le bot Telegram : valeur totale, gain ou perte de chaque position depuis l'achat et depuis le dernier point, protections manquantes et avis du bot.</p><p class="muted">Le premier point arrive au prochain passage du bot (15 min maximum). La nuit (23 h – 7 h), les messages sont silencieux. Pour arrêter, dites-moi « arrête le suivi ».</p>`;
});


/* =====================================================================
   PORTEFEUILLE : GRAPHIQUE EN BOUGIES DES POSITIONS DÉTENUES
   ===================================================================== */
let posSel = null, posTf = LS.get("vigie-ptf", 3600), posChart, posSeries, posVol, posMk, posLines = [], posBars = [], posKey = "", posUnsub = null;
function posEffTf(a) { return D.mode === "live" && a.t === "stock" && posTf < 300 ? 300 : posTf }
function renderPosChart() {
  const card = $("#posChartCard"); if (!card) return;
  const held = Object.keys(pf.pos).filter(s => BY[s]);
  if (!held.length) { card.hidden = true; if (posUnsub) { posUnsub(); posUnsub = null } posKey = ""; return }
  card.hidden = false;
  if (!held.includes(posSel)) posSel = held.includes(current) ? current : held[0];
  $("#posTabs").innerHTML = held.map(s => { const p = pf.pos[s], g = (p.q * BY[s].price / p.cost - 1) * 100; return `<button data-pos="${s}" aria-pressed="${s === posSel}">${s}<small class="${cls(g)}">${fpct(g)}</small></button>` }).join("");
  $$("[data-pos]").forEach(b => b.onclick = () => { posSel = b.dataset.pos; renderPosChart() });
  $$("[data-ptf]").forEach(b => b.setAttribute("aria-pressed", +b.dataset.ptf === posTf));
  loadPosChart();
}
function nearestBarTime(t) {
  if (!posBars.length || t < posBars[0].time) return null;
  let lo = 0, hi = posBars.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (posBars[m].time <= t) lo = m; else hi = m - 1 }
  return posBars[lo].time;
}
function posDecorate() {
  if (!posSeries) return;
  const s = posSel, p = pf.pos[s], a = BY[s]; if (!p || !a) return;
  posLines.forEach(l => { try { posSeries.removePriceLine(l) } catch (e) { } }); posLines = [];
  const pru = p.cost / p.q;
  posLines.push(posSeries.createPriceLine({ price: pru, color: C.blue, lineWidth: 2, lineStyle: 2, axisLabelVisible: true, title: "Prix moyen" }));
  if (p.sl) posLines.push(posSeries.createPriceLine({ price: p.sl, color: C.down, lineWidth: 2, lineStyle: 0, axisLabelVisible: true, title: "Stop" }));
  if (p.tp) posLines.push(posSeries.createPriceLine({ price: p.tp, color: C.up, lineWidth: 2, lineStyle: 0, axisLabelVisible: true, title: "Objectif" }));
  const mk = [];
  pf.hist.filter(h => h.s === s).forEach(h => { const t = nearestBarTime(Math.floor(h.t / 1000)); if (t == null) return; mk.push(h.side === "Achat" ? { time: t, position: "belowBar", color: C.blue, shape: "arrowUp", text: "Achat" } : { time: t, position: "aboveBar", color: C.amber, shape: "arrowDown", text: "Vente" }) });
  mk.sort((x, y) => x.time - y.time);
  posMk.setMarkers(mk);
  const val = p.q * a.price, g = val - p.cost;
  $("#posInfo").innerHTML = `<b>${esc(a.n)}</b> à <b>${fp(a.price)} $</b>${a.delayed ? " (différé)" : ""} · votre prix moyen <b>${fp(pru)} $</b> · <span class="${cls(g)}">${g >= 0 ? "+" : ""}${fusd(g)} (${fpct(g / p.cost * 100)})</span>` +
    (p.sl ? ` · stop à ${fp(p.sl)} $ (${fpct((p.sl / a.price - 1) * 100)})` : ` · <span class="flat">sans stop-loss</span>`) + (p.tp ? ` · objectif ${fp(p.tp)} $ (${fpct((p.tp / a.price - 1) * 100)})` : "");
}
async function loadPosChart() {
  if (!LC || !posSel) return;
  const a = BY[posSel], t = posEffTf(a), key = posSel + ":" + t;
  if (!posChart) {
    posChart = LC.createChart($("#poschart"), { ...baseChartOpts(), timeScale: { borderColor: C.line, timeVisible: true, rightOffset: 4 } });
    posSeries = posChart.addSeries(LC.CandlestickSeries, CS);
    posVol = posChart.addSeries(LC.HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "", lastValueVisible: false, priceLineVisible: false });
    posVol.priceScale().applyOptions({ scaleMargins: { top: .85, bottom: 0 } });
    posMk = LC.createSeriesMarkers(posSeries, []);
  }
  if (key === posKey) { posDecorate(); return }
  posKey = key;
  let data = [];
  try { data = cleanBars(await D.getBars(a, t)) } catch (e) { }
  if (posKey !== key) return;
  posBars = data;
  posSeries.setData(data.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
  posVol.setData(data.map(volPoint));
  posChart.applyOptions({ timeScale: { timeVisible: t < 86400, secondsVisible: false } });
  posChart.timeScale().setVisibleLogicalRange({ from: data.length - (innerWidth < 600 ? 60 : 110), to: data.length + 3 });
  posDecorate();
  if (posUnsub) { posUnsub(); posUnsub = null }
  if (D.klineStream && a.t === "crypto") posUnsub = D.klineStream(a.s, t, k => {
    if (!posBars.length || k.time < posBars[posBars.length - 1].time) return;
    if (k.time > posBars[posBars.length - 1].time) posBars.push(k); else Object.assign(posBars[posBars.length - 1], k);
    posSeries.update({ time: k.time, open: k.open, high: k.high, low: k.low, close: k.close }); posVol.update(volPoint(k));
  });
}
/* sans flux de bougies (démo, actions) : la dernière bougie suit le prix */
setInterval(() => {
  if (!posSeries || !posBars.length || !posSel || !BY[posSel] || posUnsub) return;
  const b = posBars[posBars.length - 1], px = BY[posSel].price; if (!px) return;
  b.close = px; b.high = Math.max(b.high, px); b.low = Math.min(b.low, px);
  posSeries.update({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close });
}, 1000);
setInterval(() => { if (posSeries && pf && posSel && pf.pos[posSel]) { posDecorate(); const tabs = $$("[data-pos]"); tabs.forEach(b => { const p = pf.pos[b.dataset.pos], a = BY[b.dataset.pos]; if (p && a) { const g = (p.q * a.price / p.cost - 1) * 100, sm = b.querySelector("small"); sm.textContent = fpct(g); sm.className = cls(g) } }) } }, 5000);
on("ready", () => {
  $$("[data-ptf]").forEach(b => b.onclick = () => { posTf = +b.dataset.ptf; LS.set("vigie-ptf", posTf); renderPosChart() });
  renderPosChart();
});
on("view", v => { if (v === "pf" && posChart) requestAnimationFrame(() => posChart.timeScale().scrollToRealTime()) });


/* =====================================================================
   OUTILS « DAY TRADER » (inspirés de github.com/Jakeschincariol/day-trader-skill, MIT)
   ===================================================================== */
const SETUP_FR = {
  breakout_20d: ["Cassure 20 jours", "La clôture dépasse toutes celles des 20 séances précédentes : les acheteurs prennent le dessus."],
  bull_flag: ["Drapeau haussier", "Forte hausse puis 5 séances de pause serrée : souvent une respiration avant de repartir."],
  reclaim_ma20: ["Retour sur la moyenne 20 j", "Le prix repasse au-dessus de sa moyenne des 20 derniers jours : la tendance courte s'améliore."],
  oversold: ["Survendu", "Forte baisse en peu de temps (RSI < 30) : un rebond est possible, mais la baisse peut continuer."],
  oversold_bounce: ["Rebond après survente", "Le RSI était sous 30 et le prix remonte : premier signe de rebond."]
};
function renderScanner() {
  const el = $("#scanner"); if (!el) return;
  const hits = D.scanner || [];
  if (!hits.length) { el.innerHTML = `<div class="empty">Aucune figure technique notable sur les dernières séances.</div>`; return }
  el.innerHTML = hits.slice(0, 12).map(h => `<button class="scan-item" data-scan="${esc(h.s)}"><span><b>${esc(h.s)}</b> <span class="muted">${esc(h.n)}</span>${h.mine ? ' <span class="chip ai">suivi</span>' : ""}<span class="scan-tags">${h.tags.map(t => `<span class="chip ${t.startsWith("oversold") ? "flat" : "up"}">${SETUP_FR[t] ? SETUP_FR[t][0] : t}</span>`).join("")}</span></span><span class="num muted" style="text-align:right">${fp(h.px)} $${h.rsi != null ? `<br><small>RSI ${nf(0).format(h.rsi)}</small>` : ""}</span><span class="why">${SETUP_FR[h.tags[0]] ? SETUP_FR[h.tags[0]][1] : ""}</span></button>`).join("");
  $$("[data-scan]").forEach(b => b.onclick = () => { const s = b.dataset.scan; if (BY[s]) { selectAsset(s); go("chart") } else toast(`${s} n'est pas dans votre watchlist : le scanner le signale à titre d'exemple`) });
}
on("ready", renderScanner);
window.addEventListener("vigie:data", renderScanner);

/* Stop conseillé selon la volatilité (méthode ATR de trader-exit) */
function atrStop(s, k = 1.5) { const a = (D.atr || {})[s], px = BY[s] && BY[s].price; if (!a || !a.d || !px) return null; const stop = px - k * a.d; return stop > 0 ? { stop, pct: (stop / px - 1) * 100, atr: a.d } : null }

/* Time Machine : 4 000 scénarios rejoués à partir des bougies horaires passées de l'actif */
const tmBars = {};
async function tmOdds(s, entry, sl, tp) {
  const a = BY[s]; if (!a || !(sl > 0) || !(tp > 0) || sl >= entry || tp <= entry) return null;
  if (!tmBars[s]) { try { tmBars[s] = cleanBars(await D.getBars(a, 3600)) } catch (e) { return null } }
  const b = tmBars[s]; if (b.length < 100) return null;
  const R = []; for (let i = 1; i < b.length; i++) { const pc = b[i - 1].close; if (pc > 0) R.push([b[i].high / pc, b[i].low / pc, b[i].close / pc]) }
  const H = a.t === "crypto" ? 168 : 35, N = 4000; let T = 0, S = 0, end = [];
  let seed = 19; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let n = 0; n < N; n++) {
    let px = entry, done = 0;
    for (let k = 0; k < H; k++) {
      const r = R[Math.floor(rnd() * R.length)], lo = px * r[1], hi = px * r[0];
      if (lo <= sl) { S++; done = 1; break }   // stop et objectif dans la même bougie : on compte le stop (prudent)
      if (hi >= tp) { T++; done = 1; break }
      px *= r[2];
    }
    if (!done) end.push(px);
  }
  end.sort((x, y) => x - y);
  return { pT: T / N * 100, pS: S / N * 100, pN: (N - T - S) / N * 100, N, days: 7, med: end.length ? end[end.length >> 1] : null, bars: R.length };
}
function oddsHTML(o, s) {
  if (!o) return "";
  const verdict = o.pT > o.pS * 1.3 ? "plutôt favorable" : o.pS > o.pT * 1.3 ? "plutôt défavorable" : "proche d'un pile ou face";
  return `<div class="muted" style="font-size:12px;margin-top:10px"><b style="color:var(--text)">Time Machine</b> · ${nf(0).format(o.N)} scénarios rejoués avec les ${nf(0).format(o.bars)} dernières heures de ${esc(s)}, sur ${o.days} jours :</div>
  <div class="oddsbar"><span style="width:${o.pT}%;background:var(--up)"></span><span style="width:${o.pN}%;background:var(--line-2)"></span><span style="width:${o.pS}%;background:var(--down)"></span></div>
  <div class="odds num"><div><b class="up">${nf(0).format(o.pT)} %</b><small>objectif d'abord</small></div><div><b>${nf(0).format(o.pN)} %</b><small>ni l'un ni l'autre</small></div><div><b class="down">${nf(0).format(o.pS)} %</b><small>stop d'abord</small></div></div>
  <div class="muted" style="font-size:11px;margin-top:6px">Verdict : ${verdict}. C'est une simulation fondée sur le passé récent, pas une prédiction.</div>`;
}
/* branchement dans la fenêtre « Protéger » et dans le graphique des positions */
const _openProtect = openProtect;
openProtect = function (s) {
  _openProtect(s);
  const box = $("#pInfo"); if (!box) return;
  const st = atrStop(s);
  if (st) { const btn = document.createElement("div"); btn.className = "quick"; btn.style.marginTop = "6px"; btn.innerHTML = `<button type="button" id="pAtr" style="flex:1">Stop conseillé : ${fp(st.stop)} $ (${fpct(st.pct)}) · 1,5 × ATR</button>`; $("#pSL").closest(".fld").after(btn); $("#pAtr").onclick = () => { $("#pSL").value = +st.stop.toFixed(dec(BY[s].price)); $("#pSL").oninput() } }
  const odds = document.createElement("div"); odds.id = "pOdds"; box.after(odds);
  let t = null; const upd = () => { clearTimeout(t); t = setTimeout(async () => { const o = await tmOdds(s, BY[s].price, +$("#pSL").value, +$("#pTP").value); const el = $("#pOdds"); if (el) el.innerHTML = o ? oddsHTML(o, s) : `<div class="muted" style="font-size:12px;margin-top:8px">Indiquez un stop-loss et un objectif : la Time Machine calculera vos chances d'atteindre l'objectif avant le stop.</div>` }, 300) };
  ["#pSL", "#pTP"].forEach(id => { const el = $(id), prev = el.oninput; el.oninput = () => { prev && prev(); upd() } });
  $$("[data-psl],[data-ptp]").forEach(b => { const prev = b.onclick; b.onclick = () => { prev && prev(); upd() } });
  upd();
};
const _posDecorate = posDecorate;
let posOddsKey = "", posOddsHtml = "";
posDecorate = function () {
  _posDecorate();
  const s = posSel, p = pf.pos[s]; if (!p || !p.sl || !p.tp) return;
  const key = `${s}:${p.sl}:${p.tp}`;
  if (key === posOddsKey) { $("#posInfo").insertAdjacentHTML("beforeend", posOddsHtml); return }
  posOddsKey = key; posOddsHtml = "";
  tmOdds(s, BY[s].price, p.sl, p.tp).then(o => { if (o && posSel === s) { posOddsHtml = `<br>🎲 Time Machine : <b class="up">${nf(0).format(o.pT)} %</b> objectif d'abord · <b class="down">${nf(0).format(o.pS)} %</b> stop d'abord (7 j)`; $("#posInfo").insertAdjacentHTML("beforeend", posOddsHtml) } });
};
