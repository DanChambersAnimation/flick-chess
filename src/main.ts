import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import RAPIER from '@dimforge/rapier3d-deterministic-compat'

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
    shape: makeShape(1.1, [
      [0, 0], [0.34, 0], [0.34, 0.1], [0.16, 0.3], [0.14, 0.65],
      [0.26, 0.8], [0.2, 1.0], [0.08, 1.1], [0, 1.1],
    ]),
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

const redPaint = new THREE.MeshStandardMaterial({ color: 0xd62828, flatShading: true })
const bluePaint = new THREE.MeshStandardMaterial({ color: 0x1d3557, flatShading: true })

// 4b. The invisible physics world
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
world.timestep = 1 / 120

world.createCollider(
  RAPIER.ColliderDesc.cuboid(4, 0.1, 4).setTranslation(0, -0.1, 0)
)

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

  const mesh = new THREE.Mesh(type.shape, side === 'red' ? redPaint : bluePaint)
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
      .setRestitution(0.3),
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
    if (!piece.out && piece.body.translation().y < -1) {
      piece.out = true
      piece.mesh.visible = false
      piece.body.setEnabled(false)
    }
  }

  if (phase !== 'rolling') return
  rollingSteps++

  const settled = pieces.every((p) => p.out || p.body.isSleeping())
  if (settled || rollingSteps >= 1800) endTurn()
}

function resetGame() {
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

  const lift = Number(liftSlider.value) * PIECE_TYPES[selected.kind].liftScale
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

  const type = PIECE_TYPES[selected.kind]
  const strength = type.maxImpulse / MAX_PULL
  const lift = Number(liftSlider.value) * type.liftScale

  selected.body.applyImpulse(
    {
      x: shot.x * strength,
      y: shot.length() * strength * lift,
      z: shot.z * strength,
    },
    true
  )
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
    world.step()
    afterStep()
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
  renderer.render(scene, camera)
})
