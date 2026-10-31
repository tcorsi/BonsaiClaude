// Ficus microcarpa (ficus de folha miúda): características botânicas que guiam a simulação.
// Calibrado com um ficus real de semente: ~10 mm de base aos 10 meses, com bons cuidados.
export default {
  id: 'ficus-microcarpa',
  scientific: 'Ficus microcarpa',
  common: 'Ficus de folha miúda',
  name: { short: 'ficus', article: 'o' },   // como o jogo se refere à planta nos avisos ("o ficus está murchando")
  family: 'Moraceae',
  origin: 'Sul e Sudeste da Ásia até a Austrália',
  growthBySeason: [1, 0.85, 0.4, 0.12],  // tropical: cresce no calor e quase para no frio
  leafDrop: 0.08,          // perene: só ~8% das folhas se renovam no frio (1 = caducifólia)
  backBudding: 0.2,        // chance diária de cada gema acordada brotar (× RATE: ~2 semanas no verão)
  // dominância apical: a ponta produz auxina, que desce pelo galho e mantém as gemas de baixo dormentes.
  // Tirar a ponta (poda) ou deitar o galho (arame na horizontal/para baixo) libera essas gemas.
  apical: {
    reach: 100,             // até quantos mm abaixo do corte/dobra as gemas sentem a liberação
    decay: 40,              // a chance cai com a distância (mm); perto do corte brota mais
    prune: 1,               // gemas acordadas por nó logo abaixo do corte (vai caindo com a distância)
    pinch: 0.01,            // ... num beliscão (só a ponta nova sai): o Y assume logo; embaixo quase nada acorda
    hardCut: 15,            // ramos removidos para o corte contar como poda forte (efeito total)
    reinhibit: 0.9,         // quando o Y abre, chance de cada gema acordada perto dele voltar a dormir
    bend: 0.35,             // ... e ao deitar o galho com arame: acorda bem menos que a poda (proporcional a quanto deitou)
    bendFrom: 70,           // a partir de quantos graus da vertical o galho "deitado" perde a dominância
    bendFull: 30,           // graus além disso para o efeito máximo (≈ 100°: horizontal ou um pouco abaixo)
    // madeira velha: casca grossa, gemas dormentes mais fundas e mais raras. O ficus ainda brota nela
    // (por isso aguenta podas drásticas), mas bem menos e mais devagar que num ramo novo
    oldWood: 0.15,          // fator de brotação na madeira mais velha (espécies que não brotam: ~0)
    matureDays: 60,         // até essa idade (ramo verde/novo) brota com facilidade total
    oldDays: 540,           // a partir dessa idade (~1,5 ano) vale o fator oldWood
    budAbort: 0.03,         // por dia: gema em madeira velha que não brotou pode voltar a dormir
  },
  // Calibrado com um ficus real de semente: ~10 mm de base aos 10 meses, com bons cuidados.
  shootGrowth: 2,          // velocidade de alongamento e de brotação das pontas
  seedling: { start: 0.6, days: 120 },    // plântula começa a 60% da velocidade e chega a 100% em ~4 meses
  // crescimento secundário pelo modelo de tubos: a madeira nova de cada segmento é proporcional
  // à área foliar que ele sustenta acima (os açúcares das folhas descem pelo floema e viram anel);
  // por isso um galho de sacrifício cheio de folhas engrossa tudo o que está abaixo dele
  thickening: {
    perLeaf: 0.0103,       // anel por unidade de área foliar acima (× RATE ÷ (espessura + girthOffset), por dia)
    girthOffset: 10,       // somado à espessura no divisor: muda fina não engrossa desproporcionalmente
    shadeAt: 350,          // área foliar a partir da qual a copa se sombreia: acima disso rende ~ raiz quadrada
    collar: 0.6,           // o colo do tronco engrossa a mais (também pelo sistema de raízes)
    swellFrom: 1.5,        // lateral com 1,5× a folhagem da continuação começa a inchar a junção
    swell: 0.5,            // quanto a junção incha (conicidade invertida, típica do sacrifício esquecido)
    heal: 2.5,             // o calo fecha a ferida ~2,5× mais rápido que o anel normal da madeira
    woundFrom: 2.5,        // galhos removidos a partir desta espessura (~2,4 mm) deixam cicatriz visível
    green: 0.3,            // ramo verde (antes de lignificar) engrossa só 30% do ritmo da madeira
  },
  lateralChance: 0.25,     // chance da ponta do tronco adulto soltar um ramo a cada novo nó (fora a onda axilar)
  // fase juvenil: a muda sobe numa haste única até ~40 cm e só então o tronco solta ramos (primários);
  // os ramos só começam a ramificar sozinhos a partir de ~1 ano. Podar bifurca em qualquer fase.
  branching: {
    height: [350, 450],     // altura do tronco (mm) em que a ramificação começa e chega ao normal
    matureAge: 730,         // depois dessa idade (dias) a planta é adulta mesmo sem ter passado da altura
    secondary: [365, 730],  // idade da planta em que galhos começam a soltar galhos sozinhos e chegam ao normal
    leaderBoost: 2.5,       // na fase juvenil a ponta cresce (1 + leaderBoost)× mais rápido
    axillary: 0.03,         // muda madura: chance diária (× RATE) de cada nó do tronco soltar um ramo da gema axilar
    axillaryAge: 200,       // ... só enquanto o nó é jovem (dias): a onda de primários é curta
    internode: 0.55,        // ... com entrenós mais curtos (folhas próximas)
  },
  apicalDominance: 0.06,   // ramo adulto: o broto do ano quase só alonga; lateral sem poda é rara
  minInternode: 14,        // comprimento mínimo de um novo entrenó (mm): a ponta sempre consegue avançar
  maxInternode: 40,        // quanto um entrenó pode se alongar quando a árvore já está muito ramificada
  pruneVigor: 1.4,         // brotos após poda nascem mais vigorosos (entrenós mais longos)
  // bifurcação: encurtar um ramo faz as duas últimas gemas abrirem juntas, em Y (no ficus é quase certo)
  fork: {
    chance: 0.95,           // chance de bifurcar num ramo novo (no ficus é quase certo)
    oldWood: 0.75,          // ... multiplicada por isso na madeira mais velha (ainda bifurca na maioria das vezes)
    days: [8, 18],          // dias de crescimento até as duas gemas abrirem (~2 semanas no verão)
    tilt: [0.35, 0.6],      // abertura de cada braço do Y em relação ao ramo (rad, ~20–35°)
  },
  pruneShock: 0.8,         // queda de vigor ao remover 100% da folhagem (proporcional ao que foi cortado)
  pruneRecovery: 0.012,    // recuperação diária do choque de poda (poda de 40% no verão: ~3 semanas)
  // gravitropismo: ramos jovens e brotos novos procuram o alto; madeira e trechos aramados ficam como estão
  gravitropism: {
    shoot: 0.15,            // inclinação para cima de cada broto/entrenó novo (somada a cada nó, faz a curva)
    downBoost: 0.2,         // reforço quando o ramo de onde ele sai aponta para baixo
    jointMax: 20,           // graus que cada junção pode se curvar além do ângulo com que nasceu:
                            // a subida se espalha pelos entrenós numa curva suave, em vez de um V na base
    bendRate: 3,            // graus por dia que um ramo verde se curva para cima (cai a 0 ao lignificar)
    // ângulo de equilíbrio (graus a partir da vertical): o tronco busca o alto; um galho lateral
    // só sobe quando está mais caído que isso (por exemplo, apontando para baixo)
    setpointTrunk: 10,
    setpointBranch: 60,
  },
  wiring: {
    greenLimit: 90,         // graus que um ramo verde aguenta dobrar
    woodyLimit: 70,         // referência da madeira: o limite cai com a espessura (70° / (1 + ⌀mm/4))
    lignifyDays: 120,       // dias até o ramo verde virar madeira
    winterFactor: 0.8,      // no frio a madeira fica mais quebradiça
    // dias de crescimento ativo (primavera/verão) para o galho fixar a nova forma.
    // O ficus fixa rápido: na prática o arame sai com 6 a 8 semanas, antes de marcar a casca
    setGreen: 45,           // ramo verde
    setWoody: 60,           // ramo lignificado típico
    setThick: 15,           // dias a mais para os galhos mais grossos (⌀ 20 mm ou mais)
    springBack: 0.7,        // tirando o arame antes de fixar, o galho volta essa fração do que faltava
    bite: 0.15,             // o arame marca a casca quando o galho engrossa 15% (mín. ~0,6 mm)
    breakSlope: 2,          // risco de quebra = (curvatura / limite − 1) × breakSlope
    crackShock: 0.05,       // choque de uma rachadura na curva
  },
  leafLifespan: 730,       // dias que uma folha vive no ramo (~2 anos)
  frostHardy: false,
  bark: [132, 122, 110],
  shoot: [118, 132, 74],
  leaf: { young: [150, 196, 92], mature: [44, 102, 48], autumn: [[212, 186, 72], [196, 160, 60]],
    stress: [206, 184, 78],
    // comprimento típico (mm) em meia-sombra; o tamanho real de cada folha depende de luz, vigor,
    // ramificação e desfolha (leafSizeFor). Folha do F. microcarpa: 4 a 10 cm na natureza, 1,5 a 3 cm num bonsai bem formado
    length: 55,
    // formato: elíptica com ponta (acuminada); width = meia-largura máxima e tip = onde começa a ponta (fração do comprimento)
    shape: { width: 0.27, tip: 0.8 },
    // disposição: 'alternate' = uma folha por nó em espiral; 'opposite' = duas por nó, frente a frente
    arrangement: 'alternate',
  },
  light: {
    growthMin: 0.35,        // fração do crescimento que sobra com pouquíssima luz (fotossíntese)
    stretch: 0.8,           // na sombra os entrenós alongam até +80% (estiolamento)
    dropOnDarker: 0.6,      // ao ir para um lugar bem mais escuro, derruba parte das folhas (aclimatação)
    scorchShock: 0.06,      // ir de dentro de casa direto para o sol pleno queima folhas
  },
  defoliation: {
    regrowDays: 18,         // dias até as folhas novas abrirem (no calor; no frio leva 2,5× mais)
    sizeBoost: 0.35,        // folhas que brotam depois da desfolha ficam até 35% menores
    boostDays: 75,          // ... efeito que vai sumindo em ~2,5 meses
    budChance: 0.35,        // chance de cada nó soltar uma gema nova (mais ramificação)
    shockFull: 0.3,         // choque da desfolha total
    shockPartial: 0.12,     // ... e da parcial (só as folhas grandes)
  },
  water: {
    use: 1,                 // sede relativa da espécie
    evaporation: 0.015,     // perda diária pela terra do vaso, sem contar a planta
    perLeaf: 0.00009,       // transpiração diária por unidade de área foliar (copa adulta no verão seca o vaso em ~3-4 dias)
    ideal: [0.3, 0.8],      // gosta de terra úmida, mas não encharcada
  },
  // saúde: cai com a terra seca (e devagar com encharcamento constante); em zero a planta morre.
  // O ficus aguenta alguns dias seco, solta as folhas para economizar água e rebrota se for regado a tempo.
  health: {
    wilt: 0.08,             // terra abaixo disso: murcha, para de crescer e perde saúde
    dry: 0.045,             // perda diária de saúde na terra seca (× calor: ~4 semanas sem rega no verão, ~2 meses no inverno)
    rot: 0.003,             // perda diária com a terra encharcada (raízes apodrecem em alguns meses)
    recover: 0.012,         // recuperação diária com água boa (× estação de crescimento)
    leafFrom: 0.7,          // abaixo dessa saúde as folhas vão caindo (todas caem em zero)
  },
  germination: {
    days: 12,               // dias de calor e terra úmida até a semente brotar
    minWater: 0.3,
    minWarmth: 0.4,         // fator de crescimento mínimo da estação (primavera/verão)
  },
  roots: {
    growth: 0.008,          // litros de raiz por dia (× estação × vigor × tamanho da copa)
    base: 0.08,             // mínimo que cresce sem folhagem (plântula vivendo das reservas da semente)
    // equilíbrio raiz/copa: as folhas produzem o açúcar que alimenta as raízes; a copa sustenta no
    // máximo `balance` litros de raiz por unidade de área foliar (medido: 0,4 a 1,8 mL numa árvore saudável)
    balance: 0.0025,
    minMass: 0.02,          // raiz mínima que qualquer planta sustenta (L)
    dieBack: 0.008,         // fração do excesso de raiz que morre por dia quando a copa não sustenta mais
    foliageMemory: 30,      // dias: a raiz "sente" a média da folhagem (uma desfolha curta não mata raízes)
    boundAt: 0.8,           // a partir de 80% do vaso ocupado o crescimento começa a cair
    boundGrowth: 0.3,       // crescimento com o vaso totalmente tomado por raízes
    boundThirst: 2.5,       // vaso enraizado seca mais rápido (até +50% de consumo)
    handlingShock: 0.08,    // choque de qualquer transplante
    pruneShock: 0.5,        // choque extra proporcional às raízes cortadas
    pruneKeep: 0.5,         // ao reduzir de vaso, as raízes são podadas para ocupar metade do novo
  },
  ambientHumidity: [0.55, 0.65, 0.5, 0.35],   // umidade do ar por estação (inverno em ambiente interno é seco)
  aerialRoots: {
    minHumidity: 0.7,       // só forma raízes aéreas com ar úmido
    chance: 0.02,           // chance por galho grosso (× RATE por dia; cresce com a umidade)
    growth: 2,              // quanto a raiz desce (× RATE por dia: ~0,7 por dia)
    maxPerBranch: 3,
    maxHang: 90,            // comprimento máximo pendurada fora do vaso
    thickening: 0.02,       // quanto engrossa depois de chegar ao solo (× RATE por dia)
  },
  traits: [
    'Folhas perenes, elípticas, verde-escuras e brilhantes',
    'Casca lisa e cinza-clara',
    'Brota com facilidade em madeira velha: tolera podas drásticas',
    'Dominância apical: tirar a ponta ou deitar o galho com arame acorda gemas ao longo do galho e gera ramificação',
    'Cresce rápido: com bons cuidados, a muda de semente chega a ~1 cm de base em 10 meses e, sem poda, engrossa ~1 cm por ano. Quanto mais folhagem, mais rápido; deixar galhos crescerem livres ("galhos de sacrifício") engrossa o tronco, podar muito desacelera',
    'Forma raízes aéreas quando o ar está úmido (acima de ~70%); ao tocar o solo, elas engrossam e viram pilares',
    'Gosta de terra sempre levemente úmida; sofre com secas e com encharcamento',
    'Quanto maior a copa, mais água transpira: árvores cheias secam o vaso bem mais rápido',
    'Podas pesadas cortam folhagem e freiam o crescimento por algumas semanas',
    'Desenvolve-se mais com mais substrato: vasos de cultivo grandes ou plantado no solo engrossam o tronco; o vaso raso de bonsai segura o crescimento',
    'Quando as raízes tomam o vaso, o crescimento para: transplante na primavera ou no verão, com poda de raízes se for para um vaso menor',
    'Sementes minúsculas germinam em 1 a 3 semanas com calor, luz e terra úmida',
    'Cresce mais no calor e desacelera abaixo de ~15 °C',
    'Ramos jovens são flexíveis e aceitam arame com facilidade; madeira grossa quebra se dobrada demais',
    'Como engrossa rápido, o arame marca a casca em poucas semanas: verifique e remova a tempo',
    'Pontas e ramos verdes se voltam para cima (gravitropismo): o tronco busca a vertical e os galhos laterais voltam ao seu ângulo natural; um galho aramado para baixo solta brotos que sobem. Só a madeira lignificada mantém a forma sozinha',
    'Gosta de muita luz: no sol as folhas ficam menores e os entrenós curtos; na sombra a planta estica e as folhas crescem',
    'Mudar para um lugar mais escuro faz o ficus derrubar folhas até se aclimatar',
    'Desfolha no início do verão, numa árvore vigorosa, gera folhas menores e mais ramificação',
    'Não tolera geada: no inverno fica em ambiente protegido',
  ],
};
