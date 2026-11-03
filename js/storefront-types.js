// The kinds of shop a ground floor can hold. Shared by tools/shops/build-storefronts.mjs (which picks one per real
// storefront from the city's registry) and js/storefronts.js (which builds, signs, lights and opens them). The order
// is the type code stored in js/storefront-geodata.bin.gz: append new kinds at the end, never reorder.
//
// hours: [open, close] in hours of the game day, close may pass midnight (26 = 2 am); [0, 24] never closes.

const SHOP_TYPES = [
  { id: 'vacant', label: 'Local vide', hours: [0, 0] },
  { id: 'bodega', label: 'Épicerie', hours: [0, 24] },
  { id: 'pizza', label: 'Pizzeria', hours: [10, 26] },
  { id: 'cafe', label: 'Café', hours: [6.5, 20] },
  { id: 'bakery', label: 'Boulangerie', hours: [6, 19] },
  { id: 'takeout', label: 'Traiteur asiatique', hours: [11, 23.5] },
  { id: 'sushi', label: 'Restaurant japonais', hours: [11.5, 23] },
  { id: 'latin', label: 'Restaurant latino', hours: [10, 24] },
  { id: 'restaurant', label: 'Restaurant', hours: [11.5, 24] },
  { id: 'bar', label: 'Bar', hours: [16, 28] },
  { id: 'diner', label: 'Snack', hours: [7, 23] },
  { id: 'juice', label: 'Bar à jus', hours: [8, 21] },
  { id: 'laundromat', label: 'Laverie', hours: [7, 23] },
  { id: 'cleaners', label: 'Pressing', hours: [7, 19.5] },
  { id: 'barber', label: 'Barbier', hours: [9, 20] },
  { id: 'salon', label: 'Onglerie', hours: [9.5, 20] },
  { id: 'pharmacy', label: 'Pharmacie', hours: [8, 22] },
  { id: 'bank', label: 'Banque', hours: [9, 17] },
  { id: 'boutique', label: 'Vêtements', hours: [10, 20] },
  { id: 'luxury', label: 'Maison de luxe', hours: [10, 19] },
  { id: 'jewelry', label: 'Bijouterie', hours: [10, 18.5] },
  { id: 'phones', label: 'Téléphones', hours: [9.5, 21] },
  { id: 'hardware', label: 'Quincaillerie', hours: [8, 19] },
  { id: 'florist', label: 'Fleuriste', hours: [8, 20] },
  { id: 'liquor', label: 'Vins et spiritueux', hours: [10, 23] },
  { id: 'books', label: 'Livres et disques', hours: [10, 21] },
  { id: 'office', label: 'Bureau', hours: [9, 18] },
  { id: 'souvenir', label: 'Souvenirs', hours: [9, 24] },
  { id: 'shoes', label: 'Chaussures', hours: [10, 20] },
  { id: 'gallery', label: 'Galerie', hours: [11, 18] }
];

const SHOP_TYPE_INDEX = Object.fromEntries(SHOP_TYPES.map((t, i) => [t.id, i]));

// Is a shop of this type open at `hour` (0..24)?
function shopOpenAt(type, hour) {
  const [open, close] = type.hours;
  if (close - open >= 24) return true;
  if (close <= open) return false;
  return (hour >= open && hour < close) || (hour + 24 >= open && hour + 24 < close);
}

export { SHOP_TYPES, SHOP_TYPE_INDEX, shopOpenAt };
