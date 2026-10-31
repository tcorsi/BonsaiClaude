// Registro das espécies do jogo. Para uma planta nova: crie species/<id>.js (copie o ficus como modelo,
// mantendo todos os campos) e acrescente aqui.
import ficus from './ficus-microcarpa.js';

export const SPECIES = Object.fromEntries([ficus].map(s => [s.id, s]));
export const DEFAULT_SPECIES = ficus.id;
