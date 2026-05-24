/* ══ НАСТРОЙКА ══ */
const SONGS = Array.from({ length: 9 }, (_, i) => ({
    num: i + 1,
    name: '',    /* заполняется из имени файла N(название).ext */
    file: null,  /* обнаруженное имя файла, иначе перебираем EXTS */
}));
const EXTS = ['mp3', 'ogg', 'wav', 'm4a', 'aac'];
const ROMAN = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
const CIRC = 283; /* 2π×45 ≈ 283 — длина окружности SVG */

/* ══ СОСТОЯНИЕ ══ */
let currentAudio = null;
let currentBtn = null;
let currentRing = null;
let progressRaf = null;
let vizRaf = null;
let audioCtx = null;
let analyser = null;
let hasRealViz = false;
let trackDuration = 0;
let loadToken = 0;
let currentLoadingBtn = null;

/* ══ ПОЛОСЫ ВИЗУАЛИЗАТОРА ══ */
const vizEl = document.getElementById('visualizer');
const vizBars = [];
for (let i = 0; i < 20; i++) {
    const b = document.createElement('div');
    b.className = 'viz-bar';
    vizEl.appendChild(b);
    vizBars.push(b);
}

/* ── Попытка подключить Web Audio ДО play() ─────────────────
   Если браузер блокирует (file://, CORS) — просто не подключаем,
   аудио продолжит играть через нативный маршрут.            */
function tryConnectWebAudio(audio) {
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 64;
            analyser.smoothingTimeConstant = 0.78;
        }
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const src = audioCtx.createMediaElementSource(audio);
        src.connect(analyser);
        analyser.connect(audioCtx.destination);
        return true;
    } catch (e) {
        return false; /* audio играет нативно — ничего не сломано */
    }
}

/* ── Запуск визуализатора (real или fake) ─── */
function startVisualizer(audio) {
    vizEl.classList.add('active');
    hasRealViz = tryConnectWebAudio(audio);

    const data = hasRealViz ? new Uint8Array(analyser.frequencyBinCount) : null;
    /* fake: каждая полоса бежит к случайной цели */
    const targets = vizBars.map(() => Math.random() * 0.65 + 0.2);
    const currents = vizBars.map(() => 0);

    function loop() {
        if (hasRealViz && analyser) {
            analyser.getByteFrequencyData(data);
            vizBars.forEach((bar, i) => {
                const v = Math.max(0.04, data[i] / 255);
                bar.style.clipPath = `inset(${((1 - v) * 100).toFixed(1)}% 0 0 0)`;
            });
        } else {
            vizBars.forEach((bar, i) => {
                if (Math.random() < 0.07) targets[i] = Math.random() * 0.7 + 0.15;
                currents[i] += (targets[i] - currents[i]) * 0.25;
                bar.style.clipPath = `inset(${((1 - currents[i]) * 100).toFixed(1)}% 0 0 0)`;
            });
        }
        checkShake();
        vizRaf = requestAnimationFrame(loop);
    }
    loop();
}

function stopVisualizer() {
    if (vizRaf) { cancelAnimationFrame(vizRaf); vizRaf = null; }
    vizEl.classList.remove('active');
    vizBars.forEach(b => b.style.clipPath = 'inset(100% 0 0 0)');
}

/* ══ КНОПКИ + SVG КОЛЬЦО ══ */
const grid = document.getElementById('grid');

SONGS.forEach((song, i) => {
    const btn = document.createElement('button');
    btn.className = 'song-btn';

    /* SVG кольцо прогресса */
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.classList.add('progress-ring');

    const bg = document.createElementNS(ns, 'circle');
    bg.setAttribute('cx', '50'); bg.setAttribute('cy', '50');
    bg.setAttribute('r', '45'); bg.classList.add('ring-bg');

    const fill = document.createElementNS(ns, 'circle');
    fill.setAttribute('cx', '50'); fill.setAttribute('cy', '50');
    fill.setAttribute('r', '45'); fill.classList.add('ring-fill');
    fill.style.strokeDashoffset = CIRC; /* пусто */

    svg.appendChild(bg);
    svg.appendChild(fill);
    btn.appendChild(svg);
    btn.insertAdjacentHTML('beforeend', `<span class="btn-num">${ROMAN[i]}</span>`);

    btn.addEventListener('click', e => {
        handleClick(song, btn, fill);
        initGyro();
    });
    btn.addEventListener('touchstart', () => { }, { passive: true });
    grid.appendChild(btn);
});

document.getElementById('stopBtn').addEventListener('click', () => stopAll(true));

/* ══ RIPPLE ══ */
function addRipple(btn, e) {
    const r = btn.getBoundingClientRect();
    const x = (e.clientX ?? r.left + r.width / 2) - r.left;
    const y = (e.clientY ?? r.top + r.height / 2) - r.top;
    const el = document.createElement('div');
    el.className = 'ripple-el';
    const s = r.width;
    el.style.cssText = `width:${s}px;height:${s}px;left:${x - s / 2}px;top:${y - s / 2}px`;
    btn.appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
}

/* ══ ВОСПРОИЗВЕДЕНИЕ ══ */
function handleClick(song, btn, ring) {
    if (currentBtn === btn) { stopAll(); return; }
    /* повторный клик по загружающейся кнопке — отмена */
    if (btn.classList.contains('loading')) {
        btn.classList.remove('loading');
        currentLoadingBtn = null;
        ++loadToken;
        return;
    }
    stopAll(); /* stopAll уже инкрементит loadToken если что-то грузилось */
    const token = ++loadToken;
    currentLoadingBtn = btn;
    btn.classList.add('loading');
    const candidates = song.file
        ? [`sound/${encodeURIComponent(song.file)}`]
        : EXTS.map(e => `sound/${song.num}.${e}`);
    tryPlay(song, btn, ring, candidates, 0, token);
}

function tryPlay(song, btn, ring, candidates, idx, token) {
    if (token !== loadToken) { btn.classList.remove('loading'); currentLoadingBtn = null; return; }
    if (idx >= candidates.length) {
        btn.classList.remove('loading');
        currentLoadingBtn = null;
        setDisplay('Файл не найден', false);
        return;
    }

    const audio = new Audio(candidates[idx]);
    audio.addEventListener('loadedmetadata', () => { trackDuration = audio.duration; }, { once: true });

    /* Promise.race: если audio.play() завис — через 4с переходим к следующему кандидату */
    let playTimer;
    const timeout = new Promise((_, rej) => { playTimer = setTimeout(() => rej(new Error('timeout')), 4000); });

    Promise.race([audio.play(), timeout])
        .then(() => {
            clearTimeout(playTimer);
            if (token !== loadToken) { audio.pause(); audio.src = ''; btn.classList.remove('loading'); currentLoadingBtn = null; return; }
            currentLoadingBtn = null;
            btn.classList.remove('loading');
            currentAudio = audio;
            currentBtn = btn;
            currentRing = ring;
            btn.classList.add('playing');
            setDisplay(song.name || `Песня ${ROMAN[song.num - 1]}`, true);
            startVisualizer(audio);
            if (lightOn && !lightRaf) lightRaf = requestAnimationFrame(lightLoop);
            startProgress();
            audio.addEventListener('ended', stopAll, { once: true });
        })
        .catch(() => { clearTimeout(playTimer); audio.src = ''; tryPlay(song, btn, ring, candidates, idx + 1, token); });
}

function stopAll(resetFx = false) {
    /* отмена любой незавершённой загрузки */
    if (currentLoadingBtn) {
        currentLoadingBtn.classList.remove('loading');
        currentLoadingBtn = null;
        ++loadToken;
    }
    if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
        currentAudio = null;
    }
    if (currentBtn) { currentBtn.classList.remove('playing', 'loading'); currentBtn = null; }
    if (currentRing) { currentRing.style.strokeDashoffset = CIRC; currentRing = null; }
    stopVisualizer();
    stopProgress();
    setDisplay('— Выберите песню —', false);

    /* сброс эффектов — только по явному запросу (кнопка ◼) */
    if (!resetFx) return;
    if (snowOn) { snowOn = false; document.getElementById('snowBtn').classList.remove('active'); cancelAnimationFrame(snowRaf); snowRaf = null; snowCtx.clearRect(0, 0, snowCanvas.width, snowCanvas.height); }
    if (leavesOn) { leavesOn = false; document.getElementById('leavesBtn').classList.remove('active'); cancelAnimationFrame(leavesRaf); leavesRaf = null; leafCtx.clearRect(0, 0, leafCanvas.width, leafCanvas.height); }
    if (typeof fireOn !== 'undefined' && fireOn) { fireOn = false; document.getElementById('fireBtn').classList.remove('active'); embers.length = 0; if (fireRaf) { cancelAnimationFrame(fireRaf); fireRaf = null; } fireCtx.clearRect(0, 0, fireCanvas.width, fireCanvas.height); }
    if (typeof lightOn !== 'undefined' && lightOn) { lightOn = false; document.getElementById('lightBtn').classList.remove('active'); lightAmt = 0; if (lightRaf) { cancelAnimationFrame(lightRaf); lightRaf = null; } lightCtx.clearRect(0, 0, lightCanvas.width, lightCanvas.height); if (_woman) _woman.style.filter = ''; }
    if (ornamentsOn) { ornamentsOn = false; document.getElementById('ornamentsBtn').classList.remove('active'); document.querySelectorAll('.khokhloma-ornament').forEach(s => s.style.opacity = '0'); }
    if (typeof shakeOn !== 'undefined' && shakeOn) { shakeOn = false; document.getElementById('shakeBtn').classList.remove('active'); }
    if (typeof filmOn !== 'undefined' && filmOn) { filmOn = false; document.getElementById('filmBtn').classList.remove('active'); filmVignette.classList.remove('active'); if (filmRaf) { cancelAnimationFrame(filmRaf); filmRaf = null; } filmCtx.clearRect(0, 0, filmCanvas.width, filmCanvas.height); }
}

/* ══ ПРОГРЕСС (requestAnimationFrame) ══ */
function startProgress() {
    if (progressRaf) cancelAnimationFrame(progressRaf);
    const fill = document.getElementById('progressFill');
    const timeEl = document.getElementById('dispTime');

    function tick() {
        if (!currentAudio) return;
        const dur = currentAudio.duration || trackDuration;
        const cur = currentAudio.currentTime;
        const pct = dur ? cur / dur : 0;

        fill.style.width = (pct * 100) + '%';
        fill.classList.toggle('has-dot', pct > 0);
        if (currentRing) currentRing.style.strokeDashoffset = CIRC * (1 - pct);
        timeEl.textContent = dur ? fmt(cur) + ' / ' + fmt(dur) : fmt(cur);

        progressRaf = requestAnimationFrame(tick);
    }
    tick();
}

function stopProgress() {
    if (progressRaf) { cancelAnimationFrame(progressRaf); progressRaf = null; }
    trackDuration = 0;
    const fill = document.getElementById('progressFill');
    fill.style.width = '0%';
    fill.classList.remove('has-dot');
    document.getElementById('dispTime').textContent = '--:--';
}

/* Перемотка: тап по дисплею */
document.getElementById('progressBar').addEventListener('click', e => {
    if (!currentAudio?.duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    currentAudio.currentTime =
        Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * currentAudio.duration;
    e.stopPropagation();
});

/* ══ ДИСПЛЕЙ ══ */
function setDisplay(text, playing) {
    const name = document.getElementById('dispSong');
    name.textContent = text;
    name.classList.toggle('active', playing);
    document.getElementById('dispTime').classList.toggle('active', playing);
    if (!playing) document.getElementById('dispTime').textContent = '--:--';
    if (typeof ornamentsPlaying === 'function') ornamentsPlaying(playing);
}

/* ══ ОБНАРУЖЕНИЕ ПЕСЕН ══
   Читает sound/songs.json (генерируется скриптом make-songs.py).
   Fallback: парсинг directory listing для локального Python-сервера. */
(async function discoverSongs() {
    /* 1. songs.json — работает везде включая GitHub Pages */
    try {
        const res = await fetch('sound/songs.json');
        if (res.ok) {
            const data = await res.json();
            data.forEach(({ num, name, file }) => {
                const song = SONGS.find(s => s.num === num);
                if (song) { song.name = name || ''; song.file = file || ''; }
            });
            return;
        }
    } catch (e) { }

    /* 2. directory listing — только локальный Python-сервер */
    try {
        const res = await fetch('sound/');
        if (!res.ok) return;
        if (!(res.headers.get('content-type') || '').includes('text/html')) return;
        const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
        [...doc.querySelectorAll('a[href]')].forEach(a => {
            const href = decodeURIComponent(a.getAttribute('href') || '').replace(/^.*\//, '');
            const m = href.match(/^(\d+)(?:\((.+)\))?\.(\w+)$/i);
            if (!m) return;
            const num = +m[1], name = m[2] || '', ext = m[3].toLowerCase();
            const song = SONGS.find(s => s.num === num);
            if (!song || !EXTS.includes(ext)) return;
            song.name = name; song.file = href;
        });
    } catch (e) { }
})();

/* ══ СНЕГ ══ */
const snowCanvas = document.createElement('canvas');
snowCanvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:100;';
document.body.appendChild(snowCanvas);
const snowCtx = snowCanvas.getContext('2d');

const flakes = Array.from({ length: 72 }, () => ({
    x: Math.random() * innerWidth,
    y: Math.random() * innerHeight,
    r: Math.random() * 2.5 + 0.8,
    speed: Math.random() * 0.8 + 0.25,
    drift: Math.random() * 0.4 - 0.2,
    wobble: Math.random() * Math.PI * 2,
    wobbleSpd: Math.random() * 0.025 + 0.005,
    opacity: Math.random() * 0.55 + 0.2,
}));

let snowOn = false;
let snowRaf = null;

function snowLoop() {
    snowCtx.clearRect(0, 0, snowCanvas.width, snowCanvas.height);
    flakes.forEach(f => {
        f.wobble += f.wobbleSpd;
        f.x += f.drift + Math.sin(f.wobble) * 0.4;
        f.y += f.speed;
        if (f.y > innerHeight + 8) { f.y = -8; f.x = Math.random() * innerWidth; }
        if (f.x > innerWidth + 8) f.x = -8;
        if (f.x < -8) f.x = innerWidth + 8;
        snowCtx.save();
        snowCtx.globalAlpha = f.opacity;
        snowCtx.fillStyle = '#fff';
        snowCtx.shadowBlur = 5;
        snowCtx.shadowColor = 'rgba(255,255,255,.6)';
        snowCtx.beginPath();
        snowCtx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        snowCtx.fill();
        snowCtx.restore();
    });
    snowRaf = requestAnimationFrame(snowLoop);
}

const snowBtn = document.getElementById('snowBtn');
snowBtn.addEventListener('click', () => {
    snowOn = !snowOn;
    snowBtn.classList.toggle('active', snowOn);
    if (snowOn) { snowLoop(); }
    else { cancelAnimationFrame(snowRaf); snowRaf = null; snowCtx.clearRect(0, 0, snowCanvas.width, snowCanvas.height); }
});

/* ══ ОГОНЬ (искры-угольки) ══ */
const fireCanvas = document.createElement('canvas');
fireCanvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99;';
document.body.appendChild(fireCanvas);
const fireCtx = fireCanvas.getContext('2d');

function mkEmber() {
    const side = Math.random();
    return {
        x: side < 0.5
            ? Math.random() * innerWidth * 0.45                      /* левая часть */
            : innerWidth * 0.55 + Math.random() * innerWidth * 0.45, /* правая */
        y: innerHeight + 6,
        vx: (Math.random() - 0.5) * 1.4,
        vy: -(Math.random() * 2.8 + 1.2),
        r: Math.random() * 2.4 + 0.5,
        life: 1,
        decay: Math.random() * 0.007 + 0.003,
    };
}

const embers = [];
let fireOn = false, fireRaf = null;

function fireLoop() {
    fireCtx.clearRect(0, 0, fireCanvas.width, fireCanvas.height);
    if (fireOn && embers.length < 90) embers.push(mkEmber());

    for (let i = embers.length - 1; i >= 0; i--) {
        const p = embers[i];
        p.x += p.vx + Math.sin(p.life * 8) * 0.35;
        p.y += p.vy;
        p.vy += 0.018;          /* лёгкое замедление при подъёме */
        p.life -= p.decay;
        if (p.life <= 0) { embers.splice(i, 1); continue; }

        const a = p.life * 0.88;
        const col = p.life > 0.65
            ? `rgba(255,210,55,${a})`
            : p.life > 0.35
                ? `rgba(255,90,15,${a})`
                : `rgba(210,15,5,${a})`;

        fireCtx.save();
        fireCtx.shadowBlur = 9;
        fireCtx.shadowColor = col;
        fireCtx.fillStyle = col;
        fireCtx.beginPath();
        fireCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        fireCtx.fill();
        fireCtx.restore();
    }

    if (embers.length > 0 || fireOn) fireRaf = requestAnimationFrame(fireLoop);
    else { fireRaf = null; fireCtx.clearRect(0, 0, fireCanvas.width, fireCanvas.height); }
}

const fireBtn = document.getElementById('fireBtn');
fireBtn.addEventListener('click', () => {
    fireOn = !fireOn;
    fireBtn.classList.toggle('active', fireOn);
    if (fireOn && !fireRaf) fireLoop();
});

/* ══ ЛИСТЬЯ ══ */
const leafCanvas = document.createElement('canvas');
leafCanvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:101;';
document.body.appendChild(leafCanvas);
const leafCtx = leafCanvas.getContext('2d');

const LEAF_COLS = ['#F71015', '#FF6600', '#FFAA00', '#CC3300', '#FF8C00', '#E85000'];
const leafArr = Array.from({ length: 38 }, () => ({
    x: Math.random() * innerWidth,
    y: Math.random() * innerHeight,
    rx: Math.random() * 7 + 5,
    ry: Math.random() * 4 + 2.5,
    speed: Math.random() * 1.1 + 0.5,
    drift: Math.random() * 1.0 - 0.5,
    wobble: Math.random() * Math.PI * 2,
    wobbleSpd: Math.random() * 0.028 + 0.008,
    rot: Math.random() * Math.PI * 2,
    rotSpd: (Math.random() - 0.5) * 0.05,
    opacity: Math.random() * 0.45 + 0.35,
    col: LEAF_COLS[Math.floor(Math.random() * LEAF_COLS.length)],
}));

let leavesOn = false;
let leavesRaf = null;

function leafLoop() {
    leafCtx.clearRect(0, 0, leafCanvas.width, leafCanvas.height);
    leafArr.forEach(l => {
        l.wobble += l.wobbleSpd;
        l.rot += l.rotSpd;
        l.x += l.drift + Math.sin(l.wobble) * 0.9;
        l.y += l.speed;
        if (l.y > innerHeight + 14) { l.y = -14; l.x = Math.random() * innerWidth; }
        if (l.x > innerWidth + 14) l.x = -14;
        if (l.x < -14) l.x = innerWidth + 14;
        leafCtx.save();
        leafCtx.translate(l.x, l.y);
        leafCtx.rotate(l.rot);
        leafCtx.globalAlpha = l.opacity;
        leafCtx.fillStyle = l.col;
        leafCtx.shadowBlur = 5;
        leafCtx.shadowColor = l.col;
        leafCtx.beginPath();
        leafCtx.ellipse(0, 0, l.rx, l.ry, 0, 0, Math.PI * 2);
        leafCtx.fill();
        leafCtx.restore();
    });
    leavesRaf = requestAnimationFrame(leafLoop);
}

const leavesBtn = document.getElementById('leavesBtn');
leavesBtn.addEventListener('click', () => {
    leavesOn = !leavesOn;
    leavesBtn.classList.toggle('active', leavesOn);
    if (leavesOn) { leafLoop(); }
    else { cancelAnimationFrame(leavesRaf); leavesRaf = null; leafCtx.clearRect(0, 0, leafCanvas.width, leafCanvas.height); }
});

/* ══ ПАРАЛЛАКС (ГИРОСКОП / МЫШЬ) ══ */
const _woman = document.querySelector('.woman-corner');
const _title = document.querySelector('.title');
const _bwrap = document.querySelector('.buttons-wrapper');

let ptx = 0, pty = 0, pcx = 0, pcy = 0;
let gyroActive = false, gyroAsked = false;

async function initGyro() {
    if (gyroAsked) return;
    gyroAsked = true;
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
        try {
            if (await DeviceOrientationEvent.requestPermission() === 'granted') startGyro();
        } catch (e) { }
    } else {
        startGyro();
    }
}

function startGyro() {
    gyroActive = true;
    window.addEventListener('deviceorientation', e => {
        ptx = Math.max(-1, Math.min(1, (e.gamma || 0) / 22));
        pty = Math.max(-1, Math.min(1, ((e.beta || 45) - 45) / 22));
    });
}

/* мышь для десктопа */
document.addEventListener('mousemove', e => {
    if (gyroActive) return;
    ptx = (e.clientX / innerWidth - 0.5) * 2;
    pty = (e.clientY / innerHeight - 0.5) * 2;
});

/* плавный параллакс через RAF */
(function parallaxLoop() {
    pcx += (ptx - pcx) * 0.07;
    pcy += (pty - pcy) * 0.07;
    if (_woman) _woman.style.transform = `translateY(${pcy * 18}px)`;
    if (_title) _title.style.transform = `translate(${-pcx * 10}px, ${-pcy * 6}px)`;
    if (_bwrap) _bwrap.style.transform = `translate(${pcx * 5}px, ${pcy * 3}px)`;
    requestAnimationFrame(parallaxLoop);
})();

/* ══ WAKE LOCK ══ */
let wakeLock = null, wakeLockOn = false;
const wakeLockBtn = document.getElementById('wakeLockBtn');

async function toggleWakeLock() {
    if (!('wakeLock' in navigator)) { wakeLockBtn.title = 'Не поддерживается'; return; }
    if (wakeLockOn) {
        await wakeLock?.release();
        wakeLock = null; wakeLockOn = false;
    } else {
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLockOn = true;
            wakeLock.addEventListener('release', () => {
                wakeLockOn = false;
                wakeLockBtn.classList.remove('active');
            });
        } catch (e) { }
    }
    wakeLockBtn.classList.toggle('active', wakeLockOn);
}
wakeLockBtn.addEventListener('click', toggleWakeLock);

/* ══ TOGGLE УЗОРОВ ══ */
let ornamentsOn = false;
let ornamentsDrawn = false;
const ornamentsBtn = document.getElementById('ornamentsBtn');
ornamentsBtn.addEventListener('click', () => {
    ornamentsOn = !ornamentsOn;
    ornamentsBtn.classList.toggle('active', ornamentsOn);
    if (ornamentsOn) {
        document.querySelectorAll('.khokhloma-ornament').forEach(s => s.style.opacity = '0.65');
        if (!ornamentsDrawn) {
            ornamentsDrawn = true;
            animPaths.forEach((p, i) => {
                p.style.transition = `stroke-dashoffset ${1.6 + i * 0.06}s ease`;
                p.style.strokeDashoffset = '0';
            });
        }
    } else {
        document.querySelectorAll('.khokhloma-ornament').forEach(s => s.style.opacity = '0');
    }
});

/* восстановить wake lock при возврате на вкладку */
document.addEventListener('visibilitychange', async () => {
    if (wakeLockOn && document.visibilityState === 'visible') {
        try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { }
    }
});

/* ══ ХОХЛОМСКИЕ УЗОРЫ ══ */
(function () {
    const NS = 'http://www.w3.org/2000/svg';
    const SIZE = 130;

    const VINE = 'M 6,6 C 8,42 42,48 56,28 C 70,8 90,34 80,58 C 70,82 44,88 50,118';
    const BR1 = 'M 56,28 C 74,12 102,18 116,6';
    const BR2 = 'M 80,58 C 100,44 120,50 126,38';
    const LEAF1 = 'M 56,28 C 48,18 46,10 56,8 C 66,6 68,18 62,26 Z';
    const LEAF2 = 'M 80,58 C 72,48 72,40 80,38 C 88,36 90,48 84,56 Z';
    const BERRIES = [
        { cx: 116, cy: 6, r: 6 }, { cx: 122, cy: 12, r: 3.5 }, { cx: 110, cy: 12, r: 3.5 },
        { cx: 126, cy: 38, r: 5.5 }, { cx: 122, cy: 44, r: 3.5 },
        { cx: 50, cy: 118, r: 7 }, { cx: 43, cy: 113, r: 4 }, { cx: 57, cy: 113, r: 4 },
    ];

    const CORNERS = [
        ['left:0;top:0', ''],
        ['right:0;top:0', 'scaleX(-1)'],
        ['left:0;bottom:0', 'scaleY(-1)'],
        ['right:0;bottom:0', 'scale(-1,-1)'],
    ];

    window.animPaths = [];

    CORNERS.forEach(([pos, tfm]) => {
        const svg = document.createElementNS(NS, 'svg');
        svg.classList.add('khokhloma-ornament');
        svg.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);
        svg.setAttribute('width', SIZE);
        svg.setAttribute('height', SIZE);
        svg.style.cssText = `position:fixed;pointer-events:none;z-index:98;opacity:0.65;transition:opacity .8s;`;
        pos.split(';').forEach(s => {
            const [k, v] = s.split(':');
            if (k && v) svg.style[k.trim()] = v.trim();
        });
        if (tfm) svg.style.transform = tfm;

        function path(d, stroke, w) {
            const p = document.createElementNS(NS, 'path');
            p.setAttribute('d', d); p.setAttribute('fill', 'none');
            p.setAttribute('stroke', stroke); p.setAttribute('stroke-width', w);
            p.setAttribute('stroke-linecap', 'round');
            return p;
        }
        function filled(d, fill) {
            const p = document.createElementNS(NS, 'path');
            p.setAttribute('d', d); p.setAttribute('fill', fill);
            return p;
        }

        const vine = path(VINE, '#C8A200', 2.5);
        const br1 = path(BR1, '#C8A200', 2);
        const br2 = path(BR2, '#B09000', 2);
        svg.append(vine, br1, br2, filled(LEAF1, '#8B7000'), filled(LEAF2, '#8B7000'));

        BERRIES.forEach(({ cx, cy, r }) => {
            const c = document.createElementNS(NS, 'circle');
            c.setAttribute('cx', cx); c.setAttribute('cy', cy);
            c.setAttribute('r', r); c.setAttribute('fill', '#F71015');
            svg.appendChild(c);
            const h = document.createElementNS(NS, 'circle');
            h.setAttribute('cx', cx - r * .3); h.setAttribute('cy', cy - r * .3);
            h.setAttribute('r', r * .35); h.setAttribute('fill', 'rgba(255,220,100,.55)');
            svg.appendChild(h);
        });

        document.body.appendChild(svg);

        [vine, br1, br2].forEach(p => {
            const len = p.getTotalLength();
            p.style.strokeDasharray = len;
            p.style.strokeDashoffset = len;
            window.animPaths.push(p);
        });
    });

    /* узоры скрыты по умолчанию */
    document.querySelectorAll('.khokhloma-ornament').forEach(s => s.style.opacity = '0');

    window.ornamentsPlaying = playing => {
        if (!ornamentsOn) return;
        document.querySelectorAll('.khokhloma-ornament').forEach(s => {
            s.style.opacity = playing ? '0.92' : '0.65';
        });
    };
})();

/* ══ FULLSCREEN (клавиша F / двойной тап по заголовку) ══ */
function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.();
    } else {
        document.exitFullscreen?.();
    }
}

document.addEventListener('keydown', e => {
    if (e.key === 'f' || e.key === 'F') toggleFullscreen();
});

let lastTap = 0;
const titleEl = document.querySelector('.title');
titleEl.addEventListener('touchend', e => {
    const now = Date.now();
    if (now - lastTap < 300) { e.preventDefault(); toggleFullscreen(); }
    lastTap = now;
});
titleEl.addEventListener('dblclick', toggleFullscreen);

/* ══ ПЛЁНКА ══ */
const filmCanvas = document.createElement('canvas');
filmCanvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:150;mix-blend-mode:screen;';
document.body.appendChild(filmCanvas);
const filmCtx = filmCanvas.getContext('2d');

const GRAIN_SZ = 200;
const grainOff = document.createElement('canvas');
grainOff.width = grainOff.height = GRAIN_SZ;
const grainOffCtx = grainOff.getContext('2d');

function genGrain() {
    const id = grainOffCtx.createImageData(GRAIN_SZ, GRAIN_SZ);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
        const v = (Math.random() * 210) | 0;
        d[i] = d[i + 1] = d[i + 2] = v;
        d[i + 3] = (Math.random() * 28 + 4) | 0;
    }
    grainOffCtx.putImageData(id, 0, 0);
}

let filmOn = false, filmRaf = null, filmTick = 0;
const filmVignette = document.getElementById('filmVignette');
const filmBtn = document.getElementById('filmBtn');

function filmLoop() {
    filmTick++;
    if (filmTick % 2 === 0) genGrain();

    filmCtx.clearRect(0, 0, filmCanvas.width, filmCanvas.height);
    const w = filmCanvas.width, h = filmCanvas.height;
    const ox = (Math.random() * GRAIN_SZ) | 0;
    const oy = (Math.random() * GRAIN_SZ) | 0;
    filmCtx.save();
    filmCtx.translate(-ox, -oy);
    for (let x = 0; x <= w + GRAIN_SZ; x += GRAIN_SZ)
        for (let y = 0; y <= h + GRAIN_SZ; y += GRAIN_SZ)
            filmCtx.drawImage(grainOff, x, y);
    filmCtx.restore();

    if (filmOn) filmRaf = requestAnimationFrame(filmLoop);
    else { filmRaf = null; filmCtx.clearRect(0, 0, filmCanvas.width, filmCanvas.height); }
}

filmBtn.addEventListener('click', () => {
    filmOn = !filmOn;
    filmBtn.classList.toggle('active', filmOn);
    filmVignette.classList.toggle('active', filmOn);
    if (filmOn && !filmRaf) filmLoop();
});

/* ══ СВЕТ ══ */
const lightCanvas = document.createElement('canvas');
lightCanvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:1;mix-blend-mode:screen;';
document.body.appendChild(lightCanvas);
const lightCtx = lightCanvas.getContext('2d');

let lightOn = false, lightRaf = null, lightAmt = 0;
const lightBtn = document.getElementById('lightBtn');

function lightLoop() {
    lightCtx.clearRect(0, 0, lightCanvas.width, lightCanvas.height);
    let target = 0;
    if (lightOn && currentBtn) {
        if (analyser && hasRealViz) {
            const d = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteFrequencyData(d);
            const avg = d.slice(0, 10).reduce((s, v) => s + v, 0) / 10;
            target = Math.max(0.22, avg / 255);
        } else if (currentAudio) {
            target = 0.28 + Math.sin(Date.now() / 270) * 0.13;
        }
    }
    lightAmt += (target - lightAmt) * 0.09;

    if (lightAmt > 0.01 && currentBtn) {
        const rc = currentBtn.getBoundingClientRect();
        const cx = rc.left + rc.width / 2;
        const cy = rc.top + rc.height / 2;
        const rad = Math.hypot(innerWidth, innerHeight) * 0.95;
        const g = lightCtx.createRadialGradient(cx, cy, rc.width * 0.3, cx, cy, rad);
        g.addColorStop(0, `rgba(255,90,20,${+(lightAmt * 0.75).toFixed(3)})`);
        g.addColorStop(0.18, `rgba(247,30,8,${+(lightAmt * 0.42).toFixed(3)})`);
        g.addColorStop(0.5, `rgba(200,10,0,${+(lightAmt * 0.18).toFixed(3)})`);
        g.addColorStop(1, 'rgba(140,4,0,0)');
        lightCtx.fillStyle = g;
        lightCtx.fillRect(0, 0, lightCanvas.width, lightCanvas.height);
        if (_woman) _woman.style.filter =
            `brightness(${(1 + lightAmt * 0.85).toFixed(2)}) contrast(1.07)`;
    } else if (_woman) {
        _woman.style.filter = '';
    }

    if (lightAmt > 0.008 || (lightOn && currentBtn)) {
        lightRaf = requestAnimationFrame(lightLoop);
    } else {
        lightRaf = null;
        lightCtx.clearRect(0, 0, lightCanvas.width, lightCanvas.height);
        if (_woman) _woman.style.filter = '';
    }
}

lightBtn.addEventListener('click', () => {
    lightOn = !lightOn;
    lightBtn.classList.toggle('active', lightOn);
    if (lightOn && currentAudio && !lightRaf) lightRaf = requestAnimationFrame(lightLoop);
});

/* ══ ТРЯСКА ══ */
const appEl = document.querySelector('.app');
let shakeOn = false, lastShakeTm = 0;
const shakeBtn = document.getElementById('shakeBtn');

function checkShake() {
    if (!shakeOn || !analyser || !hasRealViz || !currentAudio) return;
    const now = Date.now();
    if (now - lastShakeTm < 250) return;
    const d = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(d);
    if (d[0] > 158) {
        lastShakeTm = now;
        appEl.classList.remove('shaking');
        void appEl.offsetWidth; /* reflow для перезапуска анимации */
        appEl.classList.add('shaking');
        appEl.addEventListener('animationend', () => appEl.classList.remove('shaking'), { once: true });
        if ('vibrate' in navigator) navigator.vibrate(Math.round(d[0] / 255 * 35 + 10));
    }
}

shakeBtn.addEventListener('click', () => {
    shakeOn = !shakeOn;
    shakeBtn.classList.toggle('active', shakeOn);
});

/* ══ ДИАЛОГ НАСТРОЕК ══ */
const settingsOverlay = document.getElementById('settingsOverlay');
const settingsBtn = document.getElementById('settingsBtn');
const settingsClose = document.getElementById('settingsClose');

function openSettings() { settingsOverlay.classList.add('open'); }
function closeSettings() { settingsOverlay.classList.remove('open'); }

settingsBtn.addEventListener('click', openSettings);
settingsClose.addEventListener('click', closeSettings);
settingsOverlay.addEventListener('click', e => {
    if (e.target === settingsOverlay) closeSettings();
});

/* закрыть свайпом вниз по панели */
let dragStartY = 0;
settingsOverlay.querySelector('.settings-panel').addEventListener('touchstart', e => {
    dragStartY = e.touches[0].clientY;
}, { passive: true });
settingsOverlay.querySelector('.settings-panel').addEventListener('touchend', e => {
    if (e.changedTouches[0].clientY - dragStartY > 60) closeSettings();
}, { passive: true });

/* ══ RESIZE (все canvas) ══ */
window.addEventListener('resize', () => {
    snowCanvas.width = innerWidth; snowCanvas.height = innerHeight;
    fireCanvas.width = innerWidth; fireCanvas.height = innerHeight;
    leafCanvas.width = innerWidth; leafCanvas.height = innerHeight;
    filmCanvas.width = innerWidth; filmCanvas.height = innerHeight;
    lightCanvas.width = innerWidth; lightCanvas.height = innerHeight;
});
snowCanvas.width = innerWidth; snowCanvas.height = innerHeight;
fireCanvas.width = innerWidth; fireCanvas.height = innerHeight;
leafCanvas.width = innerWidth; leafCanvas.height = innerHeight;
filmCanvas.width = innerWidth; filmCanvas.height = innerHeight;
lightCanvas.width = innerWidth; lightCanvas.height = innerHeight;

/* ══ УТИЛИТА ══ */
function fmt(s) {
    if (!isFinite(s)) return '--:--';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
