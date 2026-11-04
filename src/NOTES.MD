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
- Before online play: flicks must apply in the fixed physics step, not on pointerup.
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
- Test that physics results match across two different devices.
- Automated opening-shot test, to stop first-move back-row wipeouts, then balance.
- Load my Blender heads (.glb) by named parts, with drawn textures. Choosable characters.
- Replace placeholder sounds with my recordings.
- Earn lift through score, damage meter, power-ups, bonus squares.
- Resurrect a fallen piece after wiping out all their pawns or their queen.
- Title screen and menus, standard aiming mode, phone testing, hosting, online play.

## Plan from 4 Nov 2026
Work in this order:
1. Test `grayscale(1) contrast(1.2)` on the canvas. Move the win fanfare from startRolling() to endTurn().
2. Move the flick out of pointerup into applyFlick(), taking piece, shot, lift and hook. The computer player, opening test, replays and online play will all use it.
3. Add commentary as text captions, tagged by event: opening, wipeout, own goal, near miss, king hit, queen wrap. Use a shared seed online.
4. Done: each character has three items with two stages. Losing all three forfeits at the end of the turn. Slow motion plays on the approach when someone is one hit from forfeiting.
5. Take one Blender head all the way through, with three named breakables.
6. Build a kit of heads, hair, facial hair and accessories, including female characters.
7. Add the computer opponent using Rapier snapshots, then the opening test and balancing.
8. Build the character selection screen, with random names and a random computer pick in one-player games.

## Design decisions so far
- Items have two stages, askew then gone, with one item lost per flick at most. Falling items are visual-only.
- Play it straight: silence while aiming, a still crowd, a chess clock, captions and annotations like `Qx??`.
- If greyscale stays, use ivory and ebony for the sides, and dark suits for the crowd.
- Check the licence on every music recording. Option: multitrack my own solemn choir.
- Women's Russian surnames change, e.g. Kosminsky becomes Kosminskaya.

## Characters
Each has three items. Every item needs a name, a hit zone and a way of showing its two stages.
- Countess: tiara, eyepatch, earrings.
- Russian: small dark glasses, epaulettes, medals.
- American: horn-rimmed glasses, pipe, tie clip.
- Duffer: monocle, brooch, cigarette holder.
- German fraulein: pearl necklace, hair grip, pince-nez.

Stage ideas: pairs lose one then the other, medals lose half, a pipe droops, a monocle dangles on its cord, an eyepatch slips to reveal a good eye.

Body items need a chest hit zone that still takes some lift, or flat flicks will make them too easy.

## Also to do
- Swap the camera for each player in pass-and-play.
- Add an on-screen reset button.
- Let players resign by tipping their king.
- Add replays from the stored flick list.
