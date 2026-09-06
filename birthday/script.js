/* ------------------------------------------------------------------
   Логика сайта. Правится редко — всё содержимое лежит в config.js
   ------------------------------------------------------------------ */
(function () {
  'use strict';

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  /* ---------- имя и подписи ---------- */
  $('#heroName').textContent = CONFIG.name;
  document.title = `С Днём Рождения, ${CONFIG.name}`;
  $$('.finale__sign').forEach(el => { el.textContent = CONFIG.from; });

  /* ---------- поляроиды ---------- */
  const PLACEHOLDER = `
    <div class="ph">
      <svg width="30" height="26" viewBox="0 0 30 26" fill="none" stroke="currentColor"
           stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M1 7.5A2.5 2.5 0 0 1 3.5 5h3L8.5 1.8h13L23.5 5h3A2.5 2.5 0 0 1 29 7.5v14a2.5 2.5 0 0 1-2.5 2.5h-23A2.5 2.5 0 0 1 1 21.5z"/>
        <circle cx="15" cy="14" r="5.4"/>
      </svg>
      <b>фото</b>
    </div>`;

  function makePolaroid(item, index) {
    const hasPhoto = Boolean(item.src);
    const el = document.createElement(hasPhoto ? 'button' : 'div');
    el.className = 'polaroid' + (hasPhoto ? '' : ' polaroid--empty');
    el.style.setProperty('--tilt', (item.tilt || 0) + 'deg');

    if (hasPhoto) {
      el.type = 'button';
      el.setAttribute('aria-label', 'Открыть фото: ' + (item.caption || ''));
      el.dataset.src = item.src;
      el.dataset.cap = item.caption || '';
    }

    el.innerHTML = `
      <div class="polaroid__frame">
        ${hasPhoto
          ? `<img src="${item.src}" alt="${item.caption || 'Фото'}" loading="lazy">`
          : PLACEHOLDER}
      </div>
      <div class="polaroid__cap">${item.caption || ''}</div>`;

    return el;
  }

  const heroBox = $('#heroPolaroids');
  (CONFIG.heroPhotos || []).forEach((p, i) => heroBox.appendChild(makePolaroid(p, i)));

  const grid = $('#galleryGrid');
  (CONFIG.photos || []).forEach((p, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'reveal';
    wrap.style.setProperty('--d', (i % 3) * 0.12 + 's');
    wrap.appendChild(makePolaroid(p, i));
    grid.appendChild(wrap);
  });

  /* ---------- пожелания ---------- */
  const wishesList = $('#wishesList');
  (CONFIG.wishes || []).forEach((text, i) => {
    const li = document.createElement('li');
    li.className = 'reveal';
    li.style.setProperty('--d', i * 0.08 + 's');
    li.textContent = text;
    wishesList.appendChild(li);
  });

  /* ---------- появление при скролле ---------- */
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

  $$('.reveal').forEach(el => io.observe(el));

  /* ---------- обратный отсчёт ---------- */
  function nextBirthday() {
    const now = new Date();
    let year = now.getFullYear();
    let target = new Date(year, CONFIG.month - 1, CONFIG.day, 0, 0, 0);
    if (now > new Date(year, CONFIG.month - 1, CONFIG.day, 23, 59, 59)) {
      target = new Date(year + 1, CONFIG.month - 1, CONFIG.day, 0, 0, 0);
    }
    return target;
  }

  const pad = n => String(n).padStart(2, '0');

  function tick() {
    const now = new Date();
    const isToday = now.getDate() === CONFIG.day && now.getMonth() === CONFIG.month - 1;

    if (isToday) {
      $('#countdownGrid').hidden = true;
      $('#cdToday').hidden = false;
      $('.countdown .eyebrow').textContent = 'ну наконец-то';
      return;
    }

    let diff = Math.max(0, nextBirthday() - now);
    const d = Math.floor(diff / 86400000); diff -= d * 86400000;
    const h = Math.floor(diff / 3600000);  diff -= h * 3600000;
    const m = Math.floor(diff / 60000);    diff -= m * 60000;
    const s = Math.floor(diff / 1000);

    $('#cdD').textContent = d;
    $('#cdH').textContent = pad(h);
    $('#cdM').textContent = pad(m);
    $('#cdS').textContent = pad(s);
  }
  tick();
  setInterval(tick, 1000);

  /* ---------- лайтбокс ---------- */
  const lb = $('#lightbox');
  const lbImg = $('#lightboxImg');
  const lbCap = $('#lightboxCap');
  let lastFocused = null;

  function openLightbox(src, cap) {
    lastFocused = document.activeElement;
    lbImg.src = src;
    lbImg.alt = cap || 'Фото';
    lbCap.textContent = cap || '';
    lb.hidden = false;
    document.body.style.overflow = 'hidden';
    $('#lightboxClose').focus();
  }
  function closeLightbox() {
    lb.hidden = true;
    lbImg.removeAttribute('src');
    document.body.style.overflow = '';
    if (lastFocused) lastFocused.focus();
  }

  document.addEventListener('click', (e) => {
    const card = e.target.closest('.polaroid[data-src]');
    if (card) { openLightbox(card.dataset.src, card.dataset.cap); return; }
    if (e.target === lb || e.target.id === 'lightboxClose') closeLightbox();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !lb.hidden) closeLightbox();
  });

  /* ---------- лепестки ---------- */
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduced) {
    const box = $('#petals');
    const COUNT = window.innerWidth < 700 ? 12 : 22;
    for (let i = 0; i < COUNT; i++) {
      const p = document.createElement('i');
      p.className = 'petal';
      const size = 5 + Math.random() * 9;
      p.style.width = size + 'px';
      p.style.height = size * 0.8 + 'px';
      p.style.left = Math.random() * 100 + 'vw';
      p.style.setProperty('--dx', (Math.random() * 24 - 12) + 'vw');
      p.style.animationDuration = (11 + Math.random() * 14) + 's';
      p.style.animationDelay = (-Math.random() * 22) + 's';
      p.style.opacity = (0.18 + Math.random() * 0.4).toFixed(2);
      box.appendChild(p);
    }
  }
})();
