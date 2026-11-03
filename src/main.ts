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

// 4. A pawn: draw half a silhouette, then spin it like a clay pot
const silhouette = [
  [0.0, 0.0], [0.32, 0.0], [0.32, 0.1], [0.14, 0.25],
  [0.1, 0.5], [0.2, 0.56], [0.1, 0.62], [0.2, 0.72],
  [0.17, 0.86], [0.0, 0.92],
].map(([x, y]) => new THREE.Vector2(x, y))

const pawnShape = new THREE.LatheGeometry(silhouette, 8) // 8 sides = chunky
const pawnPaint = new THREE.MeshStandardMaterial({ color: 0xd62828, flatShading: true })
const pawn = new THREE.Mesh(pawnShape, pawnPaint)
pawnShape.translate(0, -0.46, 0)
scene.add(pawn)

//4b. The invisible physics world
const world = new RAPIER.World({ x:0, y:-9.81, z:0 })
world.timestep = 1 / 120

world.createCollider(
	RAPIER.ColliderDesc.cuboid(4, 0.1, 4).setTranslation(0, -0.1, 0)
)

const pawnBody = world.createRigidBody(
	RAPIER.RigidBodyDesc.dynamic()
	  .setTranslation(0.5, 0.46, 0.5)
	  .setLinearDamping(0.3)
	  .setAngularDamping(0.3)
)
world.createCollider(
	RAPIER.ColliderDesc.cylinder(0.46, 0.3)
	  .setDensity(1)
	  .setFriction(0.5)
	  .setRestitution(0.3),
	pawnBody
)

//4c. Temporary controls: Space flicks, R resets
window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyR') {
  	pawnBody.setTranslation({ x:0.5, y:0.46, z:0.5 }, true)
  	pawnBody.setRotation({ x:0, y:0, z:0, w:1 }, true)
  	pawnBody.setLinvel({ x:0, y:0, z:0 }, true)
  	pawnBody.setAngvel({ x:0, y:0, z:0 }, true)
  }
})

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

// 5c. Pulling the pawn back to shoot
const MAX_PULL = 3
const MAX_IMPULSE = 8
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
const boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const shot = new THREE.Vector3()
let aiming = false
const liftSlider = document.querySelector<HTMLInputElement>('#lift')!

function pointOnBoard(event: PointerEvent) {
  const box = renderer.domElement.getBoundingClientRect()
  pointer.x = ((event.clientX - box.left) / box.width) * 2 - 1
  pointer.y = -((event.clientY - box.top) / box.height) * 2 + 1
  raycaster.setFromCamera(pointer, camera)
  return raycaster.ray.intersectPlane(boardPlane, new THREE.Vector3())
}

function updateArrow() {
  const length = shot.length()
  const power = length / MAX_PULL
  const x = pawn.position.x
  const z = pawn.position.z

  arrow.visible = length > 0.1
  arrow.position.set(x, 0.05, z)
  const lift = Number(liftSlider.value)
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

  const onPawn =
    raycaster.intersectObject(pawn).length > 0 ||
    spot.distanceTo(pawn.position) < 0.8

  if (onPawn) {
    aiming = true
    controls.enabled = false
    shot.set(0, 0, 0)
  }
}, { capture: true })

window.addEventListener('pointermove', (event) => {
  if (!aiming) return
  const spot = pointOnBoard(event)
  if (!spot) return

  shot.set(pawn.position.x - spot.x, 0, pawn.position.z - spot.z)
  shot.clampLength(0, MAX_PULL)
  updateArrow()
})

window.addEventListener('pointerup', () => {
  if (!aiming) return
  stopAiming()
  if (shot.length() <= 0.1) return

  const strength = MAX_IMPULSE / MAX_PULL
  const lift = Number(liftSlider.value)
  pawnBody.applyImpulse(
    {
      x: shot.x * strength,
      y: shot.length() * strength * lift,
      z: shot.z * strength
    },
    true
  )
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
    unspentTime -= world.timestep
  }

  // Copy the invisible body's position onto the visible pawn
  const position = pawnBody.translation()
  const rotation = pawnBody.rotation()
  pawn.position.set(position.x, position.y, position.z)
  pawn.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w)

  controls.update()
  renderer.render(scene, camera)
})
