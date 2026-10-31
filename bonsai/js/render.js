// Renderização: luz de ambiente, tone mapping, oclusão ambiente (GTAO), vento e níveis de qualidade.
// A cena está em milímetros (1 unidade = 1 mm).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// baixa: para computadores fracos · média: equilíbrio · alta: tudo ligado
export const QUALITY = {
  baixa: { label: 'Baixa', pixelRatio: 1, ao: false, shadow: 1024, wind: false },
  media: { label: 'Média', pixelRatio: 1.5, ao: true, aoScale: 0.5, shadow: 2048, wind: true },
  alta:  { label: 'Alta', pixelRatio: 2, ao: true, aoScale: 1, shadow: 4096, wind: true },
};
export const QUALITY_ORDER = ['baixa', 'media', 'alta'];
const QUALITY_KEY = 'bonsai-quality';

export function setupRender({ renderer, scene, camera, sun }) {
  // cor e exposição como numa câmera: ACES suaviza os brilhos e dá contraste natural
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;

  // luz de ambiente gerada no código (um "estúdio" neutro): ilumina por todos os lados e dá reflexos suaves
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  pmrem.dispose();

  // vento: deslocamento no vertex shader, maior quanto mais alto (galhos e folhas balançam de leve)
  const wind = { uTime: { value: 0 }, uWind: { value: 1 } };
  function addWind(material, flutter = 0) {
    const prev = material.onBeforeCompile;
    material.onBeforeCompile = (shader, r) => {
      prev?.call(material, shader, r);
      Object.assign(shader.uniforms, wind);
      shader.vertexShader = 'uniform float uTime;\nuniform float uWind;\n' + shader.vertexShader.replace('#include <project_vertex>', `
        vec4 mvPosition = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        vec4 wPos = modelMatrix * mvPosition;
        float hh = max( wPos.y, 0.0 ) / 400.0;
        float sway = uWind * hh * hh * ( 1.6 + 0.9 * sin( uTime * 0.37 ) );   // rajadas lentas
        wPos.x += sin( uTime * 1.3 + wPos.y * 0.015 ) * sway;
        wPos.z += cos( uTime * 1.05 + wPos.y * 0.012 ) * sway * 0.6;
        ${flutter ? `
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
        #else
          vec3 ip = vec3( 0.0 );
        #endif
        wPos.y += sin( uTime * 3.1 + ip.x * 0.37 + ip.z * 0.23 ) * ${flutter.toFixed(2)} * uWind * ( 0.3 + hh );   // folha tremulando
        ` : ''}
        mvPosition = viewMatrix * wPos;
        gl_Position = projectionMatrix * mvPosition;`);
    };
    const key = material.customProgramCacheKey?.bind(material);
    material.customProgramCacheKey = () => (key ? key() : '') + `|wind${flutter}`;
    material.needsUpdate = true;
  }

  // pós-processamento: cena → oclusão ambiente → cor final
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const ao = new GTAOPass(scene, camera, innerWidth, innerHeight);
  ao.updateGtaoMaterial({ radius: 18, distanceExponent: 1.5, thickness: 6, scale: 1, samples: 12 });
  ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
  ao.blendIntensity = 0.85;
  composer.addPass(ao);
  composer.addPass(new OutputPass());

  let quality = 'media';
  try { quality = QUALITY[localStorage.getItem(QUALITY_KEY)] ? localStorage.getItem(QUALITY_KEY) : quality; } catch (e) {}

  function resize() {
    const q = QUALITY[quality];
    renderer.setPixelRatio(Math.min(devicePixelRatio, q.pixelRatio));
    renderer.setSize(innerWidth, innerHeight);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(innerWidth, innerHeight);
    // a oclusão pode rodar em resolução menor (mais leve) sem perder muito
    if (q.ao) ao.setSize(innerWidth * renderer.getPixelRatio() * q.aoScale, innerHeight * renderer.getPixelRatio() * q.aoScale);
  }
  function setQuality(name) {
    if (!QUALITY[name]) return;
    quality = name;
    try { localStorage.setItem(QUALITY_KEY, name); } catch (e) {}
    const q = QUALITY[name];
    ao.enabled = q.ao;
    wind.uWind.value = q.wind ? 1 : 0;
    if (sun.shadow.mapSize.x !== q.shadow) {
      sun.shadow.mapSize.set(q.shadow, q.shadow);
      sun.shadow.map?.dispose(); sun.shadow.map = null;
    }
    resize();
  }

  function render(time) {
    wind.uTime.value = time;
    if (QUALITY[quality].ao) composer.render(); else renderer.render(scene, camera);
  }

  // reflexos do ambiente mais contidos em todos os materiais da cena (o padrão 1 deixa tudo lavado)
  const ENV = 0.45;
  function tune(root = scene) {
    root.traverse(o => { for (const m of [].concat(o.material ?? [])) if (m.isMeshStandardMaterial) m.envMapIntensity = ENV; });
  }

  setQuality(quality);
  return { render, resize, setQuality, addWind, tune, get quality() { return quality; } };
}
