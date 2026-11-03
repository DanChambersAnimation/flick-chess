import RAPIER from '@dimforge/rapier3d-deterministic-compat'
import { createHash } from 'node:crypto'
await RAPIER.init()

function run() {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  world.timestep = 1 / 120
  world.createCollider(RAPIER.ColliderDesc.cuboid(4, 0.1, 4).setTranslation(0, -0.1, 0))

  const pieces = []
  for (const side of [-1, 1]) {
    for (const row of [0, 1]) {
      for (let file = 0; file < 8; file++) {
        const body = world.createRigidBody(
          RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(file - 3.5, 0.46, side * (2.5 + row))
            .setLinearDamping(0.3)
            .setAngularDamping(0.3)
        )
        world.createCollider(
          RAPIER.ColliderDesc.cylinder(0.45, 0.3).setDensity(1).setFriction(0.5).setRestitution(0.3),
          body
        )
        pieces.push(body)
      }
    }
  }

  pieces[3].applyImpulse({ x: 0.03125, y: 0, z: 4}, true)

  const started = performance.now()
  let steps = 0
  for (; steps < 1800; steps++ ) {
    world.step()
    const stopped = pieces.every((p) => p.isSleeping() || p.translation().y < -3)
    if (steps > 60 && stopped) break
  }
  const ms = Math.round(performance.now() - started)

  const onBoard = pieces.filter((p) => p.translation().y > -0.5)
  const toppled = onBoard.filter((p) => {
    const q = p.rotation()
    return 1 - 2 * (q.x * q.x + q.z * q.z) < 0.7
  })

  return {
    hash: createHash('md5').update(world.takeSnapshot()).digest('hex'),
    steps,
    ms,
    knockedOff: pieces.length - onBoard.length,
    toppled: toppled.length,
  }
}

console.log(run())
console.log(run())
