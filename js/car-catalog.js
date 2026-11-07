// The same original fleet names and finishes in the garage, HUD and loading pool.
// Geometry and engineering data still come from the model and its physical tune.
const CAR_CATALOG = [
  { kind: 'sedan', brand: 'VALMONT', model: 'ÉCUME', type: 'BERLINE', drive: 'PROPULSION', paint: 0x681c29 },
  { kind: 'muscle', brand: 'BRISANT', model: 'TEMPÊTE', type: 'MUSCLE', drive: 'V8 PROPULSION', paint: 0x12305c },
  { kind: 'sport', brand: 'CORSAIRE', model: 'FOUDRE', type: 'SPORTIVE', drive: 'PROPULSION', paint: 0xc8320e },
  { kind: 'super', brand: 'CORSAIRE', model: 'ZÉNITH', type: 'SUPERCAR', drive: 'INTÉGRALE', paint: 0x9a2028 },
  { kind: 'hatch', brand: 'VALMONT', model: 'RESSAC', type: 'COMPACTE', drive: 'TRACTION', paint: 0xb7c4c6 },
  { kind: 'compact', brand: 'GRÉVILLE', model: 'GALET', type: 'CITADINE', drive: 'TRACTION', paint: 0x33757a },
  { kind: 'wagon', brand: 'VALMONT', model: 'SILLAGE', type: 'BREAK', drive: 'PROPULSION', paint: 0x354636 },
  { kind: 'suv', brand: 'BRISANT', model: 'RÉCIF', type: 'SUV', drive: 'INTÉGRALE', paint: 0x192f39 },
  { kind: 'offroad', brand: 'BRISANT', model: 'MARAIS', type: '4×4', drive: 'INTÉGRALE', paint: 0x8c784b },
  { kind: 'pickup', brand: 'GRÉVILLE', model: 'FALAISE', type: 'PICK-UP', drive: 'PROPULSION', paint: 0x633336 },
  { kind: 'minivan', brand: 'GRÉVILLE', model: 'ESCALE', type: 'MONOSPACE', drive: 'TRACTION', paint: 0x536473 },
  { kind: 'taxi', brand: 'VALMONT', model: 'CAB 7', type: 'TAXI', drive: 'PROPULSION', paint: 0xffbd22 },
  { kind: 'van', brand: 'HAUTURIER', model: 'CARGO', type: 'UTILITAIRE', drive: 'PROPULSION', paint: 0xccc9ba },
  { kind: 'delivery', brand: 'HAUTURIER', model: 'TOURNÉE', type: 'FOURGON', drive: 'TRACTION', paint: 0xe2cda5 },
  { kind: 'truck', brand: 'HAUTURIER', model: 'FRET', type: 'CAMION', drive: 'DIESEL', paint: 0x284a50 }
];
const CAR_NAMES = Object.fromEntries(CAR_CATALOG.map(c => [c.kind, [c.brand, c.model, `${c.type} / ${c.drive}`]]));
const GARAGE_KINDS = new Set(CAR_CATALOG.map(c => c.kind));
export { CAR_CATALOG, CAR_NAMES, GARAGE_KINDS };
