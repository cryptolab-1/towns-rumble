import type { PlainMessage, SlashCommand } from '@towns-protocol/proto'

// Those commands will be registered to the bot as soon as the bot is initialized
// and will be available in the slash command autocomplete.
const commands = [
    {
        name: 'rumble',
        description: 'Start a battle royale (admin only). Usage: /rumble [reward:AMOUNT] [private|public]',
    },
    {
        name: 'time',
        description: 'Get the current time',
    },
] as const satisfies PlainMessage<SlashCommand>[]

export default commands
