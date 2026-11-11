'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { SessionStats } = require('../src/session');

const J = (msg) => `23:01:39,370 - [Information (jeu)] ${msg}`;
const C = (msg) => `23:01:39,370 - [Information (combat)] ${msg}`;

test('sums kamas, XP, fights, items and challenges', () => {
  const results = [];
  const s = new SessionStats((name, won) => results.push([name, won]));
  [
    J('Vous avez gagné 9 872 kamas.'),
    J('Vous avez perdu 118 kamas.'),
    C("Elya : +1 283 346 795 points d'XP.  +1 niveau. Prochain niveau dans : 866 9"),
    C("Combat terminé, cliquez ici pour rouvrir l'écran de fin de combat. "),
    J('Vous avez ramassé 8x Eclats .'),
    J('Vous avez ramassé 2x Eclats .'),
    J('Vous avez ramassé 1x Grelot .'),
    J('Le challenge "Nomade" est réussi.'),
    J('Le challenge "Zogarde" a échoué.'),
    '23:01:40,000 - [Groupe] Bryn : gg',
  ].forEach((l) => s.feed(l));
  const snap = s.snapshot();
  assert.deepStrictEqual(
    { kin: snap.kamasIn, kout: snap.kamasOut, xp: snap.xp, fights: snap.fights, items: snap.itemCount, top: snap.topItems[0] },
    { kin: 9872, kout: 118, xp: 1283346795, fights: 1, items: 11, top: ['Eclats', 10] }
  );
  assert.deepStrictEqual(snap.challenges, { won: 1, lost: 1 });
  assert.deepStrictEqual(results, [['Nomade', true], ['Zogarde', false]]);
  s.reset();
  assert.strictEqual(s.snapshot().fights, 0);
});
