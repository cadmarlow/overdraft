import * as THREE from 'three/webgpu';
import { float, mix, texture, uv } from 'three/tsl';

// Materials from an avatar's painted maps: its specular map decides how rough each surface is.

function createPersonMaterials(person) {
  return person.maps.map(({ name, color, normal, specular }) => {
    const hair = name.includes('opacity');
    // hair is flat cards: as a mirror, however rough, they'd show the sky on every strand
    const m = hair ? new THREE.MeshPhysicalNodeMaterial({ map: color, normalMap: normal, metalness: 0, specularIntensity: 0.12 }) : new THREE.MeshStandardNodeMaterial({ map: color, normalMap: normal, metalness: 0 });
    m.name = `${person.id}-${name}`;
    m.side = hair ? THREE.DoubleSide : THREE.FrontSide;
    if (hair) m.alphaTest = 0.45;
    m.roughnessNode = hair ? float(0.92) : specular ? mix(float(0.92), float(name === 'head' ? 0.62 : 0.42), texture(specular, uv()).r) : float(0.8);
    return m;
  });
}

function createGunMaterial({ color, normal, specular }) {
  const m = new THREE.MeshStandardNodeMaterial({ map: color, normalMap: normal, metalness: 0.55 });
  m.roughnessNode = specular ? mix(float(0.75), float(0.28), texture(specular, uv()).r) : float(0.5);
  return m;
}

export { createPersonMaterials, createGunMaterial };
