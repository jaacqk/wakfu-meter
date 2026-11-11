'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { FightTracker } = require('../src/parser');

const C = (t, msg) => `${t},000 - [Information (combat)] ${msg}`;

function run(lines) {
  const t = new FightTracker();
  lines.forEach((l) => t.feed(l));
  const s = t.snapshot();
  return { s, by: Object.fromEntries((s ? s.fighters : []).map((f) => [f.name, f])) };
}

// Lines taken from a real wakfu_chat.log.
test('attributes spell, summon, state and delayed damage to the caster', () => {
  const { by } = run([
    C('11:19:28', "Rox'Ana lance le sort Pulsar"),
    C('11:19:30', "Rox'Ana: Invoque un(e) Bombe Immolante "),
    C('11:19:36', "Rox'Ana lance le sort Bombe collante"),
    C('11:19:37', "Milkar le Meulou: Retour de dague (+1 Niv.) (Fourbe)"),
    C('11:19:38', "Rox'Ana lance le sort Barbrûlé (Critiques)"),
    C('11:19:39', 'Milkar le Meulou: -786 PV  (Feu)'),
    C('11:19:40', 'Milkar le Meulou lance le sort Morsure'),
    C('11:19:41', "Rox'Ana: -100 PV (Terre)"),
    // Delayed effects resolved during the monster's turn:
    C('11:19:55', 'Milkar le Meulou: -760 PV  (Terre) (Pulsar I)'),
    C('11:19:55', 'Milkar le Meulou: -737 PV  (Terre) (Retour de dague)'),
    C('11:19:56', 'Milkar le Meulou: -622 PV  (Feu) (Parade !) (Bombe collante)'),
    C('11:19:56', 'Milkar le Meulou: -926 PV  (Feu) (Bombe immolante)'),
  ]);
  assert.strictEqual(by["Rox'Ana"].damage, 786 + 760 + 737 + 622 + 926);
  assert.strictEqual(by['Milkar le Meulou'].damage, 100);
});

test('parses narrow no-break space thousands separators', () => {
  const { by } = run([C('18:16:00', 'Vesna lance le sort Assaut'), C('18:16:11', 'Ogrest: -1 342 996 PV (Terre)')]);
  assert.strictEqual(by.Vesna.damage, 1342996);
});

test('counts heals, lifesteal and armor; ignores self-damage', () => {
  const { by } = run([
    C('11:20:37', 'Sang Vif lance le sort Entaille'),
    C('11:20:38', 'Sang Vif: +97 PV (Neutre - Vol de vie) (Entaille)'),
    C('11:20:38', 'Sang Vif: 341 Armure (Maître Roublard)'),
    C('11:20:38', 'Sang Vif: -50 PV (Neutre)'),
    C('11:20:38', 'Sang Vif: -50 Armure'),
  ]);
  const { damage, taken, heal, armor } = by['Sang Vif'];
  assert.deepStrictEqual({ damage, taken, heal, armor }, { damage: 0, taken: 0, heal: 97, armor: 341 });
});

test('tracks damage taken, KO / revive and detects classes from spells', () => {
  const t = new FightTracker();
  const feed = (l) => t.feed(l);
  feed(C('10:00:00', "Rox'Ana lance le sort Pulsar"));
  feed(C('10:00:01', 'Boss: -100 PV (Feu)'));
  feed(C('10:00:02', 'Arkan lance le sort Flèche explosive'));
  feed(C('10:00:02', 'Boss: -50 PV (Feu)'));
  feed(C('10:00:03', 'Boss lance le sort Coup'));
  feed(C('10:00:03', "Rox'Ana: -999 PV (Terre)"));
  feed(C('10:00:04', "Rox'Ana est KO !"));
  const get = (n) => t.snapshot().fighters.find((f) => f.name === n);
  assert.strictEqual(get("Rox'Ana").ko, true);
  assert.strictEqual(get("Rox'Ana").taken, 999);
  assert.strictEqual(get('Boss').taken, 150);
  assert.strictEqual(get("Rox'Ana").breed, 13); // Roublard
  assert.strictEqual(get('Arkan').breed, 9); // Crâ
  assert.strictEqual(get('Boss').breed, null);
  feed(C('10:00:05', "Rox'Ana: est réanimé"));
  assert.strictEqual(get("Rox'Ana").ko, false);
});

test('end of turn clears the caster: unattributable damage is dropped', () => {
  const t = new FightTracker();
  t.feed(C('10:00:00', 'A lance le sort X'));
  t.feed(C('10:00:01', 'M: -10 PV (Feu)'));
  t.feed(C('10:00:02', '12 secondes reportées pour le tour suivant.'));
  t.feed(C('10:00:03', 'M: -5 PV (Feu)'));
  let s = t.snapshot();
  assert.deepStrictEqual(s.fighters.filter((f) => f.damage).map((f) => [f.name, f.damage]), [['A', 10]]);
  assert.strictEqual(s.duration, 3);

  t.feed(C('10:00:04', "Combat terminé, cliquez ici pour rouvrir l'écran de fin de combat. "));
  assert.strictEqual(t.snapshot().ended, true);
  t.feed(C('10:05:00', 'B lance le sort Y'));
  t.feed(C('10:05:01', 'M: -7 PV (Eau)'));
  s = t.snapshot();
  assert.deepStrictEqual(s.fighters.filter((f) => f.damage).map((f) => [f.name, f.damage]), [['B', 7]]);
  assert.strictEqual(s.ended, false);
});

test('players are recognised from evidence; others from whom they hit or help', () => {
  const team = (lines) => {
    const t = new FightTracker();
    lines.forEach((l) => t.feed(l));
    return Object.fromEntries(t.snapshot().fighters.map((f) => [f.name, f.ally]));
  };
  // Arkan casts a Crâ spell -> player. The boss hits Arkan -> monster.
  // Mia (no evidence) heals Arkan -> player.
  const base = [
    C('10:00:00', 'Arkan lance le sort Flèche explosive'),
    C('10:00:01', 'Boss: -900 PV (Feu)'),
    C('10:00:02', 'Boss lance le sort Coup'),
    C('10:00:02', 'Arkan: -500 PV (Terre)'),
    C('10:00:03', 'Mia lance le sort Truc'),
    C('10:00:03', 'Arkan: +200 PV (Eau)'),
  ];
  assert.deepStrictEqual(team(base), { 'Arkan': true, Boss: false, Mia: true });

  // A monster trap hitting a monster and a player: neither monster becomes a player.
  assert.deepStrictEqual(
    team([
      ...base,
      C('10:00:04', 'Chevalancier lance le sort Kamas à la clé'),
      C('10:00:05', 'Doot Doot: -1 828 PV (Eau)'),
      C('10:00:05', 'Arkan: -914 PV (Eau)'),
    ]),
    { 'Arkan': true, Boss: false, Mia: true, Chevalancier: false, 'Doot Doot': false }
  );

  // No evidence at all: everyone is assumed to be a monster.
  assert.deepStrictEqual(team([C('10:00:00', 'A lance le sort X'), C('10:00:01', 'B: -10 PV (Feu)')]), { A: false, B: false });

  // KO / group chat mark players, hors-combat marks monsters.
  const t = team([
    '09:00:00,000 - [Groupe] Bob : go',
    C('10:00:00', 'Bob lance le sort X'),
    C('10:00:01', 'Gob: -10 PV (Feu)'),
    C('10:00:02', 'Gob lance le sort Y'),
    C('10:00:02', 'Zed: -10 PV (Feu)'),
    C('10:00:03', 'Zed est KO !'),
    C('10:00:04', 'Gob est hors-combat !'),
  ]);
  assert.deepStrictEqual(t, { Bob: true, Gob: false, Zed: true });
});
test('ignores non-combat channels', () => {
  const t = new FightTracker();
  assert.strictEqual(t.feed('11:00:00,000 - [Commerce] Elya : vends Gelano'), false);
  assert.strictEqual(t.snapshot(), null);
});

test('tracks the group roster from join bursts and leave lines', () => {
  const J = (t, name) => `${t} - [Information (jeu)] ${name} a rejoint le groupe`;
  const t = new FightTracker();
  // Burst re-listing the whole group replaces the roster.
  t.feed(J('08:00:00,001', 'Old'));
  t.feed(J('08:39:57,037', 'Bram'));
  t.feed(J('08:39:57,037', 'Mira'));
  t.feed(J('08:39:57,038', 'Kael'));
  assert.deepStrictEqual([...t.roster], ['Bram', 'Mira', 'Kael']);
  // A lone join adds a member.
  t.feed(J('08:45:00,000', 'Runa'));
  assert.strictEqual(t.roster.size, 4);
  // Group members count as players even before showing evidence in a fight.
  t.feed(C('09:00:00', 'Bram lance le sort Truc'));
  t.feed(C('09:00:01', 'Boss: -10 PV (Feu)'));
  t.feed(C('09:00:02', 'Bouftou lance le sort Morsure'));
  t.feed(C('09:00:02', 'Bram: -5 PV (Feu)'));
  const by = Object.fromEntries(t.snapshot().fighters.map((f) => [f.name, f.player]));
  assert.deepStrictEqual(by, { Bram: true, Boss: false, Bouftou: false });
  t.feed("09:10:00,000 - [Information (jeu)] Vous avez quitté le groupe.");
  assert.strictEqual(t.roster.size, 0);
});

test('a KO player going hors-combat stays a player', () => {
  const t = new FightTracker();
  t.feed(C('10:00:00', 'Arkan lance le sort Flèche explosive'));
  t.feed(C('10:00:01', 'Boss: -900 PV (Feu)'));
  t.feed(C('10:00:02', 'Boss lance le sort Coup'));
  t.feed(C('10:00:02', 'Arkan: -500 PV (Terre)'));
  t.feed(C('10:00:03', 'Arkan est KO !'));
  t.feed(C('10:00:30', 'Arkan est hors-combat !'));
  const f = t.snapshot().fighters.find((x) => x.name === 'Arkan');
  assert.deepStrictEqual({ player: f.player, ko: f.ko }, { player: true, ko: true });
});

test('counts turns, splits damage by spell, and sums fights in the cumul', () => {
  const t = new FightTracker();
  const fight = (h, extra = []) => [
    C(`${h}:00:00`, "Rox'Ana lance le sort Pulsar"),
    C(`${h}:00:01`, 'Boss: -100 PV (Feu)'),
    C(`${h}:00:02`, "Rox'Ana lance le sort Pulsar"),
    C(`${h}:00:03`, 'Boss: -100 PV (Feu)'),
    C(`${h}:00:04`, 'Boss lance le sort Coup'),
    C(`${h}:00:05`, "Rox'Ana: -10 PV (Feu)"),
    C(`${h}:00:06`, "Rox'Ana lance le sort Bombe collante"),
    C(`${h}:00:07`, 'Boss: -50 PV (Feu) (Bombe collante)'),
    ...extra,
    C(`${h}:00:09`, "Combat terminé, cliquez ici pour rouvrir l'écran de fin de combat. "),
  ];
  fight('10').forEach((l) => t.feed(l));
  const bp = t.snapshot().fighters.find((f) => f.name === "Rox'Ana");
  assert.strictEqual(bp.turns, 2); // two runs of casts, split by the boss's turn
  assert.deepStrictEqual(
    bp.bySpell.filter((e) => e.damage).map((e) => [e.name, e.damage]).sort(),
    [['Bombe collante', 50], ['Pulsar', 200]]
  );
  t.resetCumul();
  fight('11').forEach((l) => t.feed(l));
  fight('12').forEach((l) => t.feed(l));
  const cumul = t.cumulSnapshot();
  assert.strictEqual(cumul.fights, 2);
  assert.strictEqual(cumul.fighters.find((f) => f.name === "Rox'Ana").damage, 500);
});

test('a group never shows more than 6 members; absent ones are dropped', () => {
  // Real case: Tora left without a log line, then Runa (re)joined.
  const J = (t, name) => `${t} - [Information (jeu)] ${name} a rejoint le groupe`;
  const t = new FightTracker();
  ['Ivo', 'Elya', 'Glim', 'Lumi Arcane'].forEach((n) => t.feed(J('09:14:53,421', n)));
  t.feed(J('09:15:00,883', 'Tora'));
  t.feed(J('09:15:06,028', 'Bryn'));
  t.feed(J('09:16:24,491', 'Runa'));
  assert.strictEqual(t.roster.size, 7);
  const players = ['Ivo', 'Elya', 'Glim', 'Lumi Arcane', 'Bryn', 'Runa'];
  players.forEach((n, i) => {
    t.feed(C(`09:20:0${i}`, `${n} lance le sort Truc`));
    t.feed(C(`09:20:0${i}`, 'Boss: -10 PV (Feu)'));
  });
  const shown = t.snapshot().roster;
  assert.strictEqual(shown.length, 6);
  assert.ok(!shown.includes('Tora'));
  t.feed(C('09:21:00', "Combat terminé, cliquez ici pour rouvrir l'écran de fin de combat. "));
  assert.deepStrictEqual([...t.roster].sort(), [...players].sort());
});

test("credits a Gobgob creature's damage to its Osamodas", () => {
  const t = new FightTracker();
  [
    C('10:05:36', 'Mira lance le sort Invocation'),
    C('10:05:37', 'Mira: Invoque une créature du Gobgob'),
    C('10:05:37', 'Polyphème: 2 033 Maîtrise Élémentaire'),
    C('10:05:40', 'Polyphème lance le sort Mauvais oeil'),
    C('10:05:41', 'Boss: -656 PV (Eau)'),
  ].forEach((l) => t.feed(l));
  const by = Object.fromEntries(t.snapshot().fighters.map((f) => [f.name, f.damage]));
  assert.strictEqual(by.Mira, 656);
  assert.strictEqual(by['Polyphème'], undefined);
});

test('uses the technical log for the players of a fight and their exact class', () => {
  const T = (time, name, breed, ai) =>
    ` INFO ${time},000 [AWT-EventQueue-0] (fcd:1399) - [_FL_] fightId=42 ${name} breed : ${breed} [123] isControlledByAI=${ai} obstacleId : -1 join the fight at {Point3 : (1, 2, 0)}`;
  const J = (time, name) => `${time},000 - [Information (jeu)] ${name} a rejoint le groupe`;
  const t = new FightTracker();
  ['Elya', 'Bryn', 'Glim'].forEach((n) => t.feed(J('10:00:00', n)));
  t.feed(J('10:01:00', 'Tora')); // left the group later, without a log line
  t.feedTech(T('10:41:00', 'Elya', 7, false));
  t.feedTech(T('10:41:00', 'Bryn', 2, false));
  t.feedTech(T('10:41:00', 'Glim', 11, false));
  t.feedTech(T('10:41:00', 'Crustacérébro', 5182, true));
  t.feed(C('10:41:05', 'Glim lance le sort Truc'));
  t.feed(C('10:41:06', 'Crustacérébro: -100 PV (Feu)'));
  const s = t.snapshot();
  assert.deepStrictEqual(s.roster.sort(), ['Bryn', 'Elya', 'Glim']); // Tora is not in the fight
  assert.deepStrictEqual(s.breeds, { Elya: 7, Bryn: 2, Glim: 11 });
  assert.strictEqual(s.fighters.find((f) => f.name === 'Glim').breed, 11);
  assert.strictEqual(s.fighters.find((f) => f.name === 'Crustacérébro').player, false);
});

test('ignores a technical-log fight list without players', () => {
  const t = new FightTracker();
  t.feedTech(' INFO 10:33:38,261 [x] (fcd:1399) - [_FL_] fightId=7 Chacha noir breed : 1482 [-1] isControlledByAI=true obstacleId : 1 join the fight');
  t.feed(C('10:33:40', 'Arkan lance le sort Flèche explosive'));
  t.feed(C('10:33:41', 'Boss: -100 PV (Feu)'));
  assert.strictEqual(t.snapshot().fighters.find((f) => f.name === 'Arkan').player, true);
});

test('tracks KO count and biggest hit for the honour board, summed in the cumul', () => {
  const t = new FightTracker();
  const fight = (h, hit) => [
    C(`${h}:00:00`, 'Arkan lance le sort Flèche explosive'),
    C(`${h}:00:01`, `Boss: -${hit} PV (Feu)`),
    C(`${h}:00:02`, 'Boss lance le sort Coup'),
    C(`${h}:00:03`, 'Arkan: -50 PV (Terre)'),
    C(`${h}:00:04`, 'Arkan est KO !'),
    C(`${h}:00:09`, "Combat terminé, cliquez ici pour rouvrir l'écran de fin de combat. "),
  ];
  t.resetCumul();
  fight('10', 300).forEach((l) => t.feed(l));
  fight('11', 900).forEach((l) => t.feed(l));
  const a = t.cumulSnapshot().fighters.find((f) => f.name === 'Arkan');
  assert.deepStrictEqual({ kos: a.kos, maxHit: a.maxHit, spell: a.maxHitSpell }, { kos: 2, maxHit: 900, spell: 'Flèche explosive' });
});

test('blames a failed challenge on the player involved in the action right before', () => {
  const t = new FightTracker();
  const results = [];
  t.onChallenge = (name, won, culprit) => results.push([name, won, culprit]);
  const J = (time, msg) => `${time} - [Information (jeu)] ${msg}`;
  [
    C('22:35:59', 'Lou Garou lance le sort Canine'),
    `22:36:01,340 - [Information (combat)] Boss: -289 PV (Eau)`,
    J('22:36:01,341', 'Le challenge "Ordonné" a échoué.'), // after Lou Garou's hit
    `22:38:02,218 - [Information (combat)] Boss lance le sort Coup`,
    `22:38:02,300 - [Information (combat)] Bram: -1 245 PV (Feu)`,
    `22:38:03,327 - [Information (combat)] Bram est KO !`,
    J('22:38:03,343', 'Le challenge "Survie" a échoué.'), // Bram's KO
    J('22:40:00,000', 'Le challenge "Nomade" est réussi.'),
    J('22:50:00,000', 'Le challenge "Zen" a échoué.'), // nothing happened just before
  ].forEach((l) => t.feed(l));
  assert.deepStrictEqual(results, [
    ['Ordonné', false, 'Lou Garou'],
    ['Survie', false, 'Bram'],
    ['Nomade', true, null],
    ['Zen', false, null],
  ]);
});
