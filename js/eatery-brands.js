// The two restaurant franchises of the city, as data: who they are, what they sell, what their people say.
// Shared by the plan (eatery-plan.js), the rooms (eatery-room.js), the printed matter (eatery-prints.js), the food
// (eatery-food.js), the game (eatery.js) and the tests. Original brands: nothing here borrows from a real chain.
//
// BULLION — burgers. A gold bar with a bull's horns: beef sold as a safe haven. Black lacquer, gold, oxblood booths.
// TRANCHE — pizza by the slice. A pie chart with one share pulled out. Tomato red, cream, basil green, white tiles.

const BRANDS = Object.freeze({
  bullion: Object.freeze({
    id: 'bullion', name: 'BULLION', kind: 'burger', label: 'Burgers BULLION',
    tagline: 'La valeur refuge.', since: 'Burgers en barres depuis 1971',
    colors: Object.freeze({ gold: '#e8b23a', goldDeep: '#b8862b', goldPale: '#f6d98a', black: '#15120f', cream: '#f3e9d2', oxblood: '#7e1f1a', ember: '#d9541e' }),
    hours: [6, 26], // 6 am to 2 am
    crew: ['MAYA', 'DEV', 'SOFIA', 'JAMAL', 'CHLOÉ', 'LUIS', 'INÈS', 'OMAR'],
    // `meal`: comes on a tray, eaten at a table (bites); otherwise handed over in a bag and kept as a snack for later
    menu: Object.freeze([
      { id: 'dividende', name: 'MENU DIVIDENDE', note: 'Le Lingot, des Pépites, une boisson', price: 15, heal: 100, meal: true, fed: 300, tray: ['burger', 'fries', 'cup'], bites: 7 },
      { id: 'bullmarket', name: 'BULL MARKET', note: 'Triple bœuf, bacon, oignons frits', price: 14, heal: 100, meal: true, fed: 180, tray: ['burgerTall', 'cup'], bites: 6 },
      { id: 'lingot', name: 'LE LINGOT', note: 'Double bœuf, cheddar, sauce maison', price: 9, heal: 60, snack: 'burger' },
      { id: 'krach', name: 'LE KRACH', note: 'Poulet croustillant, coleslaw', price: 8, heal: 50, snack: 'burger' },
      { id: 'carat', name: 'LE CARAT', note: 'Le petit. Simple et net', price: 5, heal: 35, snack: 'burger' },
      { id: 'pepites', name: 'PÉPITES', note: 'Frites dorées à la graisse de bœuf', price: 4, heal: 20, snack: 'fries' },
      { id: 'liquidites', name: 'LIQUIDITÉS', note: 'Milk-shake vanille, toujours disponible', price: 5, heal: 25, snack: 'cup' }
    ]),
    lines: Object.freeze({
      greet: ['Bienvenue chez Bullion. La valeur refuge, c’est ici.', 'Bonjour ! Sur place ou à emporter ?', 'Bullion, bonjour. Le bœuf ne dévisse jamais.'],
      counter: ['Je vous écoute.', 'Qu’est-ce qui vous ferait plaisir ?', 'Prenez votre temps, le cours ne bouge pas.'],
      sold: ['Votre numéro s’affiche là-haut.', 'C’est parti en cuisine.', 'De l’or en barre. Bon choix.'],
      ready: ['Numéro {n} !', 'Le {n}, c’est prêt !', 'Commande {n} !'],
      bag: ['Et voilà, à emporter.', 'Tenez. Ça se garde, mais pas longtemps.'],
      broke: ['Ici, on ne prend pas les découverts.', 'Il manque un peu. Beaucoup, en fait.', 'Même le Carat, vous ne pouvez pas ?'],
      full: ['Vous avez déjà les poches pleines.'],
      busy: ['Une seconde, je finis avec monsieur.', 'Je suis à vous tout de suite.'],
      bye: ['Bonne journée !', 'À bientôt chez Bullion.', 'Revenez quand ça baisse.'],
      police: ['On ne sert pas les gens recherchés. Désolé.'],
      robbed: ['Prenez tout ! C’est pas mon argent !', 'OK, OK ! Je vide la caisse !', 'Ne tirez pas, c’est qu’un burger !'],
      bagged: ['C’est tout ce qu’il y a. Partez.'],
      queue: ['Hé ! La queue, c’est derrière.', 'On attend tous, mon grand.', 'Je rêve. Il double.'],
      tray: ['Mon plateau !', 'Regarde où tu vas !', 'Sérieusement ?'],
      clean: ['Pardon, je passe la serpillière.', 'Attention, sol glissant.'],
      cook: ['Deux Lingot, un Krach !', 'Ça marche !', 'Pépites en route !', 'Chaud devant !']
    })
  }),
  tranche: Object.freeze({
    id: 'tranche', name: 'TRANCHE', kind: 'pizza', label: 'Pizza TRANCHE',
    tagline: 'Prenez votre part.', since: 'Pizza à la part · four à sole',
    colors: Object.freeze({ tomato: '#d5311f', tomatoDeep: '#9e2114', cream: '#f7eedc', basil: '#2f7a4a', charcoal: '#1e1b19', crust: '#d9a45b', cheese: '#f2c14e' }),
    hours: [10, 28], // 10 am to 4 am
    crew: ['ENZO', 'NINA', 'SAL', 'CARLA', 'VITO', 'GIULIA'],
    menu: Object.freeze([
      { id: 'margherita', name: 'MARGHERITA CALL', note: 'Tomate, mozzarella, basilic', price: 4, heal: 30, slice: 'margherita' },
      { id: 'junkbond', name: 'JUNK BOND', note: 'Pepperoni, saucisse, tout ce qui traîne', price: 5, heal: 45, slice: 'pepperoni' },
      { id: 'triplea', name: 'TRIPLE A', note: 'Trois fromages, notée par personne', price: 5, heal: 40, slice: 'bianca' },
      { id: 'subprime', name: 'SUBPRIME', note: 'La part d’hier. Risque non noté', price: 1, heal: 15, slice: 'margherita', risky: true },
      { id: 'entiere', name: 'LA PIZZA ENTIÈRE', note: 'En boîte : quatre parts pour plus tard', price: 18, heal: 45, snack: 'box', count: 4 },
      { id: 'soda', name: 'SODA', note: 'Bien frais, sans dividende', price: 2, heal: 10, snack: 'can' }
    ]),
    lines: Object.freeze({
      greet: ['Une part ? Elle sort du four.', 'Entre, entre. Prends ta part.', 'Tranche, bonjour. Ici, tout le monde a sa part.'],
      counter: ['Dis-moi.', 'Laquelle te fait de l’œil ?', 'Regarde la vitrine, prends ton temps.'],
      sold: ['Je te la réchauffe.', 'Trente secondes au four.', 'Bon choix. Plie-la en deux, comme tout le monde.'],
      ready: ['Chaud devant !', 'Et voilà. Attention, ça brûle.', 'Tiens. Mange-la tant qu’elle fume.'],
      bag: ['La boîte est chaude. Tiens-la à plat !', 'Voilà. Ne la retourne pas.'],
      broke: ['Même la Subprime, tu peux pas ?', 'Reviens avec de la monnaie, pas un découvert.'],
      full: ['Tu en as déjà plein les poches.'],
      busy: ['J’arrive, j’arrive.', 'Une seconde, je sers madame.'],
      bye: ['Ciao !', 'À demain. Tu reviendras.', 'Salue ta mère.'],
      police: ['Pas avec les flics aux fesses. File.'],
      robbed: ['Prends la caisse ! Laisse le four tranquille !', 'OK ! OK ! Voilà, voilà !', 'Tu braques une pizzeria ? Sérieux ?'],
      bagged: ['Voilà. Maintenant dehors.'],
      queue: ['Oh ! Y a une queue ici.', 'Chacun son tour, capisce ?'],
      tray: ['Ma part !', 'Hé ! Elle était chaude !'],
      clean: ['Je passe un coup, bouge pas.'],
      cook: ['Une Junk Bond qui sort !', 'Margherita au four !', 'Pâte fraîche !', 'Attention la pelle !'],
      risky: ['Je t’avais prévenu pour la Subprime.']
    })
  })
});

const BRAND_IDS = Object.freeze(Object.keys(BRANDS));
// Snacks kept in the pockets for later (a burger in its paper, a boxed slice): how many at most
const SNACK_MAX = 8;

function menuItem(brand, id) { return BRANDS[brand]?.menu.find((item) => item.id === id) || null; }
// Is a branch of this brand open at `hour` (0..24)? Hours may pass midnight (26 = 2 am)
function brandOpenAt(brand, hour) {
  const [open, close] = BRANDS[brand].hours;
  return (hour >= open && hour < close) || (hour + 24 >= open && hour + 24 < close);
}

export { BRANDS, BRAND_IDS, SNACK_MAX, menuItem, brandOpenAt };
