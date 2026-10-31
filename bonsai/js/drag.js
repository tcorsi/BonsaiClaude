// Painéis arrastáveis: qualquer painel pode ser movido pela tela (arrastando por uma área sem botão),
// vem para a frente ao ser tocado ou aberto, e lembra a posição neste navegador.
// Duplo clique numa área vazia do painel devolve ele ao lugar original.
const KEY = 'bonsai-panels';
const INTERACTIVE = 'button, input, select, textarea, label, a, canvas, [data-nodrag]';
let z = 40;   // acima do jogo e do HUD; cada painel tocado sobe uma camada

function loadAll() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
function saveAll(all) { try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) {} }

export function bringToFront(el) { el.style.zIndex = ++z; }

// mantém o painel inteiro dentro da janela
function clampInto(el) {
  const r = el.getBoundingClientRect();
  const left = Math.min(Math.max(0, r.left), Math.max(0, innerWidth - r.width));
  const top = Math.min(Math.max(0, r.top), Math.max(0, innerHeight - Math.min(r.height, 60)));
  place(el, left, top);
}
function place(el, left, top) {
  Object.assign(el.style, { left: `${left}px`, top: `${top}px`, right: 'auto', bottom: 'auto', transform: 'none' });
}

export function makeDraggable(el) {
  const id = el.id, original = el.getAttribute('style') ?? '';
  el.classList.add('draggable');
  const saved = loadAll()[id];
  if (saved) { place(el, saved.left, saved.top); requestAnimationFrame(() => !el.hidden && clampInto(el)); }

  let drag = null;
  el.addEventListener('pointerdown', e => {
    bringToFront(el);
    if (e.button !== 0 || e.target.closest(INTERACTIVE)) return;
    const r = el.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false, id: e.pointerId };
  });
  addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved) { drag.moved = true; el.classList.add('dragging'); try { el.setPointerCapture(e.pointerId); } catch (err) {} }
    place(el, e.clientX - drag.dx, e.clientY - drag.dy);
  });
  const end = () => {
    if (!drag) return;
    if (drag.moved) {
      clampInto(el);
      const r = el.getBoundingClientRect(), all = loadAll();
      all[id] = { left: r.left, top: r.top }; saveAll(all);
    }
    el.classList.remove('dragging');
    drag = null;
  };
  addEventListener('pointerup', end);
  addEventListener('pointercancel', end);
  el.addEventListener('dblclick', e => {
    if (e.target.closest(INTERACTIVE)) return;
    el.setAttribute('style', original);
    const all = loadAll(); delete all[id]; saveAll(all);
    bringToFront(el);
  });
  // ao abrir (deixar de estar oculto) vem para a frente e cabe na tela
  new MutationObserver(() => { if (!el.hidden) { bringToFront(el); if (el.style.left) clampInto(el); } })
    .observe(el, { attributes: true, attributeFilter: ['hidden'] });
}
