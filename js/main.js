import * as THREE from 'three/webgpu';
import { pass, mrt, output, normalView, positionView, metalness, roughness, vec2, vec3, smoothstep, convertToTexture, rtt } from 'three/tsl';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import GTAONode from 'three/addons/tsl/display/GTAONode.js';
import DenoiseNode from 'three/addons/tsl/display/DenoiseNode.js';
import { createPostProcessing } from './post-processing.js';
import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
import { getLocationLabel, isTypingInField, ROADS, NYC_LANDMARKS, TELEPORT_LOCATIONS } from './city-config.js';
import { buildCityGrid, centralParkClearings } from './city-grid.js';
import { buildBoroughs, boroughLandAt, bridgeDeckAt } from './boroughs.js';
import { buildLandmarks } from './landmarks.js';
import { buildCityBlocks } from './buildings.js';
import { buildStreetDetails } from './street-details.js';
import { createTrafficSystem, createHighwayTraffic } from './traffic.js';
import { buildRoadPaint } from './road-paint.js';
import { ThirdPersonControllerManager } from './controllers.js';
import { TouchControls } from './touch-controls.js';
import { GamepadControls } from './gamepad-controls.js';
import { CameraSystem, CAMERA_PRESETS } from './cameras.js';
import { LightingSystem } from './lighting.js';
import { disableEffectOutputs } from './tsl-materials.js';
import { sealEffects, effectSweeper } from './effect-outputs.js';
import { NYCMapSystem } from './nyc-map.js';
import { setupSceneCulling, updateSceneCulling } from './scene-culling.js';
import { CityAudioSystem } from './audio-system.js';
import { Playground } from './gameplay.js';
import { loadCharacters } from './characters.js';
import { loadCrowd } from './human-assets.js';
import { CROWD_BODIES, CROWD_PROPS } from './human-crowd.js';
import { loadCrowdMotion } from './crowd-motion.js';
import { loadNature } from './nature-assets.js';
import { loadTrees } from './tree-assets.js';
import { treeUniforms } from './tree-materials.js';
import { loadCars } from './car-assets.js';
import { loadAircraftModels } from './aircraft-assets.js';
import { buildRamps } from './ramps.js';
import { loadWorld } from './world-assets.js';
import { loadGround } from './ground-assets.js';
import { buildRoadSurface, buildGroundDressing } from './ground.js';
import { surveyCentralPark } from './park-ground.js';
import { loadUrbanLight, urbanSkyVisibility } from './urban-light.js';
import { loadStorefronts, createStorefronts } from './storefronts.js';
import { createFacadeKit } from './facade-kit.js';
import { loadClutter } from './street-clutter.js';
import { createParking } from './parking.js';
import { createSidewalkFurniture } from './sidewalk-furniture.js';
import { createStreetLife } from './street-life.js';
import { createAmbientEvents } from './ambient-events.js';
import { createBirds } from './birds.js';
import { getIslandBoundsAtZ } from './city-config.js';
import { STREET } from './street-geodata.js';
import { buildRoadNetworkAsync } from './road-network.js';
import { setTreeDetail } from './trees.js';
import { createGrass } from './grass.js';
import { currentLevel, FramePacer } from './quality.js';
import { OpeningScreen } from './opening-screen.js';
import { calibreBox, calibreFixtures } from './calibre-plan.js';
import { createCalibreWorld } from './calibre-room.js';
import { loadCalibreKit } from './calibre-kit.js';
import { CalibreSystem } from './calibre.js';

// Application setup, shader warm-up and frame loop.

const opening = new OpeningScreen();

async function initApp() {
  let gameplay = null;
  let graphicsLost = false;
  const quality = currentLevel();
  if (!quality.reflections) disableEffectOutputs();
  const container = document.getElementById('canvas-container');
  async function showLoadingStage(message) {
    opening.setStage(message);
    if (document.hidden) return;
    // Let the label paint before synchronous work. The timeout also lets hidden tabs keep loading.
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 100);
      requestAnimationFrame(() => {
        clearTimeout(timeout);
        setTimeout(resolve, 0);
      });
    });
  }

  await showLoadingStage('Ouverture de la ville…');

  // 1. Initialize Three.js WebGPURenderer with 32-bit float reversedDepthBuffer
  // Preserve upstream's WebGPU default and its automatic capability detection.
  // Compatibility rendering is an explicit choice, never a cloud-QA workaround.
  const forceWebGL = new URLSearchParams(location.search).get('renderer') === 'webgl';
  const renderer = new THREE.WebGPURenderer({
    forceWebGL,
    antialias: true,
    powerPreference: 'high-performance',
    reversedDepthBuffer: true
  });
  renderer.setPixelRatio(quality.scale);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = quality.shadows;
  renderer.lighting = new ClusteredLighting(256, 32, 28, 48);
  container.appendChild(renderer.domElement);

  // Start-up phase timings (logged once as "[init] ...") to keep load-time regressions traceable
  let initTimings = [];
  let initMark = performance.now();
  const markInit = (label) => {
    const now = performance.now();
    initTimings.push(`${label} ${Math.round(now - initMark)}ms`);
    initMark = now;
  };

  await renderer.init();
  const rendererName = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL 2';
  console.info(`[graphics] ${rendererName}`);
  let diagnostics = null;
  if (new URLSearchParams(location.search).has('stats')) {
    diagnostics = document.createElement('output');
    diagnostics.id = 'graphics-stats';
    diagnostics.style.cssText = 'position:fixed;right:24px;top:76px;z-index:50;padding:8px 12px;background:#10180ee8;color:#e1f3a0;font:12px monospace;pointer-events:none;white-space:pre';
    diagnostics.textContent = `${rendererName} · chargement…`;
    document.body.append(diagnostics);
  }
  renderer.onDeviceLost = info => {
    graphicsLost = true;
    console.error('[graphics]', info);
    renderer.setAnimationLoop(null);
    opening.fail('Le navigateur a interrompu le rendu graphique.', 'Lancer le mode compatibilité', () => {
      const url = new URL(location.href);
      url.searchParams.set('renderer', 'webgl');
      location.href = url.href;
    });
  };
  markInit('renderer');

  // 2. Scene, atmosphere and lighting
  await showLoadingStage('Préparation de la lumière…');
  const scene = new THREE.Scene();
  const lightingSystem = new LightingSystem(scene, renderer, quality);
  markInit('lighting');

  // 3. Build Manhattan Geography, Iconic Landmarks, Blocks, Street Details & Traffic
  await showLoadingStage('Préparation des rues et des quais…');
  await Promise.all([loadNature(), loadTrees(), loadWorld(), loadGround(), loadClutter(), loadCars(undefined, { surveyedReflections: quality.id === 'high' }),
    loadStorefronts(), loadUrbanLight({ reflections: quality.id === 'high' }), loadCalibreKit(),
    // (without its aircraft the game still plays: the garage's two tiles would be empty air)
    loadAircraftModels().catch((error) => console.warn(`[aircraft] ${error.message}`))]);
  setTreeDetail(quality.trees);
  const cityGrid = buildCityGrid(scene);
  markInit('cityGrid');
  await showLoadingStage('Préparation des ponts et des quartiers…');
  const boroughs = buildBoroughs(scene, { sidewalks: cityGrid.sidewalks });
  markInit('boroughs');
  await showLoadingStage('Préparation de Manhattan…');
  const { colliders: landmarkColliders } = buildLandmarks(scene, { groundSurfaces: cityGrid.groundSurfaces });
  markInit('landmarks');
  await showLoadingStage('Préparation des bâtiments…');
  const cityBlocks = buildCityBlocks(scene, landmarkColliders);
  markInit('blocks');
  // Ground-floor shops, built in 3D around the camera (the facades paint them further out)
  const storefronts = createStorefronts(scene, cityBlocks.shops.filter(s => !s.calibre), { radius: { high: 300, balanced: 250, fluid: 170 }[quality.id] ?? 250 });
  markInit('storefronts');
  // Window sills, hoods and air conditioners in 3D around the camera (the facades paint them further out)
  const facadeKit = createFacadeKit(scene, cityBlocks.records, { radius: { high: 200, balanced: 160, fluid: 0 }[quality.id] ?? 160 });
  const allColliders = [...landmarkColliders, ...cityBlocks.colliders, ...cityBlocks.calibreSites.flatMap(calibreFixtures), ...storefronts.colliders, ...boroughs.colliders, ...(cityGrid.colliders || [])];

  await showLoadingStage('Préparation des rues…');
  const entranceReserves = cityBlocks.calibreSites.map(s => calibreBox(s, 0, 1.7, 3.4, 3.8, 0, 3.5));
  const streetDetails = buildStreetDetails(scene, [...allColliders, ...entranceReserves]);
  // Central Park's ground can now be told where its trees shade it (js/park-plan.js)
  surveyCentralPark(streetDetails.treeField.sites, (cityGrid.colliders || []).filter((c) => c.obstacle === 'rock'));
  markInit('streetDetails');
  await showLoadingStage('La ville prend vie…');
  await Promise.all([loadCharacters(), loadCrowd(CROWD_BODIES, CROWD_PROPS), loadCrowdMotion()]);
  const calibreWorld = createCalibreWorld(scene, cityBlocks.calibreSites);
  // Buildings turned along non-grid streets have oriented colliders whose world bounds reach past their lots: they stay
  // inside the property line anyway, so the road network (lanes & sidewalks) doesn't need them.
  // Elevated building sections that clear even a bus don't obstruct ground traffic.
  const grass = quality.grass ? createGrass(scene, scene, new THREE.Vector3(0, 10, 140)) : null;
  // The road network first: the street furniture lines its curbs, then the traffic drives it
  await showLoadingStage('Préparation de la circulation…');
  const roadNetwork = await buildRoadNetworkAsync(cityGrid.sidewalks, [
    ...cityGrid.footprints,
    ...streetDetails.footprints,
    ...allColliders.filter((c) => !c.obb && (c.minY ?? 0) < 3.5)
  ], streetDetails.signalIntersections, cityGrid.curbs);
  markInit('roads');
  await showLoadingStage('Préparation des trottoirs…');
  const footprintsBefore = streetDetails.footprints.length;
  const furniture = createSidewalkFurniture(scene, {
    network: roadNetwork, records: cityBlocks.records, shops: cityBlocks.shops.filter(s => !s.calibre), trunks: streetDetails.treeField.trunks, street: STREET,
    isOnSidewalk: streetDetails.isOnSidewalk, isClearOfPoles: streetDetails.isClearOfPoles, addPole: streetDetails.addPole,
    addFootprint: streetDetails.addFootprint, obstacles: streetDetails.obstacles, colliders: allColliders, entrances: entranceReserves, quality: quality.id
  });
  // what it put on the sidewalks keeps the pedestrians' routes clear of it
  for (let i = footprintsBefore; i < streetDetails.footprints.length; i++) roadNetwork.addObstacle(streetDetails.footprints[i]);
  markInit('furniture');
  const trafficSystem = createTrafficSystem(scene, cityGrid.sidewalks, [], streetDetails.signalIntersections, roadNetwork);
  markInit('traffic');
  const highwayTraffic = createHighwayTraffic(scene, cityGrid.highwayLanes, trafficSystem);
  // The cars parked along every curb, drawn with the traffic's models; gameplay.js takes them over when touched
  const parking = createParking(scene, trafficSystem.network, {
    hydrants: streetDetails.hydrants, footprints: [...cityGrid.footprints, ...streetDetails.footprints],
    storage: renderer.backend.isWebGPUBackend,
    isBlocked: (x, z) => gameplay ? gameplay.allCars.some((c) => c.mesh?.visible && Math.abs(c.position.x - x) < 5 && Math.abs(c.position.z - z) < 5) : false
  });
  // nobody parks at a bus stop or where a building site's dumpster stands
  for (const stop of furniture.busStops) parking.ban(stop.x, stop.z, 13);
  for (const b of furniture.roadBlocks) parking.ban(b.x, b.z, b.r);
  for (const site of cityBlocks.calibreSites) parking.ban(site.x, site.z, 6);
  markInit('parking');
  // People with somewhere to be: the crowd's density, its stops at the street's spots, doors, bus stops, cabs
  const streetLife = createStreetLife({
    pedestrians: trafficSystem.pedestrians, traffic: trafficSystem, shops: cityBlocks.shops.filter(s => !s.calibre), subwayMouths: streetDetails.subwayMouths,
    foodCarts: streetDetails.foodCarts, seats: furniture.seats, stands: furniture.stands, busStops: furniture.busStops,
    hourOf: () => gameplay?.atmosphere?.hour ?? 12
  });
  await showLoadingStage('Derniers préparatifs…');
  buildRoadSurface(scene, trafficSystem.network);
  buildGroundDressing(scene, trafficSystem.network, { grates: furniture.grates, cellars: furniture.cellars, treeGrates: streetDetails.treeGrates });
  buildRoadPaint(scene, trafficSystem.network, cityGrid.roadPaint);
  markInit('roadPaint');

  // 4. Initialize Third-Person Controllers (Person, Car, Cyclist, Helicopter) & Multi-Camera System
  await showLoadingStage('Préparation de votre personnage…');
  const jumpRamps = buildRamps(scene);
  const controllerManager = new ThirdPersonControllerManager(scene, [...allColliders, ...streetDetails.obstacles, ...jumpRamps.colliders]);
  controllerManager.landAt = boroughLandAt;
  controllerManager.bridgeDeckAt = bridgeDeckAt;
  controllerManager.parkWater = centralParkClearings?.water || [];
  controllerManager.groundSurfaces = cityGrid.groundSurfaces;
  parking.attach(controllerManager);
  // Pigeons on the sidewalks, gulls over the rivers, rats at night (birds.js); made before the shaders compile
  const toXZ = (list, key) => Float32Array.from(list.map((p) => p[key]));
  const birds = createBirds(scene, {
    groundHeight: (x, z) => controllerManager.getGroundHeight(x, z, 'person'),
    onSidewalk: (x, z) => roadNetwork.onSidewalk(x, z),
    perches: { x: toXZ(streetDetails.perches, 'x'), y: toXZ(streetDetails.perches, 'y'), z: toXZ(streetDetails.perches, 'z') },
    trashPiles: { x: toXZ(streetDetails.trashPiles, 'x'), z: toXZ(streetDetails.trashPiles, 'z') },
    nearWater: (x, z) => { const s = getIslandBoundsAtZ(z); return Math.min(Math.abs(x - s.westX), Math.abs(x - s.eastX)) < 150; },
    quality: quality.id
  });
  const birdWorld = { player: { x: 0, z: 0, speed: 0 }, cars: [], peds: [], hour: 12, night: 0 };
  markInit('birds');
  function savePlayerState() { gameplay?.save(); }

  const cameraSystem = new CameraSystem(renderer.domElement, controllerManager);
  const touchControls = new TouchControls(controllerManager);
  const soundButton = document.getElementById('btn-sound');
  const audioSystem = new CityAudioSystem({ controllerManager, trafficSystem, highwayTraffic, streetDetails }, {
    onStateChange: updateSoundButton
  });
  function updateSoundButton() {
    gameplay?.pauseMenu?.syncWorld();
    if (!soundButton) return;
    soundButton.disabled = !audioSystem.supported;
    soundButton.setAttribute('aria-pressed', String(audioSystem.enabled));
    soundButton.setAttribute('aria-label', audioSystem.enabled ? 'Mute sound' : 'Enable sound');
    soundButton.title = audioSystem.supported ? `${audioSystem.enabled ? 'Mute' : 'Enable'} sound [N]` : 'Web Audio is unavailable';
    soundButton.querySelector('use').setAttribute('href', audioSystem.enabled ? '#i-sound' : '#i-sound-off');
  }
  soundButton?.addEventListener('click', () => audioSystem.setEnabled(!audioSystem.enabled));
  updateSoundButton();
  // pagehide also covers navigation away on mobile; preserve the context across back-forward cache restores.
  window.addEventListener('pagehide', (event) => {
    savePlayerState();
    if (!event.persisted) audioSystem.dispose();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) savePlayerState(); });
  markInit('controllers');

  // Island-wide static geometry: chunk & distance-cull the small props, shadow stand-ins for the big casters
  // (scene-culling.js)
  await showLoadingStage('Préparation du quartier…');
  const cullingRoots = ['ManhattanCityGrid', 'ManhattanCityBlocks', 'ManhattanStreetDetails', 'ManhattanLandmarks', 'Boroughs', 'RoadMarkings', 'GroundRoads', 'GroundDressing']
    .map((name) => scene.getObjectByName(name))
    .filter(Boolean);
  setupSceneCulling(scene, cullingRoots, lightingSystem.sunLight.shadow, quality);
  calibreWorld.setExteriorRoots(scene.children.filter(o => /^(Manhattan|Boroughs|Storefronts|FacadeKit|SidewalkFurniture|HighwayTraffic|ParkedCars|Ground|Road|StreetAnimals|CullCell|ShadowProxy)/.test(o.name)));

  // Initialize static world matrices once, including the chunks and shadow proxies created above.
  // Crowd, tree and building-detail animation changes instance/pose buffers, not Object3D transforms.
  const dynamicRoots = [
    trafficSystem.group,
    highwayTraffic.group,
    storefronts.group, // its shopfront spotlights move every frame
    scene.getObjectByName('StreetClusteredLights'),
    ...Object.values(controllerManager.entities).map((entity) => entity.mesh),
    controllerManager.entities.cyclist.helmet
  ];
  scene.updateMatrixWorld(true);
  scene.matrixWorldAutoUpdate = false;
  markInit('culling');

  // On WebGPU, small InstancedMeshes (<= 1000 instances) keep their matrices in uniform buffers that three.js
  // re-uploads on every draw of every pass (~2.5 MB/frame with the shadow cascades, stalling the GPU queue).
  // Storage attributes only upload when needed; WebGL2 needs ordinary instanced attributes for correct transforms.
  if (renderer.backend.isWebGPUBackend) {
    scene.traverse((object) => {
      if (object.isInstancedMesh) {
        object.instanceMatrix = new THREE.StorageInstancedBufferAttribute(object.instanceMatrix.array, 16);
      }
    });
  }

  // 5. TSL RenderPipeline with Half-Res Screen Space Reflections (SSRNode), Bloom & Filmic Toning
  //    Fade out distant and matte surfaces so SSR spends its rays on visible glossy reflections.
  await showLoadingStage('Préparation de votre arrivée…');
  const scenePass = pass(scene, cameraSystem.camera);
  const scenePassColor = scenePass.getTextureNode('output');
  let sceneMRT = null;
  let reflections = vec3(0);
  if (renderer.backend.isWebGPUBackend && quality.reflections) {
    // The multisampled colour attachments (output, normal, metalRough) only need resolving, never storing: discarding
    // them spares the GPU writing 3 x 4 samples per pixel to memory every frame (transient, memoryless attachments where
    // the browser supports them). The multisampled depth stays stored: SSR reads it.
    scenePass.renderTarget.storeMultisampledColorBuffer = false;
    const ssrFade = smoothstep(360.0, 180.0, positionView.z.negate());
    const maxSSRRoughness = 0.75;
    sceneMRT = mrt({
      output: output,
      normal: normalView,
      metalRough: vec2(roughness.lessThan(maxSSRRoughness).select(metalness.mul(ssrFade), 0), roughness)
    });
    sceneMRT.setBlendMode('normal', new THREE.BlendMode(THREE.MaterialBlending));
    sceneMRT.setBlendMode('metalRough', new THREE.BlendMode(THREE.MaterialBlending));
    scenePass.setMRT(sceneMRT);

    const scenePassDepth = scenePass.getTextureNode('depth');
    const scenePassNormal = scenePass.getTextureNode('normal');
    const scenePassMetalRough = scenePass.getTextureNode('metalRough');

    const ssrPass = ssr(scenePassColor, scenePassDepth, scenePassNormal, {
      metalnessNode: scenePassMetalRough.r,
      roughnessNode: scenePassMetalRough.g,
      camera: cameraSystem.camera
    });
    ssrPass.resolutionScale = 0.5;
    ssrPass.blurQuality = 1;
    ssrPass.maxDistance.value = 42;
    ssrPass.thickness.value = 0.85;
    // Fewer coarse steps, then refine detected hits to keep reflection edges precise.
    ssrPass.quality.value = 0.25;
    ssrPass.binaryRefine = true;
    ssrPass.intensity.value = 0.50;
    ssrPass.screenEdgeFadeBlack = true;

    // Roughness mip blur must not spread reflections back onto matte or nonreflective surfaces.
    const reflectionMask = scenePassMetalRough.r.greaterThan(0).select(smoothstep(maxSSRRoughness, 0.55, scenePassMetalRough.g), 0);
    reflections = ssrPass.mul(reflectionMask);
  } else {
    // Materials made while the modules loaded, before the level was known (tsl-materials.js)
    scene.traverse((o) => {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m?.mrtNode) m.mrtNode = null;
    });
  }
  // Ambient occlusion: horizon-based (GTAO) at half resolution over the depth (and the normals when the reflections'
  // MRT carries them), then a depth-aware blur so it never grains. What it buys is the ground under every car and
  // body, the foot of every wall, the dark between parked cars: the image stops floating.
  // ?ao=0 and ?fx=0 (no sun shafts, fringe or sharpening) leave the effects out, to measure them or to spare a weak GPU
  const urlParams = new URLSearchParams(location.search);
  let aoNode = null, aoPass = null;
  if (renderer.backend.isWebGPUBackend && quality.ao && urlParams.get('ao') !== '0') {
    const depth = scenePass.getTextureNode('depth');
    aoPass = new GTAONode(depth, sceneMRT ? scenePass.getTextureNode('normal') : null, cameraSystem.camera);
    aoPass.resolutionScale = 0.5;
    aoPass.radius.value = 1.3;
    aoPass.thickness.value = 1.6;
    aoPass.distanceExponent.value = 1.0;
    aoPass.distanceFallOff.value = 0.6;
    aoPass.scale.value = 1.15;
    aoPass.samples.value = quality.aoSamples || 8;
    const smoothed = new DenoiseNode(convertToTexture(aoPass.getTextureNode()), depth, null, cameraSystem.camera);
    smoothed.radius.value = 4;
    smoothed.lumaPhi.value = 8;
    smoothed.depthPhi.value = 4;
    smoothed.normalPhi.value = 4;
    // the blur runs at half resolution too (its taps are the dear part), and the final pass samples it bilinearly
    aoNode = rtt(smoothed, null, null, { resolutionScale: 0.5 });
  }
  const lensFx = urlParams.get('fx') !== '0';
  const colorGrade = createPostProcessing(renderer, scenePassColor, reflections, lensFx ? scenePassColor : null, aoNode, lensFx && renderer.backend.isWebGPUBackend ? scenePass.getTextureNode('depth') : null);
  const renderPipeline = new THREE.RenderPipeline(renderer, colorGrade.outputNode);

  // 6. Wire UI Controls (Strictly using safe DOM APIs: textContent, classList, addEventListener)
  const modeButtons = document.querySelectorAll('[data-mode]');
  const cameraButtons = document.querySelectorAll('[data-camera]');
  const timeButtons = document.querySelectorAll('[data-time]');
  const teleportButtons = document.querySelectorAll('[data-teleport]');
  const hudToggleBtn = document.getElementById('btn-toggle-hud');
  const modeSwitch = document.getElementById('mode-switch');
  touchControls.onAvailabilityChange = placeModeIndicator;

  const elFps = document.getElementById('hud-fps');
  const elMode = document.getElementById('hud-active-mode');
  const elCamera = document.getElementById('hud-active-camera');
  const elSpeed = document.getElementById('hud-speed');
  const elSpeedMeter = document.getElementById('hud-speed-meter');
  const elAltitude = document.getElementById('hud-altitude');
  const elLocation = document.getElementById('hud-location');
  const elControlsHint = document.getElementById('hud-controls-hint');
  const gamepadControls = new GamepadControls(controllerManager, cameraSystem, {
    onCycleCamera: cycleCamera,
    onHorn: honk
  });

  function honk() {
    const ent = controllerManager.getActiveEntity();
    audioSystem.honk(ent);
    birds.scatter(ent.position.x, ent.position.z, 22);
  }

  // Keyboard guide for each mode: [keys, action]
  const controlHints = {
    person: [[['W', 'S'], 'Walk / Run'], [['A', 'D'], 'Turn'], [['Space'], 'Jump'], [['Drag'], 'Orbit']],
    car: [[['W', 'S'], 'Drive / Reverse'], [['A', 'D'], 'Steer'], [['B'], 'Horn'], [['Drag'], 'Orbit']],
    cyclist: [[['W', 'S'], 'Pedal / Brake'], [['A', 'D'], 'Lean & Turn'], [['Drag'], 'Orbit']],
    helicopter: [[['W', 'S'], 'Pitch'], [['A', 'D'], 'Yaw'], [['Space'], 'Ascend'], [['Q', 'C'], 'Descend']],
    plane: [[['W', 'S'], 'Nose'], [['A', 'D'], 'Bank'], [['Space'], 'Throttle up'], [['Q', 'C'], 'Throttle down']]
  };
  // Top speeds in mph (controllers.js caps them at 8.2, 36, 19 & 52 m/s): full scale of the speed meter
  const topSpeedMph = { person: 18, car: 81, cyclist: 43, helicopter: 116, plane: 195 };

  function renderControlHints(mode) {
    if (!elControlsHint) return;
    const items = (controlHints[mode] || []).map(([keys, action]) => {
      const item = document.createElement('span');
      item.className = 'hint';
      for (const key of keys) {
        const kbd = document.createElement('kbd');
        kbd.textContent = key;
        item.appendChild(kbd);
      }
      const label = document.createElement('span');
      label.className = 'hint-label';
      label.textContent = action;
      item.appendChild(label);
      return item;
    });
    elControlsHint.replaceChildren(...items);
  }

  // The taxi-yellow pill under the selected mode glides from button to button
  function placeModeIndicator() {
    const active = modeSwitch ? modeSwitch.querySelector('.mode-btn.active') : null;
    if (!active) return;
    modeSwitch.style.setProperty('--ind-x', `${active.offsetLeft}px`);
    modeSwitch.style.setProperty('--ind-w', `${active.offsetWidth}px`);
  }

  function selectMode(mode) {
    controllerManager.setMode(mode);
    touchControls.setMode(controllerManager.activeMode);
    gamepadControls.reset();
    modeButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
    });
    document.body.dataset.mode = mode;
    placeModeIndicator();
    const ent = controllerManager.getActiveEntity();
    if (elMode) elMode.textContent = ent.label;
    renderControlHints(mode);

    // If currently on a static scenic camera, switch to 3rd-Person Chase so user sees their selected character/vehicle
    const currentCam = cameraSystem.getActivePreset();
    if (currentCam.category !== 'follow') {
      selectCamera('chase', false);
    }
  }

  function selectCamera(camId, snap = false) {
    cameraSystem.setCameraPreset(camId, snap);
    cameraButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-camera') === camId);
    });
    const preset = cameraSystem.getActivePreset();
    if (elCamera) elCamera.textContent = preset.name;
  }

  // Steps through CAMERA_PRESETS (V / Shift+V, and the arrows either side of the camera name)
  function cycleCamera(step) {
    const presets = CAMERA_PRESETS.filter(p => p.category === 'follow');
    const n = presets.length;
    const idx = presets.findIndex((p) => p.id === cameraSystem.activePresetId);
    selectCamera(presets[(idx + step + n) % n].id, true);
  }

  function selectTime(timeId) {
    lightingSystem.applyPreset(timeId);
    colorGrade.applyPreset(lightingSystem.activePresetId);
    timeButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-time') === timeId);
    });
  }

  // Popovers (native [popover]: light dismiss & Esc for free) open against the control that toggles them: data-anchor
  // names the element they sit above / below, data-align the one whose right edge they line up with
  const popovers = document.querySelectorAll('.popover[popover]');
  const supportsPopover = typeof HTMLElement.prototype.togglePopover === 'function';
  function closePopovers() {
    if (!supportsPopover) return;
    popovers.forEach((pop) => {
      if (pop.matches(':popover-open')) pop.hidePopover();
    });
  }
  popovers.forEach((pop) => {
    const invoker = document.querySelector(`[popovertarget="${pop.id}"]`);
    pop.addEventListener('beforetoggle', (e) => {
      const open = e.newState === 'open';
      if (invoker) invoker.classList.toggle('is-open', open);
      if (!open) return;
      const anchor = document.getElementById(pop.dataset.anchor) || invoker;
      const align = document.getElementById(pop.dataset.align) || invoker;
      if (!anchor || !align) return;
      const r = anchor.getBoundingClientRect();
      const spaceAbove = Math.max(0, r.top - 20);
      const spaceBelow = Math.max(0, window.innerHeight - r.bottom - 20);
      let above = pop.dataset.side === 'above';
      // The camera control moves to the top on touch screens; open toward the available space.
      if ((above ? spaceAbove : spaceBelow) < 160) above = spaceAbove > spaceBelow;
      pop.style.right = `${Math.max(8, window.innerWidth - align.getBoundingClientRect().right)}px`;
      if (above) {
        pop.style.top = 'auto';
        pop.style.bottom = `${window.innerHeight - r.top + 8}px`;
        pop.style.maxHeight = `${spaceAbove}px`;
      } else {
        pop.style.bottom = 'auto';
        pop.style.top = `${r.bottom + 8}px`;
        pop.style.maxHeight = `${spaceBelow}px`;
      }
    });
  });

  modeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectMode(btn.getAttribute('data-mode'));
    });
  });

  cameraButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectCamera(btn.getAttribute('data-camera'), true);
      closePopovers();
    });
  });

  const camPrevBtn = document.getElementById('cam-prev');
  const camNextBtn = document.getElementById('cam-next');
  if (camPrevBtn) camPrevBtn.addEventListener('click', () => cycleCamera(-1));
  if (camNextBtn) camNextBtn.addEventListener('click', () => cycleCamera(1));

  timeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectTime(btn.getAttribute('data-time'));
    });
  });

  // A mouse click mustn't leave the focus on a HUD button, or Space (jump / ascend) and Enter would press it again
  document.addEventListener('click', (e) => {
    const btn = e.target instanceof Element ? e.target.closest('button') : null;
    if (btn && e.detail > 0 && !btn.closest('#game-menu, dialog')) btn.blur();
  });

  // Where you are: the place's name over its street corner, drawn as a pair of NYC street-name signs
  const roadNames = new Set(ROADS.map((r) => r.name));
  const placeNames = new Set(NYC_LANDMARKS.map((l) => l.name));
  let locationText = '';
  function renderLocation(label) {
    if (!elLocation || label === locationText) return;
    locationText = label;
    let place = '';
    let streets = label;
    const split = label.indexOf(' · ');
    if (split >= 0) {
      place = label.slice(0, split);
      streets = label.slice(split + 3);
    } else if (placeNames.has(label) || (!label.includes(' & ') && !roadNames.has(label))) {
      place = label;
      streets = '';
    }
    const nodes = [];
    if (place) {
      const el = document.createElement('div');
      el.className = 'location-place';
      el.textContent = place;
      nodes.push(el);
    }
    if (streets) {
      const row = document.createElement('div');
      row.className = 'location-signs';
      if (streets.startsWith('near ')) {
        streets = streets.slice(5);
        const near = document.createElement('span');
        near.className = 'location-near';
        near.textContent = 'near';
        row.appendChild(near);
      }
      for (const name of streets.split(' & ')) {
        const sign = document.createElement('span');
        sign.className = 'street-sign';
        sign.textContent = name;
        row.appendChild(sign);
      }
      nodes.push(row);
    }
    elLocation.replaceChildren(...nodes);
  }

  function teleportTo(x, z, heading = Math.PI) {
    const destination = controllerManager.teleportActiveTo(x, z, heading);
    touchControls.reset();
    gamepadControls.reset();
    cameraSystem.resetForTeleport();
    selectCamera('chase', true);
    mapSystem.waypoint = {
      x: destination.x,
      z: destination.z,
      name: getLocationLabel(destination.x, destination.z)
    };
    return destination;
  }

  const mapSystem = new NYCMapSystem({
    controllerManager,
    cameraSystem,
    trafficSystem,
    allBlocks: cityBlocks.allBlocks,
    onToggle: (open) => {
      controllerManager.resetInput();
      const enabled = !open && !!gameplay?.active;
      touchControls.setEnabled(enabled);
      gamepadControls.setEnabled(enabled);
      gameplay?.pauseMenu?.onMapToggle(open);
      const mapHint = document.getElementById('fullmap-hover-info');
      if (open && touchControls.available && mapHint) {
        mapHint.textContent = 'Tap to teleport · Drag to pan · Use + / − to zoom';
      }
    },
    onTeleport: teleportTo
  });

  teleportButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-teleport');
      const loc = TELEPORT_LOCATIONS[key];
      if (loc) {
        teleportTo(loc.x, loc.z, loc.heading);
      }
      closePopovers();
    });
  });

  const openMapBtn = document.getElementById('btn-open-map');
  if (openMapBtn) openMapBtn.addEventListener('click', () => mapSystem.toggleFullMap(true));

  if (hudToggleBtn) {
    hudToggleBtn.addEventListener('click', () => {
      document.body.classList.toggle('hud-minimized');
      const isMin = document.body.classList.contains('hud-minimized');
      hudToggleBtn.setAttribute('aria-pressed', String(isMin));
      hudToggleBtn.setAttribute('aria-label', isMin ? 'Show HUD' : 'Hide HUD');
      hudToggleBtn.title = isMin ? 'Show the HUD [H]' : 'Clean view: hide the HUD [H]';
      if (isMin) closePopovers();
    });
  }

  // Global keyboard shortcuts for modes (1-4), cameras (V / 5-0), and HUD (H)
  window.addEventListener('keydown', (e) => {
    if (isTypingInField(e) || !gameplay?.active) return;
    switch (e.code) {
      case 'KeyV':
        cycleCamera(e.shiftKey ? -1 : 1);
        break;
      case 'KeyH':
        if (hudToggleBtn) hudToggleBtn.click();
        break;
      case 'KeyN':
        if (!e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) audioSystem.setEnabled(!audioSystem.enabled);
        break;
      case 'KeyB':
        if (!e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey && !mapSystem.isFullMapOpen) honk();
        break;
    }
  });

  window.addEventListener('resize', () => {
    cameraSystem.onResize(window.innerWidth, window.innerHeight);
    renderer.setSize(window.innerWidth, window.innerHeight);
    placeModeIndicator();
    if (mapSystem.isFullMapOpen) {
      mapSystem.resizeFullCanvas();
      mapSystem.renderFullMap();
    }
  });

  // Initialize the UI and chase camera around the restored player, or the default taxi on a first visit.
  selectMode(controllerManager.activeMode);
  selectCamera('chase', true);
  selectTime('golden');
  gameplay = new Playground({ controllers: controllerManager, camera: cameraSystem, traffic: trafficSystem, highway: highwayTraffic, streets: streetDetails,
    scene, onMode: selectMode, onTime: selectTime, audio: audioSystem, map: mapSystem, touch: touchControls, gamepad: gamepadControls,
    lighting: lightingSystem, grade: colorGrade, parking });
  gameplay.calibre = new CalibreSystem(gameplay, calibreWorld, cityBlocks.calibreSites);
  gameplay.openingScreen = opening;
  gamepadControls.game = gameplay;
  // The Architect (ARCHITECTE.md) is a local development tool: on this machine or its network only, never online, where
  // the production build does not even ship his files (scripts/build.mjs). Built here, before the shaders compile, so his
  // car and helicopter compile behind the loading screen. ?architecte=0 plays without him, as online.
  // The street's small stories (ambient-events.js), and what the city sounds like where the listener stands
  gameplay.birds = birds;
  gameplay.ambient = createAmbientEvents({ game: gameplay, traffic: trafficSystem, pedestrians: trafficSystem.pedestrians, streetLife, streetDetails, hourOf: () => gameplay.atmosphere.hour });
  {
    const BARS = new Set(['bar', 'latin', 'restaurant']);
    let probeAt = -Infinity;
    const probe = { crowd: 0, hour: 12, subway: 0, construction: 0, bar: 0, birds: 0, water: 0, indoor: 0, rain: 0 };
    const nearestOf = (list, x, z, r) => { let best = r; for (const p of list) { const dx = p.x - x, dz = p.z - z; if (Math.abs(dx) > r || Math.abs(dz) > r) continue; const d = Math.hypot(dx, dz); if (d < best) best = d; } return best; };
    audioSystem.ambienceProbe = (position) => {
      const t = performance.now();
      if (t - probeAt < 250) return probe;
      probeAt = t;
      const x = position.x, z = position.z;
      let crowd = 0;
      for (const p of trafficSystem.peds) if (p.placed && Math.abs(p.x - x) < 45 && Math.abs(p.z - z) < 45) crowd++;
      probe.crowd = Math.min(1, crowd / 38);
      probe.hour = gameplay.atmosphere.hour;
      probe.rain = gameplay.atmosphere.rain || 0;
      probe.subway = 1 - nearestOf(streetDetails.subwayMouths, x, z, 45) / 45;
      probe.subway = Math.max(probe.subway, 0.8 * (1 - nearestOf(furniture.grates, x, z, 30) / 30));
      probe.construction = 1 - nearestOf(furniture.sheds, x, z, 70) / 70;
      probe.bar = 1 - Math.min(40, streetLife.nearestOpen(BARS, x, z, 40)) / 40;
      const shore = getIslandBoundsAtZ(z);
      probe.water = Math.max(0, 1 - Math.min(Math.abs(x - shore.westX), Math.abs(x - shore.eastX)) / 160);
      probe.birds = gameplay.birds?.near ? gameplay.birds.near(x, z) : 0;
      probe.indoor = gameplay.calibre.inside ? 0.88 : 0;
      return probe;
    };
  }
  if (architectAllowed()) {
    try {
      const { ArchitectSystem } = await import('./architect.js');
      gameplay.architect = new ArchitectSystem(gameplay);
    } catch (error) {
      console.warn('[architecte] indisponible', error);
    }
  }
  cameraSystem.initialized = false;
  controllerManager.update(0.016, 0, controllerManager.getActiveEntity().position);
  cameraSystem.update(0.016, 0);
  updateSceneCulling(cameraSystem.camera.position);
  // the curbs around the start fill before the shaders compile, so the first frame shows them
  for (let i = 0; i < 12; i++) parking.update(cameraSystem.camera, gameplay.atmosphere.hour, gameplay.atmosphere.day, 0);
  // the web fonts change the buttons' widths once they arrive
  if (document.fonts) document.fonts.ready.then(placeModeIndicator);
  markInit('ui');

  // Garage cars wait far outside the camera. Warm their colour AND shadow pipelines before the loading screen
  // goes away; compileAsync respects the frustum, so simply leaving their roots visible is not enough.
  const warmupCarMeshes = [];
  for (const ride of gameplay.rides) {
    if (!ride.body) continue;
    ride.mesh.updateMatrixWorld(true);
    ride.mesh.traverse(object => {
      if (!object.isMesh || !object.frustumCulled) return;
      warmupCarMeshes.push(object);
      object.frustumCulled = false;
    });
  }

  // Props, bodies and cars share the same local ambient light as the masonry. Materials with their own cavity /
  // foliage occlusion already include this field in tsl-materials.js. Set this before any shader is compiled.
  const litMaterials = new Set();
  scene.traverse(o => {
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m || litMaterials.has(m)) continue;
      litMaterials.add(m);
      if ((m.isMeshStandardNodeMaterial || m.isMeshPhysicalNodeMaterial) && !m.aoNode) m.aoNode = urbanSkyVisibility();
    }
  });

  // Compile shaders behind the loading screen. Overlapping compileAsync() jobs keep compilation moving
  // while individual jobs yield to the browser.
  const COMPILE_POOL = 8;
  const nextTask = () => (globalThis.scheduler?.yield ? globalThis.scheduler.yield() : new Promise((resolve) => setTimeout(resolve, 0)));
  async function precompileShaders() {
    await showLoadingStage('Derniers préparatifs…');
    // An empty frame first: it sets up the post-processing chain, which configures the scene pass's render target
    // (MSAA samples, depth format), so the pipelines compiled below are the very ones the scene pass asks for
    scene.visible = false;
    renderPipeline.render();
    scene.visible = true;
    markInit('postFX');

    // Every visible object with frustum culling off (like the warm-up frame, see the loop). Plain meshes that share
    // a material share its shader, so one job compiles them in turn (the first build serves the rest); every
    // instanced mesh gets a build of its own unless its chunks share a pipeline
    const culled = [];
    const jobs = [];
    const jobByMaterial = new Map();
    const pipelines = new Set();
    scene.traverseVisible((o) => {
      // Distance-culling stays active during warm-up: compile the starting area first.
      if (!o.isMesh && !o.isLine && !o.isPoints && !o.isSprite) return;
      // Use the first visible chunk: the original representative may be in an inactive tree cell. Shadow stand-ins
      // only draw in the shadow maps (the warm-up frame compiles those).
      if (o.userData.shadowProxy) return;
      const pipeline = o.userData.sharesPipelineWith || o;
      if (pipelines.has(pipeline)) return;
      pipelines.add(pipeline);
      if (o.isInstancedMesh || Array.isArray(o.material)) {
        jobs.push([o]);
        return;
      }
      let job = jobByMaterial.get(o.material);
      if (!job) {
        job = [];
        jobByMaterial.set(o.material, job);
        jobs.push(job);
      }
      job.push(o);
    });

    await showLoadingStage(`Derniers préparatifs… 0 %`);
    opening.progress(0);
    renderer.setRenderTarget(scenePass.renderTarget);
    if (sceneMRT) renderer.setMRT(sceneMRT);
    const compile = async (object) => {
      // Each compile starts in a task of its own: compileAsync() keeps one precompilation state on the renderer,
      // which must not be mid-step for two of them in the same microtask checkpoint
      await nextTask();
      try {
        await renderer.compileAsync(object, cameraSystem.camera, scene);
      } catch (e) {
        console.warn('[compile]', e); // the warm-up frame compiles it instead
      }
    };
    let next = 0;
    let done = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        for (const object of job) await compile(object);
        done++;
        opening.status.textContent = `Derniers préparatifs… ${Math.round((done / jobs.length) * 100)} %`;
        opening.progress(done / jobs.length);
      }
    };
    await Promise.all(Array.from({ length: COMPILE_POOL }, worker));
    renderer.setMRT(null);
    renderer.setRenderTarget(null);
    for (const o of culled) o.frustumCulled = true;
  }

  // Smoke, flashes, rain, beacons: effects draw their colour and leave the reflections' normals alone, or the ambient
  // occlusion darkens the whole square each is drawn on (js/effect-outputs.js). Whatever was made without saying so is
  // caught here, before its shader is compiled, and then a few hundred objects a frame for what is made later.
  // the aircraft wear their models before the shaders are compiled, so nothing compiles on the first take-off
  await Promise.all(Object.values(controllerManager.aircraft).map((a) => a.model.ready));
  sealEffects(scene);
  const sweepEffects = effectSweeper(scene);
  if (renderer.backend.isWebGPUBackend) await precompileShaders();
  if (graphicsLost) throw new Error('Graphics device lost during loading');
  markInit('compile');
  await showLoadingStage('Votre quartier est presque prêt…');

  // 6. Animation Loop
  let lastTime = performance.now();
  let elapsed = 0;
  let frameCount = 0;
  let fpsTimer = 0;
  let nextPlayerSave = 0;
  let warmedUp = false; // see the first frame below
  const pacer = new FramePacer({ renderer, level: quality, isActive: () => gameplay.active });
  let qaView = null;
  let qaViewFov = null;
  const applyQAView = () => {
    if (!qaView) return;
    const camera = cameraSystem.camera;
    camera.position.set(qaView[0], qaView[1], qaView[2]);
    camera.lookAt(qaView[3], qaView[4], qaView[5]);
    if (Number.isFinite(qaView[6]) && camera.fov !== qaView[6]) {
      camera.fov = qaView[6];
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
  };
  if (new URLSearchParams(location.search).has('qa')) {
    window.__render = { renderer, scene, lightingSystem, cameraSystem, pacer, THREE, cityGrid, highwayTraffic, streetDetails, storefronts, facadeKit, cityBlocks, parking, furniture, streetLife, birds, colorGrade, aoPass, aoNode,
      // Inspection: the camera goes where it is told, whatever the game does
      view(x, y, z, tx, ty, tz, fov) {
        if (x === undefined) {
          qaView = null;
          if (qaViewFov !== null) { cameraSystem.camera.fov = qaViewFov; cameraSystem.camera.updateProjectionMatrix(); }
          qaViewFov = null;
        } else {
          if (qaViewFov === null) qaViewFov = cameraSystem.camera.fov;
          qaView = [x, y, z, tx, ty, tz, Number.isFinite(fov) ? Math.max(15, Math.min(100, fov)) : null];
          applyQAView();
        }
      } };
    gameplay.renderForQA = () => {
      cameraSystem.update(0.016, elapsed);
      updateSceneCulling(cameraSystem.camera.position);
      for (const root of dynamicRoots) root.updateMatrixWorld();
      applyQAView();
      calibreWorld.render(cameraSystem.camera, () => renderPipeline.render());
    };
  }

  if (elFps) elFps.textContent = '60';

  // ?stats: milliseconds per system, averaged and shown beside the frame rate
  const profile = diagnostics ? { marks: {}, last: 0, gpu: 0, gpuBusy: false, draws: 0, tris: 0 } : null;
  const mark = (name) => {
    const t = performance.now();
    profile.marks[name] = (profile.marks[name] || 0) + t - profile.last;
    profile.last = t;
  };
  if (profile) window.__profile = profile;

  const frame = (now) => {
    if (gameplay.qaFrozen) { lastTime = now; return; }
    if (pacer.skip(now)) return;
    if (profile) profile.last = performance.now();
    const rawDt = (now - lastTime) * 0.001;
    lastTime = now;
    const dt = Math.min(Math.max(rawDt, 0.001), 0.05);
    const late = sweepEffects();
    if (late.length) console.warn(`[effects] sealed after the fact: ${[...new Set(late)].join(', ')}`);
    if (audioSystem.ready && !graphicsLost) gamepadControls.update(dt);
    if (opening.ready) return; // The first frame is warm. Save the GPU while the player is on the title screen.
    elapsed += dt;
    const liveShop = gameplay.playing && !gameplay.paused && !mapSystem.isFullMapOpen && gameplay.shops.open?.calibre;
    const simulationDt = gameplay.active || liveShop ? dt * gameplay.timeScale : 0;
    const worldDt = !gameplay.playing ? dt : simulationDt;

    // Update 3rd-person controllers, camera, signals, traffic & vehicle collisions, building LODs, and dynamic shadow focus
    gameplay.beforeUpdate(simulationDt);
    if (simulationDt > 0 && gameplay.active) controllerManager.update(simulationDt, elapsed, cameraSystem.initialized ? cameraSystem.currentPos : null);
    cameraSystem.update(simulationDt > 0 ? simulationDt : dt, elapsed);
    colorGrade.speedBlur.value = Math.max(0, cameraSystem.speedFov - 7) / 20;
    streetDetails.signalClock.value = elapsed;
    if (profile) mark('joueur');
    if (worldDt > 0) trafficSystem.update(
      worldDt,
      elapsed,
      cameraSystem.currentPos,
      controllerManager.getActiveEntity(),
      controllerManager.activeMode,
      cameraSystem.camera
    );
    if (worldDt > 0) highwayTraffic.update(worldDt, cameraSystem.camera, controllerManager.getActiveEntity(), controllerManager.activeMode);
    parking.update(cameraSystem.camera, gameplay.atmosphere.hour, gameplay.atmosphere.day, worldDt);
    if (worldDt > 0) streetLife.update(worldDt, cameraSystem.camera);
    if (simulationDt > 0) gameplay.ambient?.update(simulationDt, cameraSystem.camera);
    if (worldDt > 0) {
      const pe = controllerManager.getActiveEntity(), cam = cameraSystem.camera.position;
      birdWorld.player.x = pe.position.x; birdWorld.player.z = pe.position.z; birdWorld.player.speed = Math.abs(pe.speed || 0) + Math.hypot(pe.vx || 0, pe.vz || 0);
      birdWorld.cars.length = 0;
      for (const v of trafficSystem.vehicles) if (v.edge && Math.abs(v.x - cam.x) < 70 && Math.abs(v.z - cam.z) < 70) birdWorld.cars.push({ x: v.x, z: v.z, speed: v.speed });
      for (const c of gameplay.allCars) if (c.mesh?.visible && Math.abs(c.position.x - cam.x) < 70 && Math.abs(c.position.z - cam.z) < 70) birdWorld.cars.push({ x: c.position.x, z: c.position.z, speed: Math.abs(c.speed || 0) });
      birdWorld.peds.length = 0;
      for (const p of trafficSystem.peds) if (p.placed && Math.abs(p.x - cam.x) < 60 && Math.abs(p.z - cam.z) < 60) birdWorld.peds.push({ x: p.x, z: p.z, speed: p.v || 0 });
      birdWorld.hour = gameplay.atmosphere.hour;
      birdWorld.night = gameplay.atmosphere.night || 0;
      birds.update(worldDt, cameraSystem.camera, birdWorld);
    }
    furniture.update(cameraSystem.camera);
    if (profile) mark('trafic');
    gameplay.update(simulationDt);
    if (profile) mark('jeu');
    if (!document.hidden && now >= nextPlayerSave) {
      savePlayerState();
      nextPlayerSave = now + 5000;
    }
    if (boroughs.update) boroughs.update(elapsed); // Roosevelt Island Tramway cabins
    cityBlocks.update(cameraSystem.currentPos.x, cameraSystem.currentPos.z);
    grass?.update(cameraSystem.camera.position);
    storefronts.update(cameraSystem.camera, gameplay.atmosphere.hour, dt);
    facadeKit.update(cameraSystem.camera);
    if (streetDetails.update) streetDetails.update(cameraSystem.camera);
    // The wind that carries the paraglider is the one that bends the trees: the weather's, gusts and all
    const air = gameplay?.vertical?.wind;
    if (air) treeUniforms.wind.value.set(Math.sin(air.dir), Math.cos(air.dir), air.base, air.gust);
    lightingSystem.update(cameraSystem.currentPos, cameraSystem.camera, now);
    mapSystem.update();
    audioSystem.update(dt, elapsed, cameraSystem.camera, lightingSystem.activePresetId === 'midnight', gameplay.active || liveShop,
      cameraSystem.activePresetId === 'pov' ? 'pov' : 'chase');
    updateSceneCulling(cameraSystem.camera.position);
    // Traffic collisions can move the player after controller updates; finalize moving hierarchies here.
    for (const root of dynamicRoots) root.updateMatrixWorld();
    applyQAView();
    if (profile) mark('ville');

    // Render frame via TSL RenderPipeline (SSR + Bloom)
    if (!warmedUp) {
      // First frame = pipeline warm-up behind the loading screen, for what precompileShaders() can't reach (the shadow
      // map passes): with frustum culling off, every visible material's pipelines compile now instead of stalling the
      // first time the camera turns towards it (one chunk / shadow stand-in per shared pipeline is enough)
      const culled = [];
      const pipelines = new Set();
      scene.traverseVisible((o) => {
        const pipeline = o.userData.sharesPipelineWith || o;
        if (pipelines.has(pipeline)) return;
        pipelines.add(pipeline);
        // Preserve view and distance culling on the first frame too.
      });
      renderPipeline.render();
      for (const object of warmupCarMeshes) object.frustumCulled = true;
      warmupCarMeshes.length = 0;
      for (const o of culled) o.frustumCulled = true;
      markInit('warmup');
    }
    // the Architect's own eye: a photo frame rendered and read back just before the player's (local development only)
    gameplay.architect?.beforeRender(cameraSystem.camera, () => renderPipeline.render(), renderer.domElement);
    calibreWorld.render(cameraSystem.camera, () => renderPipeline.render());
    // the Architect's photos read the frame back here, while it is still on the canvas (local development only)
    gameplay.architect?.afterRender(renderer.domElement);
    pacer.submitted(now);
    if (profile) {
      mark('rendu');
      profile.draws = renderer.info.render.drawCalls;
      profile.tris = renderer.info.render.triangles;
      // GPU time: from the submission to the moment the queue has drained (one measure in flight at a time)
      const device = renderer.backend.device;
      if (device && !profile.gpuBusy) {
        profile.gpuBusy = true;
        const t = performance.now();
        device.queue.onSubmittedWorkDone().then(() => { profile.gpu = performance.now() - t; profile.gpuBusy = false; profile.gpuSum = (profile.gpuSum || 0) + profile.gpu; profile.gpuN = (profile.gpuN || 0) + 1; });
      }
    }
    if (!warmedUp) {
      warmedUp = true;
      markInit('firstFrame');
      // The loading screen stays up until the GPU has got through the first frame (and the pipelines its warm-up
      // compiled), i.e. until the city is actually on screen
      const device = renderer.backend.device;
      opening.status.textContent = 'Encore un instant…';
      Promise.resolve(device && device.queue.onSubmittedWorkDone()).catch(() => {}).then(() => {
        if (graphicsLost) return;
        markInit('gpu');
        console.log(`[init] ${initTimings.join(', ')}`);
        initTimings = null;
        audioSystem.ready = true;
        opening.showLaunch(gameplay.pauseMenu.root);
      });
    }

    // Telemetry uses wall time, not the clamped simulation step, so slow frames and high-refresh displays report
    // their actual frame rate (updates DOM every 250ms).
    frameCount++;
    fpsTimer += Math.max(0, rawDt);
    if (fpsTimer >= 0.25) {
      const currentFps = Math.round(frameCount / fpsTimer);
      if (diagnostics) {
        const parts = Object.entries(profile.marks).map(([k, v]) => `${k} ${(v / frameCount).toFixed(1)}`).join(' · ');
        diagnostics.textContent = `${rendererName} · ${quality.label} · échelle ${pacer.scale} · ${currentFps} FPS · ${(fpsTimer * 1000 / frameCount).toFixed(1)} ms/image\n${parts}\nGPU ${profile.gpu.toFixed(1)} · ${profile.draws} draws · ${(profile.tris / 1e6).toFixed(2)} M tri`;
        profile.summary = { fps: currentFps, ...Object.fromEntries(Object.entries(profile.marks).map(([k, v]) => [k, +(v / frameCount).toFixed(1)])), gpu: +((profile.gpuSum || 0) / (profile.gpuN || 1)).toFixed(1), scale: pacer.scale, draws: profile.draws, tris: profile.tris };
        profile.gpuSum = 0; profile.gpuN = 0;
        profile.marks = {};
      }
      frameCount = 0;
      fpsTimer = 0;

      const activeEnt = controllerManager.getActiveEntity();
      const mode = controllerManager.activeMode;
      const mph = Math.round(Math.abs(activeEnt.speed) * 2.237);
      const altFt = Math.max(0, Math.round(activeEnt.position.y * 3.281));

      if (elFps) {
        elFps.textContent = String(currentFps);
        elFps.className = currentFps >= 50 ? 'fps-ok' : currentFps >= 30 ? 'fps-warn' : 'fps-bad';
      }
      if (elSpeed) elSpeed.textContent = String(mph);
      if (elSpeedMeter) elSpeedMeter.style.transform = `scaleX(${Math.min(1, mph / (topSpeedMph[mode] || 80))})`;
      if (elAltitude) elAltitude.textContent = altFt.toLocaleString('en-US');
      // The street corner of the player on the follow cameras, of the camera itself on the scenic ones
      const where = gameplay.architect?.viewFocus() ?? (cameraSystem.getActivePreset().category === 'follow' ? activeEnt.position : cameraSystem.currentPos);
      renderLocation(getLocationLabel(where.x, where.z));
    }
  };
  renderer.setAnimationLoop(frame);
  // the Architect keeps the game going while its tab is hidden, and sees with his own eye (local development only)
  gameplay.architect?.keepAlive(frame);
  gameplay.architect?.attach({ renderer, scene });
}

// This machine or its local network (an iPhone on the same Wi-Fi), never a public host
function architectAllowed() {
  if (new URLSearchParams(location.search).get('architecte') === '0') return false;
  const host = location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.local')
    || /^(10\.\d+|192\.168|172\.(1[6-9]|2\d|3[01]))\.\d+\.\d+$/.test(host);
}

initApp().catch(error => {
  console.error('[startup]', error);
  opening.fail('Impossible de lancer le rendu 3D. Essayez Chrome ou Edge avec l’accélération matérielle activée.',
    'Réessayer', () => location.reload());
});
