import * as THREE from 'three'

// One entry per joint, from the hips up to the neck.
// Lower spring or damping makes a joint floppier.
const JOINTS = [
  { spring: 70, damping: 6, kick: 0.5 },
  { spring: 55, damping: 4.5, kick: 0.8 },
  { spring: 45, damping: 3.5, kick: 1.1 },
  { spring: 30, damping: 2.5, kick: 1.4 },
]

const KICK_SIZE = 2.5 // How hard a hit throws the body
const FOLLOW = 0.4    // How much each joint is dragged by the one below

export type Wobble = {
  parts: THREE.Group[]
  angleX: number[]
  angleZ: number[]
  speedX: number[]
  speedZ: number[]
}

export function makeWobble(parts: THREE.Group[]): Wobble {
  return {
    parts,
    angleX: parts.map(() => 0),
    angleZ: parts.map(() => 0),
    speedX: parts.map(() => 0),
    speedZ: parts.map(() => 0),
  }
}

// dx and dz are the direction the body is being pushed
export function hitWobble(wobble: Wobble, dx: number, dz: number, strength: number) {
  const length = Math.hypot(dx, dz) || 1

  JOINTS.forEach((joint, i) => {
    const kick = joint.kick * strength * KICK_SIZE
    wobble.speedX[i] += (dz / length) * kick
    wobble.speedZ[i] -= (dx / length) * kick
  })
}

function springJoint(
  angles: number[],
  speeds: number[],
  i: number,
  step: number
) {
  const joint = JOINTS[i]
  const below = i > 0 ? angles[i - 1] : 0
  const wanted = below * FOLLOW
  const push = (wanted - angles[i]) * joint.spring - speeds[i] * joint.damping

  speeds[i] += push * step
  angles[i] += speeds[i] * step
}

export function updateWobble(wobble: Wobble, elapsed: number) {
  const step = Math.min(elapsed, 0.033)

  wobble.parts.forEach((part, i) => {
    springJoint(wobble.angleX, wobble.speedX, i, step)
    springJoint(wobble.angleZ, wobble.speedZ, i, step)
    part.rotation.x = wobble.angleX[i]
    part.rotation.z = wobble.angleZ[i]
  })
}
