import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import RAPIER from '@dimforge/rapier3d-deterministic-compat'
import { burst, addShake, updateEffects } from './effects'

await RAPIER.init()

// 1. The three things every 3D program needs
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
camera.position.set(0, 9, 10)

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
document.querySelector('#app')!.appendChild(renderer.domElement)

// 2. Lights: a soft sky glow, plus one "sun" that shades the facets
scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 1.5))
const sun = new THREE.DirectionalLight(0xffffff, 2.5)
sun.position.set(4, 10, 3)
scene.add(sun)

// 3. The board: 64 boxes sharing one shape
const squareShape = new THREE.BoxGeometry(1, 0.2, 1)
const lightSquare = new THREE.MeshStandardMaterial({ color: 0xe9d8a6 })
const darkSquare = new THREE.MeshStandardMaterial({ color: 0x6b4f3a })

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
    height: 0.92, radius: 0.3, density: 1, maxImpulse: 8, liftScale: 1,
    shape: makeShape(0.92, [
      [0, 0], [0.32, 0], [0.32, 0.1], [0.14, 0.25], [0.1, 0.5],
      [0.2, 0.56], [0.1, 0.62], [0.2, 0.72], [0.17, 0.86], [0, 0.92],
    ]),
  },
  rook: {
    height: 0.8, radius: 0.36, density: 6, maxImpulse: 14, liftScale: 0.4,
    shape: makeShape(0.8, [
      [0, 0], [0.38, 0], [0.38, 0.12], [0.26, 0.2],
      [0.24, 0.6], [0.34, 0.66], [0.34, 0.8], [0, 0.8],
    ]),
  },
  knight: {
    height: 1.1, radius: 0.32, density: 3, maxImpulse: 16, liftScale: 1,
    shape: makeKnightShape(),
  },
  bishop: {
    height: 1.25, radius: 0.3, density: 3, maxImpulse: 16, liftScale: 1,
    shape: makeShape(1.25, [
      [0, 0], [0.32, 0], [0.32, 0.1], [0.14, 0.3], [0.1, 0.75],
      [0.22, 0.82], [0.1, 0.9], [0.17, 1.05], [0.06, 1.2], [0, 1.25],
    ]),
  },
  queen: {
    height: 1.45, radius: 0.33, density: 6, maxImpulse: 30, liftScale: 1,
    shape: makeShape(1.45, [
      [0, 0], [0.35, 0], [0.35, 0.12], [0.15, 0.35], [0.1, 0.95],
      [0.25, 1.05], [0.12, 1.13], [0.26, 1.3], [0.2, 1.38], [0, 1.45],
    ]),
  },
  king: {
    height: 1.6, radius: 0.33, density: 5, maxImpulse: 8, liftScale: 0.5,
    shape: makeShape(1.6, [
      [0, 0], [0.35, 0], [0.35, 0.12], [0.15, 0.35], [0.11, 1.05],
      [0.24, 1.14], [0.12, 1.22], [0.2, 1.4], [0.06, 1.48], [0.06, 1.6], [0, 1.6],
    ]),
  },
}

type PieceKind = keyof typeof PIECE_TYPES


const blueKnightShape = PIECE_TYPES.knight.shape.clone().rotateY(Math.PI)

const redPaint = new THREE.MeshStandardMaterial({ color: 0xd62828, flatShading: true })
const bluePaint = new THREE.MeshStandardMaterial({ color: 0x1d3557, flatShading: true })

// 4b. The invisible physics world
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
world.timestep = 1 / 120
const eventQueue = new RAPIER.EventQueue(true)

world.createCollider(
  RAPIER.ColliderDesc.cuboid(4, 0.1, 4).setTranslation(0, -0.1, 0)
)

// 4b-2. The table and the two players, solid in both worlds
const tableTop = new THREE.Mesh(
  new THREE.BoxGeometry(12, 0.4, 12),
  new THREE.MeshStandardMaterial({ color: 0x8d5a3b })
)
tableTop.position.set(0, -0.4, 0)
scene.add(tableTop)

world.createCollider(
  RAPIER.ColliderDesc.cuboid(6, 0.2, 6).setTranslation(0, -0.4, 0)
)

const skinPaint = new THREE.MeshStandardMaterial({ color: 0xf2c9a0, flatShading: true })

function addPerson(z: number, paint: THREE.Material) {
  const torso = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 1), paint)
  torso.position.set(0, -0.5, z)
  scene.add(torso)

  const face = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 1), skinPaint)
  face.position.set(0, 1.9, z)
  scene.add(face)

  world.createCollider(
    RAPIER.ColliderDesc.cuboid(1, 1.5, 0.5).setTranslation(0, -0.5, z)
  )
  world.createCollider(
    RAPIER.ColliderDesc.ball(0.9).setTranslation(0, 1.9, z)
  )
}

addPerson(7.2, redPaint)
addPerson(-7.2, bluePaint)

// 4b-2b. Shelves of breakable objects. These use a fixed pattern, not
// randomness, so every device builds exactly the same room.
const OBJECT_TYPES = [
  {
    height: 0.9, radius: 0.24,
    shape: makeShape(0.9, [
      [0, 0], [0.18, 0], [0.26, 0.3], [0.2, 0.6], [0.09, 0.75], [0.15, 0.9], [0, 0.9],
    ]),
  },
  {
    height: 1, radius: 0.16,
    shape: makeShape(1, [
      [0, 0], [0.16, 0], [0.16, 0.6], [0.06, 0.78], [0.06, 1], [0, 1],
    ]),
  },
  {
    height: 0.4, radius: 0.24,
    shape: makeShape(0.4, [
      [0, 0], [0.2, 0], [0.24, 0.4], [0, 0.4],
    ]),
  },
]

const OBJECT_COLOURS = [0x2a9d8f, 0xe9c46a, 0xf4a261, 0x8ecae6, 0xb5838d]
const shelfPaint = new THREE.MeshStandardMaterial({ color: 0x5c4033 })

type Breakable = {
  collider: RAPIER.Collider
  mesh: THREE.Mesh
  color: number
  broken: boolean
}

const breakables = new Map<number, Breakable>()
let objectCount = 0

function addShelf(x: number, z: number, length: number, alongX: boolean) {
  const sizeX = alongX ? length : 0.7
  const sizeZ = alongX ? 0.7 : length
  const count = Math.floor(length / 1.2)

  for (const y of [0.5, 2.5, 4.5]) {
    const board = new THREE.Mesh(new THREE.BoxGeometry(sizeX, 0.15, sizeZ), shelfPaint)
    board.position.set(x, y, z)
    scene.add(board)

    world.createCollider(
      RAPIER.ColliderDesc.cuboid(sizeX / 2, 0.075, sizeZ / 2).setTranslation(x, y, z)
    )

    for (let i = 0; i < count; i++) {
      const type = OBJECT_TYPES[objectCount % OBJECT_TYPES.length]
      const color = OBJECT_COLOURS[objectCount % OBJECT_COLOURS.length]
      objectCount++

      const offset = (i + 0.5) * (length / count) - length / 2
      const objectX = alongX ? x + offset : x
      const objectZ = alongX ? z : z + offset
      const objectY = y + 0.075 + type.height / 2

      const mesh = new THREE.Mesh(
        type.shape,
        new THREE.MeshStandardMaterial({ color, flatShading: true })
      )
      mesh.position.set(objectX, objectY, objectZ)
      scene.add(mesh)

      const collider = world.createCollider(
        RAPIER.ColliderDesc.cylinder(type.height / 2, type.radius)
          .setTranslation(objectX, objectY, objectZ)
          .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
          .setContactForceEventThreshold(30)
      )

      breakables.set(collider.handle, { collider, mesh, color, broken: false })
    }
  }
}

for (const side of [-1, 1]) {
  addShelf(0, side * 9.5, 14, true)
  addShelf(-7.5, side * 7, 4, false)
  addShelf(7.5, side * 7, 4, false)
}

function smash(item: Breakable) {
  if (item.broken) return
  item.broken = true
  item.mesh.visible = false
  item.collider.setEnabled(false)
  burst(scene, item.mesh.position, item.color, 24, 5)
  addShake(0.1)
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
    RAPIER.ColliderDesc.cylinder(homeY, type.radius)
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

let hook: { body: RAPIER.RigidBody; x: number; z: number } | null = null
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

function showStatus() {
  if (phase === 'over') statusLine.textContent = `${winner} wins! Press R`
  else if (phase === 'rolling') statusLine.textContent = '...'
  else statusLine.textContent = `${turn} to flick`
}

function startRolling() {
  phase = 'rolling'
  rollingSteps = 0
  hasFlicked[turn] = true
  showStatus()
}

function endTurn() {
  hook = null
  for (const piece of pieces) {
    const position = piece.body.translation()
    if (Math.abs(position.x) > 4 || Math.abs(position.z) > 4) piece.out = true
    piece.body.setLinvel({ x: 0, y: 0, z: 0 }, false)
    piece.body.setAngvel({ x: 0, y: 0, z: 0 }, false)
  }
  const flicker = turn
  const other: Side = flicker === 'red' ? 'blue' : 'red'

  if (!hasPlayablePiece(flicker)) {
    winner = other
    phase = 'over'
  } else if (!hasPlayablePiece(other)) {
    winner = flicker
    phase = 'over'
  } else {
    turn = other
    phase = 'aiming'
  }
  showStatus()
}

// Runs after every physics step, so every device agrees
function afterStep() {
  for (const piece of pieces) {
    if (!piece.out && piece.body.translation().y < -3) {
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
  for (const item of breakables.values()) {
    item.broken = false
    item.mesh.visible = true
    item.collider.setEnabled(true)
  }
  showStatus()
}

window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyR') resetGame()
})

showStatus()

// 5. Drag to orbit, pinch or scroll to zoom
const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true

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
let selected: Piece | null = null
const liftSlider = document.querySelector<HTMLInputElement>('#lift')!
const hookButton = document.querySelector<HTMLButtonElement>('#hook')!
let hookDirection = 1

hookButton.addEventListener('click', () => {
  hookDirection = -hookDirection
  hookButton.textContent = hookDirection === 1 ? 'Hook: right' : 'Hook: left'
})

function getLift(kind: PieceKind) {
  const slider = Number(liftSlider.value)
  if (kind === 'knight') return Math.max(slider, 0.5)
  if (kind === 'queen') return 0
  return slider * PIECE_TYPES[kind].liftScale
}

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
  arrow.visible = false
  controls.enabled = true
}

// capture: true means we hear the press before OrbitControls does
renderer.domElement.addEventListener('pointerdown', (event) => {
  const spot = pointOnBoard(event)
  if (!spot) return

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
    aiming = true
    controls.enabled = false
    shot.set(0, 0, 0)
  }
}, { capture: true })

window.addEventListener('pointermove', (event) => {
  if (!aiming || !selected) return
  const spot = pointOnBoard(event)
  if (!spot) return

  const from = selected.mesh.position
  shot.set(from.x - spot.x, 0, from.z - spot.z)
  shot.clampLength(0, MAX_PULL)
  updateArrow()
})

window.addEventListener('pointerup', () => {
  if (!aiming || !selected) return
  stopAiming()
  if (shot.length() <= 0.1) return

  if (selected.kind === 'queen') {
    startQueen(selected, shot.x * 4, shot.z * 4)
    startRolling()
    return
  }

  const type = PIECE_TYPES[selected.kind]
  const strength = type.maxImpulse / MAX_PULL
  const lift = getLift(selected.kind)

  selected.body.applyImpulse(
    {
      x: shot.x * strength,
      y: shot.length() * strength * lift,
      z: shot.z * strength,
    },
    true
  )
  if (selected.kind === 'knight') {
    const sideways = (strength * 0.5 * hookDirection) / 60
    hook = { body: selected.body, x: -shot.z * sideways, z: shot.x * sideways }
  }

  startRolling()
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

// 7. The game loop: runs once per screen refresh, forever
let lastTime = 0
let unspentTime = 0

renderer.setAnimationLoop((time) => {
  // How long since the last frame? Capped so a paused tab can't jump.
  const elapsed = Math.min((time - lastTime) / 1000, 0.25)
  lastTime = time
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

  controls.update()
  const shake = updateEffects(scene, elapsed)
  camera.position.add(shake)
  renderer.render(scene, camera)
  camera.position.sub(shake)
})
