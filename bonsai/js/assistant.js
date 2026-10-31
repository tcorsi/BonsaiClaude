// Assistente: avalia a planta pela geometria real da árvore e por critérios clássicos de bonsai.
// Classifica o estilo, dá uma nota de 0 a 10 (com notas por categoria), aponta pontos fortes e sugere melhorias.
// Tudo é calculado no jogo (sem internet). Medidas em mm; graus a partir da vertical.

const DEG = 180 / Math.PI;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const dia = n => n.girth * 0.95;
// nota de 0 a 10 que é máxima dentro de [lo, hi] e cai até zero a `soft` de distância
const band = (x, lo, hi, soft) => x < lo ? clamp(10 * (1 - (lo - x) / soft), 0, 10) : x > hi ? clamp(10 * (1 - (x - hi) / soft), 0, 10) : 10;
const fmt = mm => mm < 10 ? `${mm.toFixed(1).replace('.', ',')} mm` : `${(mm / 10).toFixed(1).replace('.', ',')} cm`;

export const STYLES = {
  formacao: { name: 'Muda em formação', jp: '', desc: 'Ainda é cedo para um estilo: agora o objetivo é engrossar o tronco e formar a base.' },
  chokkan: { name: 'Ereto formal', jp: 'Chokkan', desc: 'Tronco reto e vertical, afinando de forma regular até o ápice, galhos alternados em camadas.' },
  moyogi: { name: 'Ereto informal', jp: 'Moyogi', desc: 'Tronco com curvas suaves, mas com o ápice sobre a base. É o estilo mais comum.' },
  shakan: { name: 'Inclinado', jp: 'Shakan', desc: 'Tronco inclinado (15° a 45°), como uma árvore crescendo em encosta ou buscando luz.' },
  kengai: { name: 'Cascata', jp: 'Kengai', desc: 'O tronco desce abaixo da base do vaso, como uma árvore pendendo de um penhasco.' },
  hankengai: { name: 'Semicascata', jp: 'Han-kengai', desc: 'O tronco desce até perto da borda do vaso, sem passar muito abaixo dela.' },
  fukinagashi: { name: 'Varrido pelo vento', jp: 'Fukinagashi', desc: 'Tronco e galhos inclinados para o mesmo lado, como sob vento constante.' },
  hokidachi: { name: 'Vassoura', jp: 'Hokidachi', desc: 'Tronco reto que se abre em vários galhos de espessura parecida, formando uma copa arredondada.' },
  sokan: { name: 'Tronco duplo', jp: 'Sokan', desc: 'Dois troncos saindo da mesma base, um maior e outro menor.' },
  bunjingi: { name: 'Literato', jp: 'Bunjingi', desc: 'Tronco longo e fino, com poucos galhos concentrados no alto.' },
};

// ctx: { state, nodes, SP, pot (vaso atual), rootFill, avgLeaf, soil (altura da terra) }
export function evaluate(ctx) {
  const { state, nodes, SP, pot, soil } = ctx;
  if (state.dead) return { dead: true };
  if (state.germ > 0 || !nodes.length || !nodes[0]._e) return { seed: true };

  // ---------- medidas ----------
  const trunk = [];
  for (let c = state.root; c; c = c.kids[0]) trunk.push(c);
  const base = state.root._s, apex = trunk[trunk.length - 1]._e;
  const H = Math.max(...nodes.map(n => n._e.y)) - soil;             // altura total
  const trunkH = Math.max(1, apex.y - soil);
  const D = dia(state.root);                                         // ⌀ da base
  const age = state.day;
  const front = state.front ?? 0, fx = Math.sin(front), fz = Math.cos(front);
  const rx = Math.cos(front), rz = -Math.sin(front);                 // "direita" vista da frente

  // ⌀ do tronco em frações da altura do tronco
  const diaAt = f => { const y = soil + trunkH * f; let best = trunk[0]; for (const n of trunk) if (n._s.y <= y) best = n; return dia(best); };
  const t1 = diaAt(1 / 3) / D, t2 = diaAt(2 / 3) / D;
  // conicidade invertida: um trecho bem mais grosso que o de baixo
  let inverse = null;
  for (let i = 1; i < trunk.length; i++) if (dia(trunk[i]) > dia(trunk[i - 1]) * 1.1 && dia(trunk[i]) > 1.5) { inverse = trunk[i]; break; }
  // inclinação geral: linha da base ao ápice
  const vx = apex.x - base.x, vy = apex.y - base.y, vz = apex.z - base.z;
  // movimento: quanto o tronco se afasta da linha reta base→ápice (fração do comprimento do tronco).
  // Reto ≈ 0; curvas suaves de um ereto informal ≈ 0,08 a 0,3
  const vl = Math.hypot(vx, vy, vz) || 1, trunkLen = trunk.reduce((t, n) => t + n.len, 0) || 1;
  let dev = 0;
  for (const n of trunk) {
    const px = n._e.x - base.x, py = n._e.y - base.y, pz = n._e.z - base.z;
    const along = (px * vx + py * vy + pz * vz) / vl;
    dev = Math.max(dev, Math.sqrt(Math.max(0, px * px + py * py + pz * pz - along * along)));
  }
  const movement = dev / trunkLen;
  const slant = Math.atan2(Math.hypot(vx, vz), vy) * DEG;
  const minTrunkY = Math.min(...trunk.map(n => n._e.y)) - soil;

  // galhos primários (saem do tronco)
  const primaries = [];
  trunk.forEach(t => t.kids.forEach((k, i) => {
    if (i === 0) return;
    let tips = 0, mass = 0; (function w(n) { mass++; if (!n.kids.length) tips++; n.kids.forEach(w); })(k);
    const hx = k.dir[0], hz = k.dir[2], hl = Math.hypot(hx, hz) || 1;
    const az = Math.atan2((hx * rx + hz * rz) / hl, (hx * fx + hz * fz) / hl) * DEG;   // 0 = para a frente, ±90 = lados, ±180 = trás
    primaries.push({ n: k, y: k._s.y - soil, d: dia(k), trunkD: dia(t), az, tips, mass });
  }));
  primaries.sort((a, b) => a.y - b.y);
  const tipsTotal = nodes.filter(n => !n.kids.length).length;

  // ---------- estágio ----------
  const forming = D < 8 || age < 365 || primaries.length < 3;

  // ---------- estilo ----------
  const style = classify();
  function classify() {
    const potH = pot.visual?.h ?? 50;
    if (minTrunkY < -potH * 0.6) return { id: 'kengai', why: `o tronco desce ${fmt(-minTrunkY)} abaixo da borda do vaso` };
    if (minTrunkY < -2) return { id: 'hankengai', why: 'o tronco desce até a borda do vaso' };
    // tronco duplo: um lateral grosso saindo bem perto da base
    const twin = primaries.find(p => p.y < trunkH * 0.15 && p.d > D * 0.45);
    if (twin && !forming) return { id: 'sokan', why: `um segundo tronco (⌀ ${fmt(twin.d)}) sai a ${fmt(twin.y)} da base` };
    if (forming) return { id: 'formacao', why: D < 8 ? `tronco ainda fino (⌀ ${fmt(D)})` : age < 365 ? 'planta com menos de 1 ano' : 'ainda com poucos galhos primários' };
    // vento: maioria das pontas para um lado e tronco inclinado para o mesmo lado
    let side = 0, cnt = 0;
    for (const n of nodes) if (!n.kids.length) { side += Math.sign((n._e.x - base.x) * rx + (n._e.z - base.z) * rz); cnt++; }
    const lean = Math.sign(vx * rx + vz * rz);
    if (slant > 25 && cnt && Math.abs(side / cnt) > 0.85 && Math.sign(side) === lean) return { id: 'fukinagashi', why: 'galhos e tronco inclinados para o mesmo lado' };
    if (slant > 15 && slant <= 50) return { id: 'shakan', why: `tronco inclinado ~${Math.round(slant)}°` };
    // literato: alto e fino, galhos só no terço de cima
    if (H / D > 12 && primaries.length && primaries[0].y > trunkH * 0.6) return { id: 'bunjingi', why: `tronco longo e fino (altura ${Math.round(H / D)}× o diâmetro) e galhos só no alto` };
    // vassoura: o tronco se abre em vários galhos parecidos entre 1/4 e 1/2 da altura
    const split = trunk.find(t => t._s.y - soil > trunkH * 0.25 && t._s.y - soil < trunkH * 0.6 && t.kids.length >= 3);
    if (split && movement < 0.06 && split.kids.filter(k => dia(k) > dia(split) * 0.4).length >= 3) return { id: 'hokidachi', why: 'o tronco se abre em vários galhos de espessura parecida' };
    if (movement < 0.05 && slant < 8) return { id: 'chokkan', why: 'tronco reto e vertical' };
    return { id: 'moyogi', why: `tronco com curvas (afasta-se ${Math.round(movement * 100)}% da linha reta) e ápice sobre a base (${Math.round(slant)}°)` };
  }

  // ---------- notas ----------
  const good = [], tips = [];
  const say = (score, okText, badText, tip) => { if (score >= 7 && okText) good.push(okText); if (score < 7 && badText) tips.push({ text: badText, tip, weight: 10 - score }); };

  // tronco
  const sTaper = (band(t1, 0.6, 0.85, 0.35) + band(t2, 0.3, 0.62, 0.35)) / 2;
  say(sTaper, 'Boa conicidade: o tronco afina bem da base ao ápice.',
    t1 > 0.85 ? 'O tronco afina pouco: parece um cilindro.' : 'O tronco afina rápido demais logo acima da base.',
    t1 > 0.85 ? 'Deixe um galho baixo crescer livre (sacrifício) para engrossar a base, ou encurte o tronco num galho mais fino (troca de líder).' : 'Deixe a parte de cima crescer mais antes de podar de novo.');
  const sInverse = inverse ? 3 : 10;
  if (inverse) tips.push({ text: `Conicidade invertida a ${fmt(inverse._s.y - soil)} de altura: o tronco engrossa para cima.`, tip: 'Costuma vir de vários galhos saindo do mesmo ponto ou de um sacrifício esquecido: remova os excessos com a 🪚.', weight: 6 });
  const wantsMove = style.id !== 'chokkan' && style.id !== 'hokidachi' && style.id !== 'bunjingi';
  const sMove = wantsMove ? band(movement, 0.08, 0.3, 0.12) : band(movement, 0, 0.05, 0.08);
  const tooStraight = movement < 0.08;
  say(sMove, wantsMove ? 'Tronco com movimento, interessante de olhar.' : 'Tronco reto, coerente com o estilo.',
    wantsMove ? (tooStraight ? 'O tronco é reto demais para o estilo: falta movimento.' : 'O tronco está sinuoso demais: as curvas competem entre si.')
      : 'O tronco tem curvas demais para um ereto formal.',
    wantsMove ? (tooStraight ? 'Arame no tronco ainda jovem (ramo verde aceita bem) para criar curvas suaves; cada curva deve ser menor que a de baixo.'
      : 'Prefira poucas curvas, maiores embaixo e menores no alto.') : null);
  const trunkScore = sTaper * 0.5 + sInverse * 0.25 + sMove * 0.25;

  // galhos
  const cascade = style.id === 'kengai' || style.id === 'hankengai';
  const first = cascade ? null : primaries[0];
  const sFirst = first ? band(first.y / trunkH, 0.18, 0.42, 0.3) : cascade ? 8 : 4;
  if (first) say(sFirst, 'Primeiro galho numa boa altura (perto de 1/3 do tronco).',
    first.y / trunkH < 0.18 ? `O primeiro galho sai muito baixo (${fmt(first.y)}), escondendo a base do tronco.` : `O primeiro galho sai alto (${Math.round(first.y / trunkH * 100)}% do tronco): a parte de baixo fica vazia.`,
    first.y / trunkH < 0.18 ? 'Remova-o com a 🪚 ou use-o como sacrifício para engrossar a base e depois retire.' : `Para ter galhos mais baixos, encurte o tronco: ${SP.name.article} ${SP.name.short} brota na madeira abaixo do corte.`);
  const wantN = clamp(Math.round(trunkH / 60), 3, 12);
  const sCount = band(primaries.length, wantN * 0.6, wantN * 1.6, wantN);
  say(sCount, `Boa quantidade de galhos primários (${primaries.length}).`,
    primaries.length < wantN * 0.6 ? `Poucos galhos primários (${primaries.length}) para o tamanho do tronco.` : `Galhos primários demais (${primaries.length}): a copa fica confusa.`,
    primaries.length < wantN * 0.6 ? 'Encurte o tronco ou deite um galho com arame para acordar gemas; podas criam bifurcações.' : 'Escolha os melhores (alternados, um por altura) e remova os outros com a 🪚.');
  // barras e verticilos
  let bars = 0, whorls = 0;
  for (let i = 0; i < primaries.length; i++) {
    const same = primaries.filter(p => Math.abs(p.y - primaries[i].y) < trunkH * 0.03);
    if (same.length >= 3) whorls++;
    for (let j = i + 1; j < primaries.length; j++) if (Math.abs(primaries[j].y - primaries[i].y) < trunkH * 0.03 && Math.abs(Math.abs(primaries[j].az - primaries[i].az) - 180) < 50) bars++;
  }
  const sBars = clamp(10 - bars * 3 - whorls * 2, 0, 10);
  if (bars) tips.push({ text: `${bars === 1 ? 'Um par' : bars + ' pares'} de galhos em barra (mesma altura, lados opostos).`, tip: 'Deixe só um galho em cada altura: remova o outro com a 🪚.', weight: 4 + bars });
  if (whorls) tips.push({ text: 'Vários galhos saindo do mesmo ponto do tronco (verticilo).', tip: 'Mantenha um ou dois e remova o resto: além de feio, causa conicidade invertida.', weight: 5 });
  // galho baixo para a frente e galho de trás
  const frontLow = primaries.filter(p => p.y < trunkH * 0.4 && Math.abs(p.az) < 35);
  const back = primaries.some(p => Math.abs(p.az) > 120);
  const sFront = clamp(10 - frontLow.length * 4, 0, 10) * 0.6 + (back ? 4 : 1);
  if (frontLow.length) tips.push({ text: `${frontLow.length === 1 ? 'Um galho' : frontLow.length + ' galhos'} na parte de baixo apontando para a frente, escondendo o tronco.`, tip: 'Remova ou dobre com arame para o lado. (Defina a frente com 🎯 se ainda não definiu.)', weight: 4 });
  if (!back && primaries.length >= 3) tips.push({ text: 'Falta um galho atrás: a árvore fica "chapada", sem profundidade.', tip: 'Deixe um broto de trás crescer ou dobre um galho para trás com arame.', weight: 3 });
  else if (back) good.push('Tem galho atrás: dá profundidade à copa.');
  // galho grosso demais (compete com o tronco)
  const thick = primaries.filter(p => p.d > p.trunkD * 0.66 && p.d > 2);
  const sThick = clamp(10 - thick.length * 3, 0, 10);
  if (thick.length) tips.push({ text: `${thick.length === 1 ? 'Um galho primário está' : thick.length + ' galhos primários estão'} quase tão grossos quanto o tronco ali.`, tip: 'Encurte esses galhos para que engrossem menos; galhos de baixo um pouco mais grossos que os de cima é o ideal.', weight: 4 });
  const branchScore = primaries.length ? (sFirst * 0.3 + sCount * 0.2 + sBars * 0.2 + sFront * 0.15 + sThick * 0.15) : 3;

  // copa e ápice
  const tipsPer = primaries.length ? primaries.reduce((t, p) => t + p.tips, 0) / primaries.length : 0;
  const sRamif = primaries.length ? band(tipsPer, 8, 60, 8) : 3;
  if (primaries.length) say(sRamif, `Boa ramificação: em média ${tipsPer.toFixed(1).replace('.', ',')} pontas por galho.`,
    `Pouca ramificação: em média ${tipsPer.toFixed(1).replace('.', ',')} ponta(s) por galho.`,
    'Belisque as pontas novas (✂️ no meio do último entrenó): cada corte vira um Y.');
  const apexD = dia(trunk[Math.max(0, trunk.length - 2)]);
  const sApex = band(apexD / D, 0, 0.45, 0.4);
  say(sApex, null, 'O ápice está grosso: o topo da árvore parece cortado.', 'Deixe um broto novo assumir o ápice e encurte o antigo aos poucos.');
  const crownScore = sRamif * 0.65 + sApex * 0.35;

  // proporção
  const ratio = H / Math.max(D, 0.5);
  const sRatio = cascade ? 8 : style.id === 'bunjingi' ? band(ratio, 10, 25, 10) : band(ratio, 4, 9, 6);
  if (!cascade) say(sRatio, 'Boa proporção entre altura e grossura do tronco.',
    ratio > 9 ? `A árvore está alta para a grossura do tronco (${Math.round(ratio)}:1; o ideal fica perto de 6:1).` : 'A árvore está baixa para o tronco (atarracada).',
    ratio > 9 ? 'Engrosse o tronco (vaso maior, sacrifício) ou reduza a altura com uma poda no tronco.' : null);
  const leafRatio = (ctx.avgLeaf || 0) / Math.max(H, 1);
  const sLeaf = band(leafRatio, 0, 0.07, 0.08);
  say(sLeaf, 'Folhas pequenas em relação à árvore.', 'As folhas estão grandes para o tamanho da árvore.',
    'Mais sol e desfolha no começo do verão diminuem as folhas; ramificação fina também.');
  const propScore = sRatio * 0.6 + sLeaf * 0.4;

  // saúde
  const h = state.health ?? 1;
  const sHealth = clamp(10 * h * (0.6 + 0.4 * state.vigor) * (ctx.rootFill > 0.92 ? 0.8 : 1), 0, 10);
  say(sHealth, 'Planta saudável.', h < 0.7 ? 'A planta está estressada (seca ou encharcada).' : 'Vigor baixo.',
    ctx.rootFill > 0.92 ? 'As raízes tomaram o vaso: transplante ou pode as raízes.' : 'Ajuste a rega; a rega automática ajuda.');
  if (ctx.rootFill > 0.92) tips.push({ text: 'Raízes tomaram o vaso.', tip: 'Transplante (primavera/verão) ou faça poda de raízes.', weight: 4 });

  // técnica e vaso
  const wired = nodes.filter(n => n.wire), bitten = wired.filter(n => n.wire.bitten), fixed = wired.filter(n => (n.wire.prog ?? 0) >= 1);
  const openWounds = nodes.filter(n => (n.wounds ?? []).some(w => w.r / w.r0 > 0.5 && w.r0 * 2 > D * 0.3));
  let sTech = 10 - bitten.length * 1.5 - openWounds.length * 1.5;
  if (bitten.length) tips.push({ text: `Arame marcando a casca em ${bitten.length} ${bitten.length === 1 ? 'trecho' : 'trechos'}.`, tip: 'Remova o arame já (🪢 → Remover arame); marcas demoram anos para sumir.', weight: 6 });
  else if (fixed.length) tips.push({ text: 'Há arame que já fixou a forma.', tip: 'Pode remover antes que comece a marcar.', weight: 2 });
  if (openWounds.length) tips.push({ text: 'Cicatrizes grandes ainda abertas.', tip: 'Deixe folhagem acima delas: com mais folhas o calo fecha mais rápido.', weight: 2 });
  const inBonsaiPot = state.container === 'bonsai';
  if (!inBonsaiPot) sTech -= forming ? 0 : 2;
  if (!inBonsaiPot && !forming && D > 15) tips.push({ text: 'A árvore ainda está em vaso de cultivo.', tip: 'Quando o tronco estiver na grossura desejada, passe para a caixa de treino e depois para o vaso de bonsai.', weight: 1.5 });
  if (!front) tips.push({ text: 'A frente da árvore não foi definida.', tip: 'Gire até o melhor lado (mostra o tronco e a base) e clique em 🎯.', weight: 1 });
  const techScore = clamp(sTech, 0, 10);

  const cats = [
    { id: 'tronco', name: 'Tronco', score: trunkScore, w: 0.25 },
    { id: 'galhos', name: 'Galhos', score: branchScore, w: 0.25 },
    { id: 'copa', name: 'Copa e ápice', score: crownScore, w: 0.2 },
    { id: 'proporcao', name: 'Proporção', score: propScore, w: 0.15 },
    { id: 'saude', name: 'Saúde', score: sHealth, w: 0.05 },
    { id: 'tecnica', name: 'Técnica e vaso', score: techScore, w: 0.1 },
  ];
  // a nota mede a árvore como bonsai: muda em formação vai até 3; fora do vaso de bonsai, até 6
  let score = cats.reduce((t, c) => t + c.score * c.w, 0), cap = null;
  if (forming) cap = 3; else if (!inBonsaiPot) cap = 6;
  if (cap != null && score > cap) score = cap;
  const level = forming ? 'Em formação' : !inBonsaiPot || score < 5 ? 'Pré-bonsai' : score < 7 ? 'Bonsai em desenvolvimento' : score < 9 ? 'Bom bonsai' : 'Exemplar';
  const capNote = forming ? 'Nota limitada a 3: ainda é uma muda em formação.' : cap === 6 && score >= 6 ? 'Nota limitada a 6 até ir para um vaso de bonsai.' : null;

  // na muda em formação, só as dicas que importam agora (formação, saúde, arame, raízes)
  if (forming) for (let i = tips.length - 1; i >= 0; i--) if (!/Arame|arame|Raízes|estressada|Vigor|frente/.test(tips[i].text)) tips.splice(i, 1);
  if (forming) tips.unshift({ text: 'Fase de formação: o mais importante agora é engrossar o tronco.', tip: D < 8 ? 'Deixe crescer livre, em vaso de cultivo grande (ou no solo), com sol e rega boa. Pode estilizar o tronco com arame enquanto é verde.' : 'Escolha os galhos primários (um por altura, alternados) e deixe a planta ganhar massa.', weight: 20 });
  tips.sort((a, b) => b.weight - a.weight);

  return {
    style: { ...STYLES[style.id], id: style.id, why: style.why },
    score: Math.round(score * 10) / 10, level, forming, cats, capNote,
    good: good.slice(0, 5), tips: tips.slice(0, 6),
    facts: { H, D, ratio, primaries: primaries.length, tipsTotal, movement, slant },
  };
}
