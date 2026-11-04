import * as THREE from 'three'
import { burst, addShake, throwPart } from './effects'

type SavedPart = {
  object: THREE.Object3D
  parent: THREE.Object3D
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  scale: THREE.Vector3
}

export type HitZone = 'top' | 'eyes' | 'mouth'

// askew: tips over until its last hit, then flies off.
// half: loses half its parts, then the rest.
type ItemStyle = 'askew' | 'half'

export type Item = {
  name: string
  zone: HitZone
  style: ItemStyle
  parts: THREE.Object3D[]
  stages: number // How many hits it takes to lose this item
  stage: number // How many hits it has taken so far
}

export type Character = {
  group: THREE.Group
  items: Item[]
  size: number
  centreY: number // The head's height in the physics world, which never wobbles
  struck: boolean // Has this character already taken damage this flick?
  saved: SavedPart[]
}

function paint(color: number) {
  return new THREE.MeshStandardMaterial({ color, flatShading: true })
}

function roundedRectangle(width: number, height: number, corner: number) {
  const w = width / 2
  const h = height / 2
  const shape = new THREE.Shape()

  shape.moveTo(-w + corner, -h)
  shape.lineTo(w - corner, -h)
  shape.absarc(w - corner, -h + corner, corner, -Math.PI / 2, 0, false)
  shape.lineTo(w, h - corner)
  shape.absarc(w - corner, h - corner, corner, 0, Math.PI / 2, false)
  shape.lineTo(-w + corner, h)
  shape.absarc(-w + corner, h - corner, corner, Math.PI / 2, Math.PI, false)
  shape.lineTo(-w, -h + corner)
  shape.absarc(-w + corner, -h + corner, corner, Math.PI, Math.PI * 1.5, false)
  return shape
}

// Built at size 1, facing +z, centred on the middle of the head
export function makeCharacter(size: number, centreY: number): Character {
  const group = new THREE.Group()
  group.scale.setScalar(size)

  // Head: eight-sided, turned so a flat side faces forwards
  const head = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9, 0.9, 1.5, 8, 1, false, Math.PI / 8),
    paint(0xf2c9a0)
  )
  group.add(head)

  // Mouth and teeth
  const mouth = new THREE.Group()
  mouth.position.set(0, -0.35, 0.84)
  group.add(mouth)

  const mouthShape = new THREE.ExtrudeGeometry(roundedRectangle(0.9, 0.5, 0.14), {
    depth: 0.03,
    bevelEnabled: false,
    curveSegments: 3,
  })
  mouth.add(new THREE.Mesh(mouthShape, paint(0x3a0d12)))

  const toothShape = new THREE.BoxGeometry(0.17, 0.18, 0.04)
  const toothPaint = paint(0xfff8e7)
  const teeth: THREE.Mesh[] = []

  for (const y of [0.13, -0.13]) {
    for (let i = 0; i < 4; i++) {
      const tooth = new THREE.Mesh(toothShape, toothPaint)
      tooth.position.set(-0.285 + i * 0.19, y, 0.05)
      mouth.add(tooth)
      teeth.push(tooth)
    }
  }

  // Bulbous nose
  const nose = new THREE.Mesh(new THREE.IcosahedronGeometry(0.24, 1), paint(0xe07a5f))
  nose.position.set(0, 0.08, 0.98)
  group.add(nose)

  // Oval eyes with dot pupils
  const eyeShape = new THREE.IcosahedronGeometry(1, 1)
  const pupilShape = new THREE.IcosahedronGeometry(0.07, 0)
  const eyePaint = paint(0xffffff)
  const pupilPaint = paint(0x111111)

  for (const x of [-0.32, 0.32]) {
    const eye = new THREE.Mesh(eyeShape, eyePaint)
    eye.scale.set(0.19, 0.27, 0.05)
    eye.position.set(x, 0.38, 0.85)
    group.add(eye)

    const pupil = new THREE.Mesh(pupilShape, pupilPaint)
    pupil.position.set(x, 0.38, 0.91)
    group.add(pupil)
  }

  // Large square glasses: a four-sided ring turned 45 degrees is a square
  const glasses = new THREE.Group()
  glasses.position.set(0, 0.38, 0.96)
  group.add(glasses)

  const framePaint = paint(0x1a1a1a)
  const frameShape = new THREE.TorusGeometry(0.4, 0.035, 4, 4)

  for (const x of [-0.34, 0.34]) {
    const lens = new THREE.Mesh(frameShape, framePaint)
    lens.rotation.z = Math.PI / 4
    lens.position.x = x
    glasses.add(lens)
  }

  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.05), framePaint)
  glasses.add(bridge)

  // Pork pie hat: wide brim, low flat crown, dark band
  const hat = new THREE.Group()
  hat.position.y = 0.75
  group.add(hat)

  const hatPaint = paint(0x4a3728)

  const brim = new THREE.Mesh(new THREE.CylinderGeometry(1.08, 1.08, 0.06, 8), hatPaint)
  brim.position.y = 0.03
  hat.add(brim)

  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.7, 0.34, 8), hatPaint)
  crown.position.y = 0.23
  hat.add(crown)

  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.71, 0.71, 0.1, 8), paint(0x1a1a1a))
  band.position.y = 0.11
  hat.add(band)

  const items: Item[] = [
    { name: 'Hat', zone: 'top', style: 'askew', parts: [hat], stages: 1, stage: 0 },
    { name: 'Glasses', zone: 'eyes', style: 'askew', parts: [glasses], stages: 2, stage: 0 },
    { name: 'Teeth', zone: 'mouth', style: 'half', parts: teeth, stages: 2, stage: 0 },
  ]

  // Remember where everything belongs, ready for a new game
  const saved = items.flatMap((item) =>
    item.parts.map((object) => ({
      object,
      parent: object.parent!,
      position: object.position.clone(),
      quaternion: object.quaternion.clone(),
      scale: object.scale.clone(),
    }))
  )

  return { group, items, size, centreY, struck: false, saved }
}

// How many more hits this character can take before they forfeit
export function hitsLeft(person: Character) {
  return person.items.reduce((total, item) => total + item.stages - item.stage, 0)
}

export function newFlick(person: Character) {
  person.struck = false
}

// Falling items are visual only, so real randomness is fine here
function knockOff(scene: THREE.Scene, object: THREE.Object3D) {
  scene.attach(object)

  const velocity = new THREE.Vector3(
    (Math.random() - 0.5) * 8,
    4 + Math.random() * 5,
    (Math.random() - 0.5) * 8
  )
  throwPart(object, velocity, 2.5)
}

function damageItem(scene: THREE.Scene, item: Item) {
  item.stage++

  if (item.style === 'half') {
    const half = Math.ceil(item.parts.length / 2)
    const going = item.stage === 1 ? item.parts.slice(0, half) : item.parts.slice(half)
    for (const part of going) knockOff(scene, part)
    return
  }

  for (const part of item.parts) {
    if (item.stage < item.stages) {
      part.rotation.z += 0.35
      part.position.x += 0.12
    } else {
      knockOff(scene, part)
    }
  }
}

type Point = { x: number; y: number; z: number }

// Height decides which item was hit. This uses the fixed head height, not the
// wobbling model, because damage can end the game and every device must agree.
function findZone(height: number): HitZone | null {
  if (height > 0.55) return 'top'
  if (height > 0.2) return 'eyes'
  if (height > -0.1) return null // The nose has nothing to lose
  return 'mouth'
}

const BARE_HITS: Record<HitZone, string> = {
  top: 'Bonk!',
  eyes: 'Right in the eye!',
  mouth: 'Gums!',
}

export function hitCharacter(scene: THREE.Scene, person: Character, at: Point) {
  burst(scene, at, 0xffffff, 16, 6)
  addShake(0.25)

  // One call-out per flick, so a rebound can't talk over the damage
  if (person.struck) return null

  const zone = findZone((at.y - person.centreY) / person.size)
  if (!zone) return 'Nose!'

  const item = person.items.find((candidate) => candidate.zone === zone)
  if (!item || item.stage >= item.stages) return BARE_HITS[zone]

  person.struck = true
  damageItem(scene, item)
  return `${item.name}!`
}

// Test only: take a character down to one last hit
export function leaveOneHit(scene: THREE.Scene, person: Character) {
  for (const item of person.items) {
    while (item.stage < item.stages && hitsLeft(person) > 1) damageItem(scene, item)
  }
}

export function resetCharacter(person: Character) {
  for (const part of person.saved) {
    part.parent.add(part.object)
    part.object.position.copy(part.position)
    part.object.quaternion.copy(part.quaternion)
    part.object.scale.copy(part.scale)
  }
  for (const item of person.items) item.stage = 0
  person.struck = false
}
