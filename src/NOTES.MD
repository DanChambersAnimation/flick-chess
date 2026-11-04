# Flick Chess: project notes

## How we work
- I'm learning how games are made, so explain the choices and lead me step by step.
- Give me code and commands. I run everything myself on my T480 and paste back the output.
- I edit in Kate. Tell me exactly which lines to find and replace.
- Spell out every step in full.
- `npx tsc --noEmit` checks the code. Commit a git checkpoint after each step.

## Tech
- Three.js for graphics, Rapier deterministic build for physics, TypeScript, Vite.
- Run with `npm run dev`. Node comes from nvm.
- Source files in `src/`: main, effects, character, arm, crowd, sound, wobble.

## Rules that keep online play possible
- Game logic runs in the fixed physics step, not the drawing loop.
- Anything affecting physics uses fixed patterns, never Math.random or Math.sin.
- Visual-only effects can use real randomness.
- Plan: each turn, send only the flick, and both devices simulate it.
- Hosting plan: Cloudflare Durable Objects. Check current pricing first.

## Game rules so far
- Red and blue flick in turns. Your first flick must be a pawn.
- A piece off the board at the end of a turn is out. Fallen pieces can't be flicked.
- After a flick, you lose if you have no playable pieces. Otherwise you win if your opponent has none.
- Pawn: light. Rook: heavy, squat, little lift. King: slow.
- Knight: minimum lift, curves in flight, hook left or right.
- Bishop: bouncy, invisible side walls, can go off the ends.
- Queen: ploughs through everything, wraps at all edges, slows to a stop.

## Still to do
- Spectators wobble when hit.
- Test that physics results match across two different devices.
- Automated opening-shot test, to stop first-move back-row wipeouts, then balance.
- Silly commentary on moves, e.g. "That reminds me of Sierpinsky's Spanish opening in Prague, 1957".
- Load my Blender heads (.glb) by named parts, with drawn textures. Choosable characters.
- Replace placeholder sounds with my recordings.
- Earn lift through score, damage meter, power-ups, bonus squares.
- Resurrect a fallen piece after wiping out all their pawns or their queen.
- Title screen and menus, standard aiming mode, phone testing, hosting, online play.
