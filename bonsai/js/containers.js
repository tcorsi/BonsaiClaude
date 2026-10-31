// ---------- Vasos ----------
// Quanto mais substrato, mais a árvore se desenvolve; o vaso raso de bonsai segura o crescimento.
// volume em litros; growth multiplica o crescimento enquanto as raízes têm espaço.
// visual: medidas em mm (rx/rz = raio da boca, h = altura, taper = raio do fundo / raio da boca)
export const CONTAINERS = {
  cup:    { name: 'Copinho de muda', volume: 0.3, growth: 1.0,
            visual: { rx: 38, h: 75, taper: 0.78, color: 0x2e2e2e, rim: 0x3c3c3c } },
  pot1:   { name: 'Vaso de cultivo 1 L', volume: 1, growth: 1.0,
            visual: { rx: 62, h: 110, taper: 0.8, color: 0x2e2e2e, rim: 0x3c3c3c } },
  pot5:   { name: 'Vaso de cultivo 5 L', volume: 5, growth: 1.1,
            visual: { rx: 110, h: 170, taper: 0.8, color: 0x2e2e2e, rim: 0x3c3c3c } },
  pot20:  { name: 'Vaso de cultivo 20 L', volume: 20, growth: 1.25,
            visual: { rx: 175, h: 250, taper: 0.8, color: 0x2e2e2e, rim: 0x3c3c3c } },
  // caixa de treino: rasa e larga, entre o cultivo e o vaso de bonsai; as raízes se espalham para os lados (nebari)
  training: { name: 'Caixa de treino 8 L', volume: 8, growth: 0.85,
            visual: { shape: 'box', rx: 180, rz: 130, h: 90, color: 0x9a7350, rim: 0xa8805c } },
  ground: { name: 'Plantada no solo', volume: Infinity, growth: 1.6,
            visual: { rx: 300 } },
  bonsai: { name: 'Vaso de bonsai', volume: 1.2, growth: 0.55,
            visual: { rx: 115, rz: 72, h: 46, taper: 0.86, color: 0x8a5a44, rim: 0x9c6a52, feet: true, moss: true } },
};
export const CONTAINER_ORDER = ['cup', 'pot1', 'pot5', 'pot20', 'ground', 'training', 'bonsai'];
