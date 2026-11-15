"use strict";
/* =====================================================================
   Vigie — source de données RÉELLES
   - Crypto : API publique Binance (REST + WebSocket), sans compte
   - Actions, probabilités, actus, initiés, calendrier : fichiers JSON
     produits toutes les 15 min par le bot Python (GitHub Actions)
   ===================================================================== */
(function () {
  const REST = ["https://data-api.binance.vision", "https://api.binance.com"];
  const WSB = ["wss://data-stream.binance.vision", "wss://stream.binance.com:9443"];
  const IV = { 1: "1s", 60: "1m", 300: "5m", 900: "15m", 3600: "1h", 14400: "4h", 86400: "1d" };
  const DEFAULT = [["BTC", "Bitcoin", "crypto"], ["ETH", "Ethereum", "crypto"], ["SOL", "Solana", "crypto"], ["BNB", "BNB", "crypto"], ["XRP", "XRP", "crypto"], ["NVDA", "Nvidia", "stock"], ["AAPL", "Apple", "stock"], ["TSLA", "Tesla", "stock"], ["MSFT", "Microsoft", "stock"], ["SPY", "S&P 500 (ETF)", "stock"]];
  const sym = s => s + "USDT";
  let restBase = REST[0], wsBase = WSB[0], binanceOk = false, wsOpen = false;

  async function getJSON(url, timeout = 12000) {
    const c = new AbortController(), t = setTimeout(() => c.abort(), timeout);
    try { const r = await fetch(url, { signal: c.signal, cache: "no-store" }); if (!r.ok) throw new Error(r.status); return await r.json() } finally { clearTimeout(t) }
  }
  const dataUrl = f => `data/${f}?t=${Math.floor(Date.now() / 60000)}`;
  async function binance(path) {
    for (const b of [restBase, ...REST.filter(x => x !== restBase)]) {
      try { const j = await getJSON(b + path, 8000); restBase = b; binanceOk = true; return j } catch (e) { }
    }
    binanceOk = false; throw new Error("Binance injoignable");
  }
  function volTxt(v) { return !v ? "—" : v >= 1e9 ? (v / 1e9).toFixed(1).replace(".", ",") + " Md$" : (v / 1e6).toFixed(0) + " M$" }
  const rowsToBars = rows => (rows || []).map(r => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], value: r[5] }));

  const L = {
    mode: "live", assets: [], proba: {}, factors: {}, news: [], alerts: [], insiders: [], calendar: [], sources: [], sentiment: 50, status: {}, summary: null, people: null, _bt: {}, _market: {},
    wsOk: () => wsOpen,
    backtest(s) {
      const b = this._bt[s]; if (!b) return null;
      return { win: b.win, n: b.n, live: b.live, calib: b.calib, equity: (b.equity || []).map(([time, value]) => ({ time, value })), bh: (b.bh || []).map(([time, value]) => ({ time, value })) };
    },
    async getBars(a, tf) {
      if (a.t === "crypto") {
        try { const k = await binance(`/api/v3/klines?symbol=${sym(a.s)}&interval=${IV[tf]}&limit=${tf === 1 ? 600 : 500}`); return k.map(r => ({ time: Math.floor(r[0] / 1000), open: +r[1], high: +r[2], low: +r[3], close: +r[4], value: +r[5] })) }
        catch (e) { const m = this._market[a.s]; const t = tf < 300 ? 300 : tf; return rowsToBars(m && m.bars && m.bars[t]) }
      }
      const m = this._market[a.s]; return rowsToBars(m && m.bars && (m.bars[tf] || m.bars[300]));
    },
    start(onPrice) {
      const crypto = this.assets.filter(a => a.t === "crypto");
      const connect = (i = 0) => {
        const url = `${WSB[i % WSB.length]}/stream?streams=${crypto.map(a => sym(a.s).toLowerCase() + "@miniTicker").join("/")}`;
        let ws; try { ws = new WebSocket(url) } catch (e) { return setTimeout(() => connect(i + 1), 5000) }
        ws.onopen = () => { wsOpen = true; wsBase = WSB[i % WSB.length] };
        ws.onmessage = ev => { const d = JSON.parse(ev.data).data; if (!d) return; const a = this.assets.find(x => sym(x.s) === d.s); if (!a) return; a.price = +d.c; a.open = +d.o; a.hi = +d.h; a.lo = +d.l; a.volTxt = volTxt(+d.q); a.delayed = false; if (a.spark && a.spark.length) a.spark[a.spark.length - 1] = a.price; onPrice(a.s) };
        ws.onclose = () => { wsOpen = false; setTimeout(() => connect(i + 1), 4000) };
        ws.onerror = () => { try { ws.close() } catch (e) { } };
      };
      if (crypto.length) connect(0);
      // rafraîchissement des données du bot
      setInterval(() => this.refresh(true), 3 * 60000);
      document.addEventListener("visibilitychange", () => { if (!document.hidden) this.refresh(true) });
    },
    klineStream(s, tf, cb) {
      let ws, closed = false, i = 0;
      const open = () => {
        if (closed) return;
        ws = new WebSocket(`${WSB[i % WSB.length]}/ws/${sym(s).toLowerCase()}@kline_${IV[tf]}`);
        ws.onmessage = ev => { const k = JSON.parse(ev.data).k; if (k) cb({ time: Math.floor(k.t / 1000), open: +k.o, high: +k.h, low: +k.l, close: +k.c, value: +k.v }) };
        ws.onclose = () => { if (!closed) { i++; setTimeout(open, 3000) } };
      };
      open();
      return () => { closed = true; try { ws && ws.close() } catch (e) { } };
    },
    book(s, onBook, onTrade) {
      const a = this.assets.find(x => x.s === s); if (!a || a.t !== "crypto") return () => { };
      let ws, closed = false, i = 0;
      const min = s === "BTC" ? 250000 : s === "ETH" ? 150000 : 60000;
      const open = () => {
        if (closed) return;
        const n = sym(s).toLowerCase();
        ws = new WebSocket(`${WSB[i % WSB.length]}/stream?streams=${n}@depth20@1000ms/${n}@aggTrade`);
        ws.onmessage = ev => {
          const m = JSON.parse(ev.data), d = m.data; if (!d) return;
          if (m.stream.includes("depth")) onBook({ bids: d.bids.map(x => [+x[0], +x[1]]), asks: d.asks.map(x => [+x[0], +x[1]]) });
          else { const p = +d.p, q = +d.q; if (p * q >= min) onTrade({ side: d.m ? "sell" : "buy", p, q, t: d.T }) }
        };
        ws.onclose = () => { if (!closed) { i++; setTimeout(open, 3000) } };
      };
      open();
      return () => { closed = true; try { ws && ws.close() } catch (e) { } };
    },
    async refresh(notify) {
      const [mk, an, fd] = await Promise.all(["market.json", "analysis.json", "feed.json"].map(f => getJSON(dataUrl(f)).catch(() => null)));
      if (mk && mk.assets) {
        this._market = mk.assets;
        this.assets.forEach(a => { const m = mk.assets[a.s]; if (!m) return; if (a.t === "stock" || !wsOpen) { a.price = m.price; a.open = m.open; a.hi = m.hi; a.lo = m.lo; a.volTxt = volTxt(m.volume_usd); a.delayed = a.t === "stock" || !binanceOk } a.spark = (m.spark || []).slice(); if (a.spark.length) a.spark[a.spark.length - 1] = a.price });
      }
      if (an) {
        this.proba = {}; Object.entries(an.proba || {}).forEach(([s, P]) => this.proba[s] = P.map(([p, c]) => ({ p, c })));
        this.factors = an.factors || {}; this._bt = an.backtest || {}; this.sentiment = an.sentiment ?? 50; this.summary = an.summary || null; this.status = an.status || {};
      }
      if (fd) {
        const known = new Set(this.news.map(n => n.id)), fresh = notify ? (fd.news || []).filter(n => !known.has(n.id)) : [];
        this.alerts = fd.alerts || []; this.insiders = fd.insiders || []; this.calendar = fd.calendar || []; this.sources = fd.sources || []; this.people = fd.people || null;
        if (fresh.length && fresh.length <= 3) { this.news = (fd.news || []).filter(n => known.has(n.id)); fresh.reverse().forEach(n => window.dispatchEvent(new CustomEvent("vigie:news", { detail: n }))) }
        else this.news = fd.news || [];
      }
      if (notify) window.dispatchEvent(new Event("vigie:data"));
    }
  };

  window.LIVE = {
    async load() {
      let mk = null; try { mk = await getJSON(dataUrl("market.json")) } catch (e) { }
      const list = mk && mk.list ? mk.list : DEFAULT;
      L.assets = list.map(([s, n, t]) => ({ s, n, t, price: null, open: null, hi: null, lo: null, spark: [], volTxt: "—", delayed: t === "stock" }));
      await L.refresh(false);
      // prix crypto initiaux depuis Binance
      const crypto = L.assets.filter(a => a.t === "crypto");
      try {
        const T = await binance(`/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(crypto.map(a => sym(a.s))))}`);
        T.forEach(t => { const a = crypto.find(x => sym(x.s) === t.symbol); if (!a) return; a.price = +t.lastPrice; a.open = +t.openPrice; a.hi = +t.highPrice; a.lo = +t.lowPrice; a.volTxt = volTxt(+t.quoteVolume); a.delayed = false; if (a.spark.length) a.spark[a.spark.length - 1] = a.price });
      } catch (e) { console.warn("Binance indisponible, repli sur les données du bot", e) }
      // sans données du bot ni Binance pour un actif : on le retire
      L.assets = L.assets.filter(a => a.price != null);
      if (!L.assets.length) throw new Error("Aucune donnée disponible");
      // sans sparkline : on la construit avec les bougies 1 h
      await Promise.all(L.assets.filter(a => a.t === "crypto" && a.spark.length < 2).map(async a => { try { const b = await L.getBars(a, 3600); a.spark = b.slice(-25).map(x => x.close) } catch (e) { } }));
      return L;
    }
  };
})();
