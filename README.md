# Wakfu Meter

Overlay transparent, toujours au premier plan, qui affiche pendant un combat Wakfu les **dégâts infligés**, **dégâts reçus**,
**soins** et **armure** de chaque joueur du groupe, avec le portrait de sa classe.

Il lit uniquement le fichier de log que le jeu écrit sur ton PC (`wakfu_chat.log`) : il ne touche pas au jeu, n'envoie rien
sur Internet (sauf pour vérifier les mises à jour sur cette page) et ne présente aucun risque pour ton compte.

> Projet de fan, non affilié à Ankama. Fonctionne avec le client Wakfu **en français**.

## Installation

1. Télécharge `Wakfu-Meter-Setup-x.y.z.exe` dans la dernière version de la page **Releases** (à droite sur GitHub).
2. Lance-le. Windows peut afficher « Windows a protégé votre ordinateur » (l'application n'est pas signée, un certificat
   coûte cher) : clique sur **Informations complémentaires** puis **Exécuter quand même**.
3. L'overlay s'ouvre ; il se lance ensuite depuis le menu Démarrer (« Wakfu Meter »).

Les **mises à jour sont automatiques** : à chaque lancement, l'application vérifie s'il existe une nouvelle version, la
télécharge en arrière-plan et l'installe à la fermeture.

Prérequis : Wakfu lancé via le launcher Ankama, en mode **fenêtré** ou **plein écran fenêtré** (l'overlay ne peut pas
passer devant le plein écran exclusif).

## Utilisation

L'application regroupe plusieurs modules, choisis par les icônes à gauche de l'en-tête :

| Module | Contenu |
|---|---|
| ⚔ Combat | Dégâts infligés et reçus, soins, armure par joueur (détails ci-dessous) |
| 📊 Session | Depuis le lancement : durée, combats, XP, kamas gagnés/perdus, objets ramassés, challenges — avec les moyennes par heure |
| 🎯 Challenges | Taux de réussite global et par challenge, conservé d'une session à l'autre |
| 🏆 Honneur | Plus gros coup, plus de dégâts, meilleur DPT, plus de soins, d'armure, plus encaissé, plus de KO (combats depuis le lancement) |

Option dans l'aide (`?`) : **Lancer automatiquement avec Wakfu** — l'application démarre avec Windows en arrière-plan,
s'affiche quand Wakfu se lance et se masque quand il se ferme.

| | |
|---|---|
| Onglets | Infligés · Reçus · Soins · Armure |
| Clic sur une carte | Détail par sort, DPT (dégâts par tour), tours, gros coups ; bouton pour changer la classe |
| `Σ` | Cumul des combats depuis le lancement (pratique pour un donjon) ; `↺` en mode Σ remet le cumul à zéro |
| `📋` | Copie un récapitulatif texte à coller sur Discord |
| `🖱` | Clics traversants : les clics passent au jeu, seul l'en-tête reste cliquable |
| `⇅` / `⇆` | Disposition horizontale ou verticale (avec les noms) |
| `◐` | Mode transparent ou normal |
| `↺` | Remet le combat à zéro |
| `?` | Fenêtre d'aide (affichée au démarrage, désactivable) et numéro de version |
| `✕` au survol d'une carte | Masque ce joueur (`👁` pour réafficher) |
| Coin bas-droit / Ctrl + molette | Agrandir ou réduire (tout le contenu suit) |
| Glisser l'en-tête | Déplacer (la position est mémorisée) |

Raccourcis, utilisables même quand le jeu a le focus :

| Raccourci | Action |
|---|---|
| `Ctrl+Alt+W` | Afficher / masquer l'overlay |
| `Ctrl+Alt+C` | Clics traversants |
| `Ctrl+Alt+T` | Onglet suivant |
| `Ctrl+Alt+R` | Remise à zéro |

Bon à savoir :
- Une carte par membre du groupe, présente dès le début du combat (grisée tant que le joueur n'a rien fait, grisée avec
  « KO » quand il est KO). Une carte s'illumine brièvement lors d'un gros coup.
- La classe est devinée d'après les sorts lancés ; si elle est fausse, clique sur la carte puis sur le nom de la classe.
  Les portraits viennent de ta propre installation de Wakfu (initiales si le jeu n'est pas à l'emplacement par défaut).
- Le log ne dit pas qui frappe : l'auteur des dégâts est déduit (voir plus bas). Les chiffres sont fiables pour les
  joueurs, mais les dégâts dont l'auteur est introuvable (glyphes et poisons de monstres) ne sont pas comptés.
- Le DPT est approximatif : un tour = une suite de sorts consécutifs du même joueur.

## Développement

```
npm install
npm start          # lance l'overlay depuis les sources
npm test           # tests
npm run dist       # fabrique l'installateur dans dist/ sans le publier
npm run release    # fabrique et publie une nouvelle version sur GitHub (variable GH_TOKEN requise)
```

Pour publier une mise à jour : changer `version` dans `package.json`, puis `npm run release`. Les applications installées
la récupèrent à leur prochain lancement.

Si `npm install` ne télécharge pas Electron (npm demande d'approuver son script d'installation), lancer
`node node_modules/electron/install.js`.

Fichiers : `src/parser.js` (lecture du log, attribution, équipes, groupe, cumul), `src/tail.js` (suivi du fichier),
`src/classes.js` (sorts caractéristiques de chaque classe), `src/portraits.js` (portraits lus dans `gui.jar` du jeu),
`main.js` (fenêtre, raccourcis, mises à jour), `renderer/` (interface).

### Attribution des dégâts

Les lignes de dégâts n'indiquent pas l'attaquant (`Cible: -786 PV (Feu) (Source)`). L'auteur est déduit :
1. via la source entre parenthèses : invocation (`Invoque un(e) …`), état posé pendant le sort de quelqu'un, ou sort déjà
   lancé dans le combat ;
2. sinon, le dernier lanceur de sort du tour en cours.

Les invocations sont créditées à leur invocateur. Les dégâts qu'un combattant s'inflige sont ignorés, ainsi que les effets
dont l'auteur est introuvable.

### Joueurs / monstres

Le log ne donne pas les équipes. Indices « joueur » : sorts de classe, temps de tour reporté, « X est KO ! », gains d'XP,
canal Groupe, lignes « X a rejoint le groupe ». Indice « monstre » : « hors-combat » sans KO préalable. Sans indice, un
combattant est jugé d'après qui il frappe ou soigne parmi les combattants déjà classés ; par défaut, c'est un monstre.
Le groupe est limité à 6 : le log ne signale pas les départs, les absents d'un combat sont retirés s'il y a plus de 6 noms.
