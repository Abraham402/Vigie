# Vigie — apprendre le trading comme un pro, sans risquer un centime

**Application : https://abraham402.github.io/Vigie/**  ·  **Démo (données fictives) : https://abraham402.github.io/Vigie/?demo=1**

Vigie est un terminal de marché pour la crypto et les actions, pensé pour apprendre :
vraies données, probabilités calculées par un bot de machine learning, actualités analysées,
IA qui explique tout et portefeuille **fictif** de 10 000 $. Le bot ne passe jamais d'ordre :
il surveille, analyse, estime des probabilités et alerte. 100 % gratuit, rien à installer.

## Ce que contient l'application

| Onglet | Contenu |
|---|---|
| Marché | Sentiment peur/avidité, watchlist avec probabilités, carte de chaleur, calendrier économique avec rappels |
| Analyse | Graphique pro (1 s à 1 jour, bougies / Heikin Ashi / barres / ligne / aire), EMA, Bollinger, VWAP, Ichimoku, Fibonacci, RSI, MACD, tracés, comparaison, plein écran, mode **Rejouer** ; probabilités 1 h / 24 h / 7 j avec leurs raisons ; backtest et calibration ; carnet d'ordres et « baleines » en direct |
| Actus | Actualités traduites et notées, alertes Telegram, alertes de prix perso, initiés et Congrès US, fiabilité mesurée de chaque source, personnes suivies |
| IA | Analyste (Gemini gratuit, ou mode simple sans clé), glossaire et quiz dans la discussion |
| Portefeuille | Ordres au marché et limites, stop-loss, take-profit, frais réalistes, taille de position conseillée (règle des 1 %), risque, journal de trading avec bilan |
| Apprendre | 8 modules, quiz, missions pratiques, XP et niveaux, défi de lecture du marché, règles d'or, glossaire, visite guidée, mode « ? » |

## Configuration (une seule fois, depuis le téléphone)

Toutes les clés vont dans les **Secrets GitHub** : elles ne sont jamais visibles dans le code.
Pour ajouter un secret : dépôt **Vigie** → **Settings** → **Secrets and variables** → **Actions** →
**New repository secret** → saisir le **nom** exact et la **valeur** → **Add secret**.

### 1. Alertes Telegram (gratuit)
1. Dans Telegram, ouvrez **@BotFather**, envoyez `/newbot`, choisissez un nom puis un identifiant finissant par `bot`.
2. BotFather répond avec un **jeton** (une longue suite de chiffres et lettres avec `:`). Copiez-le.
3. Ajoutez le secret GitHub `TELEGRAM_BOT_TOKEN` avec ce jeton.
4. Ouvrez votre nouveau bot dans Telegram et envoyez-lui `/start`.
5. Au passage suivant (15 min max), Vigie trouve votre discussion tout seul et vous envoie « ✅ Vigie est connecté ».

### 2. IA Gemini (gratuit)
1. Allez sur **https://aistudio.google.com/apikey**, connectez-vous avec Google, touchez **Create API key**, copiez la clé (`AIza…`).
2. Ajoutez le secret GitHub `GEMINI_API_KEY` : le bot rédigera les résumés d'actualités et le point du matin.
3. Dans l'application, touchez ⚙️ et collez la même clé : l'analyste IA répondra à vos questions avec les données en direct.

Alternative gratuite : une clé **Groq** (https://console.groq.com/keys) dans le secret `GROQ_API_KEY`.

## Comment ça marche

```
GitHub Actions (toutes les 15 min, gratuit)          Navigateur (téléphone / ordinateur)
┌──────────────────────────────────────────┐        ┌───────────────────────────────────┐
│ bot/  (Python)                           │        │ index.html + assets/*.js           │
│  • prix : Binance, Yahoo Finance          │        │  • crypto en direct : Binance      │
│  • modèle : gradient boosting walk-forward│  JSON  │    (WebSocket, à la seconde)       │
│  • actus : RSS, Google News, Reddit       │ ─────▶ │  • actions, probabilités, actus :  │
│  • initiés, Congrès, calendrier           │ branche│    fichiers du bot (branche data)  │
│  • alertes Telegram, résumé du matin      │  data  │  • portefeuille, progression :     │
└──────────────────────────────────────────┘        │    stockés dans le navigateur      │
                                                     └───────────────────────────────────┘
```

- **Probabilités** : un modèle par actif et par horizon, entraîné sur l'historique (≈ 8 mois en horaire pour la crypto, 5 ans en journalier pour les actions), validé en *walk-forward* (il ne voit jamais les données qu'il prédit), calibré, puis légèrement ajusté par le sentiment des actualités.
- **Réussite réelle** : chaque heure, la prédiction 24 h est enregistrée puis vérifiée 24 h plus tard ; le score s'affiche dans « En conditions réelles ».
- **Fiabilité des sources** : chaque actualité marquante est vérifiée contre le mouvement du prix 24 h plus tard.

## Personnaliser
- **Personnes surveillées** : `config/people.txt` (une ligne par personne : `terme de recherche | libellé`).
- **Actifs et seuils d'alerte** : `config/settings.json`.
- Le bot relance automatiquement une analyse après chaque modification de ces fichiers.

## Limites honnêtes
- Les cours des actions gratuits sont **différés d'environ 15 minutes** ; la crypto est en temps réel.
- Les probabilités sont des estimations statistiques : une réussite de 55-60 % est déjà un très bon niveau pour ce type de modèle. Ce n'est pas un conseil en investissement.
- GitHub peut décaler les passages planifiés de quelques minutes aux heures chargées.

## Développement
- Tests : `cd bot && pip install -r requirements.txt && python -m pytest`
- Lancer le bot à la main : onglet **Actions** → **Bot Vigie** → **Run workflow**.
