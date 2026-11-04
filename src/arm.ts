import * as THREE from 'three'

// The animation controls. Angles are in radians, times in seconds.
const POSE = {
  reachSpeed: 14,    // How fast the arm travels. Higher is snappier.
  handSize: 1.6,     // How big the hand is
  handBack: 1.1,     // How far behind the piece the hand waits
  handHeight: 1.5,   // How far above the board the hand waits
  pitch: 0.785,      // How far the hand tips forward (0.785 is 45 degrees)
  dropArc: 0.6,      // How high the hand arcs on its way in
  dropMax: 2.5,      // The highest that arc can go
  restHeight: 0.5,   // Hand height at rest
  curlBase: 1.7,     // Curl at the knuckle
  curlTip: 1.5,      // Curl at the fingertip joint
  strain: 0.35,      // Extra curl at full power
  tremble: 0.06,     // Shake at full power
  snapTime: 0.05,    // How long the finger takes to ping straight
  overshoot: 0.35,   // How far it whips past straight
  wobbleSpeed: 40,   // How fast it vibrates afterwards
  settleSpeed: 12,   // How quickly the vibration dies away
  holdTime: 0.45,    // How long the hand stays before going home
  lean: 0.12,        // Body lean at full stretch
  leanTension: 0.03, // Extra lean at full power
  leanKick: 1,       // How hard the body lurches on the flick
  leanSpring: 60,    // Springiness of the body
  leanDamping: 8,    // How quickly the body settles
}

type ArmMode = 'rest' | 'aim' | 'flick'

export type Arm = {
  body: THREE.Group
  shoulder: THREE.Object3D
  sleeve: THREE.Mesh
  hand: THREE.Group
  knuckle: THREE.Group
  fingertip: THREE.Group
  restPoint: THREE.Vector3
  target: THREE.Vector3
  direction: THREE.Vector3
  restDirection: THREE.Vector3
  facing: number
  mode: ArmMode
  power: number
  curl: number
  flickTime: number
  lean: number
  leanSpeed: number
}

const sleeveShape = new THREE.BoxGeometry(0.4, 0.4, 1)
sleeveShape.translate(0, 0, 0.5)

const skinPaint = new THREE.MeshStandardMaterial({ color: 0xf2c9a0, flatShading: true })

function box(width: number, height: number, length: number) {
  const shape = new THREE.BoxGeometry(width, height, length)
  shape.translate(0, 0, length / 2)
  return new THREE.Mesh(shape, skinPaint)
}

export function makeArm(
  scene: THREE.Scene,
  body: THREE.Group,
  shoulderPoint: THREE.Vector3,
  paint: THREE.Material,
  facing: number
): Arm {
  const shoulder = new THREE.Object3D()
  shoulder.position.copy(shoulderPoint)
  body.add(shoulder)

  const sleeve = new THREE.Mesh(sleeveShape, paint)
  shoulder.getWorldPosition(sleeve.position)
  scene.add(sleeve)

  const restPoint = sleeve.position.clone()
  restPoint.y = POSE.restHeight
  restPoint.z += facing * 1.2

  const hand = new THREE.Group()
  hand.scale.setScalar(POSE.handSize)
  hand.position.copy(restPoint)
  scene.add(hand)

  // Palm: a flattened sphere
  const palm = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), skinPaint)
  palm.scale.set(0.28, 0.13, 0.24)
  hand.add(palm)

  // Thumb, forming the bottom of the OK ring
  const thumb = box(0.12, 0.12, 0.34)
  thumb.position.set(0.2, -0.12, 0.1)
  thumb.rotation.y = -0.2
  hand.add(thumb)

  // Index finger: two jointed segments
  const knuckle = new THREE.Group()
  knuckle.position.set(0.14, 0.06, 0.2)
  hand.add(knuckle)
  knuckle.add(box(0.11, 0.11, 0.28))

  const fingertip = new THREE.Group()
  fingertip.position.z = 0.28
  knuckle.add(fingertip)
  fingertip.add(box(0.1, 0.1, 0.24))

  // The other three fingers fan out, as in the OK sign
  for (const [x, tilt] of [[-0.02, 0.3], [-0.12, 0.45], [-0.22, 0.6]]) {
    const finger = box(0.1, 0.1, 0.34)
    finger.position.set(x, 0.06, 0.2)
    finger.rotation.x = -tilt
    hand.add(finger)
  }

  return {
    body,
    shoulder,
    sleeve,
    hand,
    knuckle,
    fingertip,
    restPoint,
    target: new THREE.Vector3(),
    direction: new THREE.Vector3(0, 0, facing),
    restDirection: new THREE.Vector3(0, 0, facing),
    facing,
    mode: 'rest',
    power: 0,
    curl: 1,
    flickTime: 0,
    lean: 0,
    leanSpeed: 0,
  }
}

export function startReach(arm: Arm, target: THREE.Vector3) {
  arm.mode = 'aim'
  arm.target.copy(target)
  arm.direction.set(0, 0, arm.facing)
  arm.power = 0
}

export function setAim(arm: Arm, target: THREE.Vector3, shot: THREE.Vector3, power: number) {
  arm.target.copy(target)
  if (shot.lengthSq() > 0.0001) arm.direction.copy(shot).normalize()
  arm.power = power
}

export function restArm(arm: Arm) {
  arm.mode = 'rest'
  arm.power = 0
}

export function flickArm(arm: Arm) {
  arm.mode = 'flick'
  arm.flickTime = 0
  arm.leanSpeed += POSE.leanKick
}

const goal = new THREE.Vector3()
const lookPoint = new THREE.Vector3()
const aimer = new THREE.Object3D()

export function updateArm(arm: Arm, elapsed: number) {
  const blend = 1 - Math.exp(-elapsed * POSE.reachSpeed)

  // The shoulder moves with the leaning body
  arm.shoulder.getWorldPosition(arm.sleeve.position)

  // Move the hand: when reaching, it arcs up and drops in from above
  if (arm.mode === 'rest') {
    goal.copy(arm.restPoint)
  } else {
    goal.copy(arm.target).addScaledVector(arm.direction, -POSE.handBack)
    const away = Math.hypot(arm.hand.position.x - goal.x, arm.hand.position.z - goal.z)
    goal.y = POSE.handHeight + Math.min(away * POSE.dropArc, POSE.dropMax)
  }
  arm.hand.position.lerp(goal, blend)

  // Turn the hand smoothly, tipped forward while aiming
  lookPoint.copy(arm.hand.position)
  if (arm.mode === 'rest') {
    lookPoint.add(arm.restDirection)
  } else {
    lookPoint.add(arm.direction)
    lookPoint.y -= Math.tan(POSE.pitch)
  }
  aimer.position.copy(arm.hand.position)
  aimer.lookAt(lookPoint)
  arm.hand.quaternion.slerp(aimer.quaternion, blend)

  // Stretch the sleeve from shoulder to hand
  const stretch = arm.sleeve.position.distanceTo(arm.hand.position)
  arm.sleeve.scale.z = stretch
  arm.sleeve.lookAt(arm.hand.position)

  // Lean the body on a spring, so it overshoots and settles
  const wantedLean =
    arm.mode === 'rest'
      ? 0
      : POSE.lean * Math.min(stretch / 12, 1) + POSE.leanTension * arm.power
  const step = Math.min(elapsed, 0.033)
  const push = (wantedLean - arm.lean) * POSE.leanSpring - arm.leanSpeed * POSE.leanDamping
  arm.leanSpeed += push * step
  arm.lean += arm.leanSpeed * step
  arm.body.rotation.x = arm.facing * arm.lean

  // Work out the finger's curl: 1 is cocked, 0 is straight
  if (arm.mode === 'flick') {
    arm.flickTime += elapsed
    const t = arm.flickTime

    if (t < POSE.snapTime) {
      arm.curl = 1 - t / POSE.snapTime
    } else {
      const after = t - POSE.snapTime
      arm.curl =
        -POSE.overshoot *
        Math.exp(-after * POSE.settleSpeed) *
        Math.cos(after * POSE.wobbleSpeed)
    }

    if (t > POSE.holdTime) restArm(arm)
  } else {
    let wanted = 1
    if (arm.mode === 'aim') {
      wanted += POSE.strain * arm.power
      if (arm.power > 0.9) wanted += (Math.random() - 0.5) * POSE.tremble
    }
    arm.curl += (wanted - arm.curl) * (1 - Math.exp(-elapsed * 20))
  }

  arm.knuckle.rotation.x = POSE.curlBase * arm.curl
  arm.fingertip.rotation.x = POSE.curlTip * arm.curl
}
