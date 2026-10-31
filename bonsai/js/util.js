// ---------- Configuração ----------
export const YEAR = 365;               // dias por ano
export const SEASON_LEN = YEAR / 4;    // ~91 dias por estação
// As taxas de crescimento (galhos, brotos, tronco, raízes) foram calibradas pelo quanto a árvore
// cresce por ano; RATE as distribui pelos dias do ano. Água, poda e germinação já são por dia real.
export const RATE = 120 / YEAR;
export const SEASONS = ['Primavera', 'Verão', 'Outono', 'Inverno'];
export const MAX_DEPTH = 80;           // só uma trava de segurança; o crescimento é limitado pela espécie e pelas podas
export const MAX_NODES = 3000;
export const MAX_LEAVES = MAX_NODES * 7;
export const MAX_ROOTS = 120;
export const SAVE_KEY = 'bonsai-save-v2';
export const HINT = 'Arraste para girar · botão direito para mover · roda para zoom · clique num galho para podar · clique no vazio para pausar';

export const rand = (a, b) => a + Math.random() * (b - a);
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const frac = x => x - Math.floor(x);
export const hash = (s, i) => frac(Math.sin((s * 1000 + i) * 12.9898) * 43758.5453);
export const mixColor = (c1, c2, t) => c1.map((v, i) => lerp(v, c2[i], t));
export const rgb = c => `rgb(${c.map(Math.round).join(',')})`;
export const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
