"use strict";
/* =====================================================================
   Vigie — source de données FICTIVES (mode démo)
   Expose window.DEMO avec la même interface que la source réelle (live.js)
   ===================================================================== */
(function(){
const rng=seed=>function(){seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296};
const hash=s=>{let h=2166136261;for(const c of s)h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0};
const gauss=r=>Math.sqrt(-2*Math.log(r()+1e-9))*Math.cos(2*Math.PI*r());

const ASSETS=[
 {s:"BTC",n:"Bitcoin",t:"crypto",p:98420,v:.018,volTxt:"31,2 Md$"},
 {s:"ETH",n:"Ethereum",t:"crypto",p:3645,v:.022,volTxt:"14,8 Md$"},
 {s:"SOL",n:"Solana",t:"crypto",p:212.4,v:.03,volTxt:"4,1 Md$"},
 {s:"BNB",n:"BNB",t:"crypto",p:690.2,v:.017,volTxt:"1,9 Md$"},
 {s:"XRP",n:"XRP",t:"crypto",p:2.412,v:.028,volTxt:"3,3 Md$"},
 {s:"NVDA",n:"Nvidia",t:"stock",p:187.3,v:.021,volTxt:"38,5 Md$"},
 {s:"AAPL",n:"Apple",t:"stock",p:241.6,v:.012,volTxt:"12,1 Md$"},
 {s:"TSLA",n:"Tesla",t:"stock",p:352.8,v:.03,volTxt:"27,4 Md$"},
 {s:"MSFT",n:"Microsoft",t:"stock",p:468.1,v:.011,volTxt:"9,6 Md$"},
 {s:"SPY",n:"S&P 500 (ETF)",t:"stock",p:612.5,v:.008,volTxt:"33,0 Md$"}
];
const PROBA={};
ASSETS.forEach(a=>{const r=rng(hash(a.s+"p"));const bias=(r()-.42)*30;PROBA[a.s]=[1,24,168].map((h,i)=>({p:Math.round(Math.min(84,Math.max(18,50+bias*(.5+i*.35)+(r()-.5)*10))),c:+(.45+r()*.4).toFixed(2)}))});
PROBA.BTC=[{p:57,c:.52},{p:64,c:.71},{p:69,c:.66}];
PROBA.TSLA=[{p:44,c:.48},{p:36,c:.69},{p:41,c:.55}];
ASSETS.forEach(a=>{a.open=a.p*(1-(PROBA[a.s][1].p-50)/1500-(rng(hash(a.s+"o"))()-.5)*.03);a.price=a.p;a.hi=Math.max(a.p,a.open)*1.012;a.lo=Math.min(a.p,a.open)*.988;a.spark=[];const r=rng(hash(a.s+"s"));let x=a.open;for(let i=0;i<24;i++){x*=1+gauss(r)*a.v*.25+(a.p/a.open-1)/24;a.spark.push(x)}a.spark.push(a.p)});

const FACTORS={
 BTC:[["Technique",.42,"EMA 20 au-dessus de l'EMA 50, RSI 61 (élan sans excès)"],["Volume",.31,"Volume +38 % vs moyenne 20 jours sur les bougies vertes"],["Volatilité",-.12,"Volatilité en hausse : mouvements plus brusques possibles"],["Sentiment actus",.36,"74 % des articles des 6 dernières heures sont positifs"],["Personnes influentes",.22,"Déclaration favorable d'un dirigeant d'ETF relayée par Reuters"]],
 TSLA:[["Technique",-.38,"Prix sous l'EMA 50, cassure d'un support à 360 $"],["Volume",-.2,"Volume élevé sur les bougies rouges"],["Volatilité",-.25,"Volatilité 30 j au plus haut depuis 3 mois"],["Sentiment actus",-.41,"Rappel de véhicules et objectifs de livraisons revus en baisse"],["Personnes influentes",.12,"Message optimiste du PDG sur les robotaxis, peu suivi d'effet"]]
};
ASSETS.forEach(a=>{if(FACTORS[a.s])return;const r=rng(hash(a.s+"f")),b=(PROBA[a.s][1].p-50)/50;FACTORS[a.s]=[["Technique",b*.8+(r()-.5)*.3,"Croisement des moyennes mobiles et RSI"],["Volume",b*.5+(r()-.5)*.3,"Volume comparé à la moyenne 20 jours"],["Volatilité",-(r()*.3),"Écart-type des rendements sur 30 jours"],["Sentiment actus",b*.7+(r()-.5)*.2,"Score moyen des articles des 6 dernières heures"],["Personnes influentes",(r()-.5)*.4,"Déclarations récentes relayées par les flux suivis"]]});

function backtest(s){
  const r=rng(hash(s+"bt")),win=[54+r()*4,57+r()*5,59+r()*6];
  const eq=[],bh=[];let x=100,y=100;const t0=Math.floor(Date.now()/864e5)-730;
  for(let i=0;i<104;i++){const m=gauss(r)*.045+.004;y*=1+m;x*=1+m*.55+Math.abs(gauss(r))*.006+.002;const time=(t0+i*7)*86400;eq.push({time,value:x});bh.push({time,value:y})}
  return{win,n:1800+Math.floor(r()*900),equity:eq,bh,calib:[50,60,70,80].map(p=>[p,Math.round(p+(r()-.6)*6)]),live:{n:0,win:null}};
}
const now=Date.now(),M=60000;
const NEWS=[
 {t:now-4*M,src:"fed",cat:"official",who:"Président de la Fed · discours",txt:"« L'inflation se rapproche de notre objectif ; une baisse de taux en décembre reste sur la table. »",asset:"SPY",s:.62,p:61,ai:"Ton accommodant : des taux plus bas soutiennent généralement les actions et la crypto."},
 {t:now-11*M,src:"reuters",cat:"crypto",who:"Dirigeant d'un grand gestionnaire d'ETF",txt:"Les ETF Bitcoin au comptant enregistrent 1,1 Md$ d'entrées nettes sur la semaine, un record depuis juin.",asset:"BTC",s:.78,p:64,ai:"Forte demande institutionnelle : historiquement suivie d'une hausse sur 24 à 72 h dans 63 % des cas."},
 {t:now-19*M,src:"reddit",cat:"social",who:"r/wallstreetbets · 4 200 votes",txt:"Fil de discussion très actif sur les puts Tesla avant les chiffres de livraisons.",asset:"TSLA",s:-.55,p:38,ai:"Pessimisme marqué des particuliers ; à prendre avec prudence, Reddit amplifie souvent les mouvements."},
 {t:now-27*M,src:"cnbc",cat:"stock",who:"PDG de Nvidia · conférence",txt:"« La demande pour nos puces dépasse l'offre jusqu'à la fin de l'année prochaine. »",asset:"NVDA",s:.7,p:66,ai:"Signal positif sur les revenus futurs ; le marché l'attendait en partie, l'effet peut être limité."},
 {t:now-42*M,src:"sec",cat:"official",who:"Communiqué officiel",txt:"La SEC ouvre une consultation publique sur un ETF Solana au comptant.",asset:"SOL",s:.48,p:59,ai:"Étape administrative, pas une validation, mais le marché réagit souvent positivement à ce type d'annonce."},
 {t:now-55*M,src:"coindesk",cat:"crypto",who:"Analyste on-chain",txt:"Grosses sorties d'ETH des plateformes d'échange vers des portefeuilles de stockage.",asset:"ETH",s:.35,p:57,ai:"Moins d'ETH disponibles à la vente : légèrement positif pour le prix."},
 {t:now-71*M,src:"gnews",cat:"stock",who:"Sénateur américain · interview",txt:"Appel à de nouveaux droits de douane sur l'électronique importée.",asset:"AAPL",s:-.44,p:43,ai:"Risque sur les marges d'Apple, dont une grande partie de la production est en Asie."},
 {t:now-96*M,src:"yahoo",cat:"stock",who:"Résultats trimestriels",txt:"Microsoft dépasse les attentes sur le cloud (+31 % sur un an).",asset:"MSFT",s:.66,p:62,ai:"Croissance du cloud supérieure aux prévisions : moteur principal de l'action."}
];
const LIVE_NEWS=[
 {src:"reddit",cat:"social",who:"r/CryptoCurrency · 2 900 votes",txt:"Rumeur d'intégration de Solana par un grand service de paiement.",asset:"SOL",s:.52,p:60,ai:"Rumeur non confirmée : le bot réduit le poids de cette source (fiabilité historique de 41 %)."},
 {src:"reuters",cat:"stock",who:"Ministre de l'Économie · déclaration",txt:"Accord commercial préliminaire sur les semi-conducteurs.",asset:"NVDA",s:.58,p:63,ai:"Moins de risque sur la chaîne d'approvisionnement : positif pour Nvidia."}
];
const ALERTS=[
 {t:now-26*M,a:"BTC",p:64,c:.71,src:"Reuters + volume",sum:"Entrées record dans les ETF et volume en hausse : le bot voit 64 % de chances de hausse sur 24 h."},
 {t:now-60*M,a:"TSLA",p:36,c:.69,src:"Reddit + technique",sum:"Cassure du support à 360 $ et sentiment négatif : 64 % de chances de baisse sur 24 h."},
 {t:now-170*M,a:"SPY",p:61,c:.6,src:"Discours Fed",sum:"Ton accommodant de la Fed : léger biais haussier sur les indices."}
];
const INSIDERS=[["12 nov.","Sén. A. Exemple","Congrès","NVDA","Achat","15 k–50 k $"],["11 nov.","Directeur financier","Initié · Form 4","AAPL","Vente","2,1 M$"],["8 nov.","Rep. B. Démo","Congrès","MSFT","Achat","50 k–100 k $"],["7 nov.","Administrateur","Initié · Form 4","TSLA","Vente","8,4 M$"],["5 nov.","Rep. C. Fictif","Congrès","SPY","Vente","1 k–15 k $"]];
const D0=new Date();D0.setHours(0,0,0,0);const day=k=>D0.getTime()+k*864e5;
const CALENDAR=[
 {t:day(1)+14.5*36e5,ev:"Indice manufacturier Empire State",c:"US",imp:1,cons:"−2,0",prev:"−4,8",assets:"SPY"},
 {t:day(2)+14.5*36e5,ev:"Ventes au détail",c:"US",imp:2,cons:"+0,3 %",prev:"+0,6 %",assets:"SPY"},
 {t:day(3)+20*36e5,ev:"Compte rendu de la Fed (FOMC)",c:"US",imp:3,cons:"",prev:"",assets:"SPY, BTC"},
 {t:day(3)+22.33*36e5,ev:"Résultats trimestriels Nvidia",c:"US",imp:3,cons:"BPA 1,12 $",prev:"1,05 $",assets:"NVDA"},
 {t:day(4)+14.5*36e5,ev:"Inscriptions au chômage",c:"US",imp:2,cons:"222 k",prev:"217 k",assets:"SPY"},
 {t:day(5)+16*36e5,ev:"Confiance des consommateurs (Michigan)",c:"US",imp:2,cons:"71,8",prev:"70,5",assets:"SPY"},
 {t:day(9)+14.5*36e5,ev:"Inflation PCE",c:"US",imp:3,cons:"2,6 %",prev:"2,7 %",assets:"SPY, BTC"}
];
const SOURCES=[["Communiqués de la Fed",42,71],["Reuters",318,64],["CoinDesk",205,58],["CNBC",188,57],["Yahoo Finance",240,55],["Google News",410,53],["Reddit r/wallstreetbets",520,46],["Reddit r/CryptoCurrency",470,44]];

function genBars(a,tf,n=240){
  const r=rng(hash(a.s+tf)),step=tf,vol=a.v*Math.sqrt(tf/86400)*(tf<3600?2.5:1.3);
  let x=1;const arr=[];for(let i=0;i<n;i++){x*=Math.exp(gauss(r)*vol+Math.sin(i/23)*vol*.12);arr.push(x)}
  const k=a.price/arr[n-1],nowS=Math.floor(Date.now()/1000/step)*step;let prev=arr[0]*k*(1-gauss(r)*vol*.3);
  return arr.map((c,i)=>{c*=k;const o=prev;prev=c;const hi=Math.max(o,c)*(1+Math.abs(gauss(r))*vol*.45),lo=Math.min(o,c)*(1-Math.abs(gauss(r))*vol*.45);return{time:nowS-(n-1-i)*step,open:o,high:hi,low:lo,close:c,value:(.4+r()*1.2)*(1+Math.abs(c/o-1)*40)}});
}

const SCANNER=[
 {s:"BTC",n:"Bitcoin",t:"crypto",mine:true,tags:["breakout_20d"],px:98420,rsi:63.2},
 {s:"TSLA",n:"Tesla",t:"stock",mine:true,tags:["oversold"],px:352.8,rsi:27.9},
 {s:"PLTR",n:"Palantir",t:"stock",mine:false,tags:["bull_flag"],px:84.1,rsi:58.4},
 {s:"AMD",n:"AMD",t:"stock",mine:false,tags:["reclaim_ma20"],px:162.3,rsi:51.0},
 {s:"DOGE",n:"Dogecoin",t:"crypto",mine:false,tags:["oversold_bounce"],px:0.18,rsi:31.5}];
const ATR={};ASSETS.forEach(a=>{ATR[a.s]={d:a.p*a.v,h:a.p*a.v/4}});
window.DEMO={
  scanner:SCANNER,atr:ATR,
  mode:"demo",
  assets:ASSETS,proba:PROBA,factors:FACTORS,news:NEWS,alerts:ALERTS,insiders:INSIDERS,calendar:CALENDAR,sources:SOURCES,
  sentiment:58,status:{demo:true},
  backtest:s=>backtest(s),
  getBars:(a,tf)=>Promise.resolve(genBars(a,tf)),
  /* flux simulé : appelle onPrice(sym) quand un prix change */
  start(onPrice){
    setInterval(()=>{ASSETS.forEach(a=>{a.price*=1+gauss(Math.random)*a.v*Math.sqrt(.25/86400)*2.5+(PROBA[a.s][0].p-50)*a.v*1e-6;a.hi=Math.max(a.hi,a.price);a.lo=Math.min(a.lo,a.price);a.spark[a.spark.length-1]=a.price;onPrice(a.s)})},250);
    let i=0;const push=()=>{if(i<LIVE_NEWS.length)window.dispatchEvent(new CustomEvent("vigie:news",{detail:{...LIVE_NEWS[i++],t:Date.now()}}))};
    setTimeout(push,9000);setTimeout(push,30000);
  },
  /* bougie du graphique : en démo, construite à partir du prix simulé */
  klineStream:null,
  /* carnet d'ordres simulé */
  book(sym,onBook,onTrade){
    const a=ASSETS.find(x=>x.s===sym);if(!a||a.t!=="crypto")return()=>{};
    const tick=()=>{const p=a.price,st=p*.00004,asks=[],bids=[];for(let i=0;i<10;i++){asks.push([p+st*(i+.5+Math.random()*.6),Math.random()**2*3+.05]);bids.push([p-st*(i+.5+Math.random()*.6),Math.random()**2*3+.05])}
      const unit=a.s==="BTC"?1:a.s==="ETH"?18:a.s==="SOL"?300:a.s==="BNB"?90:30000;onBook({asks:asks.map(([x,q])=>[x,q*unit/ (a.s==="BTC"?1:1)]),bids:bids.map(([x,q])=>[x,q*unit])})};
    const trade=()=>{if(Math.random()<.35){const notional=(.4+Math.random()**2*6)*1e6;onTrade({side:Math.random()<.55?"buy":"sell",q:notional/a.price,p:a.price,t:Date.now()})}};
    tick();const i1=setInterval(tick,1000),i2=setInterval(trade,2500);return()=>{clearInterval(i1);clearInterval(i2)};
  }
};
})();
