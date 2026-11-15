"use strict";
/* =====================================================================
   Vigie — Académie : parcours, quiz, missions, glossaire, visite guidée
   ===================================================================== */
const ST = Object.assign({ xp: 0, done: {}, quiz: {}, missions: {}, chal: { w: 0, n: 0 }, level: null, seen: false, learnMode: true, rp: 0, days: [] }, LS.get("vigie-learn", {}));
function saveST() { LS.set("vigie-learn", ST) }
const LEVELS = [[0, "Débutant", "🌱"], [100, "Apprenti", "🧭"], [250, "Trader junior", "📈"], [450, "Analyste", "🧠"], [700, "Trader pro", "🏆"]];
function levelOf(x) { let i = 0; LEVELS.forEach((l, k) => { if (x >= l[0]) i = k }); return { cur: LEVELS[i], next: LEVELS[i + 1] || null } }
function addXP(n, why) { const before = levelOf(ST.xp).cur; ST.xp += n; saveST(); const after = levelOf(ST.xp).cur; toast(`+${n} XP · ${why}`); if (after !== before) setTimeout(() => toast(`${after[2]} Nouveau niveau : ${after[1]} !`), 1400); renderLearnHead() }
function mission(id) { if (ST.missions[id]) return; const m = MODULES.find(m => m.mission && m.mission.id === id); if (!m) return; ST.missions[id] = true; saveST(); addXP(30, "Mission : " + m.mission.t); renderPath() }
(function streak() { const d = new Date().toISOString().slice(0, 10); if (!ST.days.includes(d)) { ST.days.push(d); ST.days = ST.days.slice(-60); saveST() } })();
function streakDays() { let n = 0; const s = new Set(ST.days); for (let i = 0; ; i++) { const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10); if (s.has(d)) n++; else break } return n }

/* ---------------- glossaire ---------------- */
const GLOSS = {
  "Sentiment": ["Humeur globale des investisseurs, mesurée par le bot à partir des actualités, de Reddit et de la volatilité. 0 = peur extrême, 100 = avidité extrême. Les extrêmes annoncent souvent un retournement.", "m7"],
  "Carte de chaleur": ["Vue d'ensemble du marché : chaque carré est un actif, vert s'il monte, rouge s'il baisse, d'autant plus foncé que le mouvement est fort. La taille reflète le poids de l'actif.", null],
  "Calendrier économique": ["Liste des annonces à venir (taux d'intérêt, inflation, emploi, résultats d'entreprises) qui font bouger les marchés. L'impact est noté de 1 à 3 points.", "m7"],
  "Bougie": ["Résumé d'une période en 4 prix : ouverture, plus haut, plus bas, clôture. Verte si le prix a monté pendant la période, rouge s'il a baissé.", "m2"],
  "Heikin Ashi": ["Bougies lissées par une moyenne : la tendance est plus lisible, mais les prix affichés ne sont pas les prix réels.", "m2"],
  "EMA": ["Moyenne mobile exponentielle : prix moyen des N dernières périodes, en donnant plus de poids aux plus récentes. EMA 20 au-dessus de l'EMA 50 = tendance haussière.", "m4"],
  "RSI": ["Indice de force relative, de 0 à 100. Au-dessus de 70 : suracheté, risque de repli. Sous 30 : survendu, rebond possible.", "m4"],
  "MACD": ["Différence entre deux moyennes mobiles (12 et 26 périodes). Quand elle croise sa ligne de signal vers le haut, l'élan devient haussier.", "m4"],
  "Bollinger": ["Enveloppe autour d'une moyenne, à ±2 écarts-types. Bandes serrées = marché calme avant un mouvement ; prix hors des bandes = excès.", "m4"],
  "VWAP": ["Prix moyen pondéré par les volumes depuis le début de la journée. C'est la référence des institutionnels : au-dessus, les acheteurs contrôlent.", "m4"],
  "Ichimoku": ["Système japonais complet : deux lignes de tendance (Tenkan, Kijun) et un « nuage » (Senkou A et B) projeté dans le futur, qui sert de support ou de résistance.", "m4"],
  "Fibonacci": ["Niveaux (23,6 %, 38,2 %, 50 %, 61,8 %) entre un plus haut et un plus bas, où le prix a statistiquement tendance à réagir.", "m3"],
  "Support": ["Zone de prix où les acheteurs ont arrêté la baisse plusieurs fois.", "m3"],
  "Résistance": ["Zone de prix où les vendeurs ont arrêté la hausse plusieurs fois.", "m3"],
  "Volume": ["Quantité échangée sur une période. Un mouvement accompagné de beaucoup de volume est plus fiable.", "m3"],
  "Volatilité": ["Amplitude des variations de prix. Forte volatilité = gains et pertes possibles plus importants.", "m5"],
  "Confiance": ["Degré de certitude du modèle sur sa probabilité, de 0 à 1. Au-dessus de 0,7 : les signaux sont nombreux et concordants.", "m6"],
  "Backtesting": ["Test d'une stratégie sur les données passées pour mesurer son taux de réussite réel avant de l'utiliser.", "m6"],
  "Calibration": ["Vérifie que les probabilités annoncées sont honnêtes : quand le bot dit 70 %, ça doit monter environ 70 fois sur 100.", "m6"],
  "Carnet d'ordres": ["Liste en direct des ordres d'achat (vert) et de vente (rouge) en attente, prix par prix. Il montre où se trouvent acheteurs et vendeurs.", "m1"],
  "Baleine": ["Investisseur qui passe des ordres énormes (plusieurs millions). Ses mouvements peuvent faire bouger le prix.", "m1"],
  "Spread": ["Écart entre le meilleur prix de vente et le meilleur prix d'achat. C'est un coût caché à chaque transaction.", "m1"],
  "Ordre limite": ["Ordre exécuté seulement si le prix atteint le niveau que vous avez fixé.", "m1"],
  "Ordre au marché": ["Ordre exécuté immédiatement au meilleur prix disponible.", "m1"],
  "Stop-loss": ["Vente automatique si le prix descend à un niveau fixé à l'avance. Il limite la perte maximale d'un trade.", "m5"],
  "Take-profit": ["Vente automatique quand le prix atteint votre objectif de gain.", "m5"],
  "Ratio risque/rendement": ["Perte possible comparée au gain visé. 1:2 = on risque 1 pour gagner 2.", "m5"],
  "Drawdown": ["Plus forte baisse du portefeuille depuis son plus haut. Mesure la « douleur » maximale subie.", "m5"],
  "Diversification": ["Répartir son capital sur plusieurs actifs peu liés entre eux pour réduire le risque global.", "m5"],
  "FOMO": ["« Fear of missing out » : la peur de rater une hausse, qui pousse à acheter trop tard et trop cher.", "m8"],
  "Initiés": ["Dirigeants et administrateurs d'une entreprise. Leurs achats et ventes d'actions sont publics (formulaire SEC Form 4).", "m7"],
  "Fed": ["Banque centrale américaine. Ses décisions sur les taux d'intérêt font bouger tous les marchés, crypto comprise.", "m7"],
  "Frais": ["Commission prélevée à chaque achat et vente (0,1 % simulé ici, comme sur Binance). Sur beaucoup de trades, elle pèse lourd.", "m1"],
  "Journal de trading": ["Carnet où l'on note chaque trade, sa raison et son résultat. C'est l'outil n°1 des pros pour progresser.", "m8"]
};

/* ---------------- parcours ---------------- */
const MODULES = [
  {
    id: "m1", t: "Les bases du marché", dur: "4 min", body: `
<p>Un <b>marché</b> met en relation des acheteurs et des vendeurs. Le prix affiché est celui de la <b>dernière transaction</b>. Il monte quand les acheteurs sont plus pressés que les vendeurs, et inversement.</p>
<p><b>Ordre au marché</b> : vous achetez tout de suite au meilleur prix disponible. <b>Ordre limite</b> : vous fixez votre prix et attendez qu'il soit atteint.</p>
<p>L'<b>écart (spread)</b> entre le meilleur prix d'achat et de vente, plus les <b>frais</b> (souvent 0,1 % en crypto), sont des coûts invisibles : sur 100 trades par mois, ils peuvent manger toute votre performance.</p>
<div class="ex">Exemple : acheter 1 000 $ de BTC puis revendre au même prix coûte environ 2 $ de frais (0,1 % × 2). Dans Vigie, ces frais sont simulés pour coller à la réalité.</div>
<p><b>Long</b> = parier sur la hausse (acheter). <b>Short</b> = parier sur la baisse. Ici, vous ne faites que du long : c'est le bon point de départ.</p>`,
    action: ["Voir le carnet d'ordres", () => { closeModal(); if (BY[current].t !== "crypto") selectAsset("BTC"); go("chart", "#obCard") }],
    mission: { id: "m1", t: "Passez votre premier achat virtuel" },
    quiz: [["Vous voulez acheter le BTC seulement s'il descend à 95 000 $. Quel ordre utiliser ?", ["Un ordre au marché", "Un ordre limite", "Un stop-loss"], 1, "L'ordre limite attend que votre prix soit atteint."],
    ["Que représente le prix affiché d'un actif ?", ["La moyenne de la journée", "Le prix de la dernière transaction", "Un prix fixé par la plateforme"], 1, "C'est le prix auquel s'est faite la dernière transaction."],
    ["Pourquoi les frais comptent-ils autant ?", ["Ils sont payés une seule fois", "Ils s'additionnent à chaque achat et vente", "Ils ne s'appliquent qu'aux pertes"], 1, "Chaque aller-retour coûte des frais : plus on trade, plus ils pèsent."]]
  },
  {
    id: "m2", t: "Lire une bougie", dur: "5 min", body: `
<p>Chaque bougie résume une période (1 seconde, 1 heure, 1 jour…) avec 4 prix : <b>ouverture, plus haut, plus bas, clôture</b>.</p>
<p><span class="up">Verte</span> : la clôture est au-dessus de l'ouverture. <span class="down">Rouge</span> : en dessous. Le <b>corps</b> montre le trajet ouverture → clôture, les <b>mèches</b> les extrêmes atteints.</p>
<ul><li><b>Longue mèche basse</b> (marteau) : les vendeurs ont poussé, les acheteurs ont repris le contrôle. Souvent haussier après une baisse.</li><li><b>Doji</b> (corps minuscule) : indécision.</li><li><b>Avalement</b> : une grande bougie qui « avale » la précédente de couleur opposée = changement de rapport de force.</li></ul>
<div class="ex">Astuce de pro : une bougie seule ne veut rien dire. Regardez le contexte (tendance, support, volume) et l'unité de temps supérieure.</div>
<p>Les bougies <b>Heikin Ashi</b> lissent le bruit : utiles pour suivre une tendance, mais leurs prix ne sont pas les prix réels.</p>`,
    action: ["S'entraîner avec le mode Rejouer", () => { closeModal(); go("chart", "#chartCard"); setTimeout(() => { if (!RP) startReplay() }, 600) }],
    mission: { id: "m2", t: "Faites 5 prédictions en mode Rejouer" },
    quiz: [["Une bougie verte signifie…", ["Le volume a augmenté", "La clôture est au-dessus de l'ouverture", "Le bot conseille d'acheter"], 1, "Verte = le prix a fini la période plus haut qu'il ne l'a commencée."],
    ["Une longue mèche basse après une baisse indique souvent…", ["Que les acheteurs reprennent la main", "Une panique qui continue", "Rien du tout"], 0, "Le prix est descendu puis a été racheté : les acheteurs ont réagi."],
    ["Un doji traduit…", ["Une forte hausse", "De l'indécision", "Une erreur de données"], 1, "Ouverture ≈ clôture : ni les acheteurs ni les vendeurs n'ont gagné."]]
  },
  {
    id: "m3", t: "Tendances, supports et résistances", dur: "6 min", body: `
<p>Une <b>tendance haussière</b> enchaîne des sommets et des creux de plus en plus hauts. Une tendance baissière, l'inverse. Le dicton : « the trend is your friend », ne nagez pas à contre-courant.</p>
<p>Un <b>support</b> est une zone où le prix a rebondi plusieurs fois : les acheteurs s'y réveillent. Une <b>résistance</b>, une zone où il a buté : les vendeurs s'y montrent.</p>
<p>Quand une résistance casse avec du <b>volume</b>, elle devient souvent un support. Sans volume, méfiance : c'est peut-être une <b>fausse cassure</b>.</p>
<div class="ex">Méthode pro : tracez vos niveaux sur l'unité 4 h ou 1 J, puis cherchez vos points d'entrée sur 15 min ou 1 h. Les niveaux de <b>Fibonacci</b> (38,2 %, 61,8 %) servent à repérer où un repli pourrait s'arrêter.</div>`,
    action: ["Tracer une ligne sur le graphique", () => { closeModal(); go("chart", "#chartCard"); setTimeout(() => setDraw("h"), 500) }],
    mission: { id: "m3", t: "Tracez un support ou une ligne de tendance" },
    quiz: [["Une tendance haussière, c'est…", ["Des sommets et des creux de plus en plus hauts", "Un prix qui ne baisse jamais", "Une bougie verte"], 0, "Même en tendance haussière, il y a des baisses : ce qui compte, ce sont des creux de plus en plus hauts."],
    ["Une résistance cassée avec un fort volume devient souvent…", ["Un support", "Une résistance plus forte", "Sans importance"], 0, "C'est le principe du « changement de polarité »."],
    ["Pourquoi se méfier d'une cassure sans volume ?", ["Elle est souvent fausse", "Le volume ne compte pas", "C'est interdit"], 0, "Peu de participants = mouvement fragile, souvent annulé."]]
  },
  {
    id: "m4", t: "Les indicateurs techniques", dur: "7 min", body: `
<p>Les indicateurs transforment le prix en signaux lisibles. Ils sont <b>en retard</b> sur le prix : ils confirment, ils ne prédisent pas.</p>
<ul><li><b>EMA 20/50</b> : moyennes mobiles. EMA 20 au-dessus de l'EMA 50 = tendance haussière. Leurs croisements donnent les flèches du graphique.</li><li><b>RSI</b> : force du mouvement, de 0 à 100. Au-dessus de 70 : suracheté ; sous 30 : survendu.</li><li><b>MACD</b> : écart entre deux moyennes. Son croisement avec la ligne de signal annonce un changement d'élan.</li><li><b>Bollinger</b> : enveloppe de volatilité. Bandes serrées = calme avant un gros mouvement.</li><li><b>VWAP</b> : prix moyen pondéré par le volume. Les institutionnels achètent volontiers sous le VWAP.</li><li><b>Ichimoku</b> : tendance + nuage de support/résistance projeté dans le futur.</li></ul>
<div class="ex">Piège n°1 du débutant : empiler 10 indicateurs. Les pros en utilisent 2 ou 3 qui mesurent des choses différentes : tendance (EMA), élan (RSI ou MACD) et volume (VWAP).</div>`,
    action: ["Activer le MACD", () => { closeModal(); go("chart", "#chartCard"); setTimeout(() => { if (!show.macd) $('[data-ind="macd"]').click() }, 500) }],
    mission: { id: "m4", t: "Activez le MACD ou l'Ichimoku" },
    quiz: [["Un RSI à 82 signifie…", ["L'actif est suracheté", "L'actif est survendu", "Le volume est de 82 %"], 0, "Au-dessus de 70, le mouvement est peut-être allé trop vite."],
    ["Pourquoi les indicateurs sont-ils « en retard » ?", ["Ils sont calculés à partir des prix passés", "Les données arrivent lentement", "Ils ne marchent que le soir"], 0, "Ils résument le passé : ils confirment plus qu'ils ne prédisent."],
    ["Bandes de Bollinger très serrées : à quoi s'attendre ?", ["À un gros mouvement prochain", "À un marché fermé", "À une baisse certaine"], 0, "La volatilité alterne : le calme précède souvent la tempête (dans un sens ou l'autre)."]]
  },
  {
    id: "m5", t: "Gestion du risque", dur: "6 min", body: `
<p>Les pros ne cherchent pas à avoir raison, ils cherchent à <b>durer</b>. Règle d'or : <b>ne jamais risquer plus de 1 % du capital</b> sur un seul trade.</p>
<p>Le <b>stop-loss</b> vend automatiquement si le prix descend jusqu'à un niveau fixé à l'avance. Le <b>take-profit</b> encaisse le gain à un niveau fixé. Décidez-les <b>avant</b> d'entrer, jamais pendant.</p>
<p>Le <b>ratio risque/rendement</b> compare la perte possible au gain visé. Avec 1:2, vous pouvez vous tromper 6 fois sur 10 et rester gagnant.</p>
<div class="ex">Calcul : capital 10 000 $, risque 1 % = 100 $. Stop-loss à 4 % sous le prix d'achat → taille de position = 100 ÷ 0,04 = 2 500 $. Le formulaire d'ordre fait ce calcul pour vous.</div>
<p>Une perte de 50 % demande +100 % pour revenir à zéro. Limiter les pertes compte donc plus que maximiser les gains.</p>`,
    action: ["Passer un ordre avec stop-loss", () => { closeModal(); go("pf", "#tradeForm"); setTimeout(() => { $("#tSL").value = 3; $("#tTP").value = 6; updateTradeInfo(); $("#tSL").focus() }, 500) }],
    mission: { id: "m5", t: "Achetez avec un stop-loss" },
    quiz: [["Capital 10 000 $, règle des 1 %, stop à 5 %. Taille de position maximale ?", ["500 $", "2 000 $", "5 000 $"], 1, "100 $ de risque ÷ 5 % = 2 000 $."],
    ["Après une perte de 50 %, combien faut-il gagner pour revenir à zéro ?", ["+50 %", "+75 %", "+100 %"], 2, "1 000 $ → 500 $ : il faut doubler (+100 %) pour revenir à 1 000 $."],
    ["Quand fixer son stop-loss ?", ["Avant d'entrer en position", "Quand le prix commence à baisser", "Jamais, il faut être patient"], 0, "Pendant le trade, les émotions prennent le dessus : on décide avant."]]
  },
  {
    id: "m6", t: "Probabilités et backtesting", dur: "6 min", body: `
<p>« 64 % de chances de hausse » ne veut pas dire que ça va monter. Cela veut dire que, <b>dans des situations similaires par le passé</b>, le prix a monté environ 64 fois sur 100. Il reste 36 % de chances de se tromper.</p>
<p>La <b>confiance</b> mesure à quel point le modèle est sûr de son estimation (beaucoup de cas similaires, signaux qui concordent).</p>
<p>Le <b>backtesting</b> rejoue la stratégie sur le passé pour mesurer son taux de réussite réel. La <b>calibration</b> vérifie que « 70 % annoncé » donne bien environ 70 % de réussite. Vigie affiche aussi la réussite <b>en conditions réelles</b>, mesurée jour après jour.</p>
<div class="ex">Espérance : 55 % de réussite × gain moyen 2 % − 45 % × perte moyenne 1 % = +0,65 % par trade. Positive sur 100 trades, même avec beaucoup de pertes.</div>
<p>Attention au <b>surapprentissage</b> : une stratégie parfaite sur le passé échoue souvent sur le futur. C'est pourquoi le bot est testé en « walk-forward » : il ne voit jamais les données qu'il prédit.</p>`,
    action: ["Voir les probabilités du bot", () => { closeModal(); go("chart", "#gauges") }],
    mission: { id: "m6", t: "Demandez à l'IA d'expliquer un signal" },
    quiz: [["Le bot annonce 64 % de hausse. Que faut-il comprendre ?", ["Le prix va monter", "Dans des cas similaires, ça a monté 64 fois sur 100", "Le prix va monter de 64 %"], 1, "C'est une fréquence observée, pas une certitude."],
    ["À quoi sert le backtesting ?", ["À prédire le futur avec certitude", "À mesurer la réussite d'une stratégie sur le passé", "À acheter moins cher"], 1, "Il évite d'utiliser une stratégie qui n'a jamais marché."],
    ["Une stratégie parfaite sur le passé…", ["Est forcément gagnante", "Peut être surapprise et échouer ensuite", "Est interdite"], 1, "Elle a peut-être appris le bruit du passé plutôt qu'une vraie régularité."]]
  },
  {
    id: "m7", t: "Actualités, macro et sentiment", dur: "6 min", body: `
<p>Les marchés bougent sur les <b>surprises</b>, pas sur les nouvelles attendues. Si l'inflation sort à 2,9 % alors que tout le monde attendait 2,9 %, il ne se passe presque rien.</p>
<p>La <b>Fed</b> fixe les taux d'intérêt américains : des taux plus bas soutiennent en général les actions et la crypto ; des taux plus hauts les pénalisent.</p>
<p>« <b>Acheter la rumeur, vendre la nouvelle</b> » : le prix monte souvent avant une annonce positive, puis baisse quand elle tombe.</p>
<p>Les achats des <b>initiés</b> (dirigeants qui achètent les actions de leur propre entreprise) sont un signal plus fort que leurs ventes, souvent faites pour des raisons personnelles.</p>
<div class="ex">Bon réflexe : consultez le calendrier économique chaque matin et évitez d'ouvrir une position 30 minutes avant une annonce à fort impact (●●●).</div>`,
    action: ["Ouvrir le calendrier économique", () => { closeModal(); go("market", "#calendar") }],
    mission: { id: "m7", t: "Activez un rappel dans le calendrier" },
    quiz: [["L'inflation sort exactement comme prévu. Réaction probable ?", ["Forte hausse", "Peu de mouvement", "Krach"], 1, "Le marché avait déjà intégré la nouvelle."],
    ["Une baisse des taux de la Fed est en général…", ["Favorable aux actions et à la crypto", "Défavorable à tout", "Sans effet"], 0, "L'argent moins cher pousse vers les actifs risqués."],
    ["Quel signal d'initié est le plus parlant ?", ["Un dirigeant qui achète ses actions", "Un dirigeant qui vend ses actions", "Les deux se valent"], 0, "On vend pour mille raisons, on n'achète que pour une : on croit à la hausse."]]
  },
  {
    id: "m8", t: "Psychologie et journal de trading", dur: "5 min", body: `
<p>La plupart des pertes ne viennent pas d'une mauvaise analyse mais de <b>décisions émotionnelles</b>.</p>
<ul><li><b>FOMO</b> : acheter parce que « tout le monde gagne » et que ça monte déjà fort.</li><li><b>Revenge trading</b> : reprendre une position juste après une perte pour se « refaire ».</li><li><b>Biais de confirmation</b> : ne lire que les infos qui vont dans votre sens.</li><li><b>Moyenner à la baisse</b> : racheter une position perdante en espérant qu'elle remonte.</li></ul>
<p>Le remède des pros : un <b>plan écrit</b> (entrée, stop, objectif) et un <b>journal</b> où chaque trade est justifié puis évalué.</p>
<div class="ex">Après 20 trades, votre journal vous dira quelle méthode marche vraiment pour vous. L'IA de Vigie fait ce bilan automatiquement dans l'onglet Portefeuille.</div>`,
    action: ["Ouvrir mon journal", () => { closeModal(); go("pf", "#journalCard") }],
    mission: { id: "m8", t: "Justifiez un trade dans le journal" },
    quiz: [["Vous venez de perdre 200 $ et voulez vous refaire tout de suite. C'est…", ["Du revenge trading", "Une bonne stratégie", "De la diversification"], 0, "Faites une pause : la décision est émotionnelle."],
    ["Le FOMO pousse à…", ["Acheter après une forte hausse par peur de rater", "Vendre au bon moment", "Diversifier"], 0, "On achète souvent au plus haut."],
    ["À quoi sert un journal de trading ?", ["À découvrir ce qui marche vraiment pour vous", "À payer moins d'impôts", "À rien, c'est pour les débutants"], 0, "C'est l'outil de progression n°1 des traders professionnels."]]
  }
];
const RULES = ["Jamais plus de 1 % du capital risqué par trade.", "Un stop-loss, toujours, décidé avant d'entrer.", "Viser un ratio risque/rendement d'au moins 1:2.", "Pas de nouvelle position 30 min avant une annonce à fort impact.", "Ne pas racheter une position perdante pour « faire baisser son prix moyen ».", "Écrire pourquoi on entre, avant d'entrer.", "Une probabilité de 65 %, c'est aussi 35 % de chances de se tromper.", "Après 3 pertes d'affilée : pause jusqu'au lendemain."];

/* ---------------- rendu de l'académie ---------------- */
function renderLearnHead() {
  const { cur, next } = levelOf(ST.xp), doneN = Object.keys(ST.done).length, misN = Object.keys(ST.missions).length;
  const qa = Object.values(ST.quiz), acc = qa.length ? Math.round(qa.reduce((s, x) => s + x, 0) / (qa.length * 3) * 100) : null;
  const pct = next ? (ST.xp - cur[0]) / (next[0] - cur[0]) * 100 : 100;
  $("#learnHead").innerHTML = `<div class="lvl"><div class="lvl-badge">${cur[2]}</div><div style="flex:1"><div class="muted" style="font-size:12px">Votre niveau</div><b style="font-size:18px">${cur[1]}</b> <span class="muted num">· ${ST.xp} XP</span><div class="xpbar"><span style="width:${pct}%"></span></div><div class="muted" style="font-size:11px;margin-top:4px">${next ? `${next[0] - ST.xp} XP avant « ${next[1]} »` : "Niveau maximum atteint 🎉"}</div></div></div>
  <div class="learn-stats num"><div class="kpi"><small>Modules</small><b>${doneN}/${MODULES.length}</b></div><div class="kpi"><small>Missions</small><b>${misN}/${MODULES.length}</b></div><div class="kpi"><small>Bonnes réponses</small><b>${acc == null ? "—" : acc + " %"}</b></div><div class="kpi"><small>Jours d'affilée</small><b>🔥 ${streakDays()}</b></div></div>`;
  const hb = $("#xpMini"); if (hb) hb.textContent = cur[2] + " " + ST.xp;
}
function renderPath() {
  const nextId = (MODULES.find(m => !ST.done[m.id]) || {}).id;
  $("#path").innerHTML = MODULES.map((m, i) => { const done = ST.done[m.id], mis = ST.missions[m.mission.id]; return `<li class="${done ? "done" : m.id === nextId ? "next" : ""}"><button data-mod="${m.id}"><span class="n">${done ? "✓" : i + 1}</span><span><b>${m.t}</b><small>${m.dur} · quiz de 3 questions</small><span class="mis ${mis ? "ok" : ""}">${mis ? "✓" : "◎"} Mission : ${m.mission.t}</span></span><span class="chip ${done ? "up" : m.id === nextId ? "ai" : ""}">${done ? "Revoir" : m.id === nextId ? "Commencer" : "Ouvrir"}</span></button></li>` }).join("");
  $$("[data-mod]").forEach(b => b.onclick = () => openLesson(b.dataset.mod));
}
function openLesson(id) {
  const m = MODULES.find(x => x.id === id), i = MODULES.indexOf(m);
  openModal(`<div class="lesson"><p class="kicker">Module ${i + 1} sur ${MODULES.length} · ${m.dur}</p><h2>${m.t}</h2>${m.body}
  <div class="mission-box"><b>Mission pratique</b> ${ST.missions[m.mission.id] ? '<span class="chip up">réussie ✓</span>' : '<span class="chip flat">+30 XP</span>'}<p>${m.mission.t}.</p><button class="btn" id="lAct">${m.action[0]}</button></div>
  <div class="btn-row"><button class="btn ai-b" id="lQuiz">Passer le quiz (3 questions)</button></div></div>`);
  $("#lAct").onclick = m.action[1]; $("#lQuiz").onclick = () => runQuiz(m);
}
function runQuiz(m) {
  let k = 0, ok = 0;
  const show1 = () => {
    const [q, opts, good, why] = m.quiz[k];
    $("#modalBody").innerHTML = `<div class="lesson"><p class="kicker">Quiz · ${m.t} · question ${k + 1}/3</p><h2 style="font-size:18px">${q}</h2>${opts.map((o, i) => `<button class="quiz-opt" data-o="${i}">${String.fromCharCode(65 + i)}. ${o}</button>`).join("")}<div id="qFb"></div></div>`;
    $$("[data-o]").forEach(b => b.onclick = () => {
      const i = +b.dataset.o; $$("[data-o]").forEach(x => { x.disabled = true; if (+x.dataset.o === good) x.classList.add("ok") }); if (i !== good) b.classList.add("ko"); else ok++;
      $("#qFb").innerHTML = `<div class="ex">${i === good ? "✅ Exact." : "❌ Pas tout à fait."} ${why}</div><div class="btn-row"><button class="btn ai-b" id="qNext">${k < 2 ? "Question suivante" : "Voir mon résultat"}</button></div>`;
      $("#qNext").onclick = () => { k++; if (k < 3) show1(); else end() };
    });
  };
  const end = () => {
    const first = !ST.done[m.id], best = Math.max(ST.quiz[m.id] || 0, ok); ST.quiz[m.id] = best; ST.done[m.id] = true; saveST();
    const gain = first ? 20 + ok * 10 : 0;
    $("#modalBody").innerHTML = `<div class="lesson" style="text-align:center"><div style="font-size:46px">${ok === 3 ? "🏆" : ok === 2 ? "👏" : "📚"}</div><h2>${ok}/3 bonnes réponses</h2><p>${ok === 3 ? "Parfait, vous maîtrisez ce module." : ok === 2 ? "Très bien. Relisez le point manqué à l'occasion." : "Relisez le module : la répétition fait le trader."}</p>${gain ? `<p class="up"><b>+${gain} XP</b></p>` : ""}<div class="btn-row" style="justify-content:center">${(() => { const n = MODULES[MODULES.indexOf(m) + 1]; return n ? `<button class="btn ai-b" id="qN">Module suivant : ${n.t}</button>` : "" })()}<button class="btn" id="qC">Fermer</button></div></div>`;
    if (gain) addXP(gain, "Module « " + m.t + " »");
    renderPath(); renderLearnHead();
    const n = MODULES[MODULES.indexOf(m) + 1]; if (n) $("#qN").onclick = () => openLesson(n.id); $("#qC").onclick = closeModal;
  };
  show1();
}
function renderGloss(f = "") {
  const k = Object.keys(GLOSS).sort((a, b) => a.localeCompare(b, "fr")).filter(t => !f || (t + GLOSS[t][0]).toLowerCase().includes(f.toLowerCase()));
  $("#gloss").innerHTML = k.map(t => `<dt>${t}</dt><dd>${GLOSS[t][0]}</dd>`).join("") || `<dd class="muted">Aucun terme trouvé.</dd>`;
}

/* ---------------- défi : lire le marché ---------------- */
let chalRun = null;
function renderChal() {
  const a = BY.BTC || ASSETS[0];
  $("#chPx").textContent = fp(a.price) + " $";
  const r = ST.chal.n ? Math.round(ST.chal.w / ST.chal.n * 100) : null;
  $("#chStats").innerHTML = ST.chal.n ? `Votre score : <b>${ST.chal.w}/${ST.chal.n}</b> (${r} %)${ST.chal.n >= 6 ? ` · ${r > 56 ? "au-dessus du hasard, bravo !" : "proche du hasard, et c'est normal : sur 30 secondes, le marché est presque aléatoire. Les pros gagnent grâce à la gestion du risque, pas en devinant."}` : ""}` : "Gagnez 5 XP par bonne réponse.";
}
function playChal(up) {
  if (chalRun) return; const a = BY.BTC || ASSETS[0], p0 = a.price; let s = 30;
  $$("#chUp,#chDn").forEach(b => b.disabled = true);
  chalRun = setInterval(() => {
    s--; $("#chRes").innerHTML = `Départ ${fp(p0)} $ · résultat dans <b>${s} s</b>`; $("#chPx").textContent = fp(a.price) + " $"; $("#chPx").className = "big num " + (a.price >= p0 ? "up" : "down");
    if (s <= 0) {
      clearInterval(chalRun); chalRun = null; const win = up ? a.price > p0 : a.price < p0; ST.chal.n++; if (win) ST.chal.w++; saveST();
      $("#chRes").innerHTML = win ? `<b class="up">Gagné !</b> ${fp(p0)} → ${fp(a.price)} $` : `<b class="down">Perdu.</b> ${fp(p0)} → ${fp(a.price)} $`;
      if (win) addXP(5, "Défi réussi"); $$("#chUp,#chDn").forEach(b => b.disabled = false); renderChal(); renderLearnHead();
    }
  }, 1000);
}

/* ---------------- mode apprentissage : bulles « ? » ---------------- */
function installQt() {
  $$("[data-term]").forEach(el => {
    if (el._qt) return; el._qt = 1;
    const b = document.createElement("button"); b.type = "button"; b.className = "qt"; b.textContent = "?"; b.setAttribute("aria-label", "Explication : " + el.dataset.term);
    b.onclick = e => { e.stopPropagation(); e.preventDefault(); showPop(el.dataset.term, b) };
    if (/BUTTON|SELECT|INPUT/.test(el.tagName)) el.after(b); else el.appendChild(b);
  });
  document.body.classList.toggle("learn", ST.learnMode);
  $("#learnToggle").setAttribute("aria-pressed", ST.learnMode);
}
function showPop(term, anchor) {
  const g = GLOSS[term]; if (!g) return; const pop = $("#pop");
  pop.innerHTML = `<b>${term}</b><p>${g[0]}</p>${g[1] ? `<button class="linkbtn" id="popL">Voir la leçon →</button>` : ""}`;
  pop.hidden = false; const r = anchor.getBoundingClientRect(), w = Math.min(300, innerWidth - 32);
  pop.style.width = w + "px"; pop.style.left = Math.max(16, Math.min(innerWidth - w - 16, r.left - w / 2)) + "px";
  const below = r.bottom + 8 + pop.offsetHeight < innerHeight; pop.style.top = (below ? r.bottom + 8 : r.top - pop.offsetHeight - 8) + "px";
  if (g[1]) $("#popL").onclick = () => { pop.hidden = true; openLesson(g[1]) };
  emit("glossary", term);
}
document.addEventListener("click", e => { const p = $("#pop"); if (p && !p.hidden && !p.contains(e.target) && !e.target.classList.contains("qt")) p.hidden = true });
window.addEventListener("scroll", () => { const p = $("#pop"); if (p) p.hidden = true }, { passive: true });

/* ---------------- visite guidée ---------------- */
const TOUR = [
  ["market", "#watchlist", "Votre watchlist", "Les actifs surveillés par le bot. Le badge ▲ 64 % est la probabilité de hausse sur 24 h. Touchez un actif pour l'analyser."],
  ["market", "#heatmap", "La carte de chaleur", "Le marché d'un coup d'œil : plus le carré est grand, plus l'actif pèse ; plus il est vert ou rouge, plus il bouge."],
  ["chart", "#chartCard", "Le graphique en direct", "Chaque bougie résume une période. Choisissez l'unité de temps (de 1 seconde à 1 jour) et le style de courbe."],
  ["chart", "#toolsRow", "Les outils du trader", "Indicateurs, tracés de lignes, comparaison de deux actifs, plein écran et mode Rejouer pour vous entraîner sur le passé."],
  ["chart", "#gauges", "Les probabilités du bot", "Chances de hausse sur 1 h, 24 h et 7 jours, avec la confiance du modèle. Juste en dessous : ce qui fait bouger la probabilité."],
  ["chart", "#btCard", "La fiabilité réelle", "Le bot est testé sur des années de données : vous voyez son vrai taux de réussite, pas des promesses."],
  ["chart", "#obCard", "Le carnet d'ordres", "Les ordres d'achat et de vente en attente en direct, et les transactions des « baleines »."],
  ["news", "#newsCard", "Actualités et alertes", "Chaque actu est reliée à un actif, notée et résumée. Vous y trouvez aussi vos alertes de prix, les initiés et le Congrès."],
  ["ai", "#aiCard", "Votre analyste IA", "Posez n'importe quelle question : un signal, un terme (« c'est quoi le RSI ? »), votre portefeuille. Elle peut aussi vous faire réviser."],
  ["pf", "#tradeForm", "Votre portefeuille fictif", "Entraînez-vous sans risque : stop-loss, take-profit, taille de position conseillée et journal de trading."],
  ["learn", "#path", "Votre parcours", "8 modules courts avec quiz et missions pratiques. Le bouton 🎓 en haut affiche des « ? » explicatifs partout."]
];
let tourI = -1;
function tour(i) {
  if (i < 0 || i >= TOUR.length) return endTour();
  tourI = i; const [v, sel, t, d] = TOUR[i];
  closeModal(); if (!isDesk()) go(v);
  setTimeout(() => {
    const el = $(sel); if (!el) return tour(i + 1);
    el.scrollIntoView({ block: "center" });
    setTimeout(() => placeTour(), 250);
    $("#tourTip").innerHTML = `<div class="step">Étape ${i + 1} sur ${TOUR.length}</div><h4>${t}</h4><p>${d}</p><div class="btn-row"><button class="btn" id="tPrev" ${i ? "" : "disabled"}>Précédent</button><button class="btn ai-b" id="tNext">${i < TOUR.length - 1 ? "Suivant" : "Terminer"}</button><button class="linkbtn" id="tEnd">Passer</button></div>`;
    $("#tPrev").onclick = () => tour(i - 1); $("#tNext").onclick = () => tour(i + 1); $("#tEnd").onclick = endTour;
    $("#tourHl").hidden = $("#tourTip").hidden = false;
  }, 120);
}
function placeTour() {
  if (tourI < 0) return; const el = $(TOUR[tourI][1]); if (!el) return;
  const r = el.getBoundingClientRect(), hl = $("#tourHl"), tip = $("#tourTip"), pad = 6;
  const top = Math.max(4, r.top - pad), h = Math.min(r.height + pad * 2, innerHeight - top - 8);
  Object.assign(hl.style, { top: top + "px", left: Math.max(4, r.left - pad) + "px", width: Math.min(r.width + pad * 2, innerWidth - 8) + "px", height: h + "px" });
  const th = tip.offsetHeight, below = top + h + 12 + th < innerHeight - 70;
  tip.style.top = (below ? top + h + 12 : Math.max(12, top - th - 12)) + "px";
  if (isDesk()) tip.style.left = Math.min(innerWidth - 380, Math.max(16, r.left)) + "px";
}
function endTour() { tourI = -1; $("#tourHl").hidden = $("#tourTip").hidden = true; if (!ST.toured) { ST.toured = true; saveST(); addXP(20, "Visite guidée terminée") } }
window.addEventListener("resize", placeTour); window.addEventListener("scroll", () => tourI >= 0 && placeTour(), { passive: true });

/* ---------------- accueil ---------------- */
function welcome() {
  openModal(`<div class="lesson welcome"><div class="wl-hero">${'<svg width="44" height="44" viewBox="0 0 26 26" aria-hidden="true"><rect width="26" height="26" rx="7" fill="#14203A"/><path d="M5 17l5-6 4 4 7-9" fill="none" stroke="#16C784" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="21" cy="6" r="2.2" fill="#9B8AFB"/></svg>'}</div>
  <h2>Bienvenue sur Vigie</h2>
  <p>Votre terminal pour <b>apprendre le trading comme un pro, sans risquer un centime</b> : vous disposez de 10 000 $ fictifs, de vraies données de marché, d'un bot qui calcule des probabilités et d'une IA qui vous explique tout.</p>
  <p class="kicker" style="margin-top:14px">Quel est votre niveau ?</p>
  <div class="lvl-pick">${[["Débutant", "Je n'ai jamais tradé"], ["Intermédiaire", "Je connais les bougies et le RSI"], ["Avancé", "Je veux surtout les données et le bot"]].map(([l, d]) => `<button class="quiz-opt" data-lv="${l}"><b>${l}</b><br><span class="muted" style="font-size:12px">${d}</span></button>`).join("")}</div>
  </div>`, () => { ST.seen = true; saveST() });
  $$("[data-lv]").forEach(b => b.onclick = () => {
    ST.level = b.dataset.lv; ST.seen = true; ST.learnMode = ST.level !== "Avancé"; saveST(); installQt();
    $("#modalBody").innerHTML = `<div class="lesson" style="text-align:center"><div style="font-size:42px">${ST.level === "Débutant" ? "🌱" : ST.level === "Intermédiaire" ? "📈" : "🧠"}</div><h2>C'est parti !</h2><p>${ST.level === "Débutant" ? "Je vous propose une visite guidée de 2 minutes, puis le premier module : « Les bases du marché »." : ST.level === "Intermédiaire" ? "Faites la visite guidée, puis attaquez le module 4 sur les indicateurs ou le module 5 sur la gestion du risque." : "Le mode « ? » est désactivé (bouton 🎓 pour le réactiver). La visite guidée vous montre où se trouve chaque outil."}</p><div class="btn-row" style="justify-content:center"><button class="btn ai-b" id="wTour">Visite guidée (2 min)</button><button class="btn" id="wSkip">Explorer seul</button></div></div>`;
    $("#wTour").onclick = () => tour(0); $("#wSkip").onclick = closeModal;
  });
}

/* ---------------- IA : glossaire et quiz ---------------- */
let pendingQ = null;
aiHooks.push(q => {
  const t = q.toLowerCase().trim();
  if (pendingQ && /^[abc]\b|^[abc][.)]/.test(t)) { const i = t.charCodeAt(0) - 97, [qq, opts, good, why] = pendingQ; pendingQ = null; if (i === good) addXP(5, "Bonne réponse"); return `<p>${i === good ? "✅ Exact !" : `❌ La bonne réponse était <b>${String.fromCharCode(65 + good)}. ${opts[good]}</b>.`}</p><p>${why}</p><p class="muted">Écrivez « quiz » pour une autre question.</p>` }
  if (/\bquiz\b|interroge|teste[- ]moi|révis/.test(t)) { const m = MODULES[Math.floor(Math.random() * MODULES.length)], qz = m.quiz[Math.floor(Math.random() * 3)]; pendingQ = qz; return `<p><b>Question (module « ${m.t} »)</b></p><p>${qz[0]}</p><ul>${qz[1].map((o, i) => `<li><b>${String.fromCharCode(65 + i)}.</b> ${o}</li>`).join("")}</ul><p class="muted">Répondez A, B ou C.</p>` }
  const term = Object.keys(GLOSS).sort((a, b) => b.length - a.length).find(k => t.includes(k.toLowerCase()));
  if (term && /c.?est quoi|qu.?est[- ]ce|explique|définition|comment|ça veut dire|signifie|apprend/.test(t)) {
    let ex = "";
    if (term === "RSI" && bars.length > 20) { const r = rsiCalc(bars).pop().value; ex = `Sur le graphique de ${BY[current].n}, le RSI vaut actuellement <b>${nf(0).format(r)}</b> : ${r > 70 ? "zone de surachat, prudence sur un achat." : r < 30 ? "zone de survente, un rebond est possible." : "zone neutre, pas d'excès."}` }
    else if (term === "EMA" && bars.length > 50) { const a = emaCalc(bars, 20).pop().value, b = emaCalc(bars, 50).pop().value; ex = `Sur ${BY[current].n}, l'EMA 20 est ${a > b ? "<b>au-dessus</b> de l'EMA 50 : tendance haussière" : "<b>sous</b> l'EMA 50 : tendance baissière"} sur cette unité de temps.` }
    else if (term === "Stop-loss") ex = `Dans le formulaire du portefeuille, indiquez par exemple 3 % : si vous achetez à ${fp(BY[current].price)} $, la position sera vendue automatiquement à ${fp(BY[current].price * .97)} $.`;
    else if (term === "Spread" && BY[current].t === "crypto") ex = `Regardez le carnet d'ordres sous le graphique : le spread y est affiché en direct.`;
    return `<p><b>${term}</b> : ${GLOSS[term][0]}</p>${ex ? `<p>${ex}</p>` : ""}${GLOSS[term][1] ? `<p class="muted">Pour aller plus loin : module « ${MODULES.find(m => m.id === GLOSS[term][1]).t} » dans l'onglet Apprendre.</p>` : ""}`;
  }
  return null;
});

/* ---------------- branchements ---------------- */
on("trade", d => { if (d.side === "buy") { mission("m1"); if (d.meta && d.meta.sl) mission("m5") } if (d.meta && d.meta.note && d.meta.note.length > 3) mission("m8") });
on("mission", id => mission(id));
on("replayGuess", d => { ST.rp = (ST.rp || 0) + 1; saveST(); if (ST.rp >= 5) mission("m2"); if (d.ok) addXP(1, "Bonne lecture") });
on("ind", d => { if (d.on && (d.k === "macd" || d.k === "ichi")) mission("m4") });
on("ask", q => { if (/signal|pourquoi/i.test(q)) mission("m6") });

function learnInit() {
  renderLearnHead(); renderPath(); renderGloss(); renderChal();
  $("#rules").innerHTML = RULES.map(r => `<li>${r}</li>`).join("");
  $("#glossQ").oninput = e => renderGloss(e.target.value);
  $("#chUp").onclick = () => playChal(true); $("#chDn").onclick = () => playChal(false);
  setInterval(() => { if (!chalRun) { const a = BY.BTC || ASSETS[0]; $("#chPx").textContent = fp(a.price) + " $" } }, 1000);
  $("#tourBtn").onclick = () => tour(0);
  $("#learnToggle").onclick = () => { ST.learnMode = !ST.learnMode; saveST(); installQt(); toast(ST.learnMode ? "Mode apprentissage activé : touchez les « ? »" : "Mode apprentissage désactivé") };
  $("#learnNav").onclick = () => go("learn");
  $("#learnTour").onclick = () => tour(0);
  installQt();
  setSugg(["Explique le signal sur " + current, "C'est quoi le RSI ?", "Fais-moi un quiz", "Commente mon portefeuille", "Résume l'actualité", "Comment placer un stop-loss ?"]);
  if (!ST.seen) setTimeout(welcome, 700);
}
on("ready", learnInit);
