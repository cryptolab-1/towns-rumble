import type { PlainMessage, SlashCommand } from '@towns-protocol/proto'

// Those commands will be registered to the bot as soon as the bot is initialized
// and will be available in the slash command autocomplete.
const commands = [
    {
        name: 'rumble',
        description: 'Start a battle royale without rewards (admin only). Usage: /rumble [private|public]',
    },
    {
        name: 'rumble_reward',
        description: 'Start a battle royale with TOWNS rewards (admin only). Usage: /rumble_reward AMOUNT [private|public]',
    },
    {
        name: 'cancel',
        description: 'Cancel a battle that hasn\'t started yet (admin only)',
    },
    {
        name: 'test',
        description: 'Add 5 test players to current battle for testing (admin only)',
    },
    {
        name: 'test2',
        description: 'Add 5 fake users (excluding admin) to current battle - can be used in any town',
    },
    {
        name: 'leaderboard',
        description: 'View the top 10 players leaderboard',
    },
] as const satisfies PlainMessage<SlashCommand>[]

export default commands
