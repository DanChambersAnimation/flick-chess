import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
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
// oneByOne: each hit knocks off the part nearest to where it landed.
type ItemStyle = 'askew' | 'oneByOne'

export type Item = {
  name: string
  zone: HitZone
  style: ItemStyle
  parts: THREE.Object3D[]
  partsLeft: THREE.Object3D[] // The parts still on the head
  stages: number // How many hits it takes to lose this item
  stage: number // How many hits it has taken so far
}

// Heights and sizes measured from the markers in Blender, at model size
export type Zones = {
  topEyes: number
  eyesNose: number
  noseMouth: number
  radius: number
  height: number
}

// A model loaded once. Every character made from it shares its shapes and paint.
export type HeadModel = {
  scene: THREE.Group
  zones: Zones
}

export type Character = {
  group: THREE.Group
  items: Item[]
  zones: Zones
  size: number
  centreY: number // The head's height in the physics world, which never wobbles
  facing: number // 1 facing +z, -1 facing -z. Turns world left and right into theirs.
  struck: boolean // Has this character already taken damage this flick?
  marked: boolean // Has a nose or eye already changed this flick?
  noses: THREE.Object3D[] // nose_0 is undamaged. Each hit shows the next one.
  noseStage: number
  leftEye: THREE.Object3D[] // Normal, then black
  rightEye: THREE.Object3D[]
  saved: SavedPart[]
}

function findPart(model: THREE.Object3D, name: string) {
  const part = model.getObjectByName(name)
  if (!part) throw new Error(`The head model has no object called ${name}`)
  return part
}

// Finds every object whose name starts this way, in name order
function findParts(model: THREE.Object3D, start: string) {
  const parts: THREE.Object3D[] = []
  model.traverse((object) => {
    if (object.name.startsWith(start)) parts.push(object)
  })
  if (parts.length === 0) throw new Error(`The head model has no objects starting ${start}`)
  return parts.sort((a, b) => a.name.localeCompare(b.name))
}

// Shows one object from a set, and hides the others
function showOnly(parts: THREE.Object3D[], index: number) {
  parts.forEach((part, i) => {
    part.visible = i === index
  })
}

// Loads a Blender export and reads its zone markers
export async function loadHeadModel(url: string): Promise<HeadModel> {
  const { scene } = await new GLTFLoader().loadAsync(url)
  scene.updateWorldMatrix(true, true)

  // Each plane's height comes from its box, because its origin may be elsewhere
  const planeHeight = (name: string) => new THREE.Box3().setFromObject(findPart(scene, name)).max.y
  const body = new THREE.Box3().setFromObject(findPart(scene, 'zone_body'))

  const zones = {
    topEyes: planeHeight('zone_top_eyes'),
    eyesNose: planeHeight('zone_eyes_nose'),
    noseMouth: planeHeight('zone_nose_mouth'),
    radius: (body.max.x - body.min.x) / 2,
    height: body.max.y - body.min.y,
  }

  // The markers have done their job
  for (const marker of findParts(scene, 'zone_')) marker.visible = false

  return { scene, zones }
}

// Built from Blender, facing +z, centred on the middle of the head
export function makeCharacter(
  model: HeadModel,
  size: number,
  centreY: number,
  facing: number
): Character {
  const group = new THREE.Group()
  group.scale.setScalar(size)

  // clone(true) gives this character its own objects, so one can lose a hat alone
  const head = model.scene.clone(true)
  group.add(head)

  const noses = findParts(head, 'nose_')
  const leftEye = findParts(head, 'eye_L_')
  const rightEye = findParts(head, 'eye_R_')
  showOnly(noses, 0)
  showOnly(leftEye, 0)
  showOnly(rightEye, 0)

  // Only the normal ears show until ear hits are added
  for (const ear of findParts(head, 'ear_')) ear.visible = ear.name.endsWith('_0')

  const teeth = findParts(head, 'item_teeth_')

  const items: Item[] = [
    {
      name: 'Hat',
      zone: 'top',
      style: 'askew',
      parts: [findPart(head, 'item_hat')],
      partsLeft: [],
      stages: 1,
      stage: 0,
    },
    {
      name: 'Glasses',
      zone: 'eyes',
      style: 'askew',
      parts: [findPart(head, 'item_glasses')],
      partsLeft: [],
      stages: 2,
      stage: 0,
    },
    {
      name: 'Teeth',
      zone: 'mouth',
      style: 'oneByOne',
      parts: teeth,
      partsLeft: [],
      stages: teeth.length,
      stage: 0,
    },
  ]

  for (const item of items) item.partsLeft = [...item.parts]

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

  return {
    group,
    items,
    zones: model.zones,
    size,
    centreY,
    facing,
    struck: false,
    marked: false,
    noses,
    noseStage: 0,
    leftEye,
    rightEye,
    saved,
  }
}

// How many more hits this character can take before they forfeit
export function hitsLeft(person: Character) {
  return person.items.reduce((total, item) => total + item.stages - item.stage, 0)
}

export function newFlick(person: Character) {
  person.struck = false
  person.marked = false
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

// side is how far from the middle of the face the hit landed, at model size.
// Plus is the character's left.
function damageItem(scene: THREE.Scene, item: Item, side: number) {
  item.stage++

  if (item.style === 'oneByOne') {
    let nearest = item.partsLeft[0]
    for (const part of item.partsLeft) {
      if (Math.abs(part.position.x - side) < Math.abs(nearest.position.x - side)) nearest = part
    }
    item.partsLeft = item.partsLeft.filter((part) => part !== nearest)
    knockOff(scene, nearest)
    return
  }

  for (const part of item.parts) {
    if (item.stage < item.stages) {
      part.rotation.z += 0.35
    } else {
      knockOff(scene, part)
    }
  }
}

// Noses and black eyes only change how a character looks, not how many hits they
// have left. One change per flick stops a single rebound using them all up.
function bruiseNose(person: Character) {
  if (person.marked || person.noseStage >= person.noses.length - 1) return
  person.marked = true
  person.noseStage++
  showOnly(person.noses, person.noseStage)
}

function blackenEye(person: Character, side: number) {
  if (person.marked) return
  person.marked = true
  const eye = side >= 0 ? person.leftEye : person.rightEye
  eye[1].visible = true
}

type Point = { x: number; y: number; z: number }

// Height decides which item was hit. This uses the fixed head height, not the
// wobbling model, because damage can end the game and every device must agree.
function findZone(zones: Zones, height: number): HitZone | null {
  if (height > zones.topEyes) return 'top'
  if (height > zones.eyesNose) return 'eyes'
  if (height > zones.noseMouth) return null // The nose has nothing to lose
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

  const zone = findZone(person.zones, (at.y - person.centreY) / person.size)
  if (!zone) {
    bruiseNose(person)
    return 'Nose!'
  }

  // The heads stand on the room's centre line, so x is already measured from them
  const side = (at.x * person.facing) / person.size

  const item = person.items.find((candidate) => candidate.zone === zone)
  if (!item || item.stage >= item.stages) {
    if (zone === 'eyes') blackenEye(person, side)
    return BARE_HITS[zone]
  }

  person.struck = true
  damageItem(scene, item, side)
  return `${item.name}!`
}

// Test only: take a character down to one last hit
export function leaveOneHit(scene: THREE.Scene, person: Character) {
  for (const item of person.items) {
    while (item.stage < item.stages && hitsLeft(person) > 1) damageItem(scene, item, 0)
  }
}

export function resetCharacter(person: Character) {
  for (const part of person.saved) {
    part.parent.add(part.object)
    part.object.position.copy(part.position)
    part.object.quaternion.copy(part.quaternion)
    part.object.scale.copy(part.scale)
  }
  for (const item of person.items) {
    item.stage = 0
    item.partsLeft = [...item.parts]
  }
  person.struck = false
  person.marked = false
  person.noseStage = 0
  showOnly(person.noses, 0)
  showOnly(person.leftEye, 0)
  showOnly(person.rightEye, 0)
}
