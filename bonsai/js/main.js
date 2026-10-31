import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { YEAR, SEASON_LEN, RATE, SEASONS, MAX_DEPTH, MAX_NODES, MAX_LEAVES, MAX_ROOTS, SAVE_KEY, HINT, rand, lerp, clamp, frac, hash, mixColor, rgb, norm, cross, dot } from './util.js';
import { SPECIES, DEFAULT_SPECIES } from './species/index.js';
import { CONTAINERS, CONTAINER_ORDER } from './containers.js';
import { setupRender, QUALITY, QUALITY_ORDER } from './render.js';

let SP = SPECIES[DEFAULT_SPECIES];
// nome da planta nos avisos: theSp() = "o ficus", TheSp() = "O ficus"
const theSp = () => `${SP.name.article} ${SP.name.short}`;
const TheSp = () => theSp()[0].toUpperCase() + theSp().slice(1);

// ---------- Estações ----------
const dayOfYear = d => ((d % YEAR) + YEAR) % YEAR;
const seasonOf = d => Math.floor(dayOfYear(d) / SEASON_LEN);
const growthFactor = d => SP.growthBySeason[seasonOf(d)];   // quanto a árvore cresce em cada época
const yearFrac = d => dayOfYear(d) / YEAR;   // 0 = início da primavera, 1 = fim do inverno
function leafFall(d) {          // 0 = copa cheia, 1 = todas as folhas que caem já caíram
  const f = yearFrac(d);
  if (f < 0.1) return 1 - f / 0.1;              // brotação no começo da primavera
  if (f < 0.54) return 0;
  if (f < 0.73) return (f - 0.54) / 0.19;       // queda ao longo do outono
  return 1;
}
// árvore com pouco vigor (seca ou encharcada) perde parte das folhas
const leafAmount = d => (1 - SP.leafDrop * leafFall(d)) * (0.45 + 0.55 * clamp(state.vigor / 0.7, 0, 1))
  * (1 - state.leafLoss)    // folhas caídas ao mudar para um lugar mais escuro
  * clamp((state.health ?? 1) / SP.health.leafFrom, 0, 1);   // seca: a planta solta as folhas para não perder água
const autumnTint = d => clamp((yearFrac(d) - 0.46) / 0.21, 0, 1);
const springFresh = d => clamp(1 - yearFrac(d) / 0.29, 0, 1);

// ---------- Árvore ----------
// Cada galho é um nó com uma direção 3D; os filhos nascem na ponta do pai.
function newNode(depth, dir, target) {
  return { len: 0, target, dir, depth, girth: 0, buds: 0, age: 0, seed: Math.random(), phi: rand(0, Math.PI * 2),
    stopped: false, kids: [], aerial: [] };
}

let state, nodeCount = 0;

// vigor: saúde ligada à água (afeta as folhas) · recovery: choque de poda (1 = recuperada; só freia o crescimento)
// container/rootMass: vaso atual e litros de raiz (saves antigos estavam no vaso de bonsai)
const CARE_DEFAULTS = { water: 0.7, humidity: 0.6, vigor: 1, recovery: 1, waterUse: 0, autoWater: false, flags: {},
  container: 'bonsai', rootMass: 0.6,
  spot: 'sun', leafLoss: 0, defolBoost: 0,     // lugar (luz), folhas caídas por aclimatação, efeito da desfolha
  foliageAvg: null,                            // média recente da folhagem (equilíbrio raiz/copa)
  trunkMax: 0,                                 // maior altura que o tronco já atingiu (fim da fase juvenil)
  health: 1, dead: false, deathCause: null,
  front: 0 };                                  // lado escolhido como frente do bonsai (ângulo em volta do vaso)  // saúde (seca/encharcamento); morta não cresce mais

// ---------- Luz ----------
const SPOTS = {
  sun:     { name: 'Sol pleno', where: 'ao ar livre', light: 1.0, outdoor: true },
  partial: { name: 'Meia-sombra', where: 'ao ar livre', light: 0.7, outdoor: true },
  window:  { name: 'Janela bem iluminada', where: 'dentro de casa', light: 0.45, outdoor: false },
  indoor:  { name: 'Longe da janela', where: 'dentro de casa', light: 0.2, outdoor: false },
};
const SPOT_ORDER = ['sun', 'partial', 'window', 'indoor'];
const spot = () => SPOTS[state.spot] ?? SPOTS.sun;
// luz efetiva: ao ar livre varia com a estação (dias curtos e sol baixo no inverno)
const lightNow = () => clamp(spot().light * (spot().outdoor ? [1, 1.05, 0.85, 0.6][seasonOf(state.day)] : 1), 0, 1);
const lightGrowth = () => SP.light.growthMin + (1 - SP.light.growthMin) * lightNow();

// tamanho (mm) da folha que abre agora neste nó: sol e galhos finos dão folhas pequenas;
// sombra, vigor e muito substrato dão folhas grandes; depois de uma desfolha as folhas novas vêm menores
function leafSizeFor(n) {
  const light = 1.6 - 0.85 * lightNow();
  const vigor = 0.7 + 0.3 * potFactor();
  const twig = clamp(1.15 - 0.05 * n.depth, 0.65, 1.1);
  const defol = 1 - SP.defoliation.sizeBoost * state.defolBoost;
  return SP.leaf.length * light * vigor * twig * defol * rand(0.9, 1.1);
}

function setSpot(id) {
  if (!SPOTS[id] || id === state.spot) return;
  pushUndo();
  const dl = SPOTS[id].light - spot().light;
  state.spot = id;
  let msg = `Planta movida para: ${SPOTS[id].name} (${SPOTS[id].where}).`;
  if (dl <= -0.25) {
    state.leafLoss = Math.min(0.6, state.leafLoss + SP.light.dropOnDarker * -dl);
    msg += ` Com menos luz ${theSp()} vai derrubar parte das folhas até se aclimatar.`;
  } else if (dl >= 0.5) {
    state.recovery = Math.max(0.15, state.recovery - SP.light.scorchShock);
    msg += ' Mudança brusca para o sol: algumas folhas queimam. O ideal é aclimatar aos poucos.';
  }
  // algumas espécies (como a serissa) derrubam folhas com qualquer mudança, até para um lugar melhor
  if (SP.light.moveDrop) {
    state.leafLoss = Math.min(0.6, state.leafLoss + SP.light.moveDrop);
    msg += ` ${TheSp()} estranha qualquer mudança de lugar e vai soltar algumas folhas.`;
  }
  rebuild(); updateCare(); save();
  toast(msg);
}
const vigorNow = () => state.vigor * (0.4 + 0.6 * state.recovery);

// origin: 'muda' (planta de 1 ano) ou 'seed' (semente na terra, ainda por germinar)
function newTree(origin = 'muda', species = state?.species ?? DEFAULT_SPECIES) {
  const keepAuto = state?.autoWater ?? false;   // a rega automática é escolha do jogador: vale para a planta nova
  SP = SPECIES[species] ?? SPECIES[DEFAULT_SPECIES];
  applySpecies();
  state = { day: 0, cuts: 0, species: SP.id, origin, germ: origin === 'seed' ? SP.germination.days : 0,
    ...structuredClone(CARE_DEFAULTS), root: newNode(0, norm([rand(-0.08, 0.08), 1, rand(-0.08, 0.08)]), SP.firstInternode ?? 55) };
  // a semente vai para um copinho; a muda chega num vaso de cultivo de 1 L com raízes pela metade
  state.container = origin === 'seed' ? 'cup' : 'pot1';
  state.autoWater = keepAuto;
  state.name = defaultName(origin);
  state.rootMass = origin === 'seed' ? 0.005 : 0.5;
  if (origin === 'muda') for (let i = 0; i < YEAR; i++) stepDay(true);   // muda de 1 ano, bem cuidada
  calcWidth(state.root);
}

// ---------- Raízes no vaso ----------
const container = () => CONTAINERS[state.container] ?? CONTAINERS.bonsai;
const rootFill = () => state.rootMass / container().volume;   // 0 = vaso vazio, 1 = tomado por raízes (no solo: 0)
// quanto o vaso deixa a árvore crescer: depende do substrato e de as raízes ainda terem espaço
function potFactor() {
  const r = SP.roots, fill = rootFill();
  const bound = fill > r.boundAt ? lerp(1, r.boundGrowth, clamp((fill - r.boundAt) / (1 - r.boundAt), 0, 1)) : 1;
  return container().growth * bound;
}
// quanto de raiz a copa atual consegue sustentar (L)
const rootTarget = () => SP.roots.minMass + (state.foliageAvg ?? foliageNow()) * SP.roots.balance;

function growRootMass() {
  const r = SP.roots, foliage = foliageNow();
  state.foliageAvg = state.foliageAvg == null ? foliage : lerp(state.foliageAvg, foliage, 1 / r.foliageMemory);
  const g = growthFactor(state.day) * vigorNow();
  // as raízes crescem com o que as folhas produzem agora, e só enquanto a copa ainda sustenta mais raiz
  const target = rootTarget();
  const room = clamp((1 - state.rootMass / target) / 0.3, 0, 1);
  const grow = r.growth * g * (r.base + Math.sqrt(foliage) / 30) * room;
  state.rootMass = Math.min(state.rootMass + grow, container().volume);   // no solo não há limite
  // copa pequena demais para tanta raiz (poda drástica, desfolha longa): as raízes finas morrem aos poucos
  if (state.rootMass > target) state.rootMass -= (state.rootMass - target) * r.dieBack;
  const fill = rootFill();
  if (fill > 0.92) notify('rootbound', 'As raízes tomaram o vaso e o crescimento parou. Transplante para um vaso maior ou use ✂️ Raízes para podar e continuar no mesmo vaso.');
  else if (fill < 0.7) state.flags.rootbound = false;
}

// choque de mexer nas raízes: manuseio + proporção cortada; pior no inverno e numa árvore ainda se recuperando
function rootShock(removed) {
  const r = SP.roots;
  let shock = r.handlingShock + removed * r.pruneShock;
  const winter = seasonOf(state.day) === 3, tired = state.recovery < 0.7;
  if (winter) shock *= 2;
  if (tired) shock *= 1.5;
  state.recovery = Math.max(0.15, state.recovery - shock);
  state.water = Math.max(state.water, 0.8);   // substrato novo, bem regado
  state.flags.rootbound = false;
  return (winter ? ' No inverno a recuperação é mais lenta; o ideal é primavera ou verão.' : '')
    + (tired ? ' A árvore ainda se recuperava de outro corte: o choque foi maior.' : '');
}

function transplant(id) {
  if (!CONTAINERS[id] || id === state.container) return;
  pushUndo();
  const to = CONTAINERS[id];
  let removed = 0;
  // vaso menor que as raízes atuais: poda de raízes para caber
  if (state.rootMass > to.volume * 0.85) {
    const keep = to.volume * SP.roots.pruneKeep;
    removed = 1 - keep / state.rootMass;
    state.rootMass = keep;
  }
  const note = rootShock(removed);
  state.container = id;
  applyContainer();
  rebuild(); updateHud(); updateCare(); save();
  toast(`Transplantada para: ${to.name}.` + (removed > 0.02 ? ` Poda de raízes: ${Math.round(removed * 100)}% cortadas.` : '') + note);
}

// poda de raízes sem trocar de vaso: libera espaço para a árvore continuar crescendo (e engrossando) no mesmo vaso
const ROOT_PRUNES = [
  { id: 'light', name: 'Leve', frac: 0.25, desc: 'apara as raízes que circulam o vaso' },
  { id: 'medium', name: 'Média', frac: 0.4, desc: 'manutenção típica de bonsai a cada 1–2 anos' },
  { id: 'heavy', name: 'Forte', frac: 0.6, desc: 'reduz bem o torrão, para ir a um vaso menor depois' },
];
// Desfolha: tira as folhas (todas, ou só as maiores). As novas abrem em ~2-3 semanas, menores,
// e alguns nós soltam gemas (mais ramificação). Melhor no início do verão, numa árvore vigorosa.
const DEFOL_MODES = [
  { id: 'partial', name: 'Parcial', desc: 'tira só a metade maior das folhas; choque leve' },
  { id: 'full', name: 'Total', desc: 'tira todas as folhas; folhas novas bem menores e mais brotos, choque forte' },
];
function defoliate(mode) {
  const amt = leafAmount(state.day);
  const vis = leaves.filter(l => leafVisible(l, amt));
  if (!vis.length) return;
  pushUndo();
  const targets = mode === 'full' ? vis : [...vis].sort((a, c) => c.len - a.len).slice(0, Math.ceil(vis.length / 2));
  const d = SP.defoliation, s = seasonOf(state.day), warm = s === 0 || s === 1;
  const weak = state.vigor < 0.7 || state.recovery < 0.7;
  state.defolBoost = mode === 'full' ? 1 : 0.6;
  const delay = d.regrowDays * (warm ? 1 : 2.5);
  for (const l of targets) spawnLeaf(l.pos, leafColor(l.n, l.k, state.day), l.len);
  for (const n of new Set(targets.map(l => l.n))) {
    n.leafBack = state.day + Math.round(delay * rand(0.8, 1.25));
    n.leafLen = leafSizeFor(n);   // a folha que vai rebrotar já nasce com o tamanho reduzido
    if (n.depth >= 1 && Math.random() < d.budChance * (warm ? 1 : 0.4) * (mode === 'full' ? 1 : 0.5)) n.buds = Math.min(4, n.buds + 1);
  }
  const shock = (mode === 'full' ? d.shockFull : d.shockPartial) * (warm ? 1 : 2) * (weak ? 1.5 : 1);
  state.recovery = Math.max(0.15, state.recovery - shock);
  rebuild(); updateCare(); save();
  toast(`Desfolha ${mode === 'full' ? 'total' : 'parcial'}: ${targets.length} folhas retiradas. As novas abrem em ~${Math.round(delay)} dias, menores.`
    + (warm ? '' : ' Fora da estação quente a rebrota é lenta e o choque maior.')
    + (weak ? ' A árvore estava fraca: o choque foi maior.' : ''));
}

function pruneRoots(frac) {
  pushUndo();
  state.rootMass *= 1 - frac;
  const note = rootShock(frac);
  rebuild(); updateHud(); updateCare(); save();
  toast(`Raízes podadas: ${Math.round(frac * 100)}% cortadas, de volta ao mesmo vaso.` + note);
}

function countNodes(n) { let c = 1; for (const k of n.kids) c += countNodes(k); return c; }

// plantas vindas de semente crescem devagar no primeiro ano
const juvenile = () => state.origin === 'seed' ? clamp(SP.seedling.start + state.day / SP.seedling.days, 0, 1) : 1;
// terra seca para o crescimento (estômatos fechados); saúde baixa também
const waterGrowth = () => clamp((state.water - SP.health.wilt) / (SP.water.ideal[0] - SP.health.wilt), 0, 1) * (state.health ?? 1);
// fase juvenil: 0 = muda de haste única, 1 = adulta (o tronco ramifica). Conta a maior altura já atingida,
// para uma árvore adulta podada baixa não voltar a ser juvenil
function branchJuv() {
  const b = SP.branching;
  if (state.day >= b.matureAge) return 1;
  return clamp(((state.trunkMax ?? 0) - b.height[0]) / (b.height[1] - b.height[0]), 0, 1);
}
// galhos soltando galhos sozinhos (ramificação secundária): só depois de ~1 ano
const secondaryBranching = () => clamp((state.day - SP.branching.secondary[0]) / (SP.branching.secondary[1] - SP.branching.secondary[0]), 0, 1);
// altura do tronco: a linha principal (kids[0]) a partir do colo
function trunkHeight() {
  let h = 0;
  for (let c = state.root; c; c = c.kids[0]) h += c.len * c.dir[1];
  return h;
}

function stepDay(skipCare = false) {
  if (!skipCare) stepCare();
  if (state.germ > 0) { stepGermination(); state.day++; return; }
  if (state.dead) { state.day++; return; }   // morta: o tempo passa, mas nada cresce
  const g = growthFactor(state.day) * vigorNow() * potFactor() * lightGrowth() * waterGrowth();
  nodeCount = countNodes(state.root);
  if (g > 0 && nodeCount > MAX_NODES * 0.85) shedShadedTwigs(skipCare);
  rootCount = 0;
  state.trunkMax = Math.max(state.trunkMax ?? 0, trunkHeight());
  const area = grow(state.root, g, true, leafAmount(state.day));
  // copa densa se sombreia: cada folha a mais rende menos (acima de shadeAt a área efetiva cresce só com a raiz quadrada)
  state.shade = 1 / Math.sqrt(1 + area / SP.thickening.shadeAt);
  state.day++;
}

// copa densa demais: raminhos baixos e sombreados secam e caem (autodesrama),
// abrindo espaço para a árvore continuar crescendo nas pontas
// raminho de no máximo 3 segmentos em linha, sem ramificar
function smallTwig(k) {
  let c = k, len = 1;
  while (c.kids.length === 1 && len <= 3) { c = c.kids[0]; len++; }
  return c.kids.length === 0 && len <= 3;
}
function shedShadedTwigs(quiet) {
  const candidates = [];
  (function walk(n) {
    for (const k of n.kids) {
      // só raminhos pequenos (até 3 segmentos); um galho inteiro não seca de uma vez, e um toco podado
      // esperando brotar (Y ou gemas) não conta como raminho sombreado
      if (k.depth >= 4 && k._e && n.kids.length > 1 && k.kids.length <= 1 && k.fork == null && !k.buds
          && smallTwig(k)) candidates.push({ k, parent: n });
      walk(k);
    }
  })(state.root);
  const count = Math.ceil(nodeCount * 0.005 * RATE);
  for (let i = 0; i < count && candidates.length; i++) {
    // entre alguns sorteados, cai o que está mais baixo (mais à sombra)
    let best = -1;
    for (let s = 0; s < 12; s++) {
      const j = Math.floor(Math.random() * candidates.length);
      if (best < 0 || candidates[j].k._e.y < candidates[best].k._e.y) best = j;
    }
    const { k, parent } = candidates.splice(best, 1)[0];
    const idx = parent.kids.indexOf(k);
    if (idx >= 0) { parent.kids.splice(idx, 1); nodeCount -= countNodes(k); }
  }
  if (!quiet) notify('shade', 'A copa está densa: raminhos de baixo, sem luz, estão secando. Podar abre espaço para a luz.');
}

// a semente só avança com terra úmida e estação quente
function stepGermination() {
  const gm = SP.germination;
  if (state.water < gm.minWater) { notify('seedDry', 'A semente precisa de terra úmida para germinar. Regue o vaso.'); return; }
  if (growthFactor(state.day) < gm.minWarmth) { notify('seedCold', 'Está frio: a semente vai esperar o calor para germinar.'); return; }
  state.germ--;
  if (state.germ <= 0) toast('A semente germinou! Um broto está saindo da terra.');
}

// ---------- Água, umidade e vigor ----------
function stepCare() {
  if (state.dead) return;
  const s = seasonOf(state.day);
  // a planta bebe mais no calor e quanto maior a copa
  // água sai por evaporação da terra e, principalmente, pela transpiração das folhas:
  // mais folhas, mais calor e ar mais seco = mais consumo
  const heat = [0.8, 1.2, 0.7, 0.4][s];
  const leafArea = foliageNow() * (0.4 + 0.6 * lightNow());   // mais sol, mais transpiração
  // aclimatação: folhas voltam aos poucos; o efeito da desfolha no tamanho das folhas vai sumindo
  state.leafLoss = Math.max(0, state.leafLoss - 0.01);
  state.defolBoost = Math.max(0, state.defolBoost - 1 / SP.defoliation.boostDays);
  const evaporation = SP.water.evaporation * heat;
  const transpiration = leafArea * SP.water.perLeaf * heat * (1.3 - state.humidity);
  // vaso maior guarda mais água (referência: vaso de bonsai de 1,2 L); enraizado, sobra pouco substrato
  const c = container();
  const capacity = c.volume === Infinity ? 8 : Math.sqrt(c.volume / 1.2);
  const bound = 1 + Math.max(0, rootFill() - SP.roots.boundAt) * SP.roots.boundThirst;
  state.waterUse = (evaporation + transpiration) * SP.water.use * bound / capacity;
  // no solo a terra puxa umidade de baixo e quase nunca seca de vez
  state.water = clamp(state.water - state.waterUse, c.volume === Infinity ? 0.35 : 0, 1);
  if (state.germ <= 0) growRootMass();
  // a recuperação da poda acontece no ritmo do crescimento (rápida no calor, lenta no inverno)
  state.recovery = Math.min(1, state.recovery + SP.pruneRecovery * (0.2 + growthFactor(state.day)) * state.vigor);
  if (state.autoWater && state.water < SP.water.ideal[0] + 0.05) water(true);
  // o ar volta aos poucos para a umidade do ambiente
  state.humidity = lerp(state.humidity, SP.ambientHumidity[s], 0.15);

  const [lo, hi] = SP.water.ideal, w = state.water;
  const dv = w < 0.08 ? -0.035 : w < lo ? -0.005 : w > 0.95 ? -0.012 : w > hi ? 0.005 : 0.03;
  state.vigor = clamp(state.vigor + dv, 0.15, 1);
  stepHealth(heat, w);

  if (w < 0.12) notify('drought', `A terra está seca. Regue ${theSp()} antes que perca folhas.`);
  if (w > 0.95) notify('soggy', 'Terra encharcada: espere secar um pouco antes de regar de novo.');
}

// saúde: a terra seca mata devagar; regar a tempo recupera (sem folhas, a planta rebrota)
function stepHealth(heat, w) {
  const H = SP.health, before = state.health;
  if (container().volume !== Infinity && w < H.wilt) state.health -= H.dry * heat;
  else if (w > 0.95) state.health -= H.rot;
  else state.health = Math.min(1, state.health + H.recover * (0.3 + growthFactor(state.day)));
  if (state.health <= 0) { die(w < H.wilt ? 'seca' : 'encharcamento'); return; }
  if (state.health < 0.7 && before >= 0.7) notify('wilting', w < H.wilt
    ? `${TheSp()} está murchando de sede e começou a soltar as folhas. Regue logo!`
    : 'As raízes estão sofrendo com a terra encharcada. Deixe secar antes de regar de novo.', true);
  if (state.health < 0.3 && before >= 0.3) notify('dying', 'A planta está morrendo! Sem folhas e com as raízes secando: regue agora para ela ainda rebrotar.', true);
}
function die(cause) {
  state.health = 0; state.dead = true; state.deathCause = cause;
  setSpeed(0);
  showDeath();
  save();
}

function water(auto = false) {
  if (!auto && state.water > 0.75) notify('overwater', 'A terra já estava úmida. Regar demais encharca as raízes.', true);
  state.water = Math.min(1, state.water + 0.55);
  state.humidity = Math.min(1, state.humidity + 0.04);
  state.flags.drought = false;
  spawnWaterDrops();
  updateCare();
}

function mist() {
  state.humidity = Math.min(1, state.humidity + 0.2);
  spawnMist();
  updateCare();
}

// mostra um aviso só uma vez por episódio (reaparece quando a flag é limpa)
function notify(flag, msg, always = false) {
  if (state.flags[flag] && !always) return;
  state.flags[flag] = true;
  toast(msg);
}

// ---------- Raízes aéreas ----------
let rootCount = 0;
const SOIL_TOP = 1;

function growRoots(n, g) {
  const ar = SP.aerialRoots;
  if (!ar || !n._s) return;   // posições só existem depois que a cena foi montada
  for (const r of n.aerial) {
    rootCount++;
    const a = attachPoint(n, r);
    if (r.grounded) {           // virou pilar: engrossa com o tempo
      r.len = a.y - SOIL_TOP;
      r.girth += ar.thickening * g * RATE;
      continue;
    }
    if (g <= 0 || state.humidity < ar.minHumidity) continue;   // ar seco: a raiz para de crescer
    r.len += ar.growth * g * RATE;
    const inPot = (a.x / SOIL_RX) ** 2 + (a.z / SOIL_RZ) ** 2 < 0.9;
    if (inPot && a.y - r.len <= SOIL_TOP) {
      r.len = a.y - SOIL_TOP;
      r.grounded = true;
      notify('grounded', 'Uma raiz aérea alcançou a terra! Agora ela vai engrossar e virar um pilar.');
    } else if (!inPot) {
      r.len = Math.min(r.len, ar.maxHang, a.y - STAND_TOP);
    }
  }
  // novas raízes surgem em galhos grossos quando o ar está úmido
  // (só em galhos inclinados, de onde a raiz pende livre em vez de colar no tronco)
  if (g <= 0 || n.depth > 5 || n.girth < 1.8 || n.dir[1] > 0.93 || n.len < n.target || n.aerial.length >= ar.maxPerBranch) return;
  if (state.humidity < ar.minHumidity || rootCount >= MAX_ROOTS) return;
  const h = 0.3 + 0.7 * (state.humidity - ar.minHumidity) / (1 - ar.minHumidity);
  if (Math.random() > ar.chance * g * h * RATE) return;
  const r = { d: rand(0.2, 0.9) * n.len, ang: rand(0, Math.PI * 2), len: 0.5, girth: 0.35, grounded: false };
  if (attachPoint(n, r).y < 10) return;
  n.aerial.push(r);
  rootCount++;
  notify('firstRoot', `Surgiu uma raiz aérea! ${TheSp()} forma raízes no ar quando a umidade está alta.`);
}

function grow(n, g, onTrunk = true, amt = leafAmount(state.day), parent = null) {
  n.age++;
  if (g > 0) {
    // a muda juvenil concentra a força na ponta do tronco, que sobe mais rápido (só ela: galhos e brotos crescem normal)
    const lead = onTrunk ? 1 + SP.branching.leaderBoost * (1 - branchJuv()) : 1;
    if (n.len < n.target) {
      n.len = Math.min(n.target, n.len + n.target * 0.13 * SP.shootGrowth * g * RATE * juvenile() * lead);
    } else if (!n.kids.length && !n.stopped && n.depth < MAX_DEPTH && Math.random() < 0.35 * SP.shootGrowth * g * RATE * lead) {
      if (nodeCount < MAX_NODES) {
        sprout(n, true, false, null, onTrunk);
        // fase juvenil: a plântula sobe numa haste única; a ramificação espontânea liga aos poucos
        const lateral = onTrunk ? SP.lateralChance * branchJuv() : SP.apicalDominance * secondaryBranching();
        if (Math.random() < lateral) sprout(n, false);
      } else {
        // árvore no limite de galhos: a ponta continua avançando alongando o entrenó
        n.target = Math.min(n.target + n.target * 0.1 * g * RATE, SP.maxInternode);
      }
    }
    // bifurcação agendada pela poda: os dois braços do Y saem juntos, em lados opostos
    // a contagem segue a estação e a água, não o vigor: mesmo depois de uma poda grande as gemas abrem em ~2 semanas
    if (n.fork != null && n.len >= n.target && (n.fork -= forkPace()) <= 0) {
      delete n.fork;
      const phi = rand(0, Math.PI * 2), [a, b] = SP.fork.tilt;
      if (nodeCount < MAX_NODES) sprout(n, false, true, { phi, tilt: rand(a, b) });
      if (nodeCount < MAX_NODES) sprout(n, false, true, { phi: phi + Math.PI + rand(-0.3, 0.3), tilt: rand(a, b) });
      reinhibit(n);   // as pontas novas voltam a produzir auxina e seguram as outras gemas
    }
    // muda que passou da fase juvenil: as gemas axilares ao longo do tronco abrem e formam os ramos primários
    // (só em trechos jovens do tronco: madeira velha não volta a brotar assim)
    if (onTrunk && n.kids.length === 1 && n.depth >= 3 && n.age > 30 && n.age < SP.branching.axillaryAge && nodeCount < MAX_NODES
        && Math.random() < SP.branching.axillary * g * RATE * branchJuv()) sprout(n, false);
    // gemas latentes acordam onde houve poda; num toco sem galhos, uma delas pode virar a nova ponta
    // cada gema acordada brota por conta própria (várias podem abrir na mesma época)
    // (num toco com Y agendado as gemas são as do próprio Y: esperam e abrem juntas com ele)
    if (n.buds > 0 && n.fork == null && n.len >= n.target && n.depth < MAX_DEPTH) {
      const vig = budVigor(n);
      for (let i = n.buds; i > 0 && nodeCount < MAX_NODES; i--) {
        // gema em madeira velha pode desistir e voltar a dormir (num toco sem galhos a última sempre fica)
        if ((n.kids.length || n.buds > 1) && Math.random() < (1 - vig) * SP.apical.budAbort) { n.buds--; continue; }
        if (Math.random() >= SP.backBudding * g * RATE * vig) continue;
        const firstShoot = !n.kids.length;
        sprout(n, firstShoot && Math.random() < 0.5, true);
        n.buds--;
        if (firstShoot) { reinhibit(n); break; }   // toco que ganhou ponta nova volta a ter dominância
      }
    }
  }
  if (g > 0) gravitropicBend(n, g, onTrunk, parent);
  growRoots(n, g);
  // a linha do tronco continua pela ponta principal (kids[0]); o resto são galhos laterais
  let area = ownLeafArea(n, amt), main = 0, side = 0;
  n.kids.forEach((k, i) => {
    const a = grow(k, g, onTrunk && i === 0, amt, n);
    area += a;
    if (i === 0) main = a; else side = Math.max(side, a);
  });
  // crescimento secundário (modelo de tubos): madeira nova ∝ folhas acima ÷ espessura que já existe
  const th = SP.thickening, girth = n.girth + th.girthOffset;
  // ramo verde engrossa pouco (o diâmetro dele vem do crescimento primário); os anéis aceleram ao lignificar
  const ring = th.perLeaf * area * (state.shade ?? 1) / girth * (n.depth === 0 ? 1 + th.collar : 1) * lerp(th.green, 1, lignin(n));
  // um lateral com mais folhas que a própria continuação despeja tudo na junção, que incha:
  // esse inchaço (knot) é local e não desce pelo tronco, então aparece como conicidade invertida
  const knot = side > main * th.swellFrom ? th.swell * th.perLeaf * (side - main * th.swellFrom) * (state.shade ?? 1) / girth : 0;
  if (g > 0) {
    const add = (ring + knot) * g * RATE;
    n.girth += add;
    if (knot) n.knot = (n.knot ?? 0) + knot * g * RATE;
    // o calo cresce das bordas da ferida junto com a madeira nova e vai fechando a cicatriz
    if (n.wounds?.length) {
      for (const w of n.wounds) w.r -= th.heal * add * 0.475;
      n.wounds = n.wounds.filter(w => w.r > 0.15);
    }
  }
  // arame esquecido: o galho engrossa por dentro dele e a casca fica marcada
  const w = n.wire;
  // a forma fixa enquanto a madeira se forma: cada dia de crescimento ativo conta (inverno quase não conta)
  if (w && (w.prog ?? 0) < 1) w.prog = Math.min(1, wireProgress(n) + setActivity() / w.set);
  // casca verde é elástica: enquanto o trecho não lignifica, ela cede sob o arame e o engrossamento não marca
  // (inclui o que vem do modelo de tubos); a marca só acumula conforme a madeira endurece
  if (w && !w.bitten) {
    const grew = n.girth - (w.seen ?? n.girth);
    if (grew > 0) w.girth0 += grew * (1 - lignin(n));
    w.seen = n.girth;
  }
  if (w && !w.bitten && n.girth > wireBiteAt(w)) {
    w.bitten = true;
    n.scar = true;
    notify('wirebite', 'O arame começou a marcar a casca de um galho! Use a ferramenta 🪢 para ver e remover o arame.');
  }
  return area;   // área foliar sustentada por este ramo
}

// ramo verde sem arame se curva aos poucos em direção ao alto, levando junto o que sai dele;
// ao lignificar perde a capacidade (a madeira só muda de forma com arame)
const GRAVI_UP = new THREE.Vector3(0, 1, 0);
function gravitropicBend(n, g, onTrunk, parent) {
  if (n.wire) return;   // o arame segura a posição
  const green = 1 - clamp(n.age / SP.wiring.lignifyDays, 0, 1);
  if (green <= 0) return;
  const gt = SP.gravitropism, d = new THREE.Vector3(...n.dir);
  const excess = d.angleTo(GRAVI_UP) - THREE.MathUtils.degToRad(onTrunk ? gt.setpointTrunk : gt.setpointBranch);
  if (excess <= 0) return;
  let axis = new THREE.Vector3().crossVectors(d, GRAVI_UP);
  if (axis.lengthSq() < 1e-6) axis.set(1, 0, 0);   // apontando reto para baixo: escolhe um lado
  let step = Math.min(excess, THREE.MathUtils.degToRad(gt.bendRate * green * g));
  const q = new THREE.Quaternion().setFromAxisAngle(axis.normalize(), step);
  if (parent) {
    // a junção com o ramo de origem só curva até jointMax além do ângulo de nascimento;
    // o resto da subida fica para os entrenós seguintes (curva suave)
    const pd = new THREE.Vector3(...parent.dir), now = d.angleTo(pd);
    n.dep ??= now;
    const after = d.clone().applyQuaternion(q).angleTo(pd), limit = n.dep + THREE.MathUtils.degToRad(gt.jointMax);
    if (after > now && after > limit) {
      if (now >= limit) return;
      q.setFromAxisAngle(axis, step * (limit - now) / (after - now));
    }
  }
  rotateSubtree(n, q);
}

function sprout(n, leader, afterPrune = false, aim = null, trunkTip = false) {
  const d = n.dir;
  const u = norm(cross(d, Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const v = cross(d, u);
  let phi, tilt;
  if (aim) ({ phi, tilt } = aim);   // braços da bifurcação
  else if (leader) { phi = rand(0, Math.PI * 2); tilt = rand(0, 0.2); }
  else { n.phi += 2.4; phi = n.phi; tilt = rand(0.4, 0.9); }   // ângulo áureo espalha os galhos em volta
  const p = [0, 1, 2].map(i => u[i] * Math.cos(phi) + v[i] * Math.sin(phi));
  const dir = [0, 1, 2].map(i => d[i] * Math.cos(tilt) + p[i] * Math.sin(tilt));
  // gravitropismo: o broto novo aponta para cima, com mais força se o ramo de origem aponta para baixo
  dir[1] += SP.gravitropism.shoot + SP.gravitropism.downBoost * Math.max(0, -d[1]);
  // entrenós encurtam com a ramificação, mas nunca abaixo do mínimo da espécie
  const min = SP.minInternode * (afterPrune ? SP.pruneVigor : 1);
  // pouca luz: entrenós longos (estiolamento). O alongamento vale para este entrenó, sem se acumular nos próximos
  const stretch = 1 + SP.light.stretch * (1 - lightNow());
  const base = n.target / (n.stretch ?? 1);
  // tronco da muda juvenil: entrenós curtos (folhas próximas), que se alongam ao normal quando a planta passa a ramificar
  const juvLen = trunkTip ? lerp(SP.branching.internode, 1, branchJuv()) : 1;
  const target = Math.max(base * (leader ? rand(0.74, 0.86) : rand(0.6, 0.78)), min * rand(0.9, 1.15)) * stretch * juvLen;
  const kid = newNode(n.depth + 1, norm(dir), target);
  kid.dep = Math.acos(clamp(dot(kid.dir, d), -1, 1));   // ângulo com que nasceu em relação ao ramo de origem
  kid.stretch = stretch;
  kid.leafLen = leafSizeFor(kid);   // o tamanho da folha é definido quando ela abre
  n.kids.push(kid);
  nodeCount++;
}

// modelo de "tubos": a espessura de um galho cobre a soma dos filhos
function calcWidth(n) {
  let s = 0;
  for (const k of n.kids) { const w = calcWidth(k) - (k.knot ?? 0); s += w * w; }
  n.girth = Math.max(n.girth, n.kids.length ? Math.sqrt(s) : 1.3);
  return n.girth;
}

function findParent(n, target) {
  for (const k of n.kids) {
    if (k === target) return n;
    const p = findParent(k, target);
    if (p) return p;
  }
  return null;
}

// folhas nas pontas que ainda crescem (até numa plântula) e ao longo dos galhos finos; tocos podados não têm
// as folhas ficam no ramo enquanto vivem (leafLifespan), mesmo que ele solte ramos novos;
// madeira mais velha e grossa vai ficando sem folhas
const hasLeaves = n => n.len > n.target * 0.3 && !(n.stopped && !n.kids.length)
  && (n.kids.length === 0 || n.depth >= 5 || n.age < SP.leafLifespan);
// folha visível: dentro da quantidade da estação/saúde e já rebrotada depois de uma desfolha
const leafVisible = (l, amt) => amt > l.th && state.day >= (l.n.leafBack ?? 0);
// "área foliar" em unidades da calibração original (uma folha de 32 mm = 6 unidades):
// é o que transpira água e alimenta as raízes, então folhas menores consomem menos
const LEAF_REF = 32;
function foliageNow() {
  const amt = leafAmount(state.day);
  let a = 0;
  for (const l of leaves) if (leafVisible(l, amt)) a += 6 * (l.len / LEAF_REF) ** 2;
  return a;
}
// área foliar que o próprio segmento carrega (mesma conta das folhas desenhadas, sem depender da cena)
function ownLeafArea(n, amt) {
  if (!hasLeaves(n) || state.day < (n.leafBack ?? 0)) return 0;
  const lf = n.lf ?? 1, count = lf < 1 ? lf : leavesAt(n);
  return count * clamp(amt / 0.98, 0, 1) * 6 * ((n.leafLen || LEAF_REF) / LEAF_REF) ** 2;
}
function avgLeafLen() {
  const amt = leafAmount(state.day);
  let s = 0, c = 0;
  for (const l of leaves) if (leafVisible(l, amt)) { s += l.len; c++; }
  return c ? s / c : 0;
}
function collect(n, set) { set.add(n); for (const k of n.kids) collect(k, set); return set; }

// progresso da fixação de um arame (0 a 1); arames de saves antigos, sem `prog`, contam pelos dias corridos
const wireProgressOf = w => clamp(w.prog ?? (state.day - w.day) / w.set, 0, 1);

// ---------- Salvar / carregar ----------
const ser = n => [n.len, n.target, n.dir, n.depth, n.girth, n.buds, n.age, n.seed, n.phi, n.stopped ? 1 : 0, n.kids.map(ser),
  n.aerial.map(r => [r.d, r.ang, r.len, r.girth, r.grounded ? 1 : 0]),
  n.wire ? [n.wire.day, n.wire.girth0, n.wire.q, n.wire.set, n.wire.bitten ? 1 : 0, Math.round(wireProgressOf(n.wire) * 1000) / 1000,
    Math.round(n.wire.lowest ?? 0), n.wire.woke ? 1 : 0] : 0,
  n.scar ? 1 : 0, n.lf ?? 1,
  n.leafLen ? Math.round(n.leafLen * 10) / 10 : 0, n.leafBack ?? 0, n.stretch ? Math.round(n.stretch * 100) / 100 : 0,
  n.wounds?.length ? n.wounds.map(w => [Math.round(w.r * 100) / 100, Math.round(w.r0 * 100) / 100, w.dir]) : 0,
  n.knot ? Math.round(n.knot * 100) / 100 : 0, n.fork != null ? Math.max(0.1, Math.round(n.fork * 10) / 10) : 0];
const de = a => ({ len: a[0], target: a[1], dir: a[2], depth: a[3], girth: a[4], buds: a[5], age: a[6], seed: a[7],
  phi: a[8], stopped: !!a[9], kids: a[10].map(de),
  aerial: (a[11] ?? []).map(r => ({ d: r[0], ang: r[1], len: r[2], girth: r[3], grounded: !!r[4] })),
  // arames antigos (sem progresso salvo) ganham o tempo de fixação atual (60 dias), contado do dia em que foram colocados
  wire: a[12] ? { day: a[12][0], girth0: a[12][1], q: a[12][2], set: a[12][5] === undefined ? Math.min(a[12][3], 60) : a[12][3],
    bitten: !!a[12][4], prog: a[12][5], lowest: a[12][6] || 0, woke: !!a[12][7] } : null,
  scar: !!a[13], lf: a[14] ?? 1, leafLen: a[15] || null, leafBack: a[16] || 0, stretch: a[17] || 1,
  wounds: a[18] ? a[18].map(w => ({ r: w[0], r0: w[1], dir: w[2] })) : undefined, knot: a[19] || 0, fork: a[20] || undefined });

// Divide um entrenó em k trechos retos iguais (articulações extras para o arame), sem mudar a planta:
// mesma direção, espessura, idade e nível; folhas repartidas (lf) e a ponta continua no último trecho.
const MIN_PIECE = 2;   // mm
function splitNode(n, k) {
  if (k < 2 || n.len / k < MIN_PIECE) return false;
  const piece = n.len / k, origKids = n.kids, origTarget = n.target, aerial = n.aerial;
  const tip = { stopped: n.stopped, buds: n.buds, fork: n.fork };
  const lf = (n.lf ?? 1) / k;
  const pieces = [n];
  Object.assign(n, { len: piece, target: piece, kids: [], aerial: [], stopped: false, buds: 0, fork: undefined, lf });
  for (let i = 1; i < k; i++) {
    const p = { len: piece, target: piece, dir: [...n.dir], depth: n.depth, girth: n.girth, buds: 0, age: n.age,
      seed: Math.random(), phi: n.phi, stopped: false, kids: [], aerial: [], wire: null, scar: n.scar, lf,
      leafLen: n.leafLen, leafBack: n.leafBack, stretch: n.stretch };
    pieces[i - 1].kids = [p];
    pieces.push(p);
  }
  if (n.wounds) { pieces[k - 1].wounds = n.wounds; delete n.wounds; }
  if (n.knot) {   // o inchaço é da junção, que agora fica no fim do último trecho
    const kn = n.knot; n.knot = 0;
    for (const q of pieces.slice(0, -1)) q.girth -= kn;
    pieces[k - 1].knot = kn;
  }
  const last = pieces[k - 1];
  Object.assign(last, tip, { kids: origKids, target: Math.max(piece, origTarget - piece * (k - 1)) });
  for (const r of aerial) {   // cada raiz aérea vai para o trecho de onde pende
    const i = Math.min(k - 1, Math.floor(r.d / piece));
    pieces[i].aerial.push({ ...r, d: r.d - i * piece });
  }
  return true;
}

// o save inteiro como objeto: vai para o navegador (autosave) e para os arquivos de planta
function saveData() {
  // salva todos os campos de cuidado (CARE_DEFAULTS) automaticamente, para nenhum ficar de fora
  const care = Object.fromEntries(Object.keys(CARE_DEFAULTS).map(k => [k, state[k]]));
  const { day, cuts, species, origin, germ, name } = state;
  return { ...care, name, day, cuts, species, origin, germ, speed, cal: YEAR, root: ser(state.root) };
}
function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(saveData())); } catch (e) {}
}
function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? applySave(JSON.parse(raw)) : false;
  } catch (e) { return false; }
}
// monta o estado a partir de um save (do navegador ou de um arquivo); lança erro se não for um save válido
function applySave(s) {
  if (!s || !Array.isArray(s.root) || typeof s.day !== 'number') throw new Error('arquivo não é uma planta');
  {
    state = { ...structuredClone(CARE_DEFAULTS), day: s.day, cuts: s.cuts ?? 0, species: s.species ?? DEFAULT_SPECIES,
      origin: s.origin ?? 'muda', germ: s.germ ?? 0, name: s.name || defaultName(s.origin), root: de(s.root) };
    for (const k of Object.keys(CARE_DEFAULTS)) if (s[k] !== undefined) state[k] = s[k];
    if (state.front === 0.35) state.front = 0;   // padrão de uma versão anterior (a vista padrão já tem esse giro)
    SP = SPECIES[state.species] ?? SPECIES[DEFAULT_SPECIES];
    state.species = SP.id;
    applySpecies();
    // saves do calendário antigo (120 dias/ano): converte a data e a idade dos ramos
    if (s.cal !== YEAR) {
      const f = YEAR / (s.cal ?? 120);
      state.day = Math.round(state.day * f);
      (function age(n) { n.age = Math.round(n.age * f); n.kids.forEach(age); })(state.root);
    }
    speed = [0, 1, 7, 30, 90].includes(s.speed) ? s.speed : 7;
    calcWidth(state.root);
    return true;
  }
}
const defaultName = origin => `${SP.name.short[0].toUpperCase() + SP.name.short.slice(1)} de ${origin === 'seed' ? 'semente' : 'muda'}`;

// ---------- Cena 3D ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

// intensidades base das luzes (a luz de ambiente do render.js já ilumina por todos os lados)
const HEMI = 0.55, SUN = 2.4;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 1, 5000);

const hemi = new THREE.HemisphereLight(0xffffff, 0x8a7a66, HEMI);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff4e6, SUN);   // sol levemente quente
sun.position.set(220, 420, 260);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -300, right: 300, top: 350, bottom: -150, near: 10, far: 1200 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.6;
scene.add(sun);
// luz de ambiente, tone mapping, oclusão ambiente, vento e qualidade (js/render.js)
const R = setupRender({ renderer, scene, camera, sun });

const mat = color => new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
function addMesh(geo, material, pos, scale) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(...pos); m.scale.set(...scale);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
  return m;
}

// ---------- Vaso (ou canteiro) ----------
// A terra fica sempre em y ≈ 1 (a base da árvore); o vaso cresce para baixo.
// SOIL_RX/RZ: superfície de terra · STAND_TOP: altura do apoio · STAND_HX/HZ: metade do apoio (onde as folhas pousam)
let SOIL_RX = 108, SOIL_RZ = 66, STAND_TOP = -56, STAND_HX = 170, STAND_HZ = 115;
const soilMat = mat(0x4a3a2c);   // a cor da terra muda com a umidade
const mossMat = mat(0x6f8f45);
let potGroup = null;

function buildContainer(c) {
  if (potGroup) { scene.remove(potGroup); potGroup.traverse(o => o.geometry?.dispose()); }
  potGroup = new THREE.Group();
  scene.add(potGroup);
  const add = (geo, material, pos, scale) => {
    const m = new THREE.Mesh(geo, material);
    m.position.set(...pos); m.scale.set(...scale);
    m.castShadow = m.receiveShadow = true;
    potGroup.add(m);
    return m;
  };
  const v = c.visual;
  if (c.volume === Infinity) {
    // canteiro: terra fofa em volta da árvore e grama até longe
    SOIL_RX = SOIL_RZ = v.rx; STAND_TOP = -1; STAND_HX = STAND_HZ = v.rx + 400;
    add(new THREE.CylinderGeometry(1, 1, 1, 64), mat(0x7f9c55), [0, -2.5, 0], [v.rx + 400, 3, v.rx + 400]);
    add(new THREE.CylinderGeometry(1, 1.04, 1, 48), soilMat, [0, -0.5, 0], [v.rx, 3, v.rx]);
  } else {
    const rx = v.rx, rz = v.rz ?? v.rx, h = v.h, feet = v.feet ? 10 : 0;
    SOIL_RX = rx - 7; SOIL_RZ = rz - 6;
    STAND_TOP = -h - feet;
    STAND_HX = Math.max(170, rx * 1.3); STAND_HZ = Math.max(115, rz * 1.3);
    if (v.shape === 'box') {   // caixa de madeira retangular
      add(new THREE.BoxGeometry(1, 1, 1), mat(v.color), [0, -(h + 3) / 2, 0], [rx * 2, h - 3, rz * 2]);
      add(new THREE.BoxGeometry(1, 1, 1), mat(v.rim), [0, -3.5, 0], [rx * 2 + 8, 7, rz * 2 + 8]);
      add(new THREE.BoxGeometry(1, 1, 1), soilMat, [0, 0, 0], [SOIL_RX * 2, 2, SOIL_RZ * 2]);
    } else {
      add(new THREE.CylinderGeometry(1, v.taper, 1, 48), mat(v.color), [0, -(h + 3) / 2, 0], [rx, h - 3, rz]);   // corpo
      add(new THREE.CylinderGeometry(1, 1, 1, 48), mat(v.rim), [0, -3.5, 0], [rx + 4, 7, rz + 4]);                // borda
      add(new THREE.CylinderGeometry(1, 1, 1, 48), soilMat, [0, 0, 0], [SOIL_RX, 2, SOIL_RZ]);                   // terra
    }
    if (v.feet) for (const [x, z] of [[-0.68, -0.58], [0.68, -0.58], [-0.68, 0.58], [0.68, 0.58]])
      add(new THREE.BoxGeometry(1, 1, 1), mat(0x6e4636), [x * rx, -h - 5, z * rz], [22, 10, 16]);
    add(new THREE.BoxGeometry(1, 1, 1), mat(0x7a5a44), [0, STAND_TOP - 6, 0], [STAND_HX * 2, 12, STAND_HZ * 2]);  // suporte
  }
  if (v.moss) {
    const moss = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 6), mossMat, 26);
    const o = new THREE.Object3D();
    for (let i = 0; i < 26; i++) {
      const a = hash(3, i) * Math.PI * 2, r = 0.25 + hash(4, i) * 0.65;
      o.position.set(Math.cos(a) * SOIL_RX * r, 1, Math.sin(a) * SOIL_RZ * r);
      o.scale.set(6 + hash(5, i) * 10, 1.6, 5 + hash(6, i) * 8);
      o.updateMatrix(); moss.setMatrixAt(i, o.matrix);
    }
    moss.receiveShadow = true;
    potGroup.add(moss);
  }
}
const applyContainer = () => { buildContainer(container()); R.tune(); };

// nebari: raízes aparentes na base
const flare = addMesh(new THREE.CylinderGeometry(1, 1.9, 1, 14), mat(0x5c402e), [0, 0, 0], [1, 1, 1]);

// semente (em escala exagerada: a do ficus tem ~1 mm) e um anel de terra mexida em volta
const seed = addMesh(new THREE.SphereGeometry(1, 12, 8), mat(0x8a6236), [0, 1.6, 0], [2.2, 1.4, 1.6]);
const seedBed = addMesh(new THREE.CylinderGeometry(1, 1, 1, 24), mat(0x3a2c20), [0, 1.05, 0], [9, 0.3, 9]);

// galhos, juntas e folhas usam "instancing": uma malha desenhada milhares de vezes
// cada segmento é um cone: aTaper (por instância) é a razão entre o raio do topo e o da base
function addTaper(material) {
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'attribute float aTaper;\n' + shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\n  transformed.xz *= mix(1.0, aTaper, position.y + 0.5);');
  };
  return material;
}
const branchMat = addTaper(new THREE.MeshStandardMaterial({ roughness: 0.95 }));
const branchGeo = new THREE.CylinderGeometry(1, 1, 1, 12);
const taperAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_NODES + 64).fill(1), 1);
branchGeo.setAttribute('aTaper', taperAttr);
const branchMesh = new THREE.InstancedMesh(branchGeo, branchMat, MAX_NODES + 64);
branchMesh.customDepthMaterial = addTaper(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }));   // sombra também cônica
const jointMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshStandardMaterial({ roughness: 0.95 }), MAX_NODES + 64);
const pickMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 6), new THREE.MeshBasicMaterial(), MAX_NODES + 64);
pickMesh.visible = false;   // versão mais grossa e invisível dos galhos, para facilitar o clique
// folha: elíptica com ponta, comprimento 1 com a base (pecíolo) na origem; largura e ponta vêm da espécie
// (com width 0,27 e tip 0,8 é exatamente a folha do ficus)
function makeLeafGeo({ width = 0.27, tip = 0.8 } = {}) {
  const k = width / 0.27, s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(0.12, 0.2 * k, 0.55 * tip / 0.8, 0.27 * k, tip, 0.12 * k);
  s.quadraticCurveTo(lerp(tip, 1, 0.6), 0.05 * k, 1, 0);
  s.quadraticCurveTo(lerp(tip, 1, 0.6), -0.05 * k, tip, -0.12 * k);
  s.bezierCurveTo(0.55 * tip / 0.8, -0.27 * k, 0.12, -0.2 * k, 0, 0);
  return new THREE.ShapeGeometry(s, 6);
}
let leafGeo = makeLeafGeo(SP.leaf.shape);
const leafMat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8 });
// flores (espécies que florescem): estrela de 5 pétalas de raio 1, virada para +z
const MAX_FLOWERS = 2000;
const flowerGeo = (() => {
  const s = new THREE.Shape();
  for (let i = 0; i <= 10; i++) {
    const a = i / 10 * Math.PI * 2, r = i % 2 ? 0.45 : 1;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r); else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  return new THREE.ShapeGeometry(s);
})();
const flowerMesh = new THREE.InstancedMesh(flowerGeo,
  new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.6, emissive: 0x666666 }), MAX_FLOWERS);
flowerMesh.count = 0; flowerMesh.frustumCulled = false; flowerMesh.castShadow = true;
scene.add(flowerMesh);
let flowers = [];
const leafMesh = new THREE.InstancedMesh(leafGeo, leafMat, MAX_LEAVES);
const FALL_MAX = 600;
const fallMesh = new THREE.InstancedMesh(leafGeo, leafMat, FALL_MAX);
// raízes aéreas (e a versão invisível mais grossa para o clique)
const rootMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.75, 1, 1, 6), new THREE.MeshStandardMaterial({ roughness: 0.95 }), MAX_ROOTS);
const MAX_WOUNDS = 200;
const woundMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 18), new THREE.MeshStandardMaterial({ roughness: 0.9 }), MAX_WOUNDS);
woundMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_WOUNDS * 3), 3);   // cor desde o início
woundMesh.count = 0; woundMesh.frustumCulled = false;
scene.add(woundMesh);
const rootPick = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 6), new THREE.MeshBasicMaterial(), MAX_ROOTS);
rootPick.visible = false;
// gotas de rega e névoa do borrifador
const DROP_MAX = 500;
const dropMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 4),
  new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.7, depthWrite: false }), DROP_MAX);
for (const m of [branchMesh, jointMesh, leafMesh, fallMesh, rootMesh]) { m.castShadow = true; m.receiveShadow = true; }
for (const m of [branchMesh, jointMesh, pickMesh, leafMesh, fallMesh, rootMesh, rootPick, dropMesh]) { m.frustumCulled = false; scene.add(m); }
rootMesh.count = rootPick.count = dropMesh.count = 0;

// neve
const SNOW_N = 700;
const snowGeo = new THREE.BufferGeometry();
const snowPos = new Float32Array(SNOW_N * 3);
for (let i = 0; i < SNOW_N; i++) { snowPos[i * 3] = rand(-400, 400); snowPos[i * 3 + 1] = rand(STAND_TOP, 500); snowPos[i * 3 + 2] = rand(-300, 300); }
snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
const snowMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.6, transparent: true, opacity: 0, depthWrite: false });
scene.add(new THREE.Points(snowGeo, snowMat));

// ---------- Montagem da árvore na cena ----------
const HIGHLIGHT = [232, 182, 76];
const UP = new THREE.Vector3(0, 1, 0);
const LEAF_X = new THREE.Vector3(1, 0, 0), LEAF_Z = new THREE.Vector3(0, 0, 1);
const tmp = new THREE.Object3D(), tmpColor = new THREE.Color(), tmpVec = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

let nodes = [], leaves = [], roots = [];
let hoverPlan = null, hoverSet = new Set();
const ROOT_COLOR = [176, 160, 140], ROOT_TIP = [214, 196, 160];
let lastLeafD = -1, prevLeafAmt = null;

// anel vermelho que mostra onde o corte vai acontecer
const marker = new THREE.Mesh(new THREE.TorusGeometry(1, 0.16, 8, 32),
  new THREE.MeshBasicMaterial({ color: 0xe0453a, depthTest: false, transparent: true }));
marker.renderOrder = 10;
marker.visible = false;
scene.add(marker);

const radius = n => n.girth * 0.475;   // raio na base do segmento
// raio no topo do segmento: encontra o ramo mais grosso que sai dali; uma ponta afina até quase nada
// uma ferida de galho removido mantém a madeira grossa até o corte, até o calo fechar
function topRadius(n) {
  const r = radius(n), wound = Math.max(0, ...(n.wounds ?? []).map(w => w.r));
  if (!n.kids.length) return Math.max(r * 0.35, 0.3, Math.min(r, wound));
  return Math.min(r, Math.max(wound, ...n.kids.map(radius)));
}
// articulação arredondada no topo; com ferida de galho dominante o topo é um corte plano (só o ramo que segue)
const jointRadius = n => n.wounds?.length ? Math.min(topRadius(n), Math.max(0.3, ...n.kids.map(radius))) : topRadius(n);
// raio num ponto do segmento (t = 0 na base, 1 no topo)
const radiusAt = (n, t) => lerp(radius(n), topRadius(n), t);
function setColor(mesh, i, c) { mesh.setColorAt(i, tmpColor.setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace)); }

function leafColor(n, i, d) {
  const s2 = hash(n.seed, i + 50), th = hash(n.seed, i) * 0.98;
  // folhas novas são verde-claras e escurecem com a idade do galho
  // (inclui as folhas que acabaram de rebrotar depois de uma desfolha)
  const regrown = n.leafBack ? clamp(1 - (d - n.leafBack) / 45, 0, 1) : 0;
  const fresh = Math.max(clamp(1 - n.age / 60, 0, 1), springFresh(d) * SP.leafDrop, regrown);
  let c = mixColor(SP.leaf.mature, SP.leaf.young, fresh * (0.6 + s2 * 0.4));
  // só as folhas que vão cair mudam de cor
  if (th > 1 - SP.leafDrop)
    c = mixColor(c, SP.leaf.autumn[Math.floor(s2 * SP.leaf.autumn.length)], clamp(autumnTint(d) * 1.4 - s2 * 0.4, 0, 1));
  // falta de vigor amarela parte das folhas
  const stress = Math.max(clamp((0.8 - state.vigor) / 0.5, 0, 1), clamp((0.95 - (state.health ?? 1)) / 0.5, 0, 1));
  if (stress > 0) c = mixColor(c, SP.leaf.stress, stress * (0.3 + s2 * 0.6));
  return hoverSet.has(n) ? mixColor(c, HIGHLIGHT, 0.65) : c;
}

function rebuild() {
  const oldLeaves = leaves;
  nodes = []; leaves = [];
  place(state.root, new THREE.Vector3(0, 0, 0));

  nodes.forEach((n, i) => {
    const r = radius(n);
    const dir = tmpVec.set(...n.dir);
    tmp.quaternion.setFromUnitVectors(UP, dir);
    tmp.position.copy(n._s).addScaledVector(dir, n.len / 2);
    tmp.scale.set(r, Math.max(n.len, 0.01), r);
    tmp.updateMatrix(); branchMesh.setMatrixAt(i, tmp.matrix);
    taperAttr.setX(i, topRadius(n) / r);
    tmp.scale.set(Math.max(r, 2.5), Math.max(n.len, 0.5), Math.max(r, 2.5));
    tmp.updateMatrix(); pickMesh.setMatrixAt(i, tmp.matrix);
    tmp.quaternion.identity(); tmp.position.copy(n._e); tmp.scale.setScalar(jointRadius(n));
    tmp.updateMatrix(); jointMesh.setMatrixAt(i, tmp.matrix);

    if (hasLeaves(n)) {
      if (!n.leafLen) n.leafLen = leafSizeFor(n);   // árvores salvas antes do tamanho de folha existir
      // folhas por nó conforme a disposição da espécie (+1 na ponta em crescimento); trechos divididos repartem a folha
      const lf = n.lf ?? 1;
      const count = lf < 1 ? (hash(n.seed, 99) < lf ? 1 : 0) : leavesAt(n);
      for (let k = 0; k < count && leaves.length < MAX_LEAVES; k++) {
        const len = n.leafLen * (0.92 + hash(n.seed, k + 80) * 0.16);
        const theta = n.phi + k * leafStep() + hash(n.seed, k + 10) * 0.6;   // espiral (alternadas) ou pares (opostas)
        const pitch = 0.15 + hash(n.seed, k + 20) * 0.5;               // folha levemente erguida
        const out = new THREE.Vector3(Math.cos(theta), 0, Math.sin(theta));
        // a base da folha (pecíolo) fica junto do nó; a folha se abre para fora
        tmp.position.copy(n._e).addScaledVector(out, Math.min(2, radius(n) + 0.5));
        tmp.quaternion.setFromAxisAngle(GRAVI_UP, -theta)
          .multiply(new THREE.Quaternion().setFromAxisAngle(LEAF_Z, pitch))
          .multiply(new THREE.Quaternion().setFromAxisAngle(LEAF_X, -Math.PI / 2 + (hash(n.seed, k + 30) - 0.5) * 0.5));
        tmp.scale.set(len, len, 1);
        tmp.updateMatrix();
        const center = tmp.position.clone().addScaledVector(out, len * 0.5);
        leaves.push({ n, k, len, th: hash(n.seed, k) * 0.98, m: tmp.matrix.clone(), pos: center });
      }
    }
  });
  branchMesh.count = jointMesh.count = pickMesh.count = nodes.length;
  leafMesh.count = leaves.length;
  placeFlowers();
  // folhas que chegaram ao fim da vida (ramo ficou velho) caem de verdade em vez de sumir;
  // as de galhos podados já caíram no corte
  const inTree = new Set(nodes), leafy = new Set(leaves.map(l => l.n));
  const amt = leafAmount(state.day);
  for (const l of oldLeaves)
    if (inTree.has(l.n) && !leafy.has(l.n) && leafVisible(l, amt) && leafMesh.visible) spawnLeaf(l.pos, leafColor(l.n, l.k, state.day), l.len);
  for (const m of [branchMesh, jointMesh, pickMesh]) m.instanceMatrix.needsUpdate = true;
  taperAttr.needsUpdate = true;
  pickMesh.boundingSphere = null;   // força o raycast a recalcular os limites

  const r0 = radius(state.root);
  flare.scale.set(r0, r0 * 1.8, r0); flare.position.y = r0 * 0.9;
  flare.visible = state.root.len > 1;
  seed.visible = state.germ > 0;
  seedBed.visible = state.germ > 0 || state.day < 30 && state.origin === 'seed';

  // raízes aéreas: descem na vertical a partir do galho
  roots = [];
  for (const n of nodes) for (const r of n.aerial) {
    if (roots.length >= MAX_ROOTS) break;
    const a = attachPoint(n, r), rad = r.girth;
    tmp.quaternion.identity();
    tmp.position.set(a.x, a.y - r.len / 2, a.z);
    tmp.scale.set(rad, Math.max(r.len, 0.01), rad);
    tmp.updateMatrix(); rootMesh.setMatrixAt(roots.length, tmp.matrix);
    tmp.scale.set(Math.max(rad, 2), Math.max(r.len, 0.5), Math.max(rad, 2));
    tmp.updateMatrix(); rootPick.setMatrixAt(roots.length, tmp.matrix);
    roots.push({ n, r });
  }
  rootMesh.count = rootPick.count = roots.length;
  rootMesh.instanceMatrix.needsUpdate = rootPick.instanceMatrix.needsUpdate = true;
  rootPick.boundingSphere = null;

  // cicatrizes: disco de madeira exposta na junção, apontando para onde estava o galho
  let wc = 0;
  for (const n of nodes) for (const w of n.wounds ?? []) {
    if (wc >= MAX_WOUNDS) break;
    const d = tmpVec.set(...w.dir), axis = new THREE.Vector3(...n.dir);
    const lead = n.kids.length ? Math.max(...n.kids.map(radius)) : 0;
    if (w.r >= lead) {
      // galho dominante removido (ex.: sacrifício): corte plano no topo do tronco, com o ramo fino ao lado
      tmp.quaternion.setFromUnitVectors(UP, axis);
      const off = d.clone().addScaledVector(axis, -d.dot(axis));
      tmp.position.copy(n._e).addScaledVector(axis, 0.15);
      if (off.lengthSq() > 1e-4) tmp.position.addScaledVector(off.normalize(), Math.max(0, topRadius(n) - w.r) * 0.9);
    } else {
      // lateral menor: a ferida fica na lateral do tronco, virada para onde o galho saía
      tmp.quaternion.setFromUnitVectors(UP, d);
      tmp.position.copy(n._e).addScaledVector(d, topRadius(n) * 0.75);
    }
    tmp.scale.set(w.r, 0.35, w.r);
    tmp.updateMatrix(); woundMesh.setMatrixAt(wc, tmp.matrix);
    // madeira clara recém-cortada escurece e ganha casca conforme fecha
    setColor(woundMesh, wc, mixColor([196, 160, 112], [92, 74, 58], 1 - w.r / w.r0));
    wc++;
  }
  woundMesh.count = wc;
  woundMesh.instanceMatrix.needsUpdate = true;
  if (woundMesh.instanceColor) woundMesh.instanceColor.needsUpdate = true;

  if (hoverPlan) {   // a árvore cresceu: refaz o plano de corte com os galhos novos
    hoverPlan = planCut(hoverPlan.hit);
    hoverSet = hoverPlan.removed;
    placeMarker(hoverPlan);
  }
  updateCoils();
  refreshHandles();   // pontos do arame acompanham o galho (e a seleção some se ele foi cortado)
  colorBranches();
  lastLeafD = -1;
}

function place(n, start, parent = null) {
  n._s = start;
  n._p = parent;
  n._e = start.clone().addScaledVector(tmpVec.set(...n.dir), n.len);
  nodes.push(n);
  for (const k of n.kids) place(k, n._e, n);
}

// ponto do galho de onde a raiz pende (na lateral da casca)
function attachPoint(n, r) {
  const rad = radius(n) * 0.8 + 1;
  return n._s.clone().addScaledVector(tmpVec.set(...n.dir), Math.min(r.d, n.len))
    .add(new THREE.Vector3(Math.cos(r.ang) * rad, 0, Math.sin(r.ang) * rad));
}

const DRY_SHOOT = [120, 98, 70], DEAD_WOOD = [128, 122, 112];
function colorBranches() {
  nodes.forEach((n, i) => {
    let c = mixColor(SP.bark, SP.shoot, clamp(1 - n.age / 120, 0, 1));   // ramos verdes lignificam em ~4 meses
    if (n.scar) c = mixColor(c, [78, 62, 50], 0.4);                      // cicatriz de arame ou rachadura
    const h = state.dead ? 0 : state.health ?? 1;
    if (h < 0.5) c = mixColor(c, DRY_SHOOT, (0.5 - h) * 2 * clamp(1 - n.age / 120, 0, 1));   // brotos verdes secam
    if (state.dead) c = mixColor(c, DEAD_WOOD, 0.55);                    // madeira morta, acinzentada
    if (wireSet.has(n)) c = mixColor(c, WIRE_SELECT, 0.6);               // galho selecionado no modo arame
    if (hoverSet.has(n)) c = HIGHLIGHT;
    setColor(branchMesh, i, c); setColor(jointMesh, i, c);
  });
  branchMesh.instanceColor.needsUpdate = jointMesh.instanceColor.needsUpdate = true;
  // raízes jovens são claras; pilares ganham cor de casca; as que serão cortadas ficam destacadas
  roots.forEach(({ n, r }, i) => {
    const doomed = hoverSet.has(n) || hoverPlan?.root === r;
    setColor(rootMesh, i, doomed ? HIGHLIGHT : r.grounded ? mixColor(ROOT_COLOR, SP.bark, clamp(r.girth / 2, 0, 1)) : mixColor(ROOT_COLOR, ROOT_TIP, 0.5));
  });
  if (rootMesh.instanceColor) rootMesh.instanceColor.needsUpdate = true;
  lastLeafD = -1;
}

// flores nas pontas com folhas: só a espécie que floresce, e só parte das pontas (density)
function placeFlowers() {
  flowers = [];
  const F = SP.flowers;
  if (F) for (const n of nodes) {
    if (n.kids.length || !hasLeaves(n) || hash(n.seed, 77) > F.density || flowers.length >= MAX_FLOWERS) continue;
    const out = new THREE.Vector3(...n.dir).add(new THREE.Vector3(0, 0.8, 0)).normalize();   // virada para cima e para fora
    tmp.position.copy(n._e).addScaledVector(out, 2 + SP.leaf.length * 0.25);   // acima do tufo de folhas da ponta
    tmp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), out);
    tmp.scale.setScalar(F.size * (0.85 + hash(n.seed, 78) * 0.3));
    tmp.updateMatrix();
    flowers.push({ m: tmp.matrix.clone(), th: hash(n.seed, 79) });
  }
  flowerMesh.count = flowers.length;
  lastLeafD = -1;
}
// quanto da floração está aberta no dia (0 a 1): sobe e desce dentro da janela da espécie
function bloomAmount(d) {
  const F = SP.flowers;
  if (!F || state.germ > 0 || state.day < F.minAge || state.dead) return 0;
  const f = yearFrac(d), [a, b] = F.season;
  if (f < a || f > b) return 0;
  const edge = Math.min(f - a, b - f) / ((b - a) * 0.25);   // abre e fecha aos poucos
  return clamp(edge, 0, 1) * clamp((state.health ?? 1) / 0.7, 0, 1) * clamp(state.vigor / 0.7, 0, 1);
}

function updateLeaves(d) {
  if (Math.abs(d - lastLeafD) < 0.03) return;
  const amt = leafAmount(d);
  const falling = prevLeafAmt !== null && amt < prevLeafAmt;
  leaves.forEach((l, i) => {
    const visible = leafVisible(l, amt);
    if (!visible && falling && l.th < prevLeafAmt && amt <= l.th) spawnLeaf(l.pos, leafColor(l.n, l.k, d), l.len);
    leafMesh.setMatrixAt(i, visible ? l.m : ZERO);
    setColor(leafMesh, i, leafColor(l.n, l.k, d));
  });
  leafMesh.instanceMatrix.needsUpdate = true;
  if (leafMesh.instanceColor) leafMesh.instanceColor.needsUpdate = true;
  // flores abertas conforme a floração do dia
  const bloom = bloomAmount(d);
  flowers.forEach((fl, i) => flowerMesh.setMatrixAt(i, fl.th < bloom ? fl.m : ZERO));
  if (flowers.length) flowerMesh.instanceMatrix.needsUpdate = true;
  prevLeafAmt = amt; lastLeafD = d;
}

// ---------- Folhas caindo e neve ----------
let falling = [];
function spawnLeaf(pos, col, len = 30) {
  if (falling.length >= FALL_MAX) return;
  falling.push({ p: pos.clone(), v: new THREE.Vector3(rand(-8, 8), rand(-25, -12), rand(-8, 8)),
    rot: new THREE.Euler(rand(0, 6), rand(0, 6), rand(0, 6)), spin: rand(-3, 3), col, len, life: 1, landed: false });
}
function updateFalling(dt) {
  falling.forEach((f, i) => {
    if (!f.landed) {
      f.p.x += (f.v.x + Math.sin(time * 2 + f.spin) * 10) * dt;
      f.p.y += f.v.y * dt;
      f.p.z += f.v.z * dt;
      f.rot.x += f.spin * dt; f.rot.z += f.spin * 0.7 * dt;
      const inPot = (f.p.x / SOIL_RX) ** 2 + (f.p.z / SOIL_RZ) ** 2 < 1;
      const onStand = Math.abs(f.p.x) < STAND_HX && Math.abs(f.p.z) < STAND_HZ;
      const floor = inPot ? 1.5 : onStand ? STAND_TOP + 0.5 : -Infinity;
      if (f.p.y <= floor) { f.p.y = floor; f.landed = true; f.rot.set(-Math.PI / 2, 0, f.spin); }
      if (f.p.y < -500) f.life = 0;
    } else {
      f.life -= dt * 0.15;
    }
    const s = clamp(f.life * 2, 0, 1);
    tmp.position.copy(f.p); tmp.rotation.copy(f.rot); tmp.scale.set(f.len * s, f.len * s, 1);
    tmp.updateMatrix(); fallMesh.setMatrixAt(i, tmp.matrix);
    setColor(fallMesh, i, f.col);
  });
  fallMesh.count = falling.length;
  fallMesh.instanceMatrix.needsUpdate = true;
  if (fallMesh.instanceColor) fallMesh.instanceColor.needsUpdate = true;
  falling = falling.filter(f => f.life > 0);
}

// ---------- Gotas de rega e névoa ----------
let drops = [];
function spawnWaterDrops() {
  for (let i = 0; i < 160 && drops.length < DROP_MAX; i++) {
    const a = rand(0, Math.PI * 2), r = Math.sqrt(Math.random()) * 0.85;
    drops.push({ p: new THREE.Vector3(Math.cos(a) * SOIL_RX * r, rand(70, 140), Math.sin(a) * SOIL_RZ * r),
      v: new THREE.Vector3(0, rand(-160, -110), 0), size: rand(0.7, 1.2), col: [120, 170, 220], life: 1, mist: false });
  }
}
function spawnMist() {
  const tips = nodes.filter(hasLeaves);
  for (let i = 0; i < 140 && drops.length < DROP_MAX; i++) {
    const t = tips.length ? tips[Math.floor(Math.random() * tips.length)]._e : new THREE.Vector3(0, 80, 0);
    drops.push({ p: t.clone().add(new THREE.Vector3(rand(-12, 12), rand(-6, 10), rand(-12, 12))),
      v: new THREE.Vector3(rand(-4, 4), rand(-3, 2), rand(-4, 4)), size: rand(0.3, 0.6), col: [235, 242, 248], life: 1, mist: true });
  }
}
function updateDrops(dt) {
  drops.forEach((p, i) => {
    p.p.addScaledVector(p.v, dt);
    if (p.mist) p.life -= dt * 0.6;
    else if (p.p.y <= SOIL_TOP) p.life = 0;
    tmp.quaternion.identity(); tmp.position.copy(p.p);
    tmp.scale.set(p.size, p.mist ? p.size : p.size * 2.2, p.size);
    tmp.updateMatrix(); dropMesh.setMatrixAt(i, tmp.matrix);
    setColor(dropMesh, i, p.col);
  });
  dropMesh.count = drops.length;
  dropMesh.instanceMatrix.needsUpdate = true;
  if (dropMesh.instanceColor) dropMesh.instanceColor.needsUpdate = true;
  drops = drops.filter(p => p.life > 0);
}

const SOIL_DRY = [150, 118, 86], SOIL_WET = [52, 38, 28];
function updateSoil() {
  const c = mixColor(SOIL_DRY, SOIL_WET, clamp(state.water / 0.7, 0, 1));
  soilMat.color.setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);
}

function updateSnow(d, dt) {
  const y = dayOfYear(d);
  const target = SP.frostHardy && y >= YEAR * 0.77 && y < YEAR * 0.98 ? 0.9 : 0;   // espécies tropicais passam o inverno protegidas
  snowMat.opacity = lerp(snowMat.opacity, target, dt * 1.5);
  if (snowMat.opacity < 0.01) return;
  for (let i = 0; i < SNOW_N; i++) {
    snowPos[i * 3 + 1] -= (25 + (i % 7) * 3) * dt;
    snowPos[i * 3] += Math.sin(time + i) * 0.15;
    if (snowPos[i * 3 + 1] < STAND_TOP) snowPos[i * 3 + 1] = 500;
  }
  snowGeo.attributes.position.needsUpdate = true;
}

// ---------- Céu e luz por estação ----------
const SEASON_SKY = [
  [[222, 238, 236], [246, 240, 228]],
  [[205, 228, 242], [247, 240, 222]],
  [[240, 218, 196], [245, 231, 214]],
  [[218, 224, 232], [239, 241, 244]],
];
let lastBg = '';
function updateSky(d) {
  const y = dayOfYear(d), s = seasonOf(d), p = (y - s * SEASON_LEN) / SEASON_LEN;
  const t = clamp((p - 0.75) / 0.25, 0, 1);
  const a = SEASON_SKY[s], b = SEASON_SKY[(s + 1) % 4];
  const top = mixColor(a[0], b[0], t), bottom = mixColor(a[1], b[1], t);
  const bg = `linear-gradient(${rgb(top)}, ${rgb(bottom)})`;
  if (bg !== lastBg) {
    document.body.style.background = bg; lastBg = bg;
    hemi.color.setRGB(top[0] / 255, top[1] / 255, top[2] / 255, THREE.SRGBColorSpace);
    mossMat.color.set(s === 3 ? 0xf2f4f7 : 0x6f8f45);
  }
}

// ---------- Câmera ----------
// Controles no estilo dos fatiadores 3D (Creality Print): esquerdo gira, direito/meio move, roda dá zoom.
const controls = new OrbitControls(camera, renderer.domElement);
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.minDistance = 80;
controls.maxDistance = 1500;
controls.screenSpacePanning = true;

const HOME_TARGET = new THREE.Vector3(0, 90, 0);
const VIEWS = {
  home:   { r: 680, phi: 1.33, theta: 0.35 },   // vista padrão: um pouco de lado e de cima, olhando a frente
  top:    { r: 620, phi: 0.001, theta: 0 },
  front:  { r: 640, phi: Math.PI / 2, theta: 0 },
  back:   { r: 640, phi: Math.PI / 2, theta: Math.PI },
  right:  { r: 640, phi: Math.PI / 2, theta: Math.PI / 2 },
  left:   { r: 640, phi: Math.PI / 2, theta: -Math.PI / 2 },
  bottom: { r: 620, phi: Math.PI - 0.001, theta: 0 },
};

// as vistas são relativas à frente escolhida para o bonsai (state.front gira tudo em volta do vaso)
const withFront = v => ({ ...v, theta: v.theta + (state?.front ?? 0) });
function setCamera(sph, target) {
  controls.target.copy(target);
  camera.position.setFromSpherical(new THREE.Spherical(sph.r, sph.phi, sph.theta)).add(target);
  camera.lookAt(target);
}

let anim = null;
function goToView(name) {
  const from = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
  const to = withFront(VIEWS[name]);
  const dTheta = ((to.theta - from.theta + Math.PI * 3) % (Math.PI * 2)) - Math.PI;   // caminho mais curto
  anim = { t: 0, from: { r: from.radius, phi: from.phi, theta: from.theta }, to: { ...to, theta: from.theta + dTheta },
    fromTarget: controls.target.clone() };
  controls.enableDamping = false;
}
function updateAnim(dt) {
  if (!anim) return;
  anim.t = Math.min(1, anim.t + dt / 0.6);
  const e = 1 - Math.pow(1 - anim.t, 3);
  setCamera({ r: lerp(anim.from.r, anim.to.r, e), phi: lerp(anim.from.phi, anim.to.phi, e), theta: lerp(anim.from.theta, anim.to.theta, e) },
    anim.fromTarget.clone().lerp(HOME_TARGET, e));
  if (anim.t >= 1) { anim = null; controls.enableDamping = true; }
}
controls.addEventListener('start', () => { if (anim) { anim = null; controls.enableDamping = true; } });

document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => goToView(b.dataset.view)));
// definir frente: o lado para onde a câmera está olhando agora vira a frente do bonsai
document.getElementById('setFront').addEventListener('click', () => {
  const s = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
  state.front = s.theta;
  save();
  goToView('home');
  toast('Frente definida! O cubo e o botão ⌂ agora usam este lado como frente.');
});

// esconder as folhas para ver só a estrutura dos galhos
const leafToggle = document.getElementById('leafToggle');
function toggleLeaves() {
  leafMesh.visible = fallMesh.visible = !leafMesh.visible;
  leafToggle.title = leafMesh.visible ? 'Ocultar folhas (tecla F)' : 'Mostrar folhas (tecla F)';
  leafToggle.classList.toggle('on', !leafMesh.visible);
}

// ---------- Cubo de navegação ----------
// Gira junto com a câmera; clicar numa face leva a câmera para aquele lado, arrastar gira a cena.
const cubeCanvas = document.getElementById('viewCube');
const cubeRenderer = new THREE.WebGLRenderer({ canvas: cubeCanvas, antialias: true, alpha: true });
cubeRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
cubeRenderer.setSize(120, 120, false);
const cubeScene = new THREE.Scene();
const cubeCam = new THREE.PerspectiveCamera(30, 1, 0.1, 20);

// mesma ordem das faces do BoxGeometry: +x, -x, +y, -y, +z, -z
const CUBE_FACES = [
  { label: 'DIREITA', view: 'right' }, { label: 'ESQUERDA', view: 'left' },
  { label: 'TOPO', view: 'top' }, { label: 'BAIXO', view: 'bottom' },
  { label: 'FRENTE', view: 'front' }, { label: 'TRÁS', view: 'back' },
];
function faceTexture(label) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#eef0ec'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#a7aea6'; g.lineWidth = 4; g.strokeRect(2, 2, 124, 124);
  g.fillStyle = '#2d2a26'; g.font = `600 ${label.length > 6 ? 19 : 24}px system-ui, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(label, 64, 66);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// tons levemente diferentes por eixo, para o cubo ter volume
const CUBE_SHADE = [0xe2e6e0, 0xe2e6e0, 0xffffff, 0xc9cfc7, 0xf3f5f1, 0xf3f5f1];
const cubeMats = CUBE_FACES.map(f => new THREE.MeshBasicMaterial({ map: faceTexture(f.label) }));
const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), cubeMats);
cube.add(new THREE.LineSegments(new THREE.EdgesGeometry(cube.geometry), new THREE.LineBasicMaterial({ color: 0x6d665d })));
cubeScene.add(cube);

const cubeRay = new THREE.Raycaster(), cubeNdc = new THREE.Vector2();
let cubeHover = -1, cubeDrag = null;

function updateViewCube() {
  cube.rotation.y = state.front ?? 0;   // a face FRENTE do cubo aponta para a frente escolhida
  const off = camera.position.clone().sub(controls.target).normalize();
  cubeCam.position.copy(off).multiplyScalar(3.3);
  cubeCam.up.copy(camera.up);
  cubeCam.lookAt(0, 0, 0);
  cubeMats.forEach((m, i) => m.color.set(i === cubeHover ? 0xa9d6b4 : CUBE_SHADE[i]));
  cubeRenderer.render(cubeScene, cubeCam);
}

function cubeFaceAt(e) {
  const r = cubeCanvas.getBoundingClientRect();
  cubeNdc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  cubeRay.setFromCamera(cubeNdc, cubeCam);
  const hit = cubeRay.intersectObject(cube, false)[0];
  return hit ? hit.face.materialIndex : -1;
}

function orbitBy(dTheta, dPhi) {
  anim = null; controls.enableDamping = true;
  const s = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
  s.theta += dTheta;
  s.phi = clamp(s.phi + dPhi, 0.001, Math.PI - 0.001);
  camera.position.setFromSpherical(s).add(controls.target);
  camera.lookAt(controls.target);
}

cubeCanvas.addEventListener('pointerdown', e => {
  cubeDrag = { x: e.clientX, y: e.clientY, moved: false };
  cubeCanvas.setPointerCapture(e.pointerId);
});
cubeCanvas.addEventListener('pointermove', e => {
  if (cubeDrag) {
    const dx = e.clientX - cubeDrag.x, dy = e.clientY - cubeDrag.y;
    if (!cubeDrag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    cubeDrag.moved = true; cubeHover = -1;
    cubeCanvas.style.cursor = 'grabbing';
    orbitBy(-dx * 0.012, -dy * 0.012);
    cubeDrag.x = e.clientX; cubeDrag.y = e.clientY;
    return;
  }
  cubeHover = cubeFaceAt(e);
  cubeCanvas.style.cursor = cubeHover >= 0 ? 'pointer' : 'grab';
});
cubeCanvas.addEventListener('pointerup', e => {
  if (cubeDrag && !cubeDrag.moved) {
    const f = cubeFaceAt(e);
    if (f >= 0) goToView(CUBE_FACES[f].view);
  }
  cubeDrag = null;
  cubeCanvas.style.cursor = 'grab';
});
cubeCanvas.addEventListener('pointerleave', () => { if (!cubeDrag) cubeHover = -1; });
leafToggle.addEventListener('click', toggleLeaves);
addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.target.tagName === 'INPUT') return;
  if (e.key === 'h' || e.key === 'H' || e.key === 'Home') goToView('home');
  if (e.key === 'f' || e.key === 'F') toggleLeaves();
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  R.resize();
});

// ---------- Poda ----------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const dirOf = n => new THREE.Vector3(...n.dir);

// devolve o galho sob o mouse e em que ponto dele (t = 0 na base, 1 na ponta)
function pick(e) {
  ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects([pickMesh, rootPick], false)[0];
  if (!hit) return null;
  if (hit.object === rootPick) return { root: roots[hit.instanceId].r, n: roots[hit.instanceId].n, point: hit.point.clone() };
  const n = nodes[hit.instanceId];
  if (n.len < 1) return null;   // broto recém-saído da semente: nada para podar ainda
  const t = n.len > 0 ? clamp(hit.point.clone().sub(n._s).dot(dirOf(n)) / n.len, 0, 1) : 1;
  return { n, t };
}

// decide o que um corte nesse ponto remove
function planCut(hit) {
  if (hit.root) return { hit, n: hit.n, root: hit.root, removed: new Set() };
  const { n, t } = hit;
  // galho inteiro: sobe até onde o galho sai do eixo-mãe e corta rente ali (o tronco não sai inteiro)
  if (tool === 'branch') {
    const base = branchBase(n);
    if (base._p) return { hit, n: base, parent: base._p, whole: true, flush: true, removed: collect(base, new Set()) };
  }
  const parent = findParent(state.root, n);
  if (parent && n.len * t < 2) return { hit, n, parent, whole: true, removed: collect(n, new Set()) };
  const removed = new Set();
  for (const k of n.kids) collect(k, removed);
  return { hit, n, parent, whole: false, keep: Math.max(n.len * t, n.depth === 0 ? 5 : 2), removed };
}

function placeMarker(plan) {
  if (plan.root) {   // anel horizontal em volta da raiz, no ponto clicado
    marker.position.copy(plan.hit.point);
    marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), UP);
    marker.scale.setScalar(Math.max(plan.root.girth * 1.6, 2));
    return;
  }
  const n = plan.n, dir = dirOf(n);
  marker.position.copy(n._s).addScaledVector(dir, plan.whole ? 0 : Math.min(plan.keep, n.len));
  marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  marker.scale.setScalar(Math.max(radius(n) * 1.5, 2.5));
}

function setHover(hit) {
  const plan = hit ? planCut(hit) : null;
  const changed = plan?.n !== hoverPlan?.n || plan?.whole !== hoverPlan?.whole || plan?.root !== hoverPlan?.root;
  hoverPlan = plan;
  marker.visible = !!plan;
  if (plan) placeMarker(plan);
  renderer.domElement.style.cursor = plan ? 'pointer' : 'default';
  const size = plan ? plan.removed.size : 0;
  hint.textContent = !plan ? HINT_FOR()
    : plan.root ? (plan.root.grounded ? 'Cortar esta raiz-pilar' : 'Cortar esta raiz aérea')
    : plan.flush ? `Remover o galho inteiro · corte rente · ${size} ${size === 1 ? 'ramo' : 'ramos'}`
    : plan.whole ? `Remover este ramo inteiro${size > 1 ? ` (${size} ramos)` : ''} · sem bifurcação`
    : `Encurtar aqui${size ? ` · remove ${size} ${size === 1 ? 'ramo' : 'ramos'}` : ''} · o toco solta 2 brotos (Y)`;
  if (changed) { hoverSet = plan ? plan.removed : new Set(); colorBranches(); }
}

// facilidade de brotar conforme a idade do segmento: 1 em ramo novo, SP.apical.oldWood em madeira velha
function budVigor(n) {
  const a = SP.apical;
  return lerp(1, a.oldWood, clamp((n.age - a.matureDays) / (a.oldDays - a.matureDays), 0, 1));
}

// Volta da dominância: as pontas novas (Y) produzem auxina de novo e as gemas acordadas pela poda que
// ainda não brotaram voltam a dormir; mais perto, mais forte. Em toco grosso (poda forte) a raiz manda
// mais citocinina para pouca copa e a inibição é mais fraca: brotação múltipla continua possível.
function reinhibit(start) {
  const a = SP.apical, strength = a.reinhibit * lerp(1, 0.4, clamp((start.girth * 0.95 - 2) / 6, 0, 1));
  let dist = 0;
  for (let cur = start; cur && dist <= a.reach; dist += cur.len, cur = cur._p) {
    const p = strength * Math.exp(-dist / a.decay);
    for (let i = cur.buds; i > 0; i--) if (Math.random() < p) cur.buds--;
  }
}

// Libera a dominância apical: descendo pelo galho a partir de `start` (em direção à base),
// cada nó pode ganhar uma gema que vai brotar; mais perto do corte/dobra, mais provável.
// Devolve quantas gemas acordaram.
// perNode: no máximo quantas gemas cada nó ganha · once: cada nó aramado responde uma vez só (dobra)
function releaseApical(start, strength, { perNode = 4, once = false } = {}) {
  const a = SP.apical;
  let woke = 0, dist = 0;
  for (let cur = start; cur && dist <= a.reach; dist += cur.len, cur = cur._p) {
    if (once && cur.wire) { if (cur.wire.woke) continue; cur.wire.woke = true; }
    // valor esperado de gemas neste nó (pode passar de 1 perto do corte); cai com a distância e a idade da madeira.
    // Trechos divididos para o arame (lf < 1) são pedaços do mesmo entrenó: repartem a chance do nó
    const expected = strength * Math.exp(-dist / a.decay) * budVigor(cur) * (cur.lf ?? 1);
    const n = Math.floor(expected) + (Math.random() < expected % 1 ? 1 : 0);
    const add = Math.min(n, perNode, 4 - cur.buds);
    if (add > 0) { cur.buds += add; woke += add; }
  }
  return woke;
}

// galho grosso removido rente deixa uma ferida do tamanho da base dele, que o calo fecha aos poucos
function addWound(p, removed) {
  const r = radius(removed);
  if (removed.girth < SP.thickening.woundFrom) return;
  (p.wounds ??= []).push({ r, r0: r, dir: [...removed.dir] });
  if (r > radius(p) * 0.6) notify('bigWound', 'Corte grande! A cicatriz vai fechando conforme o tronco engrossa: com muita folha acima dela, fecha mais rápido.');
}

const forkPace = () => growthFactor(state.day) / SP.growthBySeason[0] * (waterGrowth() > 0 ? 1 : 0);
// toco de um ramo encurtado: as duas gemas do topo abrem juntas (Y); corte forte acorda gemas extras
function scheduleFork(n, hard) {
  const f = SP.fork;
  if (Math.random() < f.chance * lerp(f.oldWood, 1, budVigor(n))) {
    n.fork = rand(...f.days);
    n.buds = Math.min(4, n.buds + Math.round(2 * hard));
  } else n.buds = Math.min(4, n.buds + 1 + Math.round(2 * hard));   // não bifurcou: brota uma gema só
}

function cut(plan, { undo = true } = {}) {
  if (undo) pushUndo();
  const amt = leafAmount(state.day);
  let removedLeaves = 0;
  for (const l of leaves) if (plan.removed.has(l.n) && leafVisible(l, amt)) { spawnLeaf(l.pos, leafColor(l.n, l.k, state.day), l.len); removedLeaves++; }
  // choque de poda: proporcional à fração da folhagem removida
  const visibleLeaves = leaves.filter(l => leafVisible(l, amt)).length;
  if (visibleLeaves) state.recovery = Math.max(0.15, state.recovery - SP.pruneShock * removedLeaves / visibleLeaves);
  if (plan.root) {
    plan.n.aerial.splice(plan.n.aerial.indexOf(plan.root), 1);
  } else if (plan.flush) {
    // corte rente com acabamento (alicate côncavo): sem toco, a ferida fecha no colar do galho
    // e quase não brota ali; o eixo-mãe segue crescendo pela ponta
    const p = plan.parent;
    p.kids.splice(p.kids.indexOf(plan.n), 1);
    addWound(p, plan.n);
    releaseApical(p, SP.apical.prune * 0.2);
  } else if (plan.whole) {
    const p = plan.parent;
    const wasApex = p.kids[0] === plan.n;    // cortou a continuação (ponta) do galho, ou só um lateral?
    p.kids.splice(p.kids.indexOf(plan.n), 1);
    if (!wasApex) addWound(p, plan.n);
    if (wasApex) {
      p.stopped = true;                      // a gema da ponta foi removida...
      if (!p.kids.length) scheduleFork(p, clamp(plan.removed.size / SP.apical.hardCut, 0, 1));   // ...o toco bifurca
      else {
        // corte logo acima de um nó com lateral: o lateral vira a nova ponta (assume a dominância)
        // e a gema daquela axila já foi usada; às vezes uma gema acessória ainda rompe
        if (Math.random() < 0.3) p.buds = Math.min(4, p.buds + 1);
      }
    } else if (Math.random() < 0.5) p.buds = Math.min(4, p.buds + 1);   // tirar um lateral às vezes acorda a gema acessória
    // a liberação começa no nó de baixo (o do corte já foi tratado acima). Tirar a ponta de um toco sem
    // laterais libera conforme a força do corte; se um lateral assumiu a ponta, ou se só um lateral saiu, quase nada
    const hard = clamp(plan.removed.size / SP.apical.hardCut, 0, 1);
    releaseApical(p._p, SP.apical.prune * (wasApex && !p.kids.length ? lerp(SP.apical.pinch, 1, hard) : 0.1));
  } else {
    // corta o galho no ponto escolhido; o toco fica e solta brotos novos
    const n = plan.n;
    const rCut = radiusAt(n, Math.min(plan.keep, n.len) / Math.max(n.len, 0.01));   // espessura no ponto do corte
    n.len = n.target = Math.min(plan.keep, n.len);
    n.kids = [];
    // toco grosso: fica a superfície do corte (madeira clara), que o calo fecha conforme os brotos novos engrossam
    if (n.girth >= SP.thickening.woundFrom) (n.wounds ??= []).push({ r: rCut, r0: rCut, dir: [...n.dir] });
    n.aerial = n.aerial.filter(r => r.d <= n.len);   // raízes acima do corte saem junto
    n.stopped = true;
    // beliscar a ponta (tirar só o crescimento novo) solta 1–2 brotos; um corte forte, de muitos ramos, solta mais
    const hard = clamp(plan.removed.size / SP.apical.hardCut, 0, 1);
    scheduleFork(n, hard);
    releaseApical(n._p, SP.apical.prune * lerp(SP.apical.pinch, 1, hard));   // sem a ponta, as gemas abaixo acordam
  }
  state.cuts++;
  setHover(null);
  rebuild(); updateHud();
  if (state.cuts === 1 && !plan.root) toast((SP.firstCutNote ? SP.firstCutNote + ' ' : '') + 'Galho podado! Sem a ponta, a auxina deixa de segurar as gemas: vão brotar ramos no corte e ao longo do galho, até na madeira velha.');
  save();
}

// ---------- Desfazer ----------
const undoStack = [];
const undoBtn = document.getElementById('undo');
function pushUndo() {
  undoStack.push({ health: state.health, dead: state.dead, deathCause: state.deathCause, name: state.name, day: state.day, cuts: state.cuts, origin: state.origin, germ: state.germ, recovery: state.recovery,
    container: state.container, rootMass: state.rootMass, root: ser(state.root) });
  if (undoStack.length > 30) undoStack.shift();
  undoBtn.disabled = false;
}
function undo() {
  const u = undoStack.pop();
  if (!u) return;
  Object.assign(state, { health: u.health ?? 1, dead: !!u.dead, deathCause: u.deathCause ?? null, name: u.name ?? state.name, day: u.day, cuts: u.cuts, origin: u.origin, germ: u.germ, recovery: u.recovery ?? 1,
    container: u.container ?? state.container, rootMass: u.rootMass ?? state.rootMass, root: de(u.root) });
  calcWidth(state.root);
  applyContainer();
  falling = []; prevLeafAmt = null;
  setHover(null); rebuild(); updateHud(); updateCare(); save();
  deathCard.hidden = !state.dead;
  undoBtn.disabled = !undoStack.length;
}
undoBtn.addEventListener('click', undo);
addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && e.target.tagName !== 'INPUT') { e.preventDefault(); undo(); } });

// um clique sem arrastar poda; arrastar gira a câmera
const hint = document.getElementById('hint');
hint.textContent = HINT;
const el = renderer.domElement;
let down = null;
// (os eventos do mouse ficam mais abaixo, depois da ferramenta de arame)

// ---------- Popup de medidas ----------
// Um "galho" é a sequência de segmentos que continua pela ponta principal (kids[0]);
// subindo por ela chegamos à base do galho, ou ao colo do tronco.
const tipEl = document.getElementById('tip');
function branchBase(n) {
  let cur = n;
  while (cur._p && cur._p.kids[0] === cur) cur = cur._p;
  return cur;
}
function branchLength(base) {
  let len = 0;
  for (let cur = base; cur; cur = cur.kids[0]) len += cur.len;
  return len;
}
function showTip(hit, e) {
  if (!hit) { tipEl.hidden = true; return; }
  let html;
  if (hit.root) {
    const r = hit.root;
    html = `<div class="t">${r.grounded ? 'Raiz-pilar' : 'Raiz aérea'}</div>⌀ <b>${fmtLength(r.girth * 2)}</b>`
      + `<div class="m">${r.grounded ? 'apoiada na terra' : `pendurada · ${fmtLength(r.len)}`}</div>`;
  } else {
    const base = branchBase(hit.n);
    const here = fmtLength(radiusAt(hit.n, hit.t) * 2);
    html = base === state.root
      ? `<div class="t">Tronco</div>⌀ na base <b>${fmtLength(radius(state.root) * 2)}</b><div class="m">⌀ neste ponto ${here}</div>`
      : `<div class="t">Galho</div>⌀ na base do galho <b>${fmtLength(radius(base) * 2)}</b>`
        + `<div class="m">⌀ neste ponto ${here} · comprimento ${fmtLength(branchLength(base))}</div>`;
    const w = (hit.n.wounds ?? []).concat(hit.n._p?.wounds ?? [])[0];
    if (w) html += `<div class="m">cicatriz de ${fmtLength(w.r0 * 2)} · ${Math.round(100 * (1 - w.r / w.r0))}% fechada</div>`;
  }
  tipEl.innerHTML = html;
  tipEl.hidden = false;
  const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  tipEl.style.left = `${e.clientX + 16 + w > innerWidth ? e.clientX - w - 12 : e.clientX + 16}px`;
  tipEl.style.top = `${e.clientY + 16 + h > innerHeight ? e.clientY - h - 12 : e.clientY + 16}px`;
}
function placeTip(e) {
  const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  tipEl.style.left = `${e.clientX + 16 + w > innerWidth ? e.clientX - w - 12 : e.clientX + 16}px`;
  tipEl.style.top = `${e.clientY + 16 + h > innerHeight ? e.clientY - h - 12 : e.clientY + 16}px`;
}

// ---------- Arame ----------
// Dobrar = girar a direção do segmento (e de tudo que sai dele) em torno da sua base.
// wire.q acumula a rotação aplicada desde que o arame foi colocado: é a "curvatura" que o galho está aguentando.
const lignin = n => clamp(n.age / SP.wiring.lignifyDays, 0, 1);   // 0 = ramo verde, 1 = madeira
// espessura em que o arame começa a marcar a casca: um broto recém-formado ainda expande até o diâmetro
// de ramo novo (crescimento primário, ~1,2 mm) sem marcar; daí em diante conta o engrossamento da madeira
const PRIMARY_GIRTH = 1.3;
const wireBiteAt = w => { const g = Math.max(w.girth0, PRIMARY_GIRTH); return g + Math.max(0.65, g * SP.wiring.bite); };
function bendLimit(n) {   // graus de curvatura seguros para este segmento
  const w = SP.wiring, woody = w.woodyLimit / (1 + n.girth * 0.95 / 4);
  return lerp(w.greenLimit, woody, lignin(n)) * (seasonOf(state.day) === 3 ? w.winterFactor : 1);
}
const wireQuat = n => new THREE.Quaternion(...(n.wire?.q ?? [0, 0, 0, 1]));
const bendAngle = n => n.wire ? THREE.MathUtils.radToDeg(2 * Math.acos(clamp(Math.abs(n.wire.q[3]), 0, 1))) : 0;
const woodLabel = n => { const l = lignin(n); return l < 0.35 ? 'ramo verde' : l < 1 ? 'lignificando' : 'lenhoso'; };
const wireProgress = n => n.wire ? wireProgressOf(n.wire) : 0;
// quanto um dia conta para fixar: 1 na primavera e no verão, metade no outono, quase nada no inverno
const setActivity = () => Math.min(1, growthFactor(state.day) / SP.growthBySeason[1]);
// dias de crescimento para este trecho fixar: verde fixa mais rápido; galhos grossos demoram um pouco mais
function wireSetDays(n) {
  const w = SP.wiring;
  return Math.round(lerp(w.setGreen, w.setWoody, lignin(n)) + w.setThick * clamp((n.girth * 0.95 - 5) / 15, 0, 1));
}
function rotateSubtree(n, q) {
  const v = new THREE.Vector3();
  (function rot(x) { v.set(...x.dir).applyQuaternion(q).normalize(); x.dir = [v.x, v.y, v.z]; x.kids.forEach(rot); })(n);
}
function chainOf(n) {   // o galho inteiro: da base, seguindo a ponta principal
  const chain = [];
  for (let cur = branchBase(n); cur; cur = cur.kids[0]) chain.push(cur);
  return chain;
}

let tool = 'prune', toolSpeed = null;
// galhos selecionados no modo arame (Shift+clique junta vários); wireChain = todos os segmentos deles
let wireBases = [], wireChain = [], wireSet = new Set(), drag = null, treeDirty = false;
const WIRE_SELECT = [110, 160, 215];

// Pontos de controle: o jogador escolhe quantos (wireHandleN); eles se espalham por igual ao longo do galho.
// Cada ponto fica numa articulação; arrastá-lo gira o trecho entre o ponto anterior (pivô) e ele.
// Se faltarem articulações, os entrenós são divididos (splitNode).
let wireHandleN = 5;
const MAX_HANDLES = 24;
const handleGroup = new THREE.Group();
handleGroup.renderOrder = 20;
scene.add(handleGroup);
const handleGeo = new THREE.SphereGeometry(1, 16, 12);
function refreshHandles() {
  for (const m of handleGroup.children) m.material.dispose();
  handleGroup.clear();
  hoverHandle = null;
  // galhos cortados ou quebrados saem da seleção; dois cliques no mesmo galho não duplicam
  wireBases = [...new Set(wireBases.filter(b => nodes.includes(b)).map(branchBase))];
  wireChain = []; wireSet = new Set();
  for (const base of wireBases) {
    const chain = chainOf(base);
    wireChain.push(...chain);
    chain.forEach(n => wireSet.add(n));
    addHandles(chain);
  }
  colorHandles();
  renderWirePanel();
}
// articulações = fim de cada trecho; escolhe as N mais próximas de posições igualmente espaçadas
function addHandles(chain) {
  let acc = 0;
  const ends = chain.filter(n => n._e && n.len >= 0.5).map(n => ({ n, at: (acc += n.len) }));
  const N = Math.min(wireHandleN, ends.length), picked = [];
  for (let i = 1; i <= N; i++) {
    const target = acc * i / N, after = picked.length ? picked[picked.length - 1].at : -1;
    let best = null;
    for (const e of ends) if (e.at > after && (!best || Math.abs(e.at - target) < Math.abs(best.at - target))) best = e;
    if (best) picked.push(best);
  }
  let prev = -1;
  for (const e of picked) {
    const end = chain.indexOf(e.n);
    const m = new THREE.Mesh(handleGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.95 }));
    m.renderOrder = 20;
    m.position.copy(e.n._e);
    m.userData = { node: e.n, pivot: chain[prev + 1], from: prev + 1, to: end, chain };
    handleGroup.add(m);
    prev = end;
  }
}
// garante pelo menos `want` articulações em cada galho selecionado, dividindo os trechos mais longos ao meio
function ensureJoints(want) {
  let changed = false;
  for (const base of wireBases) {
    let chain = chainOf(base);
    while (chain.length < want) {
      const longest = chain.reduce((a, n) => n.len > a.len ? n : a);
      if (!splitNode(longest, 2)) break;
      changed = true;
      chain = chainOf(base);
    }
  }
  return changed;
}
function setHandleCount(n) {
  wireHandleN = clamp(n, 1, MAX_HANDLES);
  if (ensureJoints(wireHandleN)) { pushUndo(); rebuild(); save(); }
  else refreshHandles();
}
// pontos por galho (com vários galhos selecionados, todos usam a mesma quantidade)
const handlesPerBranch = () => wireBases.length ? Math.round(handleGroup.children.length / wireBases.length) : 0;
function stressColor(n) {
  const s = bendAngle(n) / bendLimit(n);
  return s < 0.8 ? 0x5fbf72 : s <= 1 ? 0xe2b545 : 0xe0453a;
}
let hoverHandle = null;
function colorHandles() {
  for (const m of handleGroup.children) {
    const p = m.userData.pivot;
    m.material.color.set(drag?.n === p ? stressColor(p) : m === hoverHandle ? 0xffd36b : p.wire ? stressColor(p) : 0xffffff);
  }
}
// direção da corda do trecho (do início do pivô até o fim do ponto), calculada pelas direções atuais
function spanDir(chain, from, to) {
  const v = new THREE.Vector3();
  for (let i = from; i <= to; i++) v.addScaledVector(dirOf(chain[i]), chain[i].len);
  return v.normalize();
}
function scaleHandles() {   // tamanho constante na tela
  for (const m of handleGroup.children) m.scale.setScalar(camera.position.distanceTo(m.position) * 0.009);
}
function pickHandle(e) {
  ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  return raycaster.intersectObjects(handleGroup.children, false)[0]?.object ?? null;
}

// add = true (Shift): junta o galho à seleção, ou tira se ele já estava selecionado
function selectBranch(n, add = false) {
  const base = n ? branchBase(n) : null;
  if (!add) wireBases = base ? [base] : [];
  else if (base) wireBases = wireBases.includes(base) ? wireBases.filter(b => b !== base) : [...wireBases, base];
  refreshHandles();
  colorBranches();
}

function startDrag(h) {
  pushUndo();
  const { pivot: n, from, to, node: end, chain } = h.userData;
  // o arame cobre todo o trecho; a curvatura (q) fica no pivô, onde o trecho dobra
  const w = SP.wiring;
  for (let i = from; i <= to; i++) {
    const x = chain[i];
    if (!x.wire) x.wire = { day: state.day, girth0: x.girth, q: [0, 0, 0, 1], set: wireSetDays(x), prog: 0, bitten: false };
  }
  drag = { n, from, to, chain, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), end._e.clone()) };
  controls.enabled = false;
}
function moveDrag(e) {
  ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const p = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(drag.plane, p)) return;
  const n = drag.n, want = p.sub(n._s);
  if (want.length() < 1) return;
  const R = new THREE.Quaternion().setFromUnitVectors(spanDir(drag.chain, drag.from, drag.to), want.normalize());
  rotateSubtree(n, R);
  n.wire.q = wireQuat(n).premultiply(R).toArray();
  treeDirty = true;
  showBendTip(n, e);
}
function endDrag() {
  const n = drag.n, { from, to, chain } = drag;
  drag = null;
  controls.enabled = true;
  tipEl.hidden = true;
  const stress = bendAngle(n) / bendLimit(n);
  if (stress > 1) {
    const risk = clamp((stress - 1) * SP.wiring.breakSlope, 0, 0.95);
    if (Math.random() < risk) {
      // quebrou na dobra: o galho cai (o tronco quebra no meio)
      cut(planCut(n._p ? { n, t: 0 } : { n, t: 0.5 }), { undo: false });
      toast(`Crack! O ${n._p ? 'galho' : 'tronco'} quebrou na dobra (${Math.round(bendAngle(n))}° para um limite de ~${Math.round(bendLimit(n))}°). Use Desfazer para voltar.`);
      refreshHandles();   // o pedaço quebrado sai da seleção; os outros galhos continuam selecionados
      return;
    }
    n.scar = true;
    state.recovery = Math.max(0.15, state.recovery - SP.wiring.crackShock);
    toast('Estalo! A casca rachou na curva, mas o galho aguentou. Vai ficar uma cicatriz.');
  }
  // galho deitado (horizontal ou para baixo): a auxina deixa de descer bem e as gemas do trecho acordam.
  // Só conta quando o galho deita mais do que já tinha deitado com este arame.
  const a = SP.apical, lying = THREE.MathUtils.radToDeg(spanDir(chain, from, to).angleTo(UP));
  if (lying > Math.max(a.bendFrom, (n.wire.lowest ?? 0) + 10)) {
    // dobrar de novo não acumula: cada nó aramado responde uma vez, com no máximo uma gema
    const woke = releaseApical(chain[to], a.bend * clamp((lying - a.bendFrom) / a.bendFull, 0, 1), { perNode: 1, once: true });
    n.wire.lowest = lying;
    if (woke) toast(`Galho deitado a ${Math.round(lying)}° da vertical: a dominância da ponta enfraqueceu e ${woke} ${woke === 1 ? 'gema vai' : 'gemas vão'} brotar ao longo dele.`);
  }
  rebuild(); save();
}

function removeWires(chain) {
  let back = 0;
  for (const n of chain) {
    if (!n.wire) continue;
    // o que ainda não fixou volta: desfaz parte da rotação
    const spring = (1 - wireProgress(n)) * SP.wiring.springBack;
    if (spring > 0.01) { rotateSubtree(n, new THREE.Quaternion().slerp(wireQuat(n).invert(), spring)); back = Math.max(back, spring); }
    n.wire = null;
  }
  state.flags.wirebite = false;
  rebuild(); save();
  toast(back > 0.05 ? `Arame removido. O galho ainda não tinha fixado e voltou ~${Math.round(back * 100)}% da curva.`
    : 'Arame removido. O galho manteve a nova forma.');
}

function removeAllWires() {
  const wired = nodes.filter(n => n.wire);
  if (!wired.length) return;
  pushUndo();
  removeWires(wired);
}

function showBendTip(n, e) {
  const a = bendAngle(n), lim = bendLimit(n), s = a / lim;
  const risk = s > 1 ? Math.round(clamp((s - 1) * SP.wiring.breakSlope, 0, 0.95) * 100) : 0;
  tipEl.innerHTML = `<div class="t">Curvatura ${Math.round(a)}° · limite ~${Math.round(lim)}°</div>`
    + `<div class="m">${woodLabel(n)} · ⌀ ${fmtLength(radius(n) * 2)}</div>`
    + `<div>${s < 0.8 ? '✅ seguro' : s <= 1 ? '⚠️ no limite' : `❌ risco de quebra ${risk}%`}</div>`;
  tipEl.hidden = false;
  placeTip(e);
}
function showWireHoverTip(hit, e) {
  if (!hit || hit.root) { tipEl.hidden = true; return; }
  const n = hit.n;
  tipEl.innerHTML = `<div class="t">${branchBase(n) === state.root ? 'Tronco' : 'Galho'} · ${woodLabel(n)}</div>`
    + `<div class="m">⌀ ${fmtLength(radiusAt(n, hit.t) * 2)} · curvatura segura ~${Math.round(bendLimit(n))}°</div>`
    + `<div class="m">clique para selecionar e mostrar os pontos</div>`;
  tipEl.hidden = false;
  placeTip(e);
}

// espirais do arame em volta dos segmentos aramados
const MAX_COILS = 4000;
const coilMesh = new THREE.InstancedMesh(new THREE.TorusGeometry(1, 0.16, 6, 18),
  new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.6 }), MAX_COILS);
coilMesh.frustumCulled = false; coilMesh.castShadow = true;
coilMesh.count = 0;
scene.add(coilMesh);
const COIL = [176, 120, 72], COIL_BITTEN = [120, 70, 50];
function updateCoils() {
  let k = 0;
  const z = new THREE.Vector3(0, 0, 1), tilt = new THREE.Quaternion();
  for (const n of nodes) {
    if (!n.wire || n.len < 1) continue;
    const dir = dirOf(n), r0 = radius(n);
    const count = clamp(Math.round(n.len / Math.max(2.5, r0 * 1.6)), 2, 40);
    const base = new THREE.Quaternion().setFromUnitVectors(z, dir);
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(base);
    tilt.setFromAxisAngle(side, 0.38);   // inclinação da espiral
    for (let i = 0; i < count && k < MAX_COILS; i++, k++) {
      const t = (i + 0.5) / count;
      tmp.position.copy(n._s).addScaledVector(dir, n.len * t);
      tmp.quaternion.copy(tilt).multiply(base);
      tmp.scale.setScalar(radiusAt(n, t) * 1.06 + 0.25);
      tmp.updateMatrix(); coilMesh.setMatrixAt(k, tmp.matrix);
      setColor(coilMesh, k, n.wire.bitten ? COIL_BITTEN : COIL);
    }
  }
  coilMesh.count = k;
  coilMesh.instanceMatrix.needsUpdate = true;
  if (coilMesh.instanceColor) coilMesh.instanceColor.needsUpdate = true;
}

// painel do galho selecionado
const wirePanel = document.getElementById('wirePanel');
function renderWirePanel() {
  if (tool !== 'wire') { wirePanel.hidden = true; return; }
  const allWired = nodes.filter(n => n.wire);
  const removeAllBtn = allWired.length ? '<button id="wireRemoveAll" title="Tira o arame de todos os galhos da árvore">Remover todos os arames</button>' : '';
  if (!wireBases.length) {
    // sem galho selecionado: só o resumo da árvore e o botão de remover tudo
    if (!allWired.length) { wirePanel.hidden = true; return; }
    const trechos = allWired.length, bitten = allWired.some(n => n.wire.bitten);
    wirePanel.innerHTML = `<div><b>Arames na árvore</b> · ${trechos} ${trechos === 1 ? 'trecho aramado' : 'trechos aramados'}`
      + (bitten ? ' · <span class="warn">⚠️ algum arame está marcando a casca</span>' : '') + '</div>'
      + `<div class="row">${removeAllBtn}</div>`;
    wirePanel.hidden = false;
    document.getElementById('wireRemoveAll').addEventListener('click', removeAllWires);
    return;
  }
  if (wireBases.length > 1) { renderMultiPanel(removeAllBtn); return; }
  const base = wireBases[0], wired = wireChain.filter(n => n.wire);
  let status = 'Sem arame. Arraste um ponto para dobrar: o arame é colocado no trecho dobrado.';
  if (wired.length) {
    const oldest = wired.reduce((a, n) => n.wire.day < a.wire.day ? n : a);
    const days = state.day - oldest.wire.day, p = wireProgress(oldest);
    const bitten = wired.some(n => n.wire.bitten);
    const left = Math.max(0, (wireBiteAt(oldest.wire) - oldest.girth) * 0.95);
    // dias que faltam no ritmo de crescimento de agora (no inverno a fixação quase para)
    const act = setActivity(), left2 = Math.ceil((1 - p) * oldest.wire.set / Math.max(act, 0.05));
    status = `Arame há ${days} dias · forma ${p >= 1 ? '<b>fixada</b>: pode remover'
      : `${Math.round(p * 100)}% fixada (~${left2} dias${act < 0.5 ? ', lenta fora da estação de crescimento' : ''})`}`
      + (bitten ? ' · <span class="warn">⚠️ marcando a casca: remova!</span>'
        : ` · marca a casca se engrossar mais ${fmtLength(left)}`);
  }
  wirePanel.innerHTML = `<div><b>${base === state.root ? 'Tronco' : 'Galho'}</b> · ${woodLabel(base)} · ⌀ base ${fmtLength(radius(base) * 2)}`
    + ` · curvatura segura ~${Math.round(bendLimit(base))}° na base${wireChain.some(n => n.scar) ? ' · tem cicatriz' : ''}</div>`
    + `<div class="m">${status}</div>`
    + `<div class="m">Shift+clique em outro galho para selecionar vários</div>`
    + `<div class="row"><span class="pts">Pontos de controle
         <button id="ptsMinus" title="Menos pontos (trechos maiores)">−</button><b>${handleGroup.children.length}</b>
         <button id="ptsPlus" title="Mais pontos (divide os entrenós se precisar)">+</button></span>`
    + `${wired.length ? '<button id="wireRemove">Remover arame</button>' : ''}${removeAllBtn}<button id="wireClose">Fechar</button></div>`;
  wirePanel.hidden = false;
  bindWirePanel();
}
// vários galhos selecionados: resumo de cada um e ações que valem para todos
function renderMultiPanel(removeAllBtn) {
  const wired = wireChain.filter(n => n.wire);
  const rows = wireBases.map(b => {
    const ch = chainOf(b), w = ch.filter(n => n.wire);
    const p = w.length ? Math.min(...w.map(wireProgress)) : 0;
    return `<li>${b === state.root ? 'Tronco' : 'Galho'} · ${woodLabel(b)} · ⌀ ${fmtLength(radius(b) * 2)} · `
      + (w.length ? (p >= 1 ? 'arame <b>fixado</b>' : `arame ${Math.round(p * 100)}% fixado`) + (w.some(n => n.wire.bitten) ? ' <span class="warn">⚠️ marcando</span>' : '') : 'sem arame')
      + '</li>';
  }).join('');
  wirePanel.innerHTML = `<div><b>${wireBases.length} galhos selecionados</b> · arraste os pontos de cada um para dobrar</div>`
    + `<ul class="m">${rows}</ul>`
    + `<div class="m">Shift+clique num galho selecionado para tirá-lo da seleção</div>`
    + `<div class="row"><span class="pts">Pontos por galho
         <button id="ptsMinus" title="Menos pontos (trechos maiores)">−</button><b>${handlesPerBranch()}</b>
         <button id="ptsPlus" title="Mais pontos (divide os entrenós se precisar)">+</button></span>`
    + `${wired.length ? '<button id="wireRemove">Remover arame dos selecionados</button>' : ''}${removeAllBtn}<button id="wireClose">Fechar</button></div>`;
  wirePanel.hidden = false;
  bindWirePanel();
}
function bindWirePanel() {
  const per = handlesPerBranch();
  document.getElementById('ptsMinus').addEventListener('click', () => setHandleCount(per - 1));
  document.getElementById('ptsPlus').addEventListener('click', () => setHandleCount(per + 1));
  document.getElementById('wireRemove')?.addEventListener('click', () => { pushUndo(); removeWires(wireChain); });
  document.getElementById('wireRemoveAll')?.addEventListener('click', removeAllWires);
  document.getElementById('wireClose').addEventListener('click', () => selectBranch(null));
}

const toolBtns = { prune: document.getElementById('toolPrune'), branch: document.getElementById('toolBranch'), wire: document.getElementById('toolWire') };
function setTool(t) {
  if (t === tool) return;
  tool = t;
  for (const [k, b] of Object.entries(toolBtns)) b.classList.toggle('on', k === t);
  setHover(null); hoverSet = new Set(); selectBranch(null); tipEl.hidden = true;
  hint.textContent = HINT_FOR();
  // aramar com o tempo correndo é confuso: pausa ao entrar e retoma ao sair
  if (t === 'wire' && speed > 0) { toolSpeed = speed; setSpeed(0); toast('Modo arame: tempo pausado. Clique num galho e arraste os pontos para dobrar.'); }
  else if (t === 'wire') toast('Modo arame: clique num galho e arraste os pontos para dobrar.');
  if (t === 'prune' && toolSpeed) { setSpeed(toolSpeed); toolSpeed = null; }
}
toolBtns.prune.addEventListener('click', () => setTool('prune'));
toolBtns.branch.addEventListener('click', () => setTool(tool === 'branch' ? 'prune' : 'branch'));
toolBtns.wire.addEventListener('click', () => setTool(tool === 'wire' ? 'prune' : 'wire'));
addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.target.tagName === 'INPUT') return;
  if (e.key === 'a' || e.key === 'A') setTool(tool === 'wire' ? 'prune' : 'wire');
  if (e.key === 'p' || e.key === 'P') setTool('prune');
  if (e.key === 'r' || e.key === 'R') setTool(tool === 'branch' ? 'prune' : 'branch');
  if (e.key === 'Escape' && tool === 'wire') selectBranch(null);
  if (tool === 'wire' && wireBases.length && (e.key === '+' || e.key === '=')) setHandleCount(handlesPerBranch() + 1);
  if (tool === 'wire' && wireBases.length && e.key === '-') setHandleCount(handlesPerBranch() - 1);
});
const HINT_FOR = () => tool === 'wire'
  ? 'Arame: clique num galho · Shift+clique junta mais galhos · arraste os pontos para dobrar · + / − muda a quantidade de pontos · Esc solta · A volta à poda'
  : tool === 'branch'
  ? 'Galho inteiro: clique em qualquer ponto de um galho para removê-lo rente ao eixo · R ou ✂️ volta à poda normal'
  : HINT;

// ---------- Mouse ----------
// Poda: clique sem arrastar poda; arrastar gira a câmera; clique no vazio pausa.
// Arame: clique seleciona o galho; arrastar um ponto dobra; arrastar fora dos pontos gira a câmera.
el.addEventListener('pointerdown', e => {
  down = { x: e.clientX, y: e.clientY, b: e.button };
  if (tool === 'wire' && e.button === 0) {
    const h = pickHandle(e);
    if (h) {
      startDrag(h);
      e.stopImmediatePropagation();
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
    }
  }
}, { capture: true });   // antes da câmera, para ela não girar ao puxar um ponto
el.addEventListener('pointermove', e => {
  if (drag) { moveDrag(e); colorHandles(); return; }
  if (tool === 'wire') {
    const h = e.buttons ? null : pickHandle(e);
    if (h !== hoverHandle) { hoverHandle = h; colorHandles(); }
    const hit = h || e.buttons ? null : pick(e);
    const chain = hit && !hit.root ? chainOf(hit.n) : [];
    if (chain[0] !== [...hoverSet][0]) { hoverSet = new Set(chain); colorBranches(); }
    el.style.cursor = h ? 'grab' : hit ? 'pointer' : 'default';
    if (!h) showWireHoverTip(hit, e); else tipEl.hidden = true;
    return;
  }
  const hit = e.buttons ? null : pick(e);
  setHover(hit);
  showTip(hit, e);
});
el.addEventListener('pointerleave', () => { if (!drag) { setHover(null); hoverSet = new Set(); colorBranches(); tipEl.hidden = true; } });
el.addEventListener('pointerup', e => {
  if (drag) { endDrag(); down = null; return; }
  if (down && down.b === 0 && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) {
    const hit = pick(e);
    // Shift+clique junta (ou tira) um galho da seleção; Shift+clique no vazio não desfaz a seleção
    if (tool === 'wire') { if (!(e.shiftKey && !hit)) selectBranch(hit && !hit.root ? hit.n : null, e.shiftKey); }
    else if (hit) cut(planCut(hit));
    else togglePause();   // clique no vazio pausa (ou retoma) o tempo
  }
  down = null;
});

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 4500);
}

// ---------- Interface ----------
let speed = 7, lastSpeed = 7;
const speedBtns = [...document.querySelectorAll('[data-speed]')];
function setSpeed(v) {
  speed = v;
  if (v > 0) lastSpeed = v;
  speedBtns.forEach(b => b.classList.toggle('on', +b.dataset.speed === v));
}
function togglePause() {
  if (speed > 0) { setSpeed(0); toast('Tempo pausado. Clique no vazio de novo para continuar.'); }
  else { setSpeed(lastSpeed); toast(`Tempo retomado (${lastSpeed}×).`); }
  save();
}
speedBtns.forEach(b => b.addEventListener('click', () => setSpeed(+b.dataset.speed)));
const newMenu = document.getElementById('newMenu');
const plantName = document.getElementById('plantName');
// espécie da planta nova: o seletor só aparece quando o jogo tem mais de uma espécie
const speciesSelect = document.getElementById('speciesSelect');
speciesSelect.innerHTML = Object.values(SPECIES).map(s => `<option value="${s.id}">${s.scientific} (${s.common})</option>`).join('');
document.getElementById('speciesPick').hidden = Object.keys(SPECIES).length < 2;
// espécies que quase não formam sementes viáveis (ex.: serissa) só começam por muda
const seedBtn = newMenu.querySelector('[data-origin="seed"]');
function syncSeedButton() {
  const sp = SPECIES[speciesSelect.value], ok = sp.seeds !== false;
  seedBtn.disabled = !ok;
  seedBtn.title = ok ? '' : `${sp.name.article === 'a' ? 'A' : 'O'} ${sp.name.short} quase não forma sementes viáveis: comece pela muda (estaca enraizada)`;
  seedBtn.querySelector('small').textContent = ok ? 'Plante e acompanhe a germinação' : 'Esta espécie se propaga por estaca';
}
speciesSelect.addEventListener('change', syncSeedButton);
document.getElementById('reset').addEventListener('click', () => { plantName.value = state.name ?? ''; speciesSelect.value = state.species; syncSeedButton(); newMenu.hidden = !newMenu.hidden; });
plantName.addEventListener('input', () => { state.name = plantName.value.trim() || defaultName(state.origin); updateHud(); save(); });

// arquivos de planta: um .bonsai.json por planta, com nome e dia no nome do arquivo
const slug = t => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'planta';
document.getElementById('saveFile').addEventListener('click', () => {
  const data = { format: 'bonsai-simulador', version: 1, savedAt: new Date().toISOString(), ...saveData() };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  a.download = `${slug(state.name ?? 'planta')}-dia-${state.day + 1}.bonsai.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  newMenu.hidden = true;
  toast(`Planta "${state.name}" salva em ${a.download} (pasta de downloads).`);
});
const fileInput = document.getElementById('fileInput');
document.getElementById('openFile').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  fileInput.value = '';
  if (!file) return;
  newMenu.hidden = true;
  const prev = state;
  try {
    pushUndo();
    applySave(JSON.parse(await file.text()));
  } catch (e) {
    state = prev; undoStack.pop(); undoBtn.disabled = !undoStack.length;
    toast(`Não consegui abrir "${file.name}": não parece um arquivo de planta deste simulador.`);
    return;
  }
  applyContainer(); setSpeed(0);
  falling = []; drops = []; prevLeafAmt = null; setHover(null); selectBranch(null);
  rebuild(); updateHud(); updateCare(); renderSpecies(); save();
  deathCard.hidden = !state.dead;
  goToView('home');   // cada planta tem a sua frente
  toast(`Planta "${state.name}" carregada (dia ${state.day + 1}). Tempo pausado. Use Desfazer para voltar à anterior.`);
});
newMenu.querySelectorAll('[data-origin]').forEach(b => b.addEventListener('click', () => {
  newMenu.hidden = true; deathCard.hidden = true;
  pushUndo();
  newTree(b.dataset.origin === 'seed' && SPECIES[speciesSelect.value].seeds === false ? 'muda' : b.dataset.origin, speciesSelect.value);
  applyContainer();
  falling = []; drops = []; prevLeafAmt = null; setHover(null); rebuild(); updateHud(); updateCare(); save();
  toast(b.dataset.origin === 'seed'
    ? 'Semente plantada. Mantenha a terra úmida e ela germina em alguns dias. Use Desfazer para voltar à árvore anterior.'
    : 'Nova muda plantada. Use Desfazer para voltar à árvore anterior.');
}));

// morte: explica a causa e oferece recomeçar
const deathCard = document.getElementById('deathCard');
function showDeath() {
  speciesSelect.value = state.species;   // os botões do painel recomeçam com a mesma espécie
  document.getElementById('deathText').textContent = state.deathCause === 'seca'
    ? `A terra ficou seca por tempo demais. ${TheSp()} soltou as folhas para economizar água, mas as raízes secaram. Dica: ligue a rega automática ou regue quando o medidor de terra ficar laranja.`
    : 'A terra ficou encharcada por meses e as raízes apodreceram. Dica: regue só quando a terra começar a secar.';
  deathCard.hidden = false;
}
document.getElementById('deathOpen').addEventListener('click', () => { deathCard.hidden = true; fileInput.click(); });
document.getElementById('deathSeed').addEventListener('click', () => { deathCard.hidden = true; newMenu.querySelector(SP.seeds === false ? '[data-origin="muda"]' : '[data-origin="seed"]').click(); });
document.getElementById('deathMuda').addEventListener('click', () => { deathCard.hidden = true; newMenu.querySelector('[data-origin="muda"]').click(); });
document.getElementById('deathClose').addEventListener('click', () => deathCard.hidden = true);

// troca a espécie ativa: folhas com o formato dela e ficha atualizada
function applySpecies() {
  const geo = makeLeafGeo(SP.leaf.shape);
  leafMesh.geometry = fallMesh.geometry = geo;
  if (leafGeo !== geo) leafGeo.dispose();
  leafGeo = geo;
  renderSpecies();
}
// folhas por nó: alternadas = 1, opostas = 2; a ponta em crescimento tem uma a mais
const leavesAt = n => (SP.leaf.arrangement === 'opposite' ? 2 : 1) + (n.kids.length ? 0 : 1);
// ângulo entre as folhas do mesmo nó: espiral (ângulo áureo) ou frente a frente
const leafStep = () => SP.leaf.arrangement === 'opposite' ? Math.PI : 2.4;

// ficha da espécie
const speciesBtn = document.getElementById('speciesBtn');
const speciesCard = document.getElementById('speciesCard');
function renderSpecies() {
  speciesBtn.innerHTML = `<i>${SP.scientific}</i>`;
  speciesCard.innerHTML = `<h2><i>${SP.scientific}</i></h2>
    <p class="sub">${SP.common} · ${SP.family}</p>
    <p class="sub">Origem: ${SP.origin}</p>
    <ul>${SP.traits.map(t => `<li>${t}</li>`).join('')}</ul>`;
}
speciesBtn.addEventListener('click', () => speciesCard.hidden = !speciesCard.hidden);

// painel de cuidados
const autoWaterBox = document.getElementById('autoWater');
document.getElementById('btnWater').addEventListener('click', () => { water(); save(); });
document.getElementById('btnMist').addEventListener('click', () => { mist(); save(); });
autoWaterBox.addEventListener('change', () => { state.autoWater = autoWaterBox.checked; save(); });

// menu de transplante: lista os vasos com o efeito de cada um no crescimento
const potMenu = document.getElementById('potMenu');
function renderPotMenu() {
  potMenu.innerHTML = CONTAINER_ORDER.map(id => {
    const c = CONTAINERS[id], current = id === state.container;
    const size = c.volume === Infinity ? 'sem limite de raízes' : `${c.volume.toLocaleString('pt-BR')} L de substrato`;
    const prune = !current && c.volume !== Infinity && state.rootMass > c.volume * 0.85;
    return `<button data-pot="${id}" ${current ? 'disabled' : ''}>
      ${c.name}${current ? ' (atual)' : ''}
      <small>${size} · crescimento ${Math.round(c.growth * 100)}%</small>
      ${prune ? `<small class="warn">exige poda de raízes (~${Math.round((1 - c.volume * SP.roots.pruneKeep / state.rootMass) * 100)}%)</small>` : ''}
    </button>`;
  }).join('') + (seasonOf(state.day) === 3 ? '<small class="warn" style="padding:4px 10px">Inverno: o transplante agora tem o dobro do choque.</small>' : '');
  potMenu.querySelectorAll('[data-pot]').forEach(b => b.addEventListener('click', () => { potMenu.hidden = true; transplant(b.dataset.pot); }));
}
// menu de poda de raízes: mesmo vaso, intensidade à escolha
function renderRootMenu() {
  const fill = rootFill(), inGround = container().volume === Infinity;
  potMenu.innerHTML = `<small style="padding:4px 10px;color:var(--ui-muted)">Podar raízes e voltar ao mesmo vaso (${container().name})</small>`
    + ROOT_PRUNES.map(p => {
      const after = inGround ? '' : ` · vaso fica com ${Math.round(fill * (1 - p.frac) * 100)}% de raízes`;
      return `<button data-prune="${p.frac}">✂️ ${p.name} · corta ${Math.round(p.frac * 100)}%
        <small>${p.desc}${after}</small></button>`;
    }).join('')
    + (seasonOf(state.day) === 3 ? '<small class="warn" style="padding:4px 10px">Inverno: a poda agora tem o dobro do choque.</small>' : '')
    + (state.recovery < 0.7 ? '<small class="warn" style="padding:4px 10px">A árvore ainda se recupera de outro corte: o choque será maior.</small>' : '');
  potMenu.querySelectorAll('[data-prune]').forEach(b => b.addEventListener('click', () => { potMenu.hidden = true; pruneRoots(+b.dataset.prune); }));
}
let potMenuMode = 'pot';
// menu de lugar: quanto de luz cada um dá e o efeito nas folhas
function renderSpotMenu() {
  potMenu.innerHTML = `<small style="padding:4px 10px;color:var(--ui-muted)">Onde a planta fica (luz)</small>`
    + SPOT_ORDER.map(id => {
      const s = SPOTS[id], current = id === state.spot, dl = s.light - spot().light;
      const effect = s.light >= 0.9 ? 'folhas menores, entrenós curtos, cresce forte'
        : s.light >= 0.6 ? 'bom crescimento, folhas médias'
        : s.light >= 0.4 ? 'cresce menos, folhas maiores, estica'
        : 'cresce pouco, folhas grandes, entrenós longos';
      return `<button data-spot="${id}" ${current ? 'disabled' : ''}>${s.name} · ${s.where}${current ? ' (atual)' : ''}
        <small>luz ${Math.round(s.light * 100)}% · ${effect}</small>
        ${!current && dl <= -0.25 ? '<small class="warn">mais escuro: vai derrubar folhas até se aclimatar</small>' : ''}
        ${!current && dl >= 0.5 ? '<small class="warn">mudança brusca para o sol: pode queimar folhas</small>' : ''}</button>`;
    }).join('');
  potMenu.querySelectorAll('[data-spot]').forEach(b => b.addEventListener('click', () => { potMenu.hidden = true; setSpot(b.dataset.spot); }));
}
// menu de desfolha
function renderDefolMenu() {
  const s = seasonOf(state.day), warm = s === 0 || s === 1, weak = state.vigor < 0.7 || state.recovery < 0.7;
  potMenu.innerHTML = `<small style="padding:4px 10px;color:var(--ui-muted)">Folhas hoje: ~${fmtLength(avgLeafLen())} em média</small>`
    + DEFOL_MODES.map(m => `<button data-defol="${m.id}">🍂 ${m.name}<small>${m.desc}</small></button>`).join('')
    + (!warm ? '<small class="warn" style="padding:4px 10px">Fora da primavera/verão a rebrota é lenta e o choque dobra.</small>' : '')
    + (weak ? '<small class="warn" style="padding:4px 10px">A árvore está fraca ou se recuperando: o choque será maior.</small>' : '')
    + (state.defolBoost > 0.3 ? '<small class="warn" style="padding:4px 10px">Já houve uma desfolha recente.</small>' : '');
  potMenu.querySelectorAll('[data-defol]').forEach(b => b.addEventListener('click', () => { potMenu.hidden = true; defoliate(b.dataset.defol); }));
}
const POT_MENUS = { pot: () => renderPotMenu(), roots: () => renderRootMenu(), spot: () => renderSpotMenu(), defol: () => renderDefolMenu() };
function togglePotMenu(mode) {
  potMenu.hidden = !(potMenu.hidden || potMenuMode !== mode);
  potMenuMode = mode;
  if (!potMenu.hidden) POT_MENUS[mode]();
}
document.getElementById('btnPot').addEventListener('click', () => togglePotMenu('pot'));
document.getElementById('btnRoots').addEventListener('click', () => togglePotMenu('roots'));
document.getElementById('btnSpot').addEventListener('click', () => togglePotMenu('spot'));
document.getElementById('btnDefol').addEventListener('click', () => togglePotMenu('defol'));

function setMeter(id, value, color, text) {
  const bar = document.getElementById('m' + id);
  bar.style.width = `${Math.round(value * 100)}%`;
  bar.style.background = color;
  document.getElementById('t' + id).textContent = text;
}
function updateCare() {
  const [lo, hi] = SP.water.ideal, w = state.water, h = state.humidity, v = vigorNow() * (state.health ?? 1);
  const minH = SP.aerialRoots?.minHumidity;
  setMeter('Water', w, w < lo || w > hi ? '#d08a3c' : '#4f8fc9',
    (w < 0.08 ? 'Seca: regue já' : w < lo ? 'Secando' : w > 0.95 ? 'Encharcada' : w > hi ? 'Bem úmida' : 'Ideal')
    + (state.waterUse ? ` · consumo ${Math.round(state.waterUse * 100)}%/dia` : ''));
  if (minH == null) setMeter('Humidity', h, '#5aa6a0', `${Math.floor(h * 100)}%`);   // espécie sem raízes aéreas
  else setMeter('Humidity', h, h >= minH ? '#5aa6a0' : '#9fb3b8',
    `${Math.floor(h * 100)}% · ${h >= minH ? 'raízes aéreas crescem' : 'seco para raízes aéreas'}`);
  setMeter('Vigor', v, v > 0.7 ? '#3f7d4e' : v > 0.4 ? '#c9a23c' : '#c0583a',
    state.dead ? (state.deathCause === 'seca' ? 'Morta (seca)' : 'Morta (raízes apodreceram)')
    : state.health < 0.3 ? 'Morrendo: regue já!' : state.health < 0.7 ? `Desidratada · saúde ${Math.round(state.health * 100)}%`
    : state.health < 0.95 ? `Recuperando · saúde ${Math.round(state.health * 100)}%`
    : state.recovery < 0.95 && state.vigor > 0.6 ? `Recuperando da poda (${Math.round(state.recovery * 100)}%)`
    : v > 0.85 ? 'Saudável' : v > 0.6 ? 'Um pouco fraco' : v > 0.35 ? 'Estressado: folhas amarelando' : 'Muito fraco');
  autoWaterBox.checked = state.autoWater;
  // vaso e raízes
  const c = container(), fill = rootFill();
  document.getElementById('potName').textContent = `🪴 ${c.name}`;
  if (c.volume === Infinity) setMeter('Roots', 0.1, '#7f9c55', 'Espaço de sobra no solo');
  else setMeter('Roots', Math.min(1, fill), fill > 0.92 ? '#c0583a' : fill > SP.roots.boundAt ? '#c9a23c' : '#8a6a4a',
    `${Math.round(fill * 100)}% do vaso · ` + (fill > 0.92 ? 'enraizada: transplante ou pode as raízes'
      : fill > SP.roots.boundAt ? 'raízes apertadas, crescimento caindo'
      // raízes paradas no tamanho que a copa sustenta (equilíbrio raiz/copa), não no espaço do vaso
      : state.rootMass >= rootTarget() * 0.9 ? `limitada pela copa (sustenta ~${Math.round(rootTarget() / c.volume * 100)}%): mais folhas, mais raiz`
      : fill > 0.5 ? 'crescendo bem' : 'espaço de sobra'));
  // luz
  const L = lightNow();
  setMeter('Light', L, L >= 0.8 ? '#e0b43c' : L >= 0.5 ? '#c9b46a' : '#8f96a3',
    `${spot().name} · ${Math.round(L * 100)}%` + (spot().outdoor && seasonOf(state.day) === 3 ? ' (sol de inverno)' : '')
    + (state.leafLoss > 0.05 ? ' · aclimatando' : ''));
  if (!potMenu.hidden) POT_MENUS[potMenuMode]();
  updateSoil();
}


const SEASON_ICON = ['🌸', '☀️', '🍁', '❄️'];
function updateHud() {
  const s = seasonOf(state.day);
  const year = Math.floor(state.day / YEAR) + 1;
  const day = Math.floor(dayOfYear(state.day) - s * SEASON_LEN) + 1;   // 1 a 91/92
  const age = `${state.name ? state.name + ' · ' : ''}Ano ${year} · ${state.day + 1}º dia`;
  const detail = state.germ > 0 ? `${age} · semente germinando…` : `${age} · ${state.cuts} ${state.cuts === 1 ? 'poda' : 'podas'}`;
  document.getElementById('date').innerHTML = `${SEASON_ICON[s]} ${SEASONS[s]} · dia ${day}<small>${detail}</small>`;

  // medidas da planta (1 unidade da cena = 1 mm)
  const height = state.germ > 0 ? 0 : Math.max(0, ...nodes.map(n => n._e.y)) - SOIL_TOP;
  const base = state.germ > 0 ? 0 : radius(state.root) * 2;
  document.getElementById('measures').innerHTML = height > 0.5
    ? `📏 Altura <b>${fmtLength(height)}</b> · ⌀ base <b>${fmtLength(base)}</b>`
      + (avgLeafLen() ? ` · 🍃 folhas <b>~${fmtLength(avgLeafLen())}</b>` : '')
    : '📏 Ainda sem caule';

  // contador de ramos: cada broto lateral é um ramo; a ordem diz de onde ele sai
  // (1ª = do tronco, 2ª = de um ramo de 1ª, ...); a continuação de um eixo não conta como ramo novo
  const byOrder = [];
  (function walk(n, order) {
    n.kids.forEach((k, i) => {
      const o = i === 0 ? order : order + 1;
      if (i > 0) byOrder[o - 1] = (byOrder[o - 1] ?? 0) + 1;
      walk(k, o);
    });
  })(state.root, 0);
  const total = byOrder.reduce((a, c) => a + (c ?? 0), 0), third = byOrder.slice(2).reduce((a, c) => a + (c ?? 0), 0);
  const el = document.getElementById('branches');
  el.hidden = state.germ > 0;
  const parts = [byOrder[0] && `1ª ${byOrder[0]}`, byOrder[1] && `2ª ${byOrder[1]}`, third && `3ª+ ${third}`].filter(Boolean);
  el.innerHTML = `🌿 Ramos <b>${total}</b>` + (parts.length > 1 ? ` <small>${parts.join(' · ')}</small>` : '');
  el.title = total ? `${byOrder[0] ?? 0} primários (saem do tronco) · ${byOrder[1] ?? 0} secundários · ${third} terciários ou mais`
    : 'Ainda sem ramos: a muda sobe numa haste única até ~40 cm';
}

const MM_PER_UNIT = 1;
function fmtLength(units) {
  const mm = units * MM_PER_UNIT;
  return mm < 10 ? `${mm.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mm`
    : `${(mm / 10).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} cm`;
}

// ---------- Loop principal ----------
// vento: galhos, folhas, flores, arame e raízes aéreas balançam juntos (folhas e flores também tremulam)
for (const [m, flutter] of [[branchMat, 0], [jointMesh.material, 0], [woundMesh.material, 0], [coilMesh.material, 0],
  [rootMesh.material, 0], [leafMat, 0.9], [flowerMesh.material, 0.6]]) R.addWind(m, flutter);

// qualidade gráfica: alterna baixa → média → alta
const qualityBtn = document.getElementById('qualityBtn');
const syncQualityBtn = () => qualityBtn.title = `Qualidade gráfica: ${QUALITY[R.quality].label} (clique para mudar)`;
qualityBtn.addEventListener('click', () => {
  R.setQuality(QUALITY_ORDER[(QUALITY_ORDER.indexOf(R.quality) + 1) % QUALITY_ORDER.length]);
  syncQualityBtn();
  toast(`Qualidade gráfica: ${QUALITY[R.quality].label}` + (R.quality === 'baixa' ? ' (sem sombreamento suave nem vento, mais leve)' : R.quality === 'alta' ? ' (tudo no máximo; pode pesar em computadores mais fracos)' : ''));
});
syncQualityBtn();
R.tune();

let last = performance.now(), acc = 0, time = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now; time += dt;
  acc += dt * speed;
  let steps = 0;
  while (acc >= 1 && steps < 50) { stepDay(); acc -= 1; steps++; }
  if (steps) { calcWidth(state.root); rebuild(); updateHud(); updateCare(); treeDirty = false; }
  if (treeDirty) { rebuild(); treeDirty = false; }   // galho sendo dobrado
  scaleHandles();
  const d = state.day + acc;
  updateSky(d);
  // a cena fica mais clara ou mais escura conforme a luz do lugar
  const L = lightNow();
  sun.intensity = SUN * (0.35 + 0.65 * L);
  hemi.intensity = HEMI * (0.55 + 0.45 * L);
  updateLeaves(d);
  updateFalling(dt);
  updateDrops(dt);
  updateSnow(d, dt);
  updateAnim(dt);
  controls.update();
  R.render(time);
  updateViewCube();
  requestAnimationFrame(frame);
}

if (!load()) newTree();
applyContainer();
setSpeed(speed);
renderSpecies();
if (state.dead) showDeath();
rebuild();
updateHud();   // depois do rebuild: as medidas usam as posições dos galhos
updateCare();
setCamera(withFront(VIEWS.home), HOME_TARGET);
setInterval(save, 5000);
// exposto para depuração no console
window.bonsai = { SPECIES, bloomAmount, get flowers() { return flowers; }, stepDay, newTree, ser, de, rebuild, calcWidth, countNodes, goToView, camera, controls, frame, cut, planCut, undo, water, mist,
  transplant, pruneRoots, rootFill, potFactor, setSpot, defoliate, avgLeafLen, foliageNow, lightNow,
  get leaves() { return leaves; }, setTool, selectBranch, bendAngle, bendLimit, removeWires,
  get wireChain() { return wireChain; }, get wireBases() { return wireBases; }, get handles() { return handleGroup.children; },
  updateCare, updateHud, get SP() { return SP; }, get state() { return state; }, get nodes() { return nodes; }, get roots() { return roots; } };
requestAnimationFrame(frame);
