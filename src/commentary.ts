// The commentary. Every line lives here, so rewriting the jokes
// never means touching the game itself.
export type CommentEvent =
  | 'opening'
  | 'wipeout'
  | 'ownGoal'
  | 'nearMiss'
  | 'kingHit'
  | 'queenWrap'
  | 'itemHit'
  | 'forfeit'

const LINES: Record<CommentEvent, string[]> = {
  itemHit: [
    'A sacrifice of material for an attack on the person.',
    'Strictly speaking, that is not the board.',
    'Not in the opening books. Not in any books.',
    'The arbiter has been notified.',
  ],
  forfeit: [
    'The player is no longer presentable. Forfeit.',
    'Resigns, in the physical sense.',
    'Forfeit. The rules are clear on this, as they are on very little else.',
    'The game is abandoned. The hall will be cleared in an orderly fashion.',
  ],
  opening: [
    "That reminds me of Sierpinsky's Spanish opening in Prague, 1957.",
    'The Kosminsky Gambit. It has never once been sound.',
    'A bold reply to a question nobody has asked.',
    'We last saw this at Minsk in 1962, shortly before the lights went out.',
  ],
  wipeout: [
    'Theory runs out here. So do most of the pieces.',
    'A quiet positional move.',
    '!! Textbook. The textbook has since been withdrawn.',
    'Seven grandmasters wept at this, in Vilnius, in 1931.',
  ],
  ownGoal: [
    '?? A deep sacrifice, or a mistake. The clock will not say.',
    'Zugzwang, self-inflicted. A rare achievement.',
    'Interesting. Not good. Interesting.',
    'The engine suggests resigning. The engine is a man in a cardigan.',
  ],
  nearMiss: [
    'A waiting move.',
    'Prophylaxis.',
    'The position remains, regrettably, the same.',
    'Nothing was threatened, and nothing has happened.',
  ],
  kingHit: [
    'Kx?! His Majesty will be writing to the federation.',
    'The king has been inconvenienced.',
    'Not strictly legal in Reykjavik.',
    'A breach of etiquette in the strongest terms.',
  ],
  queenWrap: [
    'Qx?? She left by one edge and returned by the other. The federation is silent.',
    'The queen has gone round the back.',
    'A geometry unknown to the Soviet school.',
    'Analysts are pretending to have seen that coming.',
  ],
}

// A fixed pattern from a shared seed, not Math.random, so that two
// devices given the same seed will show the same lines.
let seed = 0
const used = new Map<CommentEvent, number>()

export function resetCommentary(newSeed: number) {
  seed = newSeed
  used.clear()
}

export function comment(event: CommentEvent | null) {
  if (!event) return ''

  const lines = LINES[event]
  const count = used.get(event) ?? 0
  used.set(event, count + 1)
  return lines[(seed + count) % lines.length]
}
