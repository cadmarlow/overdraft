import * as THREE from 'three';
import { BONE, LIMB } from '../../js/human-skeleton.js';

// Which of the game's 23 bones stands for each Biped bone, how a bone is swung from one bind pose to the other, and how
// far its anchor moves. `from` and `to` are matching points on the two skeletons.
function bipToGame(skeleton, bind, joints) {
  const index = new Map(skeleton.map((b, i) => [b.name, i]));
  const at = (name) => new THREE.Vector3(...bind.slice(index.get(name) * 7, index.get(name) * 7 + 3));
  const game = (b) => new THREE.Vector3(...joints[b]);
  const mapping = new Array(skeleton.length);
  const assign = new Array(skeleton.length);
  const swingOf = (a, b, ga, gb) => new THREE.Quaternion().setFromUnitVectors(at(b).sub(at(a)).normalize(), game(gb).sub(game(ga)).normalize());
  const set = (name, weights, swing, from, to) => {
    const i = index.get(name);
    if (i === undefined) return;
    mapping[i] = { swing, from, to };
    assign[i] = weights;
  };
  const none = new THREE.Quaternion();
  const hip = game(LIMB.thigh[0]).add(game(LIMB.thigh[1])).multiplyScalar(0.5);
  const pelvisLift = hip.y - at('Pelvis').y, neckLift = game(BONE.NECK).y - at('Neck').y;
  const lift = (name) => {
    const k = (at(name).y - at('Pelvis').y) / (at('Neck').y - at('Pelvis').y);
    return new THREE.Vector3(0, pelvisLift + (neckLift - pelvisLift) * k, 0).add(at(name));
  };
  set('Pelvis', [[BONE.PELVIS, 1]], none, at('Pelvis'), hip);
  set('Spine', [[BONE.SPINE, 1]], none, at('Spine'), lift('Spine'));
  set('Spine1', [[BONE.SPINE, 0.5], [BONE.CHEST, 0.5]], none, at('Spine1'), lift('Spine1'));
  set('Spine2', [[BONE.CHEST, 1]], none, at('Spine2'), lift('Spine2'));
  set('Neck', [[BONE.NECK, 1]], none, at('Neck'), game(BONE.NECK));
  set('Head', [[BONE.HEAD, 1]], none, at('Head'), game(BONE.HEAD));
  for (const [k, side] of [[0, 'L'], [1, 'R']]) {
    const up = swingOf(`${side}_UpperArm`, `${side}_Forearm`, LIMB.upperArm[k], LIMB.forearm[k]);
    const fore = swingOf(`${side}_Forearm`, `${side}_Hand`, LIMB.forearm[k], LIMB.hand[k]);
    const thigh = swingOf(`${side}_Thigh`, `${side}_Calf`, LIMB.thigh[k], LIMB.shin[k]);
    const calf = swingOf(`${side}_Calf`, `${side}_Foot`, LIMB.shin[k], LIMB.foot[k]);
    const foot = swingOf(`${side}_Foot`, `${side}_Toe0`, LIMB.foot[k], LIMB.toe[k]);
    set(`${side}_Clavicle`, [[LIMB.clavicle[k], 1]], none, at(`${side}_Clavicle`), game(LIMB.clavicle[k]));
    // down each limb the avatar keeps its own lengths, or skin would stretch across every joint
    const down = (to, swing, a, b) => to.clone().add(at(b).sub(at(a)).applyQuaternion(swing));
    const elbow = down(game(LIMB.upperArm[k]), up, `${side}_UpperArm`, `${side}_Forearm`);
    const wrist = down(elbow, fore, `${side}_Forearm`, `${side}_Hand`);
    const knee = down(game(LIMB.thigh[k]), thigh, `${side}_Thigh`, `${side}_Calf`);
    const ankle = down(knee, calf, `${side}_Calf`, `${side}_Foot`);
    set(`${side}_UpperArm`, [[LIMB.upperArm[k], 1]], up, at(`${side}_UpperArm`), game(LIMB.upperArm[k]));
    set(`${side}_Forearm`, [[LIMB.forearm[k], 1]], fore, at(`${side}_Forearm`), elbow);
    set(`${side}_Hand`, [[LIMB.hand[k], 1]], fore, at(`${side}_Hand`), wrist);
    set(`${side}_Thigh`, [[LIMB.thigh[k], 1]], thigh, at(`${side}_Thigh`), game(LIMB.thigh[k]));
    set(`${side}_Calf`, [[LIMB.shin[k], 1]], calf, at(`${side}_Calf`), knee);
    set(`${side}_Foot`, [[LIMB.foot[k], 1]], foot, at(`${side}_Foot`), ankle);
    set(`${side}_Toe0`, [[LIMB.toe[k], 1]], foot, at(`${side}_Toe0`), down(ankle, foot, `${side}_Foot`, `${side}_Toe0`));
  }
  // What hangs from them follows rigidly: fingers on the hand (and their own bone), the face on the head
  for (let i = 0; i < skeleton.length; i++) {
    if (mapping[i]) continue;
    let p = skeleton[i].parent;
    while (p >= 0 && !mapping[p]) p = skeleton[p].parent;
    const m = mapping[p] ?? mapping[index.get('Pelvis')];
    mapping[i] = m;
    const finger = skeleton[i].name.match(/^([LR])_Finger/);
    assign[i] = finger ? [[LIMB.fingers[finger[1] === 'L' ? 0 : 1], 1]] : assign[p];
  }
  return { mapping, weightsOf: (b) => assign[b] };
}

export { bipToGame };
