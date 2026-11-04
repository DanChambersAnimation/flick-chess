import * as THREE from 'three'

export type SpectatorPlan = {
  x: number
  z: number
  feetY: number
  size: number
  bodyYaw: number
  color: number
}

type Spectator = SpectatorPlan & {
  yaw: number
  headSpeed: number
  jump: number
  jumpSpeed: number
}

export type Crowd = {
  people: Spectator[]
  torsos: THREE.InstancedMesh
  heads: THREE.InstancedMesh
  eyes: THREE.InstancedMesh
  pupils: THREE.InstancedMesh
  excitement: number
}

const EYE_X = 0.32
const EYE_Y = 0.2
const EYE_Z = 0.86
const MAX_HEAD_TURN = 1.1
const MAX_GLANCE = 0.12

function makeInstances(
  scene: THREE.Scene,
  shape: THREE.BufferGeometry,
  paint: THREE.Material,
  count: number
) {
  const instances = new THREE.InstancedMesh(shape, paint, count)
  instances.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  instances.frustumCulled = false
  scene.add(instances)
  return instances
}

export function makeCrowd(scene: THREE.Scene, plans: SpectatorPlan[]): Crowd {
  const count = plans.length

  const torsos = makeInstances(
    scene,
    new THREE.BoxGeometry(2, 3, 1),
    new THREE.MeshStandardMaterial({ flatShading: true, emissive: 0x262626 }),
    count
  )

  const heads = makeInstances(
    scene,
    new THREE.IcosahedronGeometry(0.9, 1),
    new THREE.MeshStandardMaterial({
      color: 0xf2c9a0,
      flatShading: true,
      emissive: 0xf2c9a0,
      emissiveIntensity: 0.15,
    }),
    count
  )

  const eyes = makeInstances(
    scene,
    new THREE.CircleGeometry(0.22, 8),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
    count * 2
  )

  const pupils = makeInstances(
    scene,
    new THREE.CircleGeometry(0.1, 8),
    new THREE.MeshBasicMaterial({ color: 0x111111 }),
    count * 2
  )

  const people = plans.map((plan) => ({
    ...plan,
    yaw: plan.bodyYaw,
    headSpeed: 3 + Math.random() * 3,
    jump: 0,
    jumpSpeed: 0,
  }))

  const color = new THREE.Color()
  people.forEach((person, i) => torsos.setColorAt(i, color.set(person.color)))
  torsos.instanceColor!.needsUpdate = true

  return { people, torsos, heads, eyes, pupils, excitement: 0 }
}

export function excite(crowd: Crowd, amount: number) {
  crowd.excitement = Math.min(crowd.excitement + amount, 1.5)
}

function wrapAngle(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle))
}

function clamp(value: number, limit: number) {
  return Math.max(-limit, Math.min(limit, value))
}

const part = new THREE.Object3D()
const faceMatrix = new THREE.Matrix4()
const offset = new THREE.Matrix4()

export function updateCrowd(crowd: Crowd, focus: THREE.Vector3, elapsed: number) {
  crowd.excitement = Math.max(0, crowd.excitement - elapsed * 0.8)
  const turn = 1 - Math.exp(-elapsed * 4)

  crowd.people.forEach((person, i) => {
    // Jostling: excited people hop, then gravity brings them down
    if (person.jump <= 0) {
      person.jump = 0
      person.jumpSpeed = 0
      if (Math.random() < crowd.excitement * elapsed * 8) {
        person.jumpSpeed = 2 + Math.random() * 3
      }
    }
    person.jumpSpeed -= 14 * elapsed
    person.jump += person.jumpSpeed * elapsed

    // Turn the head towards the action, within a sensible limit
    const toFocus = Math.atan2(focus.x - person.x, focus.z - person.z)
    const headTurn = clamp(wrapAngle(toFocus - person.bodyYaw), MAX_HEAD_TURN)
    const wanted = person.bodyYaw + headTurn
    const blend = 1 - Math.exp(-elapsed * person.headSpeed)
    person.yaw += wrapAngle(wanted - person.yaw) * blend

    // Pupils get there before the head does
    const glance = clamp(wrapAngle(toFocus - person.yaw) * turn * 6, MAX_GLANCE)

    const baseY = person.feetY + person.jump

    part.position.set(person.x, baseY + 1.5 * person.size, person.z)
    part.rotation.set(0, person.bodyYaw, 0)
    part.scale.setScalar(person.size)
    part.updateMatrix()
    crowd.torsos.setMatrixAt(i, part.matrix)

    part.position.set(person.x, baseY + 3.9 * person.size, person.z)
    part.rotation.set(0, person.yaw, 0)
    part.updateMatrix()
    crowd.heads.setMatrixAt(i, part.matrix)
    faceMatrix.copy(part.matrix)

    for (const [eye, side] of [[0, -1], [1, 1]]) {
      const index = i * 2 + eye

      offset.makeTranslation(side * EYE_X, EYE_Y, EYE_Z)
      crowd.eyes.setMatrixAt(index, part.matrix.copy(faceMatrix).multiply(offset))

      offset.makeTranslation(side * EYE_X + glance, EYE_Y, EYE_Z + 0.01)
      crowd.pupils.setMatrixAt(index, part.matrix.copy(faceMatrix).multiply(offset))
    }
  })

  crowd.torsos.instanceMatrix.needsUpdate = true
  crowd.heads.instanceMatrix.needsUpdate = true
  crowd.eyes.instanceMatrix.needsUpdate = true
  crowd.pupils.instanceMatrix.needsUpdate = true
}
