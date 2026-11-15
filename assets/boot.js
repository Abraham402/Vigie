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

  /* ---------- application installable (PWA) ---------- */
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => { });
  const btn = document.getElementById("installBtn");
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  let deferred = null;
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferred = e; btn.hidden = false });
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (ios && !standalone) btn.hidden = false;
  btn.onclick = async () => {
    if (deferred) { deferred.prompt(); await deferred.userChoice; deferred = null; btn.hidden = true; return }
    openModal(`<div class="lesson"><h2>Installer Vigie sur votre téléphone</h2><p>Vigie s'installe comme une vraie application, sans passer par un store :</p><ol><li>Ouvrez ce site dans <b>Safari</b> (iPhone) ou <b>Chrome</b> (Android).</li><li>Touchez le bouton <b>Partager</b> (le carré avec une flèche vers le haut) sur iPhone, ou le menu <b>⋮</b> sur Android.</li><li>Choisissez <b>« Sur l'écran d'accueil »</b> (ou « Installer l'application »).</li></ol><p>L'icône Vigie apparaît alors avec vos autres applications.</p></div>`);
  };
})();
