import type { PlainMessage, SlashCommand } from '@towns-protocol/proto'

// Those commands will be registered to the bot as soon as the bot is initialized
// and will be available in the slash command autocomplete.
const commands = [
        {
            name: 'rumble',
            description: 'Start a battle royale without rewards (admin only). Usage: /rumble [private|public] Theme: [christmas]',
        },
        {
            name: 'rumble_reward',
            description: 'Start a battle royale with TOWNS rewards (admin only). Usage: /rumble_reward AMOUNT [private|public] Theme: [christmas]',
        },
    {
        name: 'cancel',
        description: 'Cancel a battle that hasn\'t started yet (admin only)',
    },
    {
        name: 'leaderboard',
        description: 'View the top 10 players leaderboard',
    },
    {
        name: 'perms',
        description: 'Manage battle permissions (admin only). Usage: /perms [add|remove|list] [userId]',
    },
    {
        name: 'help',
        description: 'Show help and how to use the Rumble Royale bot',
    },
] as const satisfies PlainMessage<SlashCommand>[]

export default commands
