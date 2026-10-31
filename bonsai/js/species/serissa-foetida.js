// Serissa foetida (sin. S. japonica), a "árvore das mil estrelas": arbusto pequeno de folhas miúdas e
// opostas, flores brancas em estrela e casca clara. Ramifica fácil e denso, mas o tronco engrossa devagar;
// sensível a qualquer mudança (lugar, rega, temperatura), quando derruba folhas. Quase não forma sementes:
// propaga-se por estaca.
export default {
  id: 'serissa-foetida',
  scientific: 'Serissa foetida',
  common: 'Serissa, árvore das mil estrelas',
  name: { short: 'serissa', article: 'a' },   // como o jogo se refere à planta nos avisos ("a serissa está murchando")
  family: 'Rubiaceae',
  origin: 'Sudeste da Ásia: China, Japão e Indochina',
  growthBySeason: [0.95, 0.8, 0.45, 0.15],  // subtropical: cresce na primavera/verão e quase para no frio
  leafDrop: 0.15,          // perene, mas renova mais folhas no frio que o ficus
  backBudding: 0.25,       // brota com facilidade depois da poda
  seeds: false,            // quase não forma sementes viáveis: o jogo só oferece muda (estaca enraizada)
  firstInternode: 25,      // mm: a estaca começa com entrenós curtos
  firstCutNote: 'Sentiu o cheiro? Cortada, a serissa solta um odor desagradável: é daí que vem o nome foetida.',
  apical: {
    reach: 80,              // até quantos mm abaixo do corte/dobra as gemas sentem a liberação
    decay: 30,              // a chance cai com a distância (mm); perto do corte brota mais
    prune: 1,               // gemas acordadas por nó logo abaixo do corte (vai caindo com a distância)
    pinch: 0.02,            // ... num beliscão: o Y assume logo; embaixo quase nada acorda
    hardCut: 12,            // ramos removidos para o corte contar como poda forte
    reinhibit: 0.85,        // quando o Y abre, chance de cada gema acordada perto dele voltar a dormir
    bend: 0.35,             // ... e ao deitar o galho com arame: acorda bem menos que a poda (proporcional a quanto deitou)
    bendFrom: 70,
    bendFull: 30,
    oldWood: 0.3,           // brota bem em madeira velha (melhor que o ficus): aceita podas drásticas
    matureDays: 60,
    oldDays: 540,
    budAbort: 0.03,
  },
  // Arbusto: entrenós curtos e crescimento moderado. Estaca de 1 ano: ~20 cm e ~5 mm de base.
  shootGrowth: 1.5,        // velocidade de alongamento e de brotação das pontas (o ficus é 2)
  seedling: { start: 0.6, days: 120 },
  thickening: {
    perLeaf: 0.0075,       // engrossa devagar: estaca de 1 ano ~5 mm; livre num vaso de 5 L, ~1 cm no 2º ano e ~2 cm no 3º
    girthOffset: 10,
    shadeAt: 150,          // copa densa de folhas miúdas: se sombreia cedo
    collar: 0.8,           // base larga e raízes aparentes (bom nebari)
    swellFrom: 1.5,
    swell: 0.5,
    heal: 1.8,             // madeira dura: o calo fecha mais devagar
    woundFrom: 2.5,
    green: 0.3,            // ramo verde (antes de lignificar) engrossa só 30% do ritmo da madeira
  },
  lateralChance: 0.4,      // arbusto: a ponta do tronco solta ramos com frequência
  // fase juvenil curta: a estaca ramifica cedo, logo acima de ~12 cm
  branching: {
    height: [120, 200],     // altura do tronco (mm) em que a ramificação começa e chega ao normal
    matureAge: 365,
    secondary: [180, 400],  // galhos ramificam sozinhos já no 1º ano: copa densa
    leaderBoost: 3.5,       // a estaca sobe rápido até ramificar (~20 cm no 1º ano)
    axillary: 0.035,
    axillaryAge: 200,
    internode: 0.7,
  },
  apicalDominance: 0.06,   // ramo adulto quase só alonga; a densidade vem da ramificação cedo e da poda
  minInternode: 6,         // entrenós curtos (mm)
  maxInternode: 18,
  pruneVigor: 1.3,
  fork: {
    chance: 0.95,           // encurtar um ramo quase sempre solta dois brotos (folhas opostas: duas gemas no nó)
    oldWood: 0.8,
    days: [10, 20],
    tilt: [0.4, 0.7],       // Y um pouco mais aberto que o do ficus
  },
  pruneShock: 0.8,
  pruneRecovery: 0.01,
  gravitropism: {
    shoot: 0.12,
    downBoost: 0.2,
    jointMax: 20,
    bendRate: 2.5,
    setpointTrunk: 12,
    setpointBranch: 65,     // galhos mais abertos, porte de arbusto
  },
  wiring: {
    greenLimit: 80,         // ramos jovens aceitam arame
    woodyLimit: 50,         // madeira dura e quebradiça: dobra bem menos que a do ficus
    lignifyDays: 90,        // lignifica rápido: arame cedo
    winterFactor: 0.8,
    setGreen: 50,
    setWoody: 75,           // engrossa devagar, então demora mais para fixar
    setThick: 20,
    springBack: 0.75,
    bite: 0.25,             // como engrossa devagar, o arame demora a marcar a casca
    breakSlope: 3,          // passou do limite, quebra com facilidade
    crackShock: 0.06,
  },
  leafLifespan: 400,       // folhas duram ~1 ano
  frostHardy: false,
  bark: [178, 168, 150],   // casca clara, cinza-bege
  shoot: [128, 124, 82],
  leaf: { young: [140, 186, 96], mature: [38, 88, 46], autumn: [[214, 196, 92], [200, 176, 70]],
    stress: [210, 192, 90],
    // comprimento típico (mm) em meia-sombra: 6 a 20 mm; ao sol e num bonsai formado, ~8 a 12 mm
    length: 15,
    shape: { width: 0.32, tip: 0.88 },   // oval, quase sem ponta
    arrangement: 'opposite',             // folhas opostas, duas por nó
  },
  // flores brancas em estrela (~1 cm) da primavera ao fim do verão, nas pontas dos ramos
  flowers: {
    season: [0.12, 0.6],    // fração do ano (0 = início da primavera)
    density: 0.55,          // fração das pontas com flor no auge
    size: 5.5,              // raio (mm): flor de ~1 cm
    minAge: 120,            // planta precisa de alguns meses para florir
  },
  light: {
    growthMin: 0.3,
    stretch: 0.9,           // na sombra estica bastante e perde a forma
    dropOnDarker: 0.8,      // muito sensível a ir para um lugar mais escuro
    scorchShock: 0.08,      // sol forte de repente queima as folhas miúdas
    moveDrop: 0.15,         // e qualquer mudança de lugar derruba algumas folhas
  },
  defoliation: {
    regrowDays: 21,
    sizeBoost: 0.25,
    boostDays: 75,
    budChance: 0.35,
    shockFull: 0.4,         // desfolha total é arriscada na serissa
    shockPartial: 0.15,
  },
  water: {
    use: 0.9,
    evaporation: 0.015,
    perLeaf: 0.00009,
    ideal: [0.35, 0.75],    // terra uniformemente úmida, nunca encharcada nem seca
  },
  health: {
    wilt: 0.1,              // murcha antes que o ficus
    dry: 0.05,
    rot: 0.006,             // apodrece as raízes com o dobro da facilidade do ficus
    recover: 0.01,
    leafFrom: 0.75,         // estressada, já começa a soltar folhas
  },
  germination: {
    days: 25,
    minWater: 0.3,
    minWarmth: 0.4,
  },
  roots: {
    growth: 0.006,
    base: 0.08,
    balance: 0.0025,
    minMass: 0.02,
    dieBack: 0.008,
    foliageMemory: 30,
    boundAt: 0.8,
    boundGrowth: 0.3,
    boundThirst: 2.5,
    handlingShock: 0.12,    // sente mais o transplante
    pruneShock: 0.6,
    pruneKeep: 0.5,
  },
  ambientHumidity: [0.55, 0.65, 0.5, 0.35],
  // sem raízes aéreas
  traits: [
    'Arbusto perene pequeno, de folhas miúdas (6 a 20 mm), ovais, verde-escuras e opostas',
    'Flores brancas em forma de estrela, da primavera ao fim do verão: daí o apelido "árvore das mil estrelas"',
    'Casca clara, cinza-bege, que fica áspera e fissurada com a idade',
    'Cortada, a madeira e as folhas soltam um cheiro desagradável (foetida = fétida)',
    'Ramifica fácil e denso: entrenós curtos, copa fechada; brota bem em madeira velha',
    'Encurtar um ramo quase sempre solta dois brotos (as folhas são opostas: duas gemas por nó)',
    'O tronco engrossa devagar: uma estaca de 1 ano tem ~5 mm de base',
    'Muito sensível a mudanças: derruba folhas quando muda de lugar, de luz, de rega ou de temperatura',
    'Gosta de terra uniformemente úmida; apodrece as raízes com facilidade se ficar encharcada',
    'Gosta de muita luz, mas o sol forte de repente queima as folhas',
    'Madeira dura e quebradiça: aramar só ramos jovens, com cuidado; galhos grossos quebram',
    'Quase não forma sementes viáveis: propaga-se por estaca',
    'Não forma raízes aéreas',
    'Não tolera geada: no inverno, fica protegida acima de ~5 °C',
  ],
};
