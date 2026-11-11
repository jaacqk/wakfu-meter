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
let module = 'combat'; // combat | session | challenges | honour
let settingsState = { launchWithWakfu: false };
let contentWidth = 0; // width of the cards, reused by the other views
const viewEl = $('view');
const MODULE_TITLE = { session: 'Bilan de session', challenges: 'Challenges', honour: "Tableau d'honneur" };

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

// The log only gives a time when something happens (spell, damage...), so a
// quiet turn would freeze the timer. Instead the timer runs on the PC clock
// from the fight's start, and only moves forward to catch up with the log.
// It stops after MAX_QUIET seconds without a line, so a fight left unfinished
// in the log doesn't count forever.
const MAX_QUIET = 120;
let clock = { start: null, duration: 0, origin: 0, changed: 0 };
function liveDuration(view, live) {
  if (!live) return view.duration;
  const now = Date.now();
  if (clock.start !== view.start) {
    clock = { start: view.start, duration: view.duration, origin: now - view.duration * 1000, changed: now };
  } else if (clock.duration !== view.duration) {
    clock.duration = view.duration;
    clock.changed = now;
    clock.origin = Math.min(clock.origin, now - view.duration * 1000); // behind the log: catch up
  }
  const elapsed = Math.floor((Math.min(now, clock.changed + MAX_QUIET * 1000) - clock.origin) / 1000);
  return Math.max(view.duration, elapsed);
}
// Ticks often so the display changes right on each second.
setInterval(() => {
  const view = shown();
  if (!cumulOn && view && !view.ended) state.textContent = duration(liveDuration(view, true));
}, 200);

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
  // the icon shows the layout the button switches to
  $('layout').replaceChildren(icon(vertical ? 'columns' : 'stack'));
  $('through').classList.toggle('on', clickThrough);
  $('cumul').classList.toggle('on', cumulOn);
  $('unhide').hidden = hidden.size === 0;
  $('unhide').textContent = `👁${hidden.size}`;
  const combat = module === 'combat';
  document.querySelectorAll('#modules button').forEach((b) => b.classList.toggle('active', b.dataset.module === module));
  for (const id of ['tabs', 'cumul', 'copy', 'layout', 'state']) $(id).hidden = !combat;
  if (!combat) $('unhide').hidden = true;
  $('module-title').hidden = combat;
  if (!combat) $('module-title').replaceChildren(icon(module), el('span', { textContent: MODULE_TITLE[module] }));
  $('reset').title = {
    session: 'Recommencer la session',
    challenges: 'Effacer les statistiques de challenges',
    honour: "Remettre le tableau d'honneur à zéro (avec le cumul)",
  }[module] || (cumulOn ? 'Remettre le cumul à zéro' : 'Remettre le combat à zéro (Ctrl+Alt+R)');

  // Remember classes so idle members keep their portrait: exact ones from the
  // game's technical log first, otherwise guessed from spells.
  let learned = false;
  const known = { ...Object.fromEntries((view ? view.fighters : []).filter((f) => f.player && f.breed).map((f) => [f.name, f.breed])), ...(view?.breeds || {}) };
  for (const [name, breed] of Object.entries(known)) {
    if (seenBreed[name] !== breed) {
      seenBreed[name] = breed;
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
  state.textContent = view ? (cumulOn ? `${view.fights}× · ${duration(view.duration)}` : duration(liveDuration(view, live))) : '';
  state.title = view
    ? `${cumulOn ? `Cumul de ${view.fights} combat(s)` : view.ended ? 'Combat terminé' : 'En combat'} · total ${fmt.format(total)}`
    : '';

  empty.hidden = list.length > 0;
  if (status && !status.ok) empty.textContent = `Log introuvable : ${status.path}`;
  else empty.textContent = cumulOn ? 'Aucun combat dans le cumul.' : "En attente d'un combat…";

  cards.replaceChildren(...list.map((s, i) => card(s, i + 1, max, total, live)));
  showSections();
  if (!combat && !panelFor) renderModule();
  if (panelFor) renderPanel();
  placeSideIcons(combat && !panelFor);
  fitWindow();
}

// Side bar icons: centred on the damage cards, then kept at that same spot
// in the other (taller) views so they never move.
let sideIconsTop = 4;
function placeSideIcons(centre) {
  const bar = $('modules');
  if (centre) {
    bar.style.justifyContent = 'center';
    bar.style.paddingTop = '';
    sideIconsTop = bar.querySelector('button').offsetTop;
  } else {
    bar.style.justifyContent = 'flex-start';
    bar.style.paddingTop = `${sideIconsTop}px`;
  }
}

// Shows the cards, a module view or a panel (only one at a time).
function showSections() {
  if (!main.hidden && main.offsetWidth) contentWidth = main.offsetWidth;
  const combat = module === 'combat';
  main.hidden = !!panelFor || !combat;
  viewEl.hidden = !!panelFor || combat;
  panel.hidden = !panelFor;
  viewEl.style.width = `${Math.max(240, contentWidth)}px`;
}

// --- Detail / class picker panel (replaces the cards while open)
function openPanel(kind, name) {
  if (!panelFor) panel.style.width = `${Math.max(kind === 'welcome' ? 280 : 180, main.offsetWidth || contentWidth)}px`;
  panelFor = { kind, name };
  showSections();
  renderPanel();
  placeSideIcons(false);
  fitWindow();
  updateMouse();
}
function closePanel() {
  panelFor = null;
  showSections();
  if (module !== 'combat') renderModule();
  placeSideIcons(module === 'combat');
  fitWindow();
  updateMouse();
}

// --- Modules other than combat
const hours = (ms) => Math.max(ms / 3600000, 1 / 60);
function hm(ms) {
  const m = Math.floor(ms / 60000);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}
// Row icon: name from ICONS, tinted with a colour.
function rowIcon(name, color) {
  const i = icon(name, 'row-icon');
  i.style.color = color;
  return i;
}
function infoLine(text) {
  return el('p', { className: 'info-line' }, icon('info'), el('span', { textContent: text }));
}

function statRow(iconName, color, label, value, extra = '') {
  return el(
    'li',
    {},
    rowIcon(iconName, color),
    el('span', { className: 'row-label', textContent: label }),
    el('span', { className: 'row-value', textContent: value }),
    el('span', { className: 'row-extra', textContent: extra })
  );
}

function renderSession() {
  const s = data.session;
  if (!s) return [el('p', { className: 'facts', textContent: 'En attente du log…' })];
  const ms = Date.now() - s.started;
  const h = hours(ms);
  const net = s.kamasIn - s.kamasOut;
  const top = s.topItems.slice(0, 3).map(([n, q]) => `${n} ×${q}`).join(', ');
  const ch = s.challenges.won + s.challenges.lost;
  return [
    el(
      'ul',
      { className: 'rows' },
      statRow('hourglass', '#e9c46a', 'Durée', hm(ms)),
      statRow('combat', '#dfe9e7', 'Combats', fmt.format(s.fights), `${(s.fights / h).toFixed(1)}/h`),
      statRow('sparkle', '#ffd166', 'XP', `+${compact(s.xp)}`, `${compact(Math.round(s.xp / h))}/h`),
      statRow('coin', '#f4a261', 'Kamas', `${net >= 0 ? '+' : ''}${compact(net)}`, `${compact(Math.round(net / h))}/h · +${compact(s.kamasIn)} −${compact(s.kamasOut)}`),
      statRow('bag', '#ff7aa2', 'Objets ramassés', fmt.format(s.itemCount), top),
      statRow('target', '#5eead4', 'Challenges', ch ? `${s.challenges.won}/${ch}` : '—', ch ? `${Math.round((s.challenges.won / ch) * 100)}% réussis` : '')
    ),
    infoLine("Depuis le lancement de l'application (↺ pour recommencer)."),
  ];
}

function renderChallenges() {
  const list = Object.entries(data.challenges || {})
    .map(([name, c]) => ({ name, ...c, total: c.won + c.lost }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  if (!list.length) return [el('p', { className: 'facts', textContent: 'Aucun challenge terminé pour le moment. Les résultats apparaîtront ici au fil des combats.' })];
  const won = list.reduce((s, c) => s + c.won, 0);
  const total = list.reduce((s, c) => s + c.total, 0);
  // Who failed them (deduced from the action right before each failure).
  const blame = {};
  for (const c of list) for (const [who, n] of Object.entries(c.by || {})) if (who !== '?') blame[who] = (blame[who] || 0) + n;
  const culprits = Object.entries(blame).sort((a, b) => b[1] - a[1]);
  const byText = (c) =>
    Object.entries(c.by || {})
      .sort((a, b) => b[1] - a[1])
      .map(([who, n]) => `${who === '?' ? 'inconnu' : who}${n > 1 ? ` ×${n}` : ''}`)
      .join(', ');
  const SHOWN = 8; // the most played ones, to keep the window small
  const more = list.length - SHOWN;
  list.length = Math.min(list.length, SHOWN);
  return [
    el('p', { className: 'facts', textContent: `Réussite globale : ${Math.round((won / total) * 100)}% (${won}/${total}) · conservé d'une session à l'autre` }),
    culprits.length
      ? el(
          'p',
          { className: 'culprits', title: "Déduit de l'action qui précède chaque échec dans le log du jeu." },
          el('b', { textContent: 'Plus de ratés : ' }),
          culprits.slice(0, 4).map(([who, n]) => `${who} (${n})`).join(' · ')
        )
      : '',
    el(
      'ol',
      { className: 'spells challenges' },
      ...list.map((c) =>
        el(
          'li',
          {},
          rowIcon('flag', c.won >= c.lost ? '#5eead4' : '#ff8fa3'),
          el('span', { className: 'spell-name', textContent: c.name }),
          el('span', { className: 'spell-value', textContent: `✓${c.won} ✗${c.lost} · ${Math.round((c.won / c.total) * 100)}%` }),
          el('div', { className: 'share' }, el('div', { style: `width:${(c.won / c.total) * 100}%` })),
          c.lost && c.by ? el('div', { className: 'failed-by', textContent: `raté par ${byText(c)}` }) : ''
        )
      )
    ),
    more > 0 ? el('p', { className: 'facts', textContent: `… et ${more} autre${more > 1 ? 's' : ''} challenge${more > 1 ? 's' : ''} moins joué${more > 1 ? 's' : ''}.` }) : '',
  ];
}

function renderHonour() {
  const cumul = data.cumul;
  const players = (cumul ? cumul.fighters : []).filter((f) => f.player && !hidden.has(f.name));
  if (!players.length) return [el('p', { className: 'facts', textContent: 'Aucun combat depuis le lancement. Le tableau se remplira au fil des combats.' })];
  const best = (fn) => players.reduce((a, b) => (fn(b) > fn(a) ? b : a), players[0]);
  const awards = [
    [['burst', '#ffb703'], 'Plus gros coup', best((f) => f.maxHit), (f) => f.maxHit, (f) => f.maxHitSpell || ''],
    [['combat', '#dfe9e7'], 'Plus de dégâts', best((f) => f.damage), (f) => f.damage],
    [['bolt', '#ffd166'], 'Meilleur DPT', best((f) => dpt(f) || 0), (f) => dpt(f) || 0, (f) => `${f.turns} tours`],
    [['heart', '#ff8fab'], 'Plus de soins', best((f) => f.heal), (f) => f.heal],
    [['wall', '#f4845f'], "Plus d'armure", best((f) => f.armor), (f) => f.armor],
    [['shield', '#a5d8ff'], 'Plus encaissé', best((f) => f.taken), (f) => f.taken],
    [['skull', '#e0aaff'], 'Plus de KO', best((f) => f.kos), (f) => f.kos],
  ].filter(([, , who, value]) => value(who) > 0);
  return [
    el(
      'ul',
      { className: 'rows honour' },
      ...awards.map(([icon, label, who, value, extra]) =>
        el(
          'li',
          {},
          rowIcon(...icon),
          el('span', { className: 'row-label', textContent: label }),
          el(
            'span',
            { className: 'row-who', title: who.name },
            el('span', { className: 'mini-portrait' }, portraitEl(who.name)),
            el('span', { className: 'row-name', textContent: who.name })
          ),
          el('span', { className: 'row-value', textContent: compact(value(who)) }),
          el('span', { className: 'row-extra', textContent: extra ? extra(who) : '' })
        )
      )
    ),
    infoLine(`${cumul.fights} combat(s) depuis le lancement (↺ pour remettre à zéro, avec le cumul Σ).`),
  ];
}

function renderModule() {
  const content = { session: renderSession, challenges: renderChallenges, honour: renderHonour }[module]();
  viewEl.replaceChildren(...content);
}
setInterval(() => {
  if (module === 'session' && !panelFor) {
    renderModule();
    fitWindow();
  }
}, 15000);

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
    el(
      'div',
      { className: 'detail-head' },
      el('span', { className: 'detail-portrait' }, portraitEl(name)),
      el('div', { className: 'detail-title' }, el('b', { textContent: name }), el('span', { className: 'facts', textContent: facts })),
      classBtn,
      (() => {
        const close = el('button', { textContent: '✕', title: 'Fermer' });
        close.onclick = closePanel;
        return close;
      })()
    ),
    spells.length
      ? el(
          'ol',
          { className: 'spells' },
          ...spells.map((e) =>
            el(
              'li',
              {},
              icon(e.element || 'neutre', `row-icon el-${(e.element || 'neutre').replace('è', 'e')}`),
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
  ['Barre de gauche', "modules : combat, bilan de session, challenges, tableau d'honneur"],
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
  const withWakfu = el('input', { type: 'checkbox', checked: settingsState.launchWithWakfu });
  withWakfu.onchange = () => window.meter.setLaunchWithWakfu(withWakfu.checked);
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
      'label',
      { className: 'setting', title: "Démarre avec Windows en arrière-plan, s'affiche quand Wakfu se lance et se masque quand il se ferme." },
      withWakfu,
      ' Lancer automatiquement avec Wakfu'
    ),
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
  const interactive = !clickThrough || !!panelFor || !!pointerTarget?.closest?.('header, #modules, #grip');
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
  $('copy').classList.add('done');
  setTimeout(() => $('copy').classList.remove('done'), 1200);
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
  if (module === 'session') window.meter.resetSession();
  else if (module === 'challenges') {
    if (confirm('Effacer toutes les statistiques de challenges ?')) window.meter.resetChallenges();
  } else if (module === 'honour' || cumulOn) window.meter.resetCumul();
  else window.meter.reset();
}
document.querySelectorAll('#modules button').forEach((btn) => {
  btn.onclick = () => {
    module = btn.dataset.module;
    if (panelFor) panelFor = null;
    render();
    updateMouse();
  };
});
$('reset').onclick = reset;
$('close').onclick = () => window.meter.close();
$('help').onclick = () => (panelFor?.kind === 'welcome' ? closePanel() : openPanel('welcome'));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panelFor) closePanel(); });

// Static icons and ornaments declared in the HTML.
document.querySelectorAll('[data-icon]').forEach((b) => b.prepend(icon(b.dataset.icon)));
const ART = { CURL, SCENERY };
document.querySelectorAll('[data-art]').forEach((e) => { e.innerHTML = ART[e.dataset.art]; });

window.meter.onCommand((command) => {
  if (command === 'click-through') toggleClickThrough();
  else if (command === 'next-tab' && module === 'combat') setStat(STATS[(STATS.indexOf(stat) + 1) % STATS.length]);
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
window.meter.onSettings((s) => {
  settingsState = s;
  if (panelFor?.kind === 'welcome') renderPanel();
});
render();
if (!load('hideWelcome', false)) openPanel('welcome');
updateMouse();
