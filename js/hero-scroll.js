// Concha - hero-scroll.js
// Scrub do video do hero dirigido pelo scroll nativo (1:1, sem sequestro).
// Toda a coreografia vive aqui, em progresso normalizado 0..1 do track.
// GPU-only: so opacity, transform, filter e a troca de data-theme.

(function () {
  "use strict";

  var scrolly = document.getElementById("scrolly");
  if (!scrolly) return;

  var video = scrolly.querySelector(".scrolly-video");
  var track = scrolly.querySelector(".scrolly-track");
  var scrim = scrolly.querySelector(".scrolly-scrim");
  var veil = scrolly.querySelector(".scrolly-veil");
  var nav = document.getElementById("siteNav");
  var hint = scrolly.querySelector(".scroll-hint");

  var layerHero = scrolly.querySelector(".layer-hero");
  var layerNote = scrolly.querySelector(".layer-note");

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var mqCoarse = window.matchMedia("(max-width: 768px)");
  var isCoarse = mqCoarse.matches;

  // ---------- Coreografia (marcas em progresso 0..1 do track) ----------
  //
  // O track tem duas fases:
  //   FASE A (0 -> SCRUB_END): o scroll dirige o video.
  //   FASE B (SCRUB_END -> 1): o video CONGELA no ultimo frame e o fundo vira
  //                            palco fixo; so os blocos de texto trocam.
  //
  // As marcas da fase A saem da curva de luminancia medida do video (6.04s):
  //   video t=3.8s  golden ratio sobre a concha real (lum 204 -> 126)
  //   video t=4.35s cena ja totalmente escura        (lum ~36)
  //   video t=6.04s desenho tecnico sobre o vinho da marca
  // Convertidas pro track: p = SCRUB_END * (t / 6.04).
  var SCRUB_END = 0.56;

  // O video escurece rapido: cai de 207 pra 119 de luminancia em 1.35s de 8.12s.
  // Mapeado linear, a headline (texto cafe, precisa de fundo claro) teria menos
  // de 1s de vida. Esta curva gasta mais rolagem no comeco do video e acelera
  // depois, entao a abertura clara dura o tempo de ler o titulo. O scroll segue
  // 1:1 com o gesto, so a taxa de avanco do video muda.
  var SCRUB_EASE = 2.2;

  var CUE = {
    hint:     { out: [0.01, 0.06] },
    hero:     { out: [0.10, 0.20] },
    // t~3.8s -> p 0.352. A placa cai no frame em que a estrutura aparece
    // sobre a concha real: ilustracao literal de "estrutura antes de estetica".
    note:     { in: [0.29, 0.35], out: [0.40, 0.45] },
    // O video ja termina em #341012, praticamente o vinho da marca, entao o
    // scrim serve mais pra legibilidade do texto do que pra corrigir cor.
    // Satura antes do congelamento e fica constante na fase B.
    scrim:    { in: [0.40, 0.52], max: 0.40, outro: [0.52, SCRUB_END], outroMax: 0.25 },
    blur:     { in: [0.46, SCRUB_END], max: 6 },
    navFlip:  0.42
  };

  // Blocos de texto da fase B. Adicionar um tempo novo = markup + uma linha.
  var BEATS = [
    { sel: '[data-beat="1"]', in: [0.57, 0.63], out: [0.70, 0.75] },
    { sel: '[data-beat="2"]', in: [0.78, 0.84], out: null }
  ];

  var beats = BEATS.map(function (b) {
    return { el: scrolly.querySelector(b.sel), in: b.in, out: b.out };
  }).filter(function (b) { return b.el; });

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function range(p, a, b) { return clamp01((p - a) / (b - a)); }

  // ---------- Fallback estatico ----------
  // Sem scrub: reduced-motion, ou browser que nao toca h264.
  var canScrub = !reduced && video && video.canPlayType &&
                 video.canPlayType('video/mp4; codecs="avc1.42E01E"') !== "";

  if (!canScrub) {
    scrolly.classList.add("is-static");
    if (video) { video.removeAttribute("src"); video.load(); }
    return;
  }

  // ---------- Estado ----------
  var duration = 0;
  var eased = 0;
  var lastSet = -1;
  var running = false;
  var inView = true;
  var lastNavDark = null;

  function readDuration() {
    if (!duration && video.duration && isFinite(video.duration)) duration = video.duration;
    return duration;
  }

  // Listeners ANTES do load, senao um video em cache pode disparar
  // loadedmetadata sem ninguem escutando e o scrub nasce com duration 0.
  video.addEventListener("loadedmetadata", function () { readDuration(); start(); });
  video.addEventListener("durationchange", function () { readDuration(); start(); });
  video.addEventListener("loadeddata", function () {
    scrolly.classList.add("is-ready");
    start();
  });

  // Fonte por viewport: mobile decodifica menos pixel. Reavaliada quando a
  // media query vira, senao quem redimensiona ou gira o aparelho fica preso
  // na fonte escolhida no primeiro load.
  function pickSource() {
    var want = isCoarse ? video.dataset.srcSm : video.dataset.src;
    if (video.getAttribute("src") === want) return;

    var keep = eased;
    video.setAttribute("src", want);
    video.load();

    video.addEventListener("loadeddata", function restore() {
      video.removeEventListener("loadeddata", restore);
      lastSet = -1;
      eased = keep;
      if (video.readyState >= 2) video.currentTime = keep;
    });
  }

  mqCoarse.addEventListener("change", function (e) {
    isCoarse = e.matches;
    if (isCoarse) video.style.removeProperty("--blur");
    pickSource();
    start();
  });

  pickSource();

  // iOS so libera o decode depois de um play() mudo
  function unlock() {
    var p = video.play();
    if (p && p.then) p.then(function () { video.pause(); }).catch(function () {});
    else video.pause();
  }
  unlock();
  document.addEventListener("touchstart", unlock, { once: true, passive: true });

  // ---------- Progresso ----------
  function progress() {
    var rect = track.getBoundingClientRect();
    var scrollable = rect.height - window.innerHeight;
    if (scrollable <= 0) return 0;
    return clamp01(-rect.top / scrollable);
  }

  // ---------- Coreografia ----------
  function paint(p) {
    // Hero sai subindo de leve
    var heroOut = range(p, CUE.hero.out[0], CUE.hero.out[1]);
    layerHero.style.opacity = String(1 - heroOut);
    layerHero.style.transform = "translate3d(0," + (-heroOut * 32).toFixed(2) + "px,0)";

    // O veu claro existe pra proteger o texto do hero: sai junto com ele
    veil.style.opacity = String(1 - heroOut);

    if (hint) hint.style.opacity = String(1 - range(p, CUE.hint.out[0], CUE.hint.out[1]));

    // Placa de anotacao, ancorada no desenho do golden ratio
    var noteIn = range(p, CUE.note.in[0], CUE.note.in[1]);
    var noteOut = range(p, CUE.note.out[0], CUE.note.out[1]);
    layerNote.style.opacity = String(Math.min(noteIn, 1 - noteOut));
    layerNote.style.transform = "translate3d(0," + ((1 - noteIn) * 18).toFixed(2) + "px,0)";

    // Scrim vinho: legibilidade + fechamento na cor da banda seguinte
    var scrimAmount = range(p, CUE.scrim.in[0], CUE.scrim.in[1]) * CUE.scrim.max +
                      range(p, CUE.scrim.outro[0], CUE.scrim.outro[1]) * CUE.scrim.outroMax;
    scrim.style.setProperty("--scrim", scrimAmount.toFixed(3));

    // Desfoque so no desktop: no mobile o repaint nao compensa
    if (!isCoarse) {
      video.style.setProperty("--blur", (range(p, CUE.blur.in[0], CUE.blur.in[1]) * CUE.blur.max).toFixed(2) + "px");
    }

    // Blocos de texto sobre o fundo congelado
    beats.forEach(function (b) {
      var fin = range(p, b.in[0], b.in[1]);
      var fout = b.out ? range(p, b.out[0], b.out[1]) : 0;
      b.el.style.opacity = String(Math.min(fin, 1 - fout));
      b.el.style.transform = "translate3d(0," + ((1 - fin) * 20).toFixed(2) + "px,0)";
    });

    // Nav troca de tema so quando o video ja escureceu de verdade
    var navDark = p >= CUE.navFlip;
    if (navDark !== lastNavDark) {
      if (navDark) nav.setAttribute("data-theme", "cafe");
      else nav.removeAttribute("data-theme");
      lastNavDark = navDark;
    }

    return p;
  }

  // ---------- Loop ----------
  // Roda enquanto o palco estiver em vista. Suaviza o seek: o scroll
  // pula, o video nao deve pular junto.
  function loop() {
    if (!inView) { running = false; return; }

    var p = paint(progress());
    var dur = readDuration();

    if (dur > 0) {
      // Fase A dirige o video; fase B segura no ultimo frame. O epsilon evita
      // parar exatamente em `duration`, onde alguns browsers soltam o frame.
      var videoP = Math.pow(clamp01(p / SCRUB_END), SCRUB_EASE);
      var target = Math.min(videoP * dur, dur - 0.06);
      var delta = target - eased;
      eased = Math.abs(delta) < 0.005 ? target : eased + delta * 0.2;

      if (video.readyState >= 2 && Math.abs(eased - lastSet) > 0.008) {
        video.currentTime = eased;
        lastSet = eased;
      }
    }

    requestAnimationFrame(loop);
  }

  function start() {
    if (running) return;
    running = true;
    requestAnimationFrame(loop);
  }

  var io = new IntersectionObserver(function (entries) {
    inView = entries[0].isIntersecting;
    if (inView) start();
  }, { rootMargin: "15% 0px" });
  io.observe(scrolly);

  window.addEventListener("resize", function () { start(); }, { passive: true });

  start();
})();
