'use strict';

// Wakfu classes (breed ids match the game's portrait files) and signature
// spells used to guess a fighter's class from what they cast.
// Spell names are from the French client; most were checked against real logs.

const CLASSES = [
  { id: 1, name: 'Féca', spells: ['Orbe défensif', 'Bastion', 'Avalanche', 'Volcan', 'Frappe tellurique', 'Magnétisme', 'Goutte'] },
  { id: 2, name: 'Osamodas', spells: ['Fouet', 'Crapaud', 'Dragonnet', 'Gobgob'] },
  { id: 3, name: 'Enutrof', spells: ['Excavation', 'Maladresse', 'Taxe', 'Filouterie', "Force de l'âge", 'Gisement'] },
  { id: 4, name: 'Sram', spells: ['Premier Sang', 'Saignée mortelle', 'Ouvrir les veines', 'Mise à mort', 'Attaque perfide', 'Arnaque', 'Fourberie', 'Invisibilité', 'Piège de Répulsion'] },
  { id: 5, name: 'Xélor', spells: ['Aiguille', 'Désynchronisation', 'Vol du temps', 'Distorsion', 'Dévouement', 'Cadran', 'Régulateur', 'Éclair obscur', 'Suspension'] },
  { id: 6, name: 'Ecaflip', spells: ['Pile ou Face', 'Roue de la Fortune', 'Rekop', 'Bluff'] },
  { id: 7, name: 'Eniripsa', spells: ['Revitalisation', 'Vivification', 'Cure alternative', 'Flamme purificatrice', 'Reconstitution', 'Contre-nature', 'Lapino'] },
  { id: 8, name: 'Iop', spells: ['Uppercut', 'Éventrail', 'Rafale', 'Torgnole', 'Fendoir', 'Bond', 'Épée céleste', 'Colère de Iop', 'Super Iop Punch', 'Jabs'] },
  { id: 9, name: 'Crâ', spells: ['Flèche explosive', 'Balise de destruction', 'Débalisage', 'Flèche d\'immolation', 'Balise de contact', 'Flèche fulminante', 'Flèche criblante'] },
  { id: 10, name: 'Sadida', spells: ['Graine', 'Vaporiser', 'Ronce', 'Relent Boisé', 'Coup de Froid', 'Force de la nature', 'Arbre'] },
  { id: 11, name: 'Sacrieur', spells: ['Assaut', 'Fulgurance', 'Cinétose', 'Tempête spirituelle', 'Entaille', 'Poing tatoué agrippant', 'Démence', 'Coeur sanguin'] },
  { id: 12, name: 'Pandawa', spells: ['Lait de bambou', 'Picole', 'Ivresse', 'Gueule de bois', 'Karcham', 'Chamrak'] },
  { id: 13, name: 'Roublard', spells: ['Pulsar', 'Détonation', 'Coup rapide', 'Barbrûlé', 'Croisement', 'Bombe collante', 'Balle plombante', 'Exécution', 'Dynamite', 'Tricherie'] },
  { id: 14, name: 'Zobal', spells: ['Cabriole', 'Plastron', 'Furia'] },
  { id: 15, name: 'Ouginak', spells: ['Croc-en-jambe', 'Rupture', 'Canine', 'Proie', 'Baroud', 'Élan', 'Ougigarou'] },
  { id: 16, name: 'Steamer', spells: ["Tir d'alignement", 'Ecume', 'Flibuste', 'Tourelle', 'Surtension', 'Flux de Stasis', 'Courant'] },
  { id: 18, name: 'Eliotrope', spells: ['Pulsation', 'Wakméha', 'Portail', 'Exaltation', 'Déluge', 'Targe fracassante', 'Portail céleste'] },
  { id: 19, name: 'Huppermage', spells: ['Halo Chatoyant', 'Feu-follet', 'Disque luminescent', 'Cœur de Lumière', 'Cycle élémentaire', 'Runification', 'Rayon crépusculaire', 'Faille', 'Lueur de l\'aube', 'Vestige'] },
];

const key = (s) => s.toLowerCase().replace(/\s+[ivx]+$/, '').trim();

const SPELL_CLASS = new Map();
for (const c of CLASSES) for (const s of c.spells) SPELL_CLASS.set(key(s), c.id);

// spells: Map<spell name, cast count>. Returns the breed id or null.
function detectClass(spells) {
  const score = new Map();
  for (const [spell, n] of spells) {
    const id = SPELL_CLASS.get(key(spell));
    if (id) score.set(id, (score.get(id) || 0) + n);
  }
  let best = null;
  for (const [id, n] of score) if (!best || n > score.get(best)) best = id;
  return best;
}

module.exports = { CLASSES: CLASSES.map(({ id, name }) => ({ id, name })), detectClass };
