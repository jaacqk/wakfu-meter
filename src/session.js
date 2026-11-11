'use strict';

// Session summary from wakfu_chat.log: fights, XP, kamas, items picked up and
// challenges since the session started.

const LINE = /^\d\d:\d\d:\d\d,\d+ - \[([^\]]+)\] (.*)$/;
const KAMAS_IN = /^Vous avez gagné ([\d\s]+) kamas/;
const KAMAS_OUT = /^Vous avez perdu ([\d\s]+) kamas/;
const XP = /^(.+?) : \+([\d\s]+) points d'XP/;
const PICKED = /^Vous avez ramassé (\d+)x (.+?)\s*\.?$/;
const CHALLENGE = /^Le challenge "(.+)" (est réussi|a échoué)/;
const FIGHT_END = /^Combat terminé/;

const num = (s) => Number(s.replace(/\s/g, '')); // \s covers U+202F separators

class SessionStats {
  constructor(onChallenge = () => {}) {
    this.onChallenge = onChallenge; // (name, won) for each challenge result
    this.reset();
  }

  reset(now = Date.now()) {
    this.started = now;
    this.fights = 0;
    this.xp = 0;
    this.kamasIn = 0;
    this.kamasOut = 0;
    this.items = new Map(); // item -> quantity
    this.challenges = { won: 0, lost: 0 };
  }

  // Feeds one chat log line; returns true when the summary changed.
  feed(line) {
    const m = LINE.exec(line.trimEnd());
    if (!m) return false;
    const [, channel, msg] = m;
    let r;
    if (channel === 'Information (jeu)') {
      if ((r = KAMAS_IN.exec(msg))) this.kamasIn += num(r[1]);
      else if ((r = KAMAS_OUT.exec(msg))) this.kamasOut += num(r[1]);
      else if ((r = PICKED.exec(msg))) this.items.set(r[2], (this.items.get(r[2]) || 0) + +r[1]);
      else if ((r = CHALLENGE.exec(msg))) {
        const won = r[2] === 'est réussi';
        this.challenges[won ? 'won' : 'lost']++;
        this.onChallenge(r[1], won);
      } else return false;
      return true;
    }
    if (channel === 'Information (combat)') {
      if ((r = XP.exec(msg))) this.xp += num(r[2]);
      else if (FIGHT_END.test(msg)) this.fights++;
      else return false;
      return true;
    }
    return false;
  }

  snapshot() {
    const items = [...this.items].sort((a, b) => b[1] - a[1]);
    return {
      started: this.started,
      fights: this.fights,
      xp: this.xp,
      kamasIn: this.kamasIn,
      kamasOut: this.kamasOut,
      itemCount: items.reduce((sum, [, n]) => sum + n, 0),
      topItems: items.slice(0, 5),
      challenges: { ...this.challenges },
    };
  }
}

module.exports = { SessionStats };
