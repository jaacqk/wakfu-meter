'use strict';

const { detectClass } = require('./classes');

// Parses Wakfu's wakfu_chat.log (French client) and aggregates, per fighter,
// damage dealt and taken, healing done and armor given (with a per-spell
// breakdown) for the current fight and a cumul of fights. It also tracks the
// group roster from the log's group lines.
//
// Damage/heal lines do not name the attacker ("Cible: -786 PV (Feu) (Source)"),
// so the author is inferred, in this order:
//   1. the trailing "(Source)" tag, matched against summons, states applied
//      during someone's cast, and spells cast this fight;
//   2. otherwise the last fighter who cast a spell this turn.
// Lines whose author cannot be inferred are dropped. Summons are credited to
// their summoner.
//
// The log has no team info, so who is a player is inferred too (see sides()):
// casting class spells, banking turn time, "X est KO !" (monsters go
// "hors-combat" instead), XP gains and group chat mark players; fighters
// without evidence are judged by whom they hit or help.

const LINE = /^(\d\d):(\d\d):(\d\d),\d+ - \[Information \(combat\)\] (.*)$/;
const GROUP = /^\d\d:\d\d:\d\d,\d+ - \[Groupe\] (.+?) : /;
const CAST = /^(.+?) lance le sort (.+?)(?: \(Critiques\))?$/;
const SUMMON = /^(.+?): Invoque un\(e\) (.+?)\s*$/;
const HP = /^(.+?): ([+-])([\d\s]+) PV\s*(.*)$/;
const ARMOR = /^(.+?): ([\d\s]+) Armure\s*(.*)$/;
const STATE = /^(.+?): (.+?) \((?:Niv\. \d+|[+-]\d+ Niv\.)\)/;
const KO = /^(.+?) est KO !$/;
const REVIVED = /^(.+?): est réanimé/;
const OUT = /^(.+?) est hors-combat !$/;
const XP = /^(.+?) : \+[\d\s]+ points d'XP/;
const TURN_END = /secondes? reportées? pour le tour suivant/;
const FIGHT_END = /^Combat terminé/;
const CREATURE = /^(.+?): Invoque une créature du Gobgob/; // the next line names it
// Technical log (wakfu.log): every fighter joining a fight, with its class.
const TECH_TIME = /^\s*[A-Z]+ (\d\d):(\d\d):(\d\d),/;
const TECH_JOIN = /\[_FL_\] fightId=(\d+) (.+?) breed : (\d+) \[-?\d+\] isControlledByAI=(true|false)/;
const JOIN = /^(\d\d):(\d\d):(\d\d),(\d+) - \[Information \(jeu\)\] (.+) a rejoint le groupe$/;
const LEAVE = /^\d\d:\d\d:\d\d,\d+ - \[Information \(jeu\)\] (?:Vous avez quitté le groupe|Vous ne faites désormais plus partie d'un groupe)/;

const MAX_GROUP = 6;
const ELEMENTS = new Set(['feu', 'eau', 'terre', 'air', 'neutre', 'lumière', 'stasis']);
const META = new Set(['parade !', 'critiques', 'critique']);

// "Pulsar I" -> "pulsar", "Séisme niveau 2" / "Séisme - Critique" -> "séisme"
function norm(name) {
  return name
    .toLowerCase()
    .replace(/\s+-\s+critique$/, '')
    .replace(/\s+niveau \d+$/, '')
    .replace(/\s+[ivx]+$/, '')
    .trim();
}

function parseNumber(s) {
  return Number(s.replace(/\s/g, '')); // \s covers U+00A0 / U+202F separators
}

// Returns the effect source from "(Feu) (Parade !) (Bombe collante)", if any.
function sourceTag(tail) {
  const groups = [...tail.matchAll(/\(([^()]*)\)/g)].map((m) => m[1].trim());
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i].toLowerCase();
    if (ELEMENTS.has(g.split(' - ')[0]) || META.has(g)) continue;
    return groups[i];
  }
  return null;
}

class FightTracker {
  constructor() {
    this.fight = null;
    this.ended = true;
    this.known = new Map(); // name -> 'ally' | 'enemy', kept across fights
    this.roster = new Set(); // group members (the log never says when one leaves)
    this.lastSeen = new Map(); // member -> sequence number of their last sign of life
    this.seq = 0;
    this.tech = null; // { fightId, time, players: Map name -> breed } from wakfu.log
    this.joinBurst = null; // { ms, names } of consecutive "a rejoint le groupe" lines
    this.cumulFights = []; // snapshots of fights finished since the last cumul reset
  }

  newFight(seconds) {
    this.closeFight();
    this.fight = { start: seconds, last: seconds, fighters: new Map() };
    this.ended = false;
    this.caster = null;
    this.castSpell = null;
    this.summonOwner = new Map(); // norm(summon) -> summoner
    this.effectOwner = new Map(); // norm(spell or state) -> fighter
    this.relations = new Map(); // "author\ntarget" -> { hit, help }
    this.pendingCreature = null; // Osamodas whose Gobgob creature is named next
    this.attachTech();
  }

  // Links the technical log's roster to the current fight if they match in time
  // (the two logs are read separately, either may come first).
  attachTech() {
    const f = this.fight;
    // A list without players is useless (e.g. only the summons of a fight
    // whose start is in the previous, rotated log file).
    if (!f || !this.tech?.players.size || f.tech === this.tech) return false;
    if (this.tech.time < f.start - 120 || this.tech.time > f.last + 5) return false;
    f.tech = this.tech;
    return true;
  }

  // Feeds one line of wakfu.log; returns true when the fight state changed.
  feedTech(line) {
    const j = TECH_JOIN.exec(line);
    if (!j) return false;
    const t = TECH_TIME.exec(line);
    const time = t ? +t[1] * 3600 + +t[2] * 60 + +t[3] : 0;
    const [, fightId, name, breed, ai] = j;
    if (this.tech?.fightId !== fightId) this.tech = { fightId, time, players: new Map() };
    if (ai === 'false') this.tech.players.set(name, +breed);
    return this.attachTech() || (ai === 'false' && this.fight?.tech === this.tech);
  }

  // Discards the current fight.
  reset() {
    this.fight = null;
    this.ended = true;
  }

  // Files the current fight into the cumul, once.
  closeFight() {
    if (!this.fight || this.fight.closed) return;
    this.fight.roster = this.groupFor(this.fight); // the group as it was for this fight
    // More names than a group can hold: those absent from the fight have left.
    if (this.roster.size > MAX_GROUP) {
      for (const name of [...this.roster]) if (!this.fight.fighters.has(name)) this.roster.delete(name);
    }
    this.fight.closed = true;
    this.cumulFights.push(this.snapshot());
  }

  seen(name) {
    this.lastSeen.set(name, ++this.seq);
  }

  // At most 6 members: those present in the fight first, then the most
  // recently seen (someone may have left without a log line).
  groupFor(fight) {
    // The technical log lists who is really in the fight.
    if (fight?.tech) {
      const players = [...fight.tech.players.keys()];
      const inGroup = players.filter((n) => this.roster.has(n));
      return inGroup.length ? inGroup : players;
    }
    const members = [...this.roster];
    if (members.length <= MAX_GROUP) return members;
    const rank = (n) => (fight?.fighters.has(n) ? Infinity : this.lastSeen.get(n) || 0);
    const keep = new Set([...members].sort((a, b) => rank(b) - rank(a)).slice(0, MAX_GROUP));
    return members.filter((n) => keep.has(n));
  }

  // Starts a new cumul (e.g. at the entrance of a dungeon). A fight still in
  // progress is included.
  resetCumul() {
    this.cumulFights = [];
  }

  // Follows summon -> summoner links.
  owner(name) {
    if (!this.summonOwner) return name;
    const seen = new Set();
    while (this.summonOwner.has(norm(name)) && !seen.has(name)) {
      seen.add(name);
      name = this.summonOwner.get(norm(name));
    }
    return name;
  }

  author(tail) {
    const src = sourceTag(tail);
    if (src) {
      const key = norm(src);
      if (this.summonOwner.has(key)) return this.owner(this.summonOwner.get(key));
      if (this.effectOwner.has(key)) return this.owner(this.effectOwner.get(key));
    }
    return this.caster ? this.owner(this.caster) : null;
  }

  fighter(name) {
    let f = this.fight.fighters.get(name);
    if (!f) {
      f = {
        damage: 0, taken: 0, heal: 0, armor: 0,
        ko: false, banked: 0,
        turns: 0, hits: 0, hitSum: 0, bigHits: 0,
        kos: 0, maxHit: 0, maxHitSpell: null, // for the honour board
        spells: new Map(), // spell cast -> count (class detection)
        bySpell: new Map(), // norm(effect) -> { name, damage, taken, heal, armor }
      };
      this.fight.fighters.set(name, f);
    }
    return f;
  }

  // Adds to a fighter's total and, if known, to the effect that did it.
  add(name, stat, value, label) {
    const f = this.fighter(name);
    f[stat] += value;
    if (!label) return f;
    const key = norm(label);
    let e = f.bySpell.get(key);
    if (!e) f.bySpell.set(key, (e = { name: label.replace(/\s+[IVX]+$/, ''), damage: 0, taken: 0, heal: 0, armor: 0 }));
    e[stat] += value;
    return f;
  }

  relate(author, target, kind, n) {
    this.fighter(target);
    const key = `${author}\n${target}`;
    let r = this.relations.get(key);
    if (!r) this.relations.set(key, (r = { hit: 0, help: 0 }));
    r[kind] += n;
  }

  // On joining a group or changing zone, the game re-lists every member
  // ("X a rejoint le groupe") within the same few milliseconds: such a burst
  // replaces the roster. A lone line is a new member. Returns true if handled.
  updateRoster(line) {
    if (LEAVE.test(line)) {
      this.roster.clear();
      this.joinBurst = null;
      return true;
    }
    const j = JOIN.exec(line);
    if (!j) return false;
    const ms = ((+j[1] * 60 + +j[2]) * 60 + +j[3]) * 1000 + +j[4];
    const name = j[5];
    this.learn(name, 'ally');
    this.seen(name);
    if (this.joinBurst && Math.abs(ms - this.joinBurst.ms) <= 200) {
      this.joinBurst.ms = ms;
      this.joinBurst.names.add(name);
      this.roster = new Set(this.joinBurst.names);
    } else {
      this.joinBurst = { ms, names: new Set([name]) };
      this.roster.add(name);
    }
    return true;
  }

  // Records team evidence; returns true if it is new.
  learn(name, team) {
    if (this.known.get(name) === team) return false;
    this.known.set(name, team);
    return true;
  }

  // Feeds one log line; returns true when the fight state changed.
  feed(line) {
    line = line.trimEnd();
    const g = GROUP.exec(line);
    if (g) {
      const isNew = !this.roster.has(g[1]);
      this.roster.add(g[1]);
      this.seen(g[1]);
      return this.learn(g[1], 'ally') || isNew;
    }
    if (this.updateRoster(line)) return true;

    const m = LINE.exec(line);
    if (!m) return false;
    let seconds = +m[1] * 3600 + +m[2] * 60 + +m[3];
    const msg = m[4];

    // A Gobgob creature is only named by the line right after its summoning.
    if (this.fight && !this.ended) {
      if (this.pendingCreature) {
        const named = /^(.+?): /.exec(msg);
        if (named && named[1] !== this.pendingCreature) this.summonOwner.set(norm(named[1]), this.pendingCreature);
        this.pendingCreature = null;
      }
      const creature = CREATURE.exec(msg);
      if (creature) {
        this.pendingCreature = creature[1];
        return false;
      }
    }

    if (FIGHT_END.test(msg)) {
      if (this.ended) return false;
      this.ended = true;
      this.closeFight();
      return true;
    }

    let match;
    if ((match = KO.exec(msg))) {
      this.learn(match[1], 'ally');
      if (!this.fight || this.ended) return false;
      const f = this.fighter(match[1]);
      f.ko = true;
      f.kos++;
      return true;
    }
    if ((match = REVIVED.exec(msg))) {
      if (!this.fight || this.ended) return false;
      this.fighter(match[1]).ko = false;
      return true;
    }
    if ((match = XP.exec(msg))) {
      return this.learn(match[1], 'ally') && !!this.fight;
    }
    if ((match = OUT.exec(msg))) {
      const name = match[1];
      if (this.owner(name) !== name) return false; // a summon
      // A KO player whose countdown runs out also goes "hors-combat".
      const f = this.fight && !this.ended ? this.fight.fighters.get(name) : null;
      if (f?.ko || this.roster.has(name)) return false;
      return this.learn(name, 'enemy') && !!this.fight;
    }

    let cast, summon, hp, armor, state;
    if ((cast = CAST.exec(msg)) || (summon = SUMMON.exec(msg)) || (hp = HP.exec(msg)) || (armor = ARMOR.exec(msg))) {
      if (this.ended) this.newFight(seconds);
      if (seconds < this.fight.last) seconds += 86400; // past midnight
      this.fight.last = seconds;
    } else if (this.fight && !this.ended) {
      if (TURN_END.test(msg)) {
        // Banking turn time follows a player's turn (almost never a monster's).
        if (this.caster) this.fighter(this.owner(this.caster)).banked++;
        this.caster = null;
        this.castSpell = null;
      }
      else if ((state = STATE.exec(msg)) && this.caster) {
        this.effectOwner.set(norm(state[2]), this.caster);
      }
      return false;
    } else {
      return false;
    }

    if (cast) {
      const f = this.fighter(this.owner(cast[1]));
      // A turn = a run of consecutive casts by the same (non-summon) fighter.
      if (cast[1] !== this.caster && this.owner(cast[1]) === cast[1]) f.turns++;
      this.caster = cast[1];
      this.castSpell = cast[2];
      this.effectOwner.set(norm(cast[2]), cast[1]);
      f.spells.set(cast[2], (f.spells.get(cast[2]) || 0) + 1);
      const wasKo = f.ko;
      f.ko = false;
      return wasKo;
    }
    if (summon) {
      this.summonOwner.set(norm(summon[2]), summon[1]);
      return false;
    }

    const [target, tail] = hp ? [hp[1], hp[4]] : [armor[1], armor[3]];
    const victim = this.owner(target);
    const hit = hp && hp[2] === '-';
    const who = this.author(tail);
    const label = sourceTag(tail) || this.castSpell;
    // Damage taken counts even when its author is unknown, but not self-inflicted.
    if (hit && victim === target && who !== victim) this.add(victim, 'taken', parseNumber(hp[3]), label);
    if (!who) return hit;
    if (hit) {
      if (who === victim) return true; // self-damage / counters
      const n = parseNumber(hp[3]);
      this.relate(who, victim, 'hit', n);
      const f = this.add(who, 'damage', n, label);
      // A big hit: well above this fighter's average so far.
      if (f.hits >= 3 && n >= 1000 && n >= 2.5 * (f.hitSum / f.hits)) f.bigHits++;
      f.hits++;
      f.hitSum += n;
      if (n > f.maxHit) {
        f.maxHit = n;
        f.maxHitSpell = label || null;
      }
    } else {
      const n = parseNumber(hp ? hp[3] : armor[2]);
      if (who !== victim) this.relate(who, victim, 'help', n);
      this.add(who, hp ? 'heal' : 'armor', n, label);
    }
    return true;
  }

  // name -> { ally, player }: on the players' side, and a player (not a summon).
  sides() {
    // 1. Direct evidence: positive = player, negative = monster.
    const evidence = new Map();
    for (const [name, f] of this.fight.fighters) {
      let e = Math.min(f.banked, 2);
      if (detectClass(f.spells)) e += 3;
      // Controlled by a player per the technical log: strong if in the group
      // (in PvP, opponents are players too).
      if (this.fight.tech?.players.has(name)) e += this.roster.has(name) || !this.roster.size ? 4 : 1;
      const k = this.known.get(name);
      if (k === 'ally') e += 3;
      else if (k === 'enemy') e -= 3;
      evidence.set(name, e);
    }

    // 2. What each fighter did to others (outgoing) and suffered (incoming).
    const outgoing = new Map();
    const incoming = new Map();
    const push = (map, name, rel) => (map.get(name) || map.set(name, []).get(name)).push(rel);
    for (const [key, { hit, help }] of this.relations) {
      const [a, b] = key.split('\n');
      push(outgoing, a, { other: b, hit, help });
      push(incoming, b, { other: a, hit, help });
    }

    // 3. Fighters with evidence are settled. The others are judged only
    //    against settled fighters (never against default guesses), spreading
    //    a few rounds: helping players or hitting monsters votes "player".
    //    What a fighter suffered counts only if it did nothing itself, and
    //    only when it comes from a player (monster area effects hit monsters
    //    too). Still undecided at the end = monster.
    const settled = new Map();
    for (const [name, e] of evidence) if (e !== 0) settled.set(name, e > 0);
    const vote = (rels = [], fromPlayersOnly = false) => {
      let v = 0;
      for (const { other, hit, help } of rels) {
        const side = settled.get(other);
        if (side === undefined || (fromPlayersOnly && !side)) continue;
        v += (side ? 1 : -1) * (help - hit);
      }
      return Math.sign(v);
    };
    for (let round = 0; round < 3; round++) {
      const decided = [];
      for (const name of evidence.keys()) {
        if (settled.has(name)) continue;
        const v = vote(outgoing.get(name)) || vote(incoming.get(name), true);
        if (v) decided.push([name, v > 0]);
      }
      if (!decided.length) break;
      for (const [name, side] of decided) settled.set(name, side);
    }

    // Evidence can be weak (a single banked turn): a fighter with little
    // evidence who mostly hits players is still a monster.
    // A player is an ally with evidence of their own or a group member;
    // other allies (e.g. summons not announced in the log) get no card.
    const sides = new Map();
    for (const [name, e] of evidence) {
      const v = Math.abs(e) < 3 ? vote(outgoing.get(name)) : 0;
      const ally = settled.has(name) ? (v ? v > 0 : settled.get(name)) : false;
      const human = this.fight.tech ? this.fight.tech.players.has(name) : e > 0 || this.roster.has(name);
      sides.set(name, { ally, player: ally && human });
    }
    return sides;
  }

  snapshot() {
    if (!this.fight) return null;
    const sides = this.sides();
    return {
      start: this.fight.start,
      duration: this.fight.last - this.fight.start,
      ended: this.ended,
      roster: this.fight.roster || this.groupFor(this.fight),
      breeds: this.fight.tech ? Object.fromEntries(this.fight.tech.players) : {}, // exact classes
      fighters: [...this.fight.fighters].map(([name, { spells, bySpell, hitSum, ...s }]) => ({
        name,
        ...sides.get(name),
        breed: this.fight.tech?.players.get(name) || detectClass(spells),
        ...s,
        bySpell: [...bySpell.values()],
      })),
    };
  }

  // Sum of the fights since the last cumul reset, including a fight in progress.
  cumulSnapshot() {
    const parts = [...this.cumulFights];
    if (this.fight && !this.fight.closed) parts.push(this.snapshot());
    if (!parts.length) return null;
    const STATS = ['damage', 'taken', 'heal', 'armor', 'turns', 'hits', 'bigHits', 'kos'];
    const fighters = new Map();
    for (const part of parts) {
      for (const f of part.fighters) {
        let c = fighters.get(f.name);
        if (!c) {
          c = { name: f.name, ally: false, player: false, breed: null, ko: false, maxHit: 0, maxHitSpell: null, spellMap: new Map() };
          for (const k of STATS) c[k] = 0;
          fighters.set(f.name, c);
        }
        for (const k of STATS) c[k] += f[k];
        if (f.maxHit > c.maxHit) {
          c.maxHit = f.maxHit;
          c.maxHitSpell = f.maxHitSpell;
        }
        c.ally ||= f.ally;
        c.player ||= f.player;
        c.breed ||= f.breed;
        for (const e of f.bySpell) {
          const key = norm(e.name);
          const m = c.spellMap.get(key) || c.spellMap.set(key, { name: e.name, damage: 0, taken: 0, heal: 0, armor: 0 }).get(key);
          for (const k of ['damage', 'taken', 'heal', 'armor']) m[k] += e[k];
        }
      }
    }
    const last = parts[parts.length - 1];
    return {
      start: parts[0].start,
      duration: parts.reduce((sum, p) => sum + p.duration, 0),
      ended: last.ended,
      fights: parts.length,
      roster: [],
      fighters: [...fighters.values()].map(({ spellMap, ...c }) => ({ ...c, bySpell: [...spellMap.values()] })),
    };
  }
}

module.exports = { FightTracker };
