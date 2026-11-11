'use strict';

const $ = (id) => document.getElementById(id);
const app = $('app');
const main = document.querySelector('main');
const cards = $('cards');
const empty = $('empty');
const state = $('state');
const panel = $('panel');
const fmt = new Intl.NumberFormat('fr-FR');
const short = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });

const STATS = ['damage', 'taken', 'heal', 'armor'];
const STAT_LABEL = { damage: 'Dégâts infligés', taken: 'Dégâts reçus', heal: 'Soins', armor: 'Armure' };

let data = { fight: null, cumul: null };
let status = null;
let classes = [];
let portraits = {};
let stat = 'damage';
let cumulOn = false;
let panelFor = null; // { kind: 'detail' | 'picker' | 'welcome', name }
let version = '';

// Per-viewer preferences, kept between sessions.
function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}
const hidden = new Set(load('hidden', []));
const chosenPortrait = load('portraits', {}); // name -> portrait key, e.g. "91"
const seenBreed = load('breeds', {}); // name -> breed detected in a past fight
let opaque = load('opaque', false);
let vertical = load('vertical', false);
let clickThrough = load('clickThrough', false);
let scale = Math.min(4, Math.max(0.5, Number(load('zoom', 1)) || 1));

function el(tag, props = {}, ...children) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

const duration = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const compact = (v) => (v >= 1e5 ? short.format(v) : fmt.format(v));
const dpt = (f) => (f && f.turns ? Math.round(f.damage / f.turns) : null);

function portraitKey(name) {
  if (chosenPortrait[name]) return chosenPortrait[name];
  return seenBreed[name] ? `${seenBreed[name]}0` : null;
}
function className(name) {
  const key = portraitKey(name);
  return classes.find((c) => key && String(c.id) === key.slice(0, -1))?.name;
}
function initials(name) {
  return name.split(/[\s'-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}
function portraitEl(name) {
  const key = portraitKey(name);
  return key && portraits[key]
    ? el('img', { src: portraits[key], alt: className(name) || '' })
    : el('span', { className: 'initials' }, initials(name));
}

// --- What is shown: the current fight or the cumul.
function shown() {
  return cumulOn ? data.cumul : data.fight;
}

// One slot per group member plus any other player seen, so the layout stays
// fixed during a fight.
function slots(view) {
  const players = new Map((view ? view.fighters : []).filter((f) => f.player).map((f) => [f.name, f]));
  const names = [...new Set([...(view?.roster || []), ...players.keys()])].filter((n) => !hidden.has(n));
  return names
    .map((name, order) => ({ name, order, f: players.get(name), value: players.get(name)?.[stat] || 0 }))
    .sort((a, b) => b.value - a.value || a.order - b.order);
}

// --- Cards
const lastBigHits = new Map(); // name -> bigHits already flashed (live fight)
let liveStart = null;

function card({ name, f, value }, rank, max, total, live) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  const perTurn = stat === 'damage' ? dpt(f) : null;
  const cls = ['card'];
  if (rank === 1 && value > 0) cls.push('top');
  if (f?.ko) cls.push('ko');
  if (!value) cls.push('idle');
  if (live && f && f.bigHits > (lastBigHits.get(name) ?? f.bigHits)) cls.push('flash');
  if (live && f) lastBigHits.set(name, f.bigHits);

  const hide = el('button', { className: 'hide', textContent: '✕', title: `Masquer ${name}` });
  hide.onclick = (e) => {
    e.stopPropagation();
    hidden.add(name);
    save('hidden', [...hidden]);
    render();
  };

  const tip = [
    `${value ? `#${rank} ` : ''}${name}${className(name) ? ` (${className(name)})` : ''}`,
    `${fmt.format(value)} · ${pct}%`,
    perTurn != null ? `DPT ${fmt.format(perTurn)} (${f.turns} tour${f.turns > 1 ? 's' : ''})` : null,
    f?.ko ? 'KO' : null,
    'Clic : détail par sort',
  ].filter(Boolean).join('\n');

  const li = el(
    'li',
    { className: cls.join(' '), title: tip },
    hide,
    el('div', { className: 'portrait' }, portraitEl(name)),
    el(
      'div',
      { className: 'info' },
      el('div', { className: 'name', textContent: perTurn != null ? `${name} · ${compact(perTurn)}/t` : name }),
      el('div', { className: 'value', textContent: compact(value) }),
      el('div', { className: 'share' }, el('div', { style: `width:${max ? (value / max) * 100 : 0}%` }))
    )
  );
  li.onclick = () => openPanel('detail', name);
  return li;
}

function render() {
  const view = shown();
  const live = !cumulOn && data.fight && !data.fight.ended;

  document.body.classList.toggle('opaque', opaque);
  document.body.classList.toggle('vertical', vertical);
  document.body.style.setProperty('--color', `var(--${stat})`);
  $('layout').textContent = vertical ? '⇆' : '⇅';
  $('through').classList.toggle('on', clickThrough);
  $('cumul').classList.toggle('on', cumulOn);
  $('unhide').hidden = hidden.size === 0;
  $('unhide').textContent = `👁${hidden.size}`;
  $('reset').title = cumulOn ? 'Remettre le cumul à zéro' : 'Remettre le combat à zéro (Ctrl+Alt+R)';

  // Remember detected classes so idle members keep their portrait.
  let learned = false;
  for (const f of view ? view.fighters : []) {
    if (f.player && f.breed && seenBreed[f.name] !== f.breed) {
      seenBreed[f.name] = f.breed;
      learned = true;
    }
  }
  if (learned) save('breeds', seenBreed);

  if (data.fight?.start !== liveStart) {
    liveStart = data.fight?.start ?? null;
    lastBigHits.clear();
  }

  const list = slots(view);
  const total = list.reduce((sum, s) => sum + s.value, 0);
  const max = list.length ? list[0].value : 0;

  state.className = live ? 'live' : '';
  state.textContent = view ? (cumulOn ? `${view.fights}× · ${duration(view.duration)}` : duration(view.duration)) : '';
  state.title = view
    ? `${cumulOn ? `Cumul de ${view.fights} combat(s)` : view.ended ? 'Combat terminé' : 'En combat'} · total ${fmt.format(total)}`
    : '';

  empty.hidden = list.length > 0;
  if (status && !status.ok) empty.textContent = `Log introuvable : ${status.path}`;
  else empty.textContent = cumulOn ? 'Aucun combat dans le cumul.' : "En attente d'un combat…";

  cards.replaceChildren(...list.map((s, i) => card(s, i + 1, max, total, live)));
  if (panelFor) renderPanel();
  fitWindow();
}

// --- Detail / class picker panel (replaces the cards while open)
function openPanel(kind, name) {
  if (!panelFor) panel.style.width = `${Math.max(kind === 'welcome' ? 280 : 180, main.offsetWidth)}px`;
  panelFor = { kind, name };
  main.hidden = true;
  panel.hidden = false;
  renderPanel();
  fitWindow();
  updateMouse();
}
function closePanel() {
  panelFor = null;
  panel.hidden = true;
  main.hidden = false;
  fitWindow();
  updateMouse();
}

function panelBar(title, ...buttons) {
  const close = el('button', { textContent: '✕', title: 'Fermer' });
  close.onclick = closePanel;
  return el('div', { className: 'panel-bar' }, el('span', { className: 'panel-title', textContent: title }), ...buttons, close);
}

function renderPanel() {
  const { kind, name } = panelFor;
  if (kind === 'picker') return renderPicker(name);
  if (kind === 'welcome') return renderWelcome();

  const f = shown()?.fighters.find((x) => x.name === name);
  const classBtn = el('button', { textContent: className(name) || 'Classe', title: 'Changer la classe' });
  classBtn.onclick = () => openPanel('picker', name);

  const total = f ? f[stat] : 0;
  const perTurn = stat === 'damage' ? dpt(f) : null;
  const facts = [
    `${STAT_LABEL[stat]} : ${fmt.format(total)}`,
    perTurn != null ? `DPT ${fmt.format(perTurn)}` : null,
    f?.turns ? `${f.turns} tour${f.turns > 1 ? 's' : ''}` : null,
    stat === 'damage' && f?.bigHits ? `${f.bigHits} gros coup${f.bigHits > 1 ? 's' : ''}` : null,
  ].filter(Boolean).join(' · ');

  const spells = (f ? f.bySpell : []).filter((e) => e[stat] > 0).sort((a, b) => b[stat] - a[stat]);
  const max = spells.length ? spells[0][stat] : 0;
  panel.replaceChildren(
    panelBar(name, classBtn),
    el('div', { className: 'facts', textContent: facts }),
    spells.length
      ? el(
          'ol',
          { className: 'spells' },
          ...spells.map((e) =>
            el(
              'li',
              {},
              el('span', { className: 'spell-name', textContent: e.name }),
              el('span', { className: 'spell-value', textContent: `${compact(e[stat])} · ${Math.round((e[stat] / total) * 100)}%` }),
              el('div', { className: 'share' }, el('div', { style: `width:${(e[stat] / max) * 100}%` }))
            )
          )
        )
      : el('p', { className: 'facts', textContent: 'Aucun détail pour cet onglet.' })
  );
}

// --- Welcome / help panel, shown at launch unless turned off.
const FEATURES = [
  ['Infligés · Reçus · Soins · Armure', 'les quatre onglets, une carte par joueur du groupe'],
  ['Clic sur une carte', 'détail par sort, DPT (dégâts par tour), choix de la classe'],
  ['Σ', 'cumul des combats, pratique pour tout un donjon'],
  ['📋', 'copie le récapitulatif à coller sur Discord'],
  ['🖱', "clics traversants : seul l'en-tête reste cliquable"],
  ['⇅  ◐', 'disposition horizontale / verticale, mode transparent / normal'],
  ['Coin ◢ ou Ctrl + molette', "agrandir ou réduire ; glisser l'en-tête pour déplacer"],
  ['Ctrl+Alt+W · C · T · R', 'afficher/masquer · clics traversants · onglet suivant · remise à zéro'],
];

function renderWelcome() {
  const hide = el('input', { type: 'checkbox', checked: load('hideWelcome', false) });
  hide.onchange = () => save('hideWelcome', hide.checked);
  const go = el('button', { className: 'primary', textContent: "C'est parti !" });
  go.onclick = closePanel;
  panel.replaceChildren(
    panelBar('Bienvenue dans Wakfu Meter'),
    el(
      'p',
      { className: 'welcome-intro' },
      'Suis en direct les dégâts, soins et armure de ton groupe pendant tes combats. ',
      "L'overlay lit le log que le jeu écrit sur ton PC : il ne touche pas au jeu."
    ),
    el(
      'ul',
      { className: 'features' },
      ...FEATURES.map(([key, text]) => el('li', {}, el('b', { textContent: key }), ` ${text}`))
    ),
    el('p', { className: 'facts', textContent: 'Jeu en français, en mode fenêtré ou plein écran fenêtré.' }),
    el(
      'div',
      { className: 'welcome-footer' },
      el('label', {}, hide, ' Ne plus afficher au démarrage'),
      el('span', { className: 'version', textContent: version ? `v${version}` : '' }),
      go
    )
  );
}

let pickerSex = 0;
function renderPicker(name) {
  const current = chosenPortrait[name];
  if (current) pickerSex = Number(current.slice(-1));
  const choose = (key) => {
    if (key) chosenPortrait[name] = key;
    else delete chosenPortrait[name];
    save('portraits', chosenPortrait);
    openPanel('detail', name);
    render();
  };
  const sex = el('button', { textContent: pickerSex ? '♀' : '♂', title: 'Changer le sexe du portrait' });
  sex.onclick = () => {
    pickerSex = 1 - pickerSex;
    if (chosenPortrait[name]) chosenPortrait[name] = chosenPortrait[name].slice(0, -1) + pickerSex;
    renderPicker(name);
  };
  const auto = el('button', { textContent: 'Auto', title: 'Revenir à la détection automatique' });
  auto.onclick = () => choose(null);
  panel.replaceChildren(
    panelBar(`Classe de ${name}`, sex, auto),
    el(
      'div',
      { className: 'picker-grid' },
      ...classes.map((c) => {
        const key = `${c.id}${pickerSex}`;
        const b = el('button', { title: c.name, className: key === current ? 'selected' : '' });
        if (portraits[key]) b.append(el('img', { src: portraits[key], alt: c.name }));
        else b.textContent = c.name.slice(0, 2);
        b.onclick = () => choose(key);
        return b;
      })
    )
  );
}

// --- Scaling: the content is laid out at its natural size, then scaled; the
// window is sized to match. Transparent windows cannot be resized by their
// edges on Windows, so the corner grip (or Ctrl + wheel) sets the scale.
let natural = { w: 0, h: 0 };

function applyScale() {
  app.style.transform = `scale(${scale})`;
}
function requestFit() {
  window.meter.fit(Math.round(natural.w * scale), Math.round(natural.h * scale));
}
function setScale(s) {
  scale = Math.min(4, Math.max(0.5, s));
  applyScale();
  requestFit();
}
function fitWindow() {
  const w = app.offsetWidth; // layout size, unaffected by the transform
  const h = app.offsetHeight;
  applyScale();
  if (w === natural.w && h === natural.h) return;
  natural = { w, h };
  requestFit();
}

const grip = $('grip');
let drag = null;
grip.addEventListener('pointerdown', (e) => {
  grip.setPointerCapture(e.pointerId);
  drag = { x: e.screenX, y: e.screenY, w: natural.w * scale, h: natural.h * scale };
});
grip.addEventListener('pointermove', (e) => {
  if (!drag) return;
  setScale(Math.max((drag.w + e.screenX - drag.x) / natural.w, (drag.h + e.screenY - drag.y) / natural.h));
});
grip.addEventListener('pointerup', () => {
  drag = null;
  save('zoom', scale);
});
window.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  setScale(scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
  save('zoom', scale);
});

// --- Click-through: mouse events go to the game, except over the header,
// the grip and an open panel.
let ignoring = null;
let pointerTarget = null;
function updateMouse() {
  const interactive = !clickThrough || !!panelFor || !!pointerTarget?.closest?.('header, #grip');
  if (ignoring === !interactive) return;
  ignoring = !interactive;
  window.meter.ignoreMouse(ignoring);
}
document.addEventListener('mousemove', (e) => {
  pointerTarget = e.target;
  updateMouse();
});
document.addEventListener('mouseleave', () => {
  pointerTarget = null;
  updateMouse();
});
function toggleClickThrough() {
  clickThrough = !clickThrough;
  save('clickThrough', clickThrough);
  render();
  updateMouse();
}

// --- Copy a text recap of the view (e.g. for Discord)
function recap() {
  const view = shown();
  if (!view) return '';
  const list = slots(view).filter((s) => s.value > 0);
  const total = list.reduce((sum, s) => sum + s.value, 0);
  const when = cumulOn ? `cumul de ${view.fights} combat(s)` : view.ended ? 'combat terminé' : 'en cours';
  const lines = [`⚔️ ${STAT_LABEL[stat]} — ${duration(view.duration)} (${when}) — total ${fmt.format(total)}`];
  list.forEach((s, i) => {
    const perTurn = stat === 'damage' ? dpt(s.f) : null;
    lines.push(
      `${i + 1}. ${s.name}${className(s.name) ? ` (${className(s.name)})` : ''} — ${fmt.format(s.value)} (${Math.round((s.value / total) * 100)} %)` +
        (perTurn != null ? ` · DPT ${fmt.format(perTurn)}` : '')
    );
  });
  return lines.join('\n').replace(/ /g, ' ');
}
$('copy').onclick = () => {
  const text = recap();
  if (!text) return;
  window.meter.copy(text);
  $('copy').textContent = '✓';
  setTimeout(() => { $('copy').textContent = '📋'; }, 1200);
};

// --- Header controls
function setStat(s) {
  stat = s;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.stat === s));
  render();
}
document.querySelectorAll('#tabs button').forEach((btn) => { btn.onclick = () => setStat(btn.dataset.stat); });
$('cumul').onclick = () => { cumulOn = !cumulOn; render(); };
$('unhide').onclick = () => { hidden.clear(); save('hidden', []); render(); };
$('through').onclick = toggleClickThrough;
$('layout').onclick = () => { vertical = !vertical; save('vertical', vertical); if (panelFor) closePanel(); render(); };
$('mode').onclick = () => { opaque = !opaque; save('opaque', opaque); render(); };
function reset() {
  if (cumulOn) window.meter.resetCumul();
  else window.meter.reset();
}
$('reset').onclick = reset;
$('close').onclick = () => window.meter.close();
$('help').onclick = () => (panelFor?.kind === 'welcome' ? closePanel() : openPanel('welcome'));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panelFor) closePanel(); });

window.meter.onCommand((command) => {
  if (command === 'click-through') toggleClickThrough();
  else if (command === 'next-tab') setStat(STATS[(STATS.indexOf(stat) + 1) % STATS.length]);
  else if (command === 'reset') reset();
});
window.meter.onClasses((d) => {
  classes = d.classes;
  portraits = d.portraits;
  version = d.version;
  $('help').title = `Aide et fonctionnalités · Wakfu Meter v${version}`;
  render();
});
window.meter.onFight((d) => {
  data = d;
  render();
});
window.meter.onStatus((d) => { status = d; render(); });
render();
if (!load('hideWelcome', false)) openPanel('welcome');
updateMouse();
