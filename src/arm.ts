import * as THREE from 'three'

// The animation controls. Angles are in radians, times in seconds.
const POSE = {
  reachSpeed: 14,    // How fast the arm travels. Higher is snappier.
  handSize: 1.6,     // How big the hand is
  handBack: 1.45,    // How far behind the piece the hand waits
  handHeight: 0.45,  // How far above the board the hand sits
  curlBase: 1.7,     // Curl at the knuckle
  curlTip: 1.5,      // Curl at the fingertip joint
  strain: 0.35,      // Extra curl at full power
  tremble: 0.06,     // Shake at full power
  snapTime: 0.05,    // How long the finger takes to ping straight
  overshoot: 0.35,   // How far it whips past straight
  wobbleSpeed: 40,   // How fast it vibrates afterwards
  settleSpeed: 12,   // How quickly the vibration dies away
  holdTime: 0.45,    // How long the hand stays before going home
}

type ArmMode = 'rest' | 'aim' | 'flick'

export type Arm = {
  sleeve: THREE.Mesh
  hand: THREE.Group
  knuckle: THREE.Group
  fingertip: THREE.Group
  restPoint: THREE.Vector3
  target: THREE.Vector3
  direction: THREE.Vector3
  facing: number
  mode: ArmMode
  power: number
  curl: number
  flickTime: number
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
  shoulder: THREE.Vector3,
  paint: THREE.Material,
  facing: number
): Arm {
  const sleeve = new THREE.Mesh(sleeveShape, paint)
  sleeve.position.copy(shoulder)
  scene.add(sleeve)

  const restPoint = shoulder.clone()
  restPoint.y = 0.25
  restPoint.z += facing * 1.2

  const hand = new THREE.Group()
  hand.scale.setScalar(POSE.handSize)
  hand.position.copy(restPoint)
  scene.add(hand)

  // Palm
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.42), skinPaint)
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
    sleeve,
    hand,
    knuckle,
    fingertip,
    restPoint,
    target: new THREE.Vector3(),
    direction: new THREE.Vector3(0, 0, facing),
    facing,
    mode: 'rest',
    power: 0,
    curl: 1,
    flickTime: 0,
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
}

export function flickArm(arm: Arm) {
  arm.mode = 'flick'
  arm.flickTime = 0
}

const goal = new THREE.Vector3()
const lookPoint = new THREE.Vector3()

export function updateArm(arm: Arm, elapsed: number) {
  // Move the hand towards where it should be
  if (arm.mode === 'rest') {
    goal.copy(arm.restPoint)
  } else {
    goal.copy(arm.target).addScaledVector(arm.direction, -POSE.handBack)
    goal.y = POSE.handHeight
  }
  arm.hand.position.lerp(goal, 1 - Math.exp(-elapsed * POSE.reachSpeed))

  lookPoint.copy(arm.hand.position).add(arm.direction)
  arm.hand.lookAt(lookPoint)

  // Stretch the sleeve from shoulder to hand
  arm.sleeve.scale.z = arm.sleeve.position.distanceTo(arm.hand.position)
  arm.sleeve.lookAt(arm.hand.position)

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

    if (t > POSE.holdTime) arm.mode = 'rest'
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
