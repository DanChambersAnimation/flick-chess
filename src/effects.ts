import * as THREE from 'three'

type Bit = {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  life: number
  startLife: number
}

const MAX_BITS = 300
const GRAVITY = 9.81
const bitShape = new THREE.TetrahedronGeometry(0.1)
const paints = new Map<number, THREE.MeshBasicMaterial>()
const bits: Bit[] = []
const shake = new THREE.Vector3()
let shakeAmount = 0

function getPaint(color: number) {
  let paint = paints.get(color)
  if (!paint) {
    paint = new THREE.MeshBasicMaterial({ color })
    paints.set(color, paint)
  }
  return paint
}

type Point = { x: number; y: number; z: number }

export function burst(
  scene: THREE.Scene,
  at: Point,
  color: number,
  count: number,
  speed: number
) {
  for (let i = 0; i < count && bits.length < MAX_BITS; i++) {
    const mesh = new THREE.Mesh(bitShape, getPaint(color))
    mesh.position.set(at.x, at.y, at.z)
    scene.add(mesh)

    const velocity = new THREE.Vector3(
      Math.random() - 0.5,
      Math.random(),
      Math.random() - 0.5
    ).multiplyScalar(speed)

    const life = 0.4 + Math.random() * 0.5
    bits.push({ mesh, velocity, life, startLife: life })
  }
}

export function addShake(amount: number) {
  shakeAmount = Math.min(shakeAmount + amount, 0.4)
}

// Moves the bits and returns this frame's camera shake
export function updateEffects(scene: THREE.Scene, elapsed: number) {
  for (let i = bits.length - 1; i >= 0; i--) {
    const bit = bits[i]
    bit.life -= elapsed

    if (bit.life <= 0) {
      scene.remove(bit.mesh)
      bits.splice(i, 1)
      continue
    }

    bit.velocity.y -= GRAVITY * elapsed
    bit.mesh.position.addScaledVector(bit.velocity, elapsed)
    bit.mesh.rotation.x += elapsed * 8
    bit.mesh.rotation.y += elapsed * 6
    bit.mesh.scale.setScalar(bit.life / bit.startLife)
  }

  shake.set(
    (Math.random() - 0.5) * shakeAmount,
    (Math.random() - 0.5) * shakeAmount,
    (Math.random() - 0.5) * shakeAmount
  )
  shakeAmount = Math.max(0, shakeAmount - elapsed)
  return shake
}
