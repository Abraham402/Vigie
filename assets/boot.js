"use strict";
/* Vigie — démarrage : choix démo / réel, installation sur l'écran d'accueil */
(async function () {
  const params = new URLSearchParams(location.search);
  const wantDemo = params.has("demo");
  let data = null;
  if (wantDemo) data = window.DEMO;
  else {
    try { data = await window.LIVE.load() }
    catch (e) {
      console.warn(e);
      document.getElementById("bootMsg").textContent = "Données réelles indisponibles : ouverture de la démo…";
      await new Promise(r => setTimeout(r, 900));
      data = window.DEMO;
    }
  }
  document.documentElement.dataset.mode = data.mode;
  try { await startApp(data) } catch (e) { console.error(e) }
  const boot = document.getElementById("boot"); boot.classList.add("out"); setTimeout(() => boot.remove(), 400);

  /* ---------- stockage durable ---------- */
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist() } catch (e) { }
  const ua = navigator.userAgent;
  const inApp = /FBAN|FBAV|Instagram|Line\/|Telegram|Snapchat|LinkedInApp|GSA\/|; wv\)|Claude/i.test(ua) || (/iPhone|iPad/.test(ua) && !/Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua));
  const installed = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const mobile = /Android|iPhone|iPad/i.test(ua);
  let dismissed = false; try { dismissed = sessionStorage.getItem("vigie-banner") === "1" } catch (e) { }
  if (mobile && !installed && !dismissed) {
    const ios = /iPhone|iPad/.test(ua);
    const bar = document.createElement("div"); bar.className = "save-bar";
    bar.innerHTML = inApp
      ? `<b>⚠️ Ce navigateur intégré efface vos données à la fermeture</b><span>Ouvrez Vigie dans ${ios ? "Safari" : "Chrome"} (menu ⋯ → « Ouvrir dans le navigateur »), puis installez-la sur l'écran d'accueil pour garder votre portefeuille et vos réglages.</span><button class="btn ai-b" id="saveHow">Comment faire</button><button class="linkbtn" id="saveX">Plus tard</button>`
      : `<b>💾 Installez Vigie pour ne rien perdre</b><span>Une fois sur l'écran d'accueil, votre portefeuille, vos réglages et votre progression sont conservés durablement.</span><button class="btn ai-b" id="saveHow">Installer</button><button class="linkbtn" id="saveX">Plus tard</button>`;
    document.body.appendChild(bar);
    document.getElementById("saveX").onclick = () => { bar.remove(); try { sessionStorage.setItem("vigie-banner", "1") } catch (e) { } };
    document.getElementById("saveHow").onclick = () => document.getElementById("installBtn").click();
  }

  /* ---------- application installable (PWA) ---------- */
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => { });
  const btn = document.getElementById("installBtn");
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  let deferred = null;
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferred = e; btn.hidden = false });
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (!standalone && /Android|iPhone|iPad/i.test(navigator.userAgent)) btn.hidden = false;
  btn.onclick = async () => {
    if (deferred) { deferred.prompt(); await deferred.userChoice; deferred = null; btn.hidden = true; return }
    openModal(`<div class="lesson"><h2>Installer Vigie sur votre téléphone</h2><p>Installée, Vigie fonctionne comme une vraie application et <b>garde vos données</b> (portefeuille, clé IA, progression) :</p><ol><li>Copiez l'adresse : <b>abraham402.github.io/Vigie</b> <button class="linkbtn" id="cpUrl">Copier</button></li><li>Ouvrez <b>${/iPhone|iPad/.test(navigator.userAgent) ? "Safari" : "Chrome"}</b> et collez l'adresse (pas depuis Telegram, Claude ou un e-mail : leurs navigateurs intégrés effacent tout).</li><li>${/iPhone|iPad/.test(navigator.userAgent) ? "Touchez <b>Partager</b> (carré avec une flèche vers le haut), puis <b>« Sur l'écran d'accueil »</b>." : "Touchez le menu <b>⋮</b>, puis <b>« Installer l'application »</b> ou « Ajouter à l'écran d'accueil »."}</li><li>Ouvrez désormais Vigie depuis son icône.</li></ol><p class="kicker">Astuce : ⚙️ → « Exporter » crée un fichier de sauvegarde de votre portefeuille.</p></div>`);
    const cp = document.getElementById("cpUrl"); if (cp) cp.onclick = () => { navigator.clipboard && navigator.clipboard.writeText("https://abraham402.github.io/Vigie/"); cp.textContent = "Copié ✓" };
  };
})();
