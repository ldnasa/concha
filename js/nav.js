// Concha - nav.js
// Header: menu mobile + solidificacao ao sair da area imersiva.
// Enquanto o palco do scrollytell estiver na tela, a nav fica transparente
// (o data-theme dela e controlado pelo hero-scroll.js).

(function () {
  "use strict";

  var nav = document.getElementById("siteNav");
  if (!nav) return;

  var menuBtn = document.getElementById("menuBtn");
  var mobilePanel = document.getElementById("mobilePanel");
  var immersive = document.getElementById("scrolly");

  // ---------- Menu mobile ----------
  function setMenu(open) {
    mobilePanel.classList.toggle("is-open", open);
    menuBtn.setAttribute("aria-expanded", String(open));
    menuBtn.querySelector(".icon-menu").style.display = open ? "none" : "";
    menuBtn.querySelector(".icon-close").style.display = open ? "" : "none";
  }

  menuBtn.addEventListener("click", function () {
    setMenu(!mobilePanel.classList.contains("is-open"));
  });

  mobilePanel.addEventListener("click", function (e) {
    if (e.target.closest("a")) setMenu(false);
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && mobilePanel.classList.contains("is-open")) {
      setMenu(false);
      menuBtn.focus();
    }
  });

  // ---------- Fundo solido apos a area imersiva ----------
  var overImmersive = false;
  var lastSolid = null;

  function paintNav() {
    // A barra flutuante ganha superficie assim que o scroll comeca, INCLUSIVE
    // sobre o palco imersivo. Antes isso era travado por !overImmersive,
    // porque a nav antiga era uma faixa solida de borda a borda e brigava com
    // o hero. A barra flutuante e o contrario: e justamente sobre o video
    // escuro que ela precisa do proprio substrato pra manter contraste.
    // No topo (scrollY 0) ela segue limpa, sobre o ceu claro do primeiro frame.
    var solid = window.scrollY > 40;
    if (solid !== lastSolid) {
      nav.classList.toggle("is-scrolled", solid);
      lastSolid = solid;
    }
  }

  if (immersive) {
    overImmersive = true;
    var immersiveIO = new IntersectionObserver(function (entries) {
      overImmersive = entries[0].isIntersecting;
      paintNav();
      paintTheme();
    }, { rootMargin: "-10% 0px -70% 0px" });
    immersiveIO.observe(immersive);
  }

  // ---------- Tema da nav conforme a banda que esta sob ela ----------
  // A nav e transparente, entao o texto dela precisa seguir o fundo real.
  // Enquanto o palco imersivo manda, quem decide e o hero-scroll.js; fora
  // dele, quem decide e a banda escura que estiver embaixo da barra.
  var darkBands = [].slice.call(document.querySelectorAll('[data-theme="dark"], [data-theme="cafe"]'))
    .filter(function (el) { return !immersive || !immersive.contains(el); });

  var underNav = new Set();

  function paintTheme() {
    if (overImmersive) return; // o scrollytell tem a palavra final
    if (underNav.size > 0) nav.setAttribute("data-theme", "cafe");
    else nav.removeAttribute("data-theme");
  }

  if (darkBands.length) {
    var navH = nav.getBoundingClientRect().height || 72;
    var bandIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) underNav.add(e.target);
        else underNav.delete(e.target);
      });
      paintTheme();
    }, { rootMargin: "0px 0px -" + Math.max(0, window.innerHeight - navH) + "px 0px" });

    darkBands.forEach(function (b) { bandIO.observe(b); });
  }

  window.addEventListener("scroll", paintNav, { passive: true });
  paintNav();
  paintTheme();
})();
