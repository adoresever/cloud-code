import type { Command, LocalCommandCall } from '../../types/command.js'
import { getCompanion, roll, companionUserId } from '../../buddy/companion.js'
import { renderSprite, renderFace } from '../../buddy/sprites.js'
import { RARITY_STARS, type StoredCompanion } from '../../buddy/types.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'

function formatCompanionCard(companion: ReturnType<typeof getCompanion>): string {
  if (!companion) return ''
  const sprite = renderSprite(companion, 0)
  const face = renderFace(companion)
  const stars = RARITY_STARS[companion.rarity]
  const shinyTag = companion.shiny ? ' ✦ SHINY' : ''
  const lines = [
    `${stars} ${companion.rarity.toUpperCase()}${shinyTag}`,
    '',
    ...sprite,
    '',
    `  ${companion.name}  (${companion.species})`,
    `  ${face}  eye: ${companion.eye}  hat: ${companion.hat}`,
    '',
    `  DEBUGGING: ${companion.stats.DEBUGGING}  PATIENCE: ${companion.stats.PATIENCE}`,
    `  CHAOS: ${companion.stats.CHAOS}  WISDOM: ${companion.stats.WISDOM}  SNARK: ${companion.stats.SNARK}`,
    '',
    `  "${companion.personality}"`,
  ]
  return lines.join('\n')
}

const call: LocalCommandCall = async (_args, { abortController }) => {
  const config = getGlobalConfig()

  // Subcommands
  const arg = (_args ?? '').trim()

  if (arg === 'mute') {
    saveGlobalConfig(c => ({ ...c, companionMuted: true }))
    return { type: 'text', value: 'Buddy muted. Run /buddy unmute to bring them back.' }
  }
  if (arg === 'unmute') {
    saveGlobalConfig(c => ({ ...c, companionMuted: false }))
    return { type: 'text', value: 'Buddy unmuted!' }
  }
  if (arg === 'pet') {
    const companion = getCompanion()
    if (!companion) return { type: 'text', value: 'No buddy yet! Run /buddy to hatch one.' }
    return { type: 'text', value: `♥ ♥ ♥  ${companion.name} wiggles happily!  ♥ ♥ ♥` }
  }

  // Already hatched — show card
  const existing = getCompanion()
  if (existing) {
    return { type: 'text', value: formatCompanionCard(existing) }
  }

  // First hatch — generate bones + soul
  const userId = companionUserId()
  const { bones, inspirationSeed } = roll(userId)

  // Generate name and personality (offline fallback if no API)
  const speciesCapital = bones.species.charAt(0).toUpperCase() + bones.species.slice(1)
  const fallbackNames: Record<string, string> = {
    duck: 'Quackers', goose: 'Honk', blob: 'Blobby', cat: 'Whiskers',
    dragon: 'Ember', octopus: 'Inky', owl: 'Hoot', penguin: 'Waddle',
    turtle: 'Shell', snail: 'Slime', ghost: 'Boo', axolotl: 'Axel',
    capybara: 'Capy', cactus: 'Spike', robot: 'Beep', rabbit: 'Flopsy',
    mushroom: 'Spore', chonk: 'Chonkers',
  }
  const name = fallbackNames[bones.species] || speciesCapital
  const personality = `A ${bones.rarity} ${bones.species} who excels at ${
    Object.entries(bones.stats).sort((a, b) => b[1] - a[1])[0]![0].toLowerCase()
  } but struggles with ${
    Object.entries(bones.stats).sort((a, b) => a[1] - b[1])[0]![0].toLowerCase()
  }. Seed: ${inspirationSeed}.`

  const soul: StoredCompanion = {
    name,
    personality,
    hatchedAt: Date.now(),
  }

  saveGlobalConfig(c => ({ ...c, companion: soul }))

  const companion = { ...soul, ...bones }
  const card = formatCompanionCard(companion)

  return {
    type: 'text',
    value: `🥚 *crack* ...\n\nA ${bones.rarity} ${bones.species} appeared!\n\n${card}`,
  }
}

const buddy = {
  type: 'local' as const,
  name: 'buddy',
  description: 'Hatch or view your companion buddy',
  isEnabled: () => true,
  supportsNonInteractive: false,
  load: () => Promise.resolve({ call }),
}

export default buddy
