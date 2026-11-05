import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import RAPIER from '@dimforge/rapier3d-deterministic-compat'
import { burst, addShake, updateEffects, clearBits } from './effects'
import { loadHeadModel, makeCharacter, hitCharacter, hitsLeft, newFlick, leaveOneHit, resetCharacter, type Character } from './character'
import { makeArm, startReach, setAim, restArm, flickArm, flailArm, updateArms, type Arm } from './arm'
import { makeWobble, hitWobble, updateWobble, type Wobble } from './wobble'
import { makeCrowd, updateCrowd, excite, knockSpectator, resetCrowd, type SpectatorPlan } from './crowd'
import { startAudio, play, type SoundName } from './sound'
import { comment, resetCommentary, type CommentEvent } from './commentary'

await RAPIER.init()
const headModel = await loadHeadModel('models/head.glb')

// 1. The three things every 3D program needs
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(53, 1, 0.1, 100)
camera.position.set(0, 13, 10)

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
document.querySelector('#app')!.appendChild(renderer.domElement)

// 2. Lights: nearly dark, with one hard light over the table
scene.background = new THREE.Color(0x0b0d14)
scene.fog = new THREE.Fog(0x0b0d14, 25, 70)
renderer.shadowMap.enabled = true

scene.add(new THREE.HemisphereLight(0x8899bb, 0x1a1420, 0.4))

const tableLight = new THREE.SpotLight(0xfff0d0, 900, 40, Math.PI / 5, 0.5, 2)
tableLight.position.set(0, 15, 0)
tableLight.castShadow = true
tableLight.shadow.mapSize.set(1024, 1024)
tableLight.shadow.camera.near = 5
tableLight.shadow.camera.far = 40
tableLight.shadow.normalBias = 0.03
scene.add(tableLight)

for (const side of [1, -1]) {
  const endLight = new THREE.SpotLight(0xfff0d0, 700, 30, Math.PI / 3, 0.6, 2)
  endLight.position.set(0, 16, side * 20)
  endLight.target.position.set(0, 9, side * 29)
  scene.add(endLight, endLight.target)

  // Gentle fill: high up on the table side, angled down at the player's face
  const fillLight = new THREE.SpotLight(0xfff4e6, 250, 30, Math.PI / 8, 0.6, 2)
  fillLight.position.set(0, 14, side * -1.8)
  fillLight.target.position.set(0, 3.5, side * 7.2)
  scene.add(fillLight, fillLight.target)
}

// 3. The board: 64 boxes sharing one shape
const squareShape = new THREE.BoxGeometry(1, 0.2, 1)
const lightSquare = new THREE.MeshStandardMaterial({
  color: 0xe9d8a6,
  emissive: 0xe9d8a6,
  emissiveIntensity: 0.25,
})
const darkSquare = new THREE.MeshStandardMaterial({
  color: 0x6b4f3a,
  emissive: 0x6b4f3a,
  emissiveIntensity: 0.25,
})

for (let rank = 0; rank < 8; rank++) {
  for (let file = 0; file < 8; file++) {
    const isLight = (rank + file) % 2 === 0
    const square = new THREE.Mesh(squareShape, isLight ? lightSquare : darkSquare)
    square.position.set(file - 3.5, -0.1, rank - 3.5)
    scene.add(square)
  }
}

// 4. The pieces: one table holding every piece's shape and physics
function makeShape(height: number, profile: number[][]) {
  const points = profile.map(([x, y]) => new THREE.Vector2(x, y))
  const shape = new THREE.LatheGeometry(points, 8) // 8 sides = chunky
  shape.translate(0, -height / 2, 0)
  return shape
}

// A knight is a round base plus a flat horse outline pushed out into 3D.
// Each point is [forwards, height]. The horse faces forwards along +x.
function makeKnightShape() {
  const base = makeShape(1.1, [
    [0, 0], [0.34, 0], [0.34, 0.1], [0.22, 0.22], [0, 0.22],
  ]).toNonIndexed()

  const outline = new THREE.Shape()
  outline.moveTo(-0.24, 0.18)
  outline.lineTo(0.22, 0.18)
  outline.lineTo(0.14, 0.42)
  outline.lineTo(0.16, 0.55)
  outline.lineTo(0.38, 0.62)
  outline.lineTo(0.42, 0.74)
  outline.lineTo(0.3, 0.88)
  outline.lineTo(0.14, 0.98)
  outline.lineTo(0.1, 1.1)
  outline.lineTo(0, 1.0)
  outline.lineTo(-0.16, 0.9)
  outline.lineTo(-0.28, 0.6)
  outline.closePath()

  const horse = new THREE.ExtrudeGeometry(outline, { depth: 0.3, bevelEnabled: false })
  horse.translate(0, -0.55, -0.15)

  const knight = mergeGeometries([base, horse])!
  knight.rotateY(Math.PI / 2) // Face the blue side
  return knight
}

const PIECE_TYPES = {
  pawn: {
    height: 0.92, radius: 0.3, density: 1, maxImpulse: 8, minLift: 0, maxLift: 0.75,
    shape: makeShape(0.92, [
      [0, 0], [0.32, 0], [0.32, 0.1], [0.14, 0.25], [0.1, 0.5],
      [0.2, 0.56], [0.1, 0.62], [0.2, 0.72], [0.17, 0.86], [0, 0.92],
    ]),
  },
  rook: {
    height: 0.8, radius: 0.36, density: 6, maxImpulse: 14, minLift: 0, maxLift: 0.15,
    shape: makeShape(0.8, [
      [0, 0], [0.38, 0], [0.38, 0.12], [0.26, 0.2],
      [0.24, 0.6], [0.34, 0.66], [0.34, 0.8], [0, 0.8],
    ]),
  },
  knight: {
    height: 1.1, radius: 0.32, density: 3, maxImpulse: 16, minLift: 0.5, maxLift: 0.75,
    shape: makeKnightShape(),
  },
  bishop: {
    height: 1.25, radius: 0.3, density: 3, maxImpulse: 16, minLift: 0, maxLift: 0.75,
    shape: makeShape(1.25, [
      [0, 0], [0.32, 0], [0.32, 0.1], [0.14, 0.3], [0.1, 0.75],
      [0.22, 0.82], [0.1, 0.9], [0.17, 1.05], [0.06, 1.2], [0, 1.25],
    ]),
  },
  queen: {
    height: 1.45, radius: 0.33, density: 6, maxImpulse: 30, minLift: 0, maxLift: 0,
    shape: makeShape(1.45, [
      [0, 0], [0.35, 0], [0.35, 0.12], [0.15, 0.35], [0.1, 0.95],
      [0.25, 1.05], [0.12, 1.13], [0.26, 1.3], [0.2, 1.38], [0, 1.45],
    ]),
  },
  king: {
    height: 1.6, radius: 0.33, density: 5, maxImpulse: 8, minLift: 0, maxLift: 0.35,
    shape: makeShape(1.6, [
      [0, 0], [0.35, 0], [0.35, 0.12], [0.15, 0.35], [0.11, 1.05],
      [0.24, 1.14], [0.12, 1.22], [0.2, 1.4], [0.06, 1.48], [0.06, 1.6], [0, 1.6],
    ]),
  },
}

type PieceKind = keyof typeof PIECE_TYPES


const blueKnightShape = PIECE_TYPES.knight.shape.clone().rotateY(Math.PI)

const redPaint = new THREE.MeshStandardMaterial({ color: 0xf2ead3, flatShading: true })
const bluePaint = new THREE.MeshStandardMaterial({ color: 0x1c1917, flatShading: true })

// 4b. The invisible physics world
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
world.timestep = 1 / 120
const eventQueue = new RAPIER.EventQueue(true)

world.createCollider(
  RAPIER.ColliderDesc.cuboid(4, 0.1, 4).setTranslation(0, -0.1, 0)
)

// 4b-2. The table, floor and two players, solid in both worlds
const FLOOR_Y = -4

const woodPaint = new THREE.MeshStandardMaterial({ color: 0x8d5a3b })
const tableTop = new THREE.Mesh(new THREE.BoxGeometry(12, 0.4, 12), woodPaint)
tableTop.position.set(0, -0.4, 0)
scene.add(tableTop)

world.createCollider(
  RAPIER.ColliderDesc.cuboid(6, 0.2, 6).setTranslation(0, -0.4, 0)
)

for (const x of [-5.4, 5.4]) {
  for (const z of [-5.4, 5.4]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.6, 3.4, 0.6), woodPaint)
    leg.position.set(x, -2.3, z)
    scene.add(leg)
  }
}

const floor = new THREE.Mesh(
  new THREE.BoxGeometry(100, 0.2, 100),
  new THREE.MeshStandardMaterial({ color: 0x2b2d36 })
)
floor.position.set(0, FLOOR_Y - 0.1, 0)
scene.add(floor)

world.createCollider(
  RAPIER.ColliderDesc.cuboid(50, 0.1, 50).setTranslation(0, FLOOR_Y - 0.1, 0)
)

const players = new Map<number, Character>()
const HEAD_Y = 3.5
const HEAD_Z = { red: 7.2, blue: -7.2 }

const bodyHits = new Map<number, { wobble: Wobble; side: Side; z: number }>()
const wobbles: Wobble[] = []

function addPlayer(z: number, paint: THREE.Material, side: Side) {
  // The body pivots at the feet, then bends through a stack of segments
  const body = new THREE.Group()
  body.position.set(0, FLOOR_Y, z)
  scene.add(body)

  const segmentShape = new THREE.BoxGeometry(4, 2.05, 2)
  const parts: THREE.Group[] = []
  let parent: THREE.Group = body

  for (let i = 0; i < 3; i++) {
    const segment = new THREE.Group()
    segment.position.y = i === 0 ? 0 : 2
    parent.add(segment)

    const mesh = new THREE.Mesh(segmentShape, paint)
    mesh.position.y = 1
    segment.add(mesh)

    parts.push(segment)
    parent = segment
  }

  // The head hangs from a neck joint on top of the stack
  const neck = new THREE.Group()
  neck.position.y = 2
  parent.add(neck)
  parts.push(neck)

  const character = makeCharacter(headModel, 2, HEAD_Y, z > 0 ? -1 : 1)
  character.group.position.y = 1.5
  character.group.rotation.y = z > 0 ? Math.PI : 0
  neck.add(character.group)

  const torsoCollider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(2, 3, 1)
      .setTranslation(0, -1, z)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(40)
  )

  const headCollider = world.createCollider(
    RAPIER.ColliderDesc.cylinder(
      (character.zones.height / 2) * character.size,
      character.zones.radius * character.size
    )
      .setTranslation(0, HEAD_Y, z)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(40)
  )

  players.set(headCollider.handle, character)

  const wobble = makeWobble(parts)
  wobbles.push(wobble)
  bodyHits.set(headCollider.handle, { wobble, side, z })
  bodyHits.set(torsoCollider.handle, { wobble, side, z })

  return { body, top: parent, character }
}

const red = addPlayer(HEAD_Z.red, redPaint, 'red')
const blue = addPlayer(HEAD_Z.blue, bluePaint, 'blue')
const characters = { red: red.character, blue: blue.character }

// Shoulders are measured from each player's feet, and start inside the torso
const arms = {
  red: [
    makeArm(scene, red.body, red.top, new THREE.Vector3(1.7, 1.3, -0.3), redPaint, -1, false),
    makeArm(scene, red.body, red.top, new THREE.Vector3(-1.7, 1.3, -0.3), redPaint, -1, true),
  ],
  blue: [
    makeArm(scene, blue.body, blue.top, new THREE.Vector3(-1.7, 1.3, 0.3), bluePaint, 1, false),
    makeArm(scene, blue.body, blue.top, new THREE.Vector3(1.7, 1.3, 0.3), bluePaint, 1, true),
  ],
}
const allArms = [...arms.red, ...arms.blue]
let activeArm: Arm = arms.red[0]

// 4b-2b. The walls of the room
const wallPaint = new THREE.MeshStandardMaterial({ color: 0x1f2430 })

function addWall(x: number, z: number, sizeX: number, sizeZ: number) {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(sizeX, 24, sizeZ), wallPaint)
  wall.position.set(x, FLOOR_Y + 12, z)
  scene.add(wall)

  world.createCollider(
    RAPIER.ColliderDesc.cuboid(sizeX / 2, 12, sizeZ / 2).setTranslation(x, FLOOR_Y + 12, z)
  )
}

addWall(0, 30.5, 62, 1)
addWall(0, -30.5, 62, 1)
addWall(30.5, 0, 1, 62)
addWall(-30.5, 0, 1, 62)

// 4b-2c. The audience: an L round each corner, with a gap behind each player
const standPaint = new THREE.MeshStandardMaterial({ color: 0x3a3440 })
const SHIRT_COLOURS = [0x2a9d8f, 0xe9c46a, 0xf4a261, 0x8ecae6, 0xb5838d]
const AUDIENCE_SIZE = 1.6
let spectatorCount = 0

function addStand(x: number, z: number, sizeX: number, sizeZ: number) {
  const stand = new THREE.Mesh(new THREE.BoxGeometry(sizeX, 2, sizeZ), standPaint)
  stand.position.set(x, FLOOR_Y + 1, z)
  scene.add(stand)

  world.createCollider(
    RAPIER.ColliderDesc.cuboid(sizeX / 2, 1, sizeZ / 2).setTranslation(x, FLOOR_Y + 1, z)
  )
}

const spectators: SpectatorPlan[] = []

type SpectatorHit = {
  index: number
  torso: RAPIER.Collider
  head: RAPIER.Collider
  down: boolean
}

const spectatorHits = new Map<number, SpectatorHit>()

// Looks random, but it's a fixed pattern so every device matches
const BODY_HEIGHTS = [0.75, 1, 1.3]

function addSpectator(x: number, z: number, sideways: boolean) {
  const n = spectatorCount
  const color = SHIRT_COLOURS[n % SHIRT_COLOURS.length]
  const bodyHeight = BODY_HEIGHTS[(n * 2 + Math.floor(n / 3)) % 3]
  const headType = (n + Math.floor(n / 4)) % 3
  spectatorCount++

  const size = AUDIENCE_SIZE
  const feetY = FLOOR_Y + 2
  const width = sideways ? size : 2 * size
  const depth = sideways ? 2 * size : size
  const torsoHeight = 3 * size * bodyHeight

  const torso = world.createCollider(
    RAPIER.ColliderDesc.cuboid(width / 2, torsoHeight / 2, depth / 2)
      .setTranslation(x, feetY + torsoHeight / 2, z)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(30)
  )
  const head = world.createCollider(
    RAPIER.ColliderDesc.ball(0.9 * size)
      .setTranslation(x, feetY + torsoHeight + 0.9 * size, z)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(30)
  )

  const hit = { index: n, torso, head, down: false }
  spectatorHits.set(torso.handle, hit)
  spectatorHits.set(head.handle, hit)

  let bodyYaw = z > 0 ? Math.PI : 0
  if (sideways) bodyYaw = x > 0 ? -Math.PI / 2 : Math.PI / 2

  spectators.push({ x, z, feetY, size, bodyYaw, color, bodyHeight, headType })
}

   for (const sideX of [-1, 1]) {
     for (const sideZ of [-1, 1]) {
       addStand(sideX * 14.75, sideZ * 22, 19.5, 5)
       addStand(sideX * 22, sideZ * 13.75, 5, 11.5)

       for (const x of [6, 10, 14, 18, 22]) addSpectator(sideX * x, sideZ * 22, false)
       for (const z of [18, 14, 10]) addSpectator(sideX * 22, sideZ * z, true)
     }
   }

const crowd = makeCrowd(scene, spectators)

// 4b-2c. A trophy shelf at each end. Fixed pattern, not randomness,
// so every device builds exactly the same room.
function addHandles(cup: THREE.BufferGeometry, x: number, y: number, size: number) {
  const right = new THREE.TorusGeometry(size, 0.05, 4, 6, Math.PI).toNonIndexed()
  right.rotateZ(-Math.PI / 2)
  right.translate(x, y, 0)

  const left = right.clone().rotateY(Math.PI)
  return mergeGeometries([cup.toNonIndexed(), right, left])!
}

const TROPHY_TYPES = [
  {
    height: 1.4, radius: 0.4, color: 0xffc300,
    shape: addHandles(
      makeShape(1.4, [
        [0, 0], [0.35, 0], [0.35, 0.12], [0.1, 0.2], [0.08, 0.6],
        [0.4, 0.9], [0.42, 1.4], [0.3, 1.4], [0, 0.95],
      ]),
      0.38, 0.45, 0.2
    ),
  },
  {
    height: 1, radius: 0.32, color: 0xcfd8dc,
    shape: addHandles(
      makeShape(1, [
        [0, 0], [0.28, 0], [0.28, 0.1], [0.08, 0.2], [0.08, 0.5],
        [0.32, 0.7], [0.2, 1], [0, 1],
      ]),
      0.3, 0.2, 0.18
    ),
  },
]

const shelfPaint = new THREE.MeshStandardMaterial({ color: 0x5c4033 })

type Breakable = {
  collider: RAPIER.Collider
  mesh: THREE.Mesh
  color: number
  broken: boolean
}

const breakables = new Map<number, Breakable>()

function addTrophyShelf(z: number) {
  const shelfY = 9

  const board = new THREE.Mesh(new THREE.BoxGeometry(26, 0.2, 1), shelfPaint)
  board.position.set(0, shelfY, z)
  scene.add(board)

  world.createCollider(
    RAPIER.ColliderDesc.cuboid(13, 0.1, 0.5).setTranslation(0, shelfY, z)
  )

  for (let i = 0; i < 12; i++) {
    const type = TROPHY_TYPES[i % TROPHY_TYPES.length]
    const x = i * 2 - 11
    const y = shelfY + 0.1 + type.height / 2

    const mesh = new THREE.Mesh(
      type.shape,
      new THREE.MeshStandardMaterial({
        color: type.color,
        flatShading: true,
        metalness: 0.4,
        roughness: 0.3,
        emissive: type.color,
        emissiveIntensity: 0.3,
      })
    )
    mesh.position.set(x, y, z)
    scene.add(mesh)

    const collider = world.createCollider(
      RAPIER.ColliderDesc.cylinder(type.height / 2, type.radius)
        .setTranslation(x, y, z)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(30)
    )

    breakables.set(collider.handle, { collider, mesh, color: type.color, broken: false })
  }
}

addTrophyShelf(29.4)
addTrophyShelf(-29.4)

function smash(item: Breakable) {
  if (item.broken) return
  item.broken = true
  item.mesh.visible = false
  item.collider.setEnabled(false)
  burst(scene, item.mesh.position, item.color, 24, 5)
  addShake(0.1)
  excite(crowd, 0.6)
  play('crash')
}

function knockDown(hit: SpectatorHit, at: { x: number; y: number; z: number }) {
  if (hit.down) return
  hit.down = true
  hit.torso.setEnabled(false)
  hit.head.setEnabled(false)
  knockSpectator(crowd, hit.index)
  burst(scene, at, 0xffffff, 16, 6)
  addShake(0.1)
  excite(crowd, 0.8)
  play('clonk')
}

function shakePlayer(handle: number, at: { x: number; z: number }, strength: number) {
  const hit = bodyHits.get(handle)
  if (!hit) return

  hitWobble(hit.wobble, -at.x, hit.z - at.z, strength)
  for (const arm of arms[hit.side]) flailArm(arm)
}

const HIT_SOUNDS: Record<string, SoundName> = {
  'Hat!': 'clonk',
  'Bonk!': 'clonk',
  'Gums!': 'clonk',
  'Glasses!': 'highCrash',
  'Teeth!': 'highCrash',
  'Nose!': 'honk',
  'Right in the eye!': 'squelch',
}

function handleImpacts() {
  eventQueue.drainContactForceEvents((event) => {
    const handle1 = event.collider1()
    const handle2 = event.collider2()

    const item = breakables.get(handle1) ?? breakables.get(handle2)
    if (item) {
      smash(item)
      return
    }

    const spectator = spectatorHits.get(handle1) ?? spectatorHits.get(handle2)
    if (spectator) {
      const pieceHandle = spectatorHits.has(handle1) ? handle2 : handle1
      knockDown(spectator, world.getCollider(pieceHandle).translation())
      return
    }


    const person = players.get(handle1) ?? players.get(handle2)
    if (person) {
      const pieceHandle = players.has(handle1) ? handle2 : handle1
      const at = world.getCollider(pieceHandle).translation()
      const result = hitCharacter(scene, person, at)
      shakePlayer(players.has(handle1) ? handle1 : handle2, at, 1)
      if (result) {
        statusLine.textContent = result
        play(HIT_SOUNDS[result])
      }
      excite(crowd, 1)
      return
    }
    const bodyHandle = bodyHits.has(handle1) ? handle1 : bodyHits.has(handle2) ? handle2 : null
    if (bodyHandle !== null) {
      const pieceHandle = bodyHandle === handle1 ? handle2 : handle1
      shakePlayer(bodyHandle, world.getCollider(pieceHandle).translation(), 0.5)
      excite(crowd, 0.4)
      play('clonk')
      return
    }
    // Spark at the moving piece, or halfway between two pieces
    const collider1 = world.getCollider(handle1)
    const collider2 = world.getCollider(handle2)
    const a = collider1.translation()
    const b = collider2.translation()

    let at = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }
    if (!collider1.parent()) at = b
    if (!collider2.parent()) at = a

    const size = Math.min(event.totalForceMagnitude() / 150, 4)
    burst(scene, at, 0xffb703, Math.round(6 * size), 3 + size)
    addShake(0.02 * size)
    excite(crowd, 0.1 * size)
    play('click', size / 4)
  })
}

// 4b-3. Invisible side walls that only bishops can hit
const WALL_GROUP = 0x00040002
const BISHOP_GROUP = 0x0003ffff
const OTHER_PIECE_GROUP = 0x0001ffff

for (const x of [-4.1, 4.1]) {
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.1, 4, 4)
      .setTranslation(x, 4, 0)
      .setRestitution(1)
      .setCollisionGroups(WALL_GROUP)
  )
}

// Plain numbers, not Math.sin: sin and cos can differ between devices
const OCTAGON = [
  [1, 0], [0.7071, 0.7071], [0, 1], [-0.7071, 0.7071],
  [-1, 0], [-0.7071, -0.7071], [0, -1], [0.7071, -0.7071],
]

function taperedHull(height: number, radius: number) {
  const points: number[] = []
  for (const [x, z] of OCTAGON) {
    points.push(x * radius, -height / 2, z * radius)
    points.push(x * radius * 0.35, height / 2, z * radius * 0.35)
  }
  return new Float32Array(points)
}

// 4c. Every piece is a visible mesh, an invisible body and a home square
type Side = 'red' | 'blue'

type Piece = {
  side: Side
  out: boolean
  kind: PieceKind
  mesh: THREE.Mesh
  body: RAPIER.RigidBody
  homeX: number
  homeY: number
  homeZ: number
}

const pieces: Piece[] = []

function addPiece(kind: PieceKind, x: number, z: number, side: Side) {
  const type = PIECE_TYPES[kind]
  const homeY = type.height / 2

  const shape = kind === 'knight' && side === 'blue' ? blueKnightShape : type.shape
  const mesh = new THREE.Mesh(shape, side === 'red' ? redPaint : bluePaint)
  scene.add(mesh)

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, homeY, z)
      .setLinearDamping(0.3)
      .setAngularDamping(0.3)
  )
  world.createCollider(
    RAPIER.ColliderDesc.convexHull(taperedHull(type.height, type.radius))!
      .setDensity(type.density)
      .setFriction(0.5)
      .setRestitution(kind === 'bishop' ? 0.8 : 0.3)
      .setCollisionGroups(kind === 'bishop' ? BISHOP_GROUP : OTHER_PIECE_GROUP)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(150),
    body
  )

  pieces.push({ side, out: false, kind, mesh, body, homeX: x, homeY, homeZ: z })
}

const BACK_ROW: PieceKind[] = [
  'rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook',
]

for (let file = 0; file < 8; file++) {
  const x = file - 3.5
  addPiece('pawn', x, 2.5, 'red')
  addPiece(BACK_ROW[file], x, 3.5, 'red')
  addPiece('pawn', x, -2.5, 'blue')
  addPiece(BACK_ROW[file], x, -3.5, 'blue')
}

// 4d. The game rules
type Phase = 'aiming' | 'rolling' | 'over'

let turn: Side = 'red'
let phase: Phase = 'aiming'
let winner: Side | null = null
let rollingSteps = 0
const hasFlicked = { red: false, blue: false }
const statusLine = document.querySelector<HTMLDivElement>('#status')!
const captionLine = document.querySelector<HTMLDivElement>('#caption')!

// A snapshot taken at each flick, so the end of the turn can see what changed
const atFlick = { red: 0, blue: 0, kings: 0, hits: 0, opening: false }
let queenWrapped = false

// Online, the host will choose this seed and send it to both devices
resetCommentary(Math.floor(Math.random() * 1000))

let hook: { body: RAPIER.RigidBody; x: number; z: number } | null = null
let flicked: Piece | null = null
let queenRun: {
  piece: Piece
  x: number
  z: number
  vx: number
  vz: number
} | null = null

function startQueen(piece: Piece, vx: number, vz: number) {
  const position = piece.body.translation()
  piece.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true)
  queenRun = { piece, x: position.x, z: position.z, vx, vz }
}

function stepQueen() {
  if (!queenRun) return
  const run = queenRun

  run.x += run.vx * world.timestep
  run.z += run.vz * world.timestep
  run.vx *= 0.99
  run.vz *= 0.99

  // Off one edge, back on at the opposite edge
  let wrapped = false
  if (run.x > 4) { run.x -= 8; wrapped = true }
  if (run.x < -4) { run.x += 8; wrapped = true }
  if (run.z > 4) { run.z -= 8; wrapped = true }
  if (run.z < -4) { run.z += 8; wrapped = true }
  if (wrapped) queenWrapped = true

  const target = { x: run.x, y: run.piece.homeY, z: run.z }
  if (wrapped) run.piece.body.setTranslation(target, true)
  else run.piece.body.setNextKinematicTranslation(target)

  if (run.vx * run.vx + run.vz * run.vz < 0.25) {
    run.piece.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true)
    queenRun = null
  }
}

function isFallen(piece: Piece) {
  const q = piece.body.rotation()
  return 1 - 2 * (q.x * q.x + q.z * q.z) < 0.7
}

function isPlayable(piece: Piece) {
  return !piece.out && !isFallen(piece)
}

function hasPlayablePiece(side: Side) {
  return pieces.some((p) => p.side === side && isPlayable(p))
}

// Squared speeds, so 0.09 means 0.3 units a second
function isSlow(piece: Piece) {
  const v = piece.body.linvel()
  const w = piece.body.angvel()
  const speed = v.x * v.x + v.y * v.y + v.z * v.z
  const spin = w.x * w.x + w.y * w.y + w.z * w.z
  return speed < 0.09 && spin < 1
}

function canFlick(piece: Piece) {
  if (phase !== 'aiming' || piece.side !== turn) return false
  if (!isPlayable(piece)) return false
  return hasFlicked[turn] || piece.kind === 'pawn'
}

const SIDE_NAMES = { red: 'Ivory', blue: 'Ebony' }

function showStatus() {
  if (phase === 'over') statusLine.textContent = `${SIDE_NAMES[winner!]} wins! Press R`
  else if (phase === 'rolling') statusLine.textContent = '...'
  else statusLine.textContent = `${SIDE_NAMES[turn]} to flick`
}

function countPlayable(side: Side) {
  return pieces.filter((p) => p.side === side && isPlayable(p)).length
}

function countKings() {
  return pieces.filter((p) => p.kind === 'king' && isPlayable(p)).length
}

function countHitsLeft() {
  return hitsLeft(characters.red) + hitsLeft(characters.blue)
}

// Out of pieces or out of items, either way the game is up
function isBeaten(side: Side) {
  return !hasPlayablePiece(side) || hitsLeft(characters[side]) === 0
}

// One flick gets one caption, so the order here sets which event wins
function readTurn(flicker: Side, other: Side): CommentEvent | null {
  const ownLost = atFlick[flicker] - countPlayable(flicker)
  const otherLost = atFlick[other] - countPlayable(other)

  if (hitsLeft(characters.red) === 0 || hitsLeft(characters.blue) === 0) return 'forfeit'
  if (countKings() < atFlick.kings) return 'kingHit'
  if (countHitsLeft() < atFlick.hits) return 'itemHit'
  if (ownLost > otherLost) return 'ownGoal'
  if (otherLost >= 3) return 'wipeout'
  if (queenWrapped) return 'queenWrap'
  if (atFlick.opening) return 'opening'
  if (otherLost === 0) return 'nearMiss'
  return null
}

function startRolling() {
  atFlick.red = countPlayable('red')
  atFlick.blue = countPlayable('blue')
  atFlick.kings = countKings()
  atFlick.hits = countHitsLeft()
  newFlick(characters.red)
  newFlick(characters.blue)
  atFlick.opening = !hasFlicked.red && !hasFlicked.blue
  queenWrapped = false
  captionLine.textContent = ''

  phase = 'rolling'
  rollingSteps = 0
  hasFlicked[turn] = true
  showStatus()
}

function endTurn() {
  hook = null
  flicked = null
  for (const piece of pieces) {
    const position = piece.body.translation()
    if (Math.abs(position.x) > 4 || Math.abs(position.z) > 4) piece.out = true
    piece.body.setLinvel({ x: 0, y: 0, z: 0 }, false)
    piece.body.setAngvel({ x: 0, y: 0, z: 0 }, false)
  }
  const flicker = turn
  const other: Side = flicker === 'red' ? 'blue' : 'red'
  captionLine.textContent = comment(readTurn(flicker, other))

  if (isBeaten(flicker)) {
    winner = other
    phase = 'over'
  } else if (isBeaten(other)) {
    winner = flicker
    phase = 'over'
  } else {
    turn = other
    phase = 'aiming'
  }

  resetLiftSlider()
  if (phase === 'over') {
    play('winFanfare')
    play('cheer')
  }
  showStatus()
}

// Runs after every physics step, so every device agrees
function afterStep() {
  for (const piece of pieces) {
    if (!piece.out && piece.body.translation().y < -10) {
      piece.out = true
      piece.mesh.visible = false
      piece.body.setEnabled(false)
    }
  }

  if (phase !== 'rolling') return
  rollingSteps++

  if (hook && rollingSteps > 30 && rollingSteps <= 90) {
    hook.body.applyImpulse({ x: hook.x, y: 0, z: hook.z }, true)
  }

  const settled = !queenRun && pieces.every((p) => p.out || isSlow(p))
  if ((settled && rollingSteps > 30) || rollingSteps >= 1800) endTurn()
}

function resetGame() {
  play('fanfare')
  captionLine.textContent = ''
  resetCommentary(Math.floor(Math.random() * 1000))
  if (aiming || settingLift) stopAiming()
  resetLiftSlider()
  flicked = null
  if (queenRun) {
    queenRun.piece.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true)
    queenRun = null
  }
  hook = null
  for (const piece of pieces) {
    piece.out = false
    piece.mesh.visible = true
    piece.body.setEnabled(true)
    piece.body.setTranslation({ x: piece.homeX, y: piece.homeY, z: piece.homeZ }, true)
    piece.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true)
    piece.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    piece.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
  }
  turn = 'red'
  phase = 'aiming'
  winner = null
  hasFlicked.red = false
  hasFlicked.blue = false
  clearBits(scene)
  for (const person of players.values()) resetCharacter(person)
  for (const item of breakables.values()) {
    item.broken = false
    item.mesh.visible = true
    item.collider.setEnabled(true)
  }
  resetCrowd(crowd)
  for (const hit of spectatorHits.values()) {
    hit.down = false
    hit.torso.setEnabled(true)
    hit.head.setEnabled(true)
  }
  showStatus()
}

window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyR') resetGame()
})

showStatus()

// 4e. Everything built so far casts and receives shadows
scene.traverse((object) => {
  if (object instanceof THREE.Mesh) {
    object.castShadow = true
    object.receiveShadow = true
  }
})

// 4f. What the crowd is watching: the chosen piece, then the fastest piece
const boardCentre = new THREE.Vector3()

function findFocus() {
  if (aiming && selected) return selected.mesh.position
  if (phase !== 'rolling') return boardCentre

  let fastest = boardCentre
  let topSpeed = 0.5

  for (const piece of pieces) {
    if (piece.out) continue
    const v = piece.body.linvel()
    const speed = v.x * v.x + v.y * v.y + v.z * v.z
    if (speed > topSpeed) {
      topSpeed = speed
      fastest = piece.mesh.position
    }
  }
  return fastest
}

// 4g. Sound can only begin after the first click or tap
let gameStarted = false

window.addEventListener('pointerdown', () => {
  startAudio()
  if (!gameStarted) {
    gameStarted = true
    play('fanfare')
  }
}, { capture: true })

// 5. Drag to orbit, pinch or scroll to zoom
const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.maxDistance = 26
controls.maxPolarAngle = Math.PI / 2.1

// 5b. The aiming arrow: a flat shaft and a four-sided cone
const arrow = new THREE.Group()
const arrowPaint = new THREE.MeshBasicMaterial({ color: 0x2ecc71 })
const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 1), arrowPaint)
const head = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.5, 4), arrowPaint)
head.rotation.x = Math.PI / 2
arrow.add(shaft, head)
arrow.visible = false
scene.add(arrow)

// 5c. Pulling a piece back to shoot
const MAX_PULL = 3
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
const boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const shot = new THREE.Vector3()
let aiming = false
let settingLift = false
let liftDrag: { x: number; z: number; from: number } | null = null
let selected: Piece | null = null
const liftSlider = document.querySelector<HTMLInputElement>('#lift')!
const hookButton = document.querySelector<HTMLButtonElement>('#hook')!
let hookDirection = 1

hookButton.addEventListener('click', () => {
  hookDirection = -hookDirection
  hookButton.textContent = hookDirection === 1 ? 'Hook: right' : 'Hook: left'
})

// Test only: remove the other side's pieces, so your next flick wins.
// import.meta.env.DEV is false in the finished game, which hides the button.
const testingButton = document.querySelector<HTMLButtonElement>('#testing')!
testingButton.hidden = !import.meta.env.DEV

testingButton.addEventListener('click', () => {
  if (phase !== 'aiming') return
  for (const piece of pieces) {
    if (piece.side === turn) continue
    piece.out = true
    piece.mesh.visible = false
    piece.body.setEnabled(false)
  }
})

// Test only: leave the other side one hit from forfeiting
const lastItemButton = document.querySelector<HTMLButtonElement>('#last-item')!
lastItemButton.hidden = !import.meta.env.DEV

lastItemButton.addEventListener('click', () => {
  if (phase !== 'aiming') return
  leaveOneHit(scene, characters[turn === 'red' ? 'blue' : 'red'])
})

function getLift(kind: PieceKind) {
  const type = PIECE_TYPES[kind]
  return Math.min(Math.max(Number(liftSlider.value), type.minLift), type.maxLift)
}

// Grey out what this piece can't use, and move the slider into the allowed part
function fitLiftSlider(kind: PieceKind) {
  const type = PIECE_TYPES[kind]
  const top = Number(liftSlider.max)
  liftSlider.style.setProperty('--low', String(type.minLift / top))
  liftSlider.style.setProperty('--high', String(type.maxLift / top))
  liftSlider.value = String(getLift(kind))
}

function resetLiftSlider() {
  selected = null
  liftSlider.style.setProperty('--low', '0')
  liftSlider.style.setProperty('--high', '1')
  liftSlider.value = '0'
}

liftSlider.addEventListener('input', () => {
  if (selected) liftSlider.value = String(getLift(selected.kind))
  if (settingLift) updateArrow()
})

function pointOnBoard(event: PointerEvent) {
  const box = renderer.domElement.getBoundingClientRect()
  pointer.x = ((event.clientX - box.left) / box.width) * 2 - 1
  pointer.y = -((event.clientY - box.top) / box.height) * 2 + 1
  raycaster.setFromCamera(pointer, camera)
  return raycaster.ray.intersectPlane(boardPlane, new THREE.Vector3())
}

function updateArrow() {
  if (!selected) return

  const length = shot.length()
  const power = length / MAX_PULL
  const x = selected.mesh.position.x
  const z = selected.mesh.position.z

  arrow.visible = length > 0.1
  arrow.position.set(x, 0.05, z)

  const lift = getLift(selected.kind)
  arrow.lookAt(x + shot.x, 0.05 + length * lift, z + shot.z)

  shaft.scale.z = length
  shaft.position.z = length / 2
  head.position.z = length + 0.25
  arrowPaint.color.setHSL(0.33 * (1 - power), 0.9, 0.5)
}

function stopAiming() {
  aiming = false
  settingLift = false
  liftDrag = null
  arrow.visible = false
  backButton.hidden = true
  controls.enabled = true
  restArm(activeArm)
  showStatus()
}

function fireFlick(piece: Piece) {
  stopAiming()
  flickArm(activeArm)
  play('thwack')
  applyFlick(piece, shot, getLift(piece.kind), hookDirection)
}

// Phones have no Esc key, so the button is the way back on every device
const backButton = document.querySelector<HTMLButtonElement>('#back')!
if (matchMedia('(pointer: coarse)').matches) backButton.textContent = 'Back to aim'

backButton.addEventListener('click', stopAiming)

window.addEventListener('keydown', (event) => {
  if (event.code === 'Escape' && (aiming || settingLift)) stopAiming()
})

// capture: true means we hear the press before OrbitControls does
renderer.domElement.addEventListener('pointerdown', (event) => {
  const spot = pointOnBoard(event)
  if (!spot) return

  if (settingLift) {
    liftDrag = { x: spot.x, z: spot.z, from: Number(liftSlider.value) }
    return
  }

  // Did the ray hit a piece? If not, allow for a slightly clumsy thumb.
  const hit = raycaster.intersectObjects(pieces.map((p) => p.mesh))[0]
  let touched = pieces.find((p) => p.mesh === hit?.object)

  if (!touched) {
    touched = pieces.find((p) => {
      const dx = p.mesh.position.x - spot.x
      const dz = p.mesh.position.z - spot.z
      return dx * dx + dz * dz < 0.25
    })
  }

  if (touched && canFlick(touched)) {
    selected = touched
    fitLiftSlider(touched.kind)
    aiming = true
    controls.enabled = false
    shot.set(0, 0, 0)
    const pieceX = touched.mesh.position.x
    activeArm = arms[turn].find((arm) => arm.shoulder.position.x > 0 === pieceX > 0)!
    startReach(activeArm, touched.mesh.position)
  }
}, { capture: true })

window.addEventListener('pointermove', (event) => {
  if (liftDrag && selected) {
    const spot = pointOnBoard(event)
    if (!spot) return

    // How far the pointer has moved back along the aim line
    const backX = liftDrag.x - spot.x
    const backZ = liftDrag.z - spot.z
    const pulled = (backX * shot.x + backZ * shot.z) / shot.length()

    const top = Number(liftSlider.max)
    liftSlider.value = String(liftDrag.from + (pulled / MAX_PULL) * top)
    liftSlider.value = String(getLift(selected.kind))
    updateArrow()
    return
  }

  if (!aiming || !selected) return
  const spot = pointOnBoard(event)
  if (!spot) return

  const from = selected.mesh.position
  shot.set(from.x - spot.x, 0, from.z - spot.z)
  shot.clampLength(0, MAX_PULL)
  setAim(activeArm, from, shot, shot.length() / MAX_PULL)
  updateArrow()
})

// The one way a flick enters the game. It takes plain numbers and touches
// nothing on screen, so a player, the computer, a replay or the other
// device can all use it and get the same result.
function applyFlick(
  piece: Piece,
  aim: { x: number; z: number },
  lift: number,
  hookSide: number
) {
  flicked = piece

  if (piece.kind === 'queen') {
    startQueen(piece, aim.x * 4, aim.z * 4)
    startRolling()
    return
  }

  const strength = PIECE_TYPES[piece.kind].maxImpulse / MAX_PULL
  const length = Math.sqrt(aim.x * aim.x + aim.z * aim.z)

  piece.body.applyImpulse(
    {
      x: aim.x * strength,
      y: length * strength * lift,
      z: aim.z * strength,
    },
    true
  )

  if (piece.kind === 'knight') {
    const sideways = (strength * 0.5 * hookSide) / 60
    hook = { body: piece.body, x: -aim.z * sideways, z: aim.x * sideways }
  }

  startRolling()
}

window.addEventListener('pointerup', () => {
  if (liftDrag && selected) {
    fireFlick(selected)
    return
  }

  if (!aiming || !selected) return
  if (shot.length() <= 0.1) {
    stopAiming()
    return
  }

  // The aim is locked in. The next press and release sets the lift and flicks.
  aiming = false
  settingLift = true
  backButton.hidden = false
  statusLine.textContent =
    selected.kind === 'queen' ? 'Click to flick' : 'Pull back again for lift, let go to flick'
})

window.addEventListener('pointercancel', stopAiming)

// 6. Keep the picture matched to the window or a rotating phone
function fitToWindow() {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
}
window.addEventListener('resize', fitToWindow)
fitToWindow()

// 6b. Slow motion. It only changes how fast the fixed physics steps are spent,
// never what happens in them, so every device still gets the same result.
const SLOW_MOTION = 0.2
const SLOW_WARNING = 0.25 // Seconds before arrival that the slowdown begins
const HEAD_WIDTH = 2.5
const HEAD_RADIUS = headModel.zones.radius * 2 + 0.4 // The head, plus a bit for the size of the piece
let timeScale = 1

// Is this piece about to reach the head at this end of the room?
// arrival is the time to reach the head's middle. Its face comes sooner.
function isHeadingFor(piece: Piece, headZ: number) {
  const p = piece.body.translation()
  const v = piece.body.linvel()
  const speed = v.x * v.x + v.z * v.z
  if (speed < 4) return false

  const arrival = (-p.x * v.x + (headZ - p.z) * v.z) / speed
  const toFace = arrival - HEAD_RADIUS / Math.sqrt(speed)
  if (arrival <= 0 || toFace > SLOW_WARNING) return false

  const missX = p.x + v.x * arrival
  const missZ = p.z + v.z * arrival - headZ
  const faceTime = Math.max(toFace, 0)
  const height = p.y + v.y * faceTime - 4.9 * faceTime * faceTime

  return missX * missX + missZ * missZ < HEAD_WIDTH * HEAD_WIDTH && height > 1.5 && height < 5.5
}

// Slow down only for a shot that could end the game this instant
function isDecidingShot() {
  if (!flicked) return false

  for (const side of ['red', 'blue'] as const) {
    const person = characters[side]
    if (hitsLeft(person) === 1 && !person.struck && isHeadingFor(flicked, HEAD_Z[side])) return true
  }
  return false
}

// 7. The game loop: runs once per screen refresh, forever
let lastTime = 0
let unspentTime = 0

renderer.setAnimationLoop((time) => {
  // How long since the last frame? Capped so a paused tab can't jump.
  const realElapsed = Math.min((time - lastTime) / 1000, 0.25)
  lastTime = time

  const wantedScale = isDecidingShot() ? SLOW_MOTION : 1
  timeScale += (wantedScale - timeScale) * Math.min(realElapsed * 12, 1)
  const elapsed = realElapsed * timeScale
  unspentTime += elapsed

  // Run as many fixed physics steps as that time pays for
  while (unspentTime >= world.timestep) {
    stepQueen()
    world.step(eventQueue)
    afterStep()
    handleImpacts()
    unspentTime -= world.timestep
  }

  // Copy each invisible body's position onto its visible piece
  for (const piece of pieces) {
    const position = piece.body.translation()
    const rotation = piece.body.rotation()
    piece.mesh.position.set(position.x, position.y, position.z)
    piece.mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w)
  }

  updateArms(allArms, elapsed)
  for (const wobble of wobbles) updateWobble(wobble, elapsed)
  updateCrowd(crowd, findFocus(), elapsed)
  controls.update()
  const shake = updateEffects(scene, elapsed)
  camera.position.add(shake)
  renderer.render(scene, camera)
  camera.position.sub(shake)
})
