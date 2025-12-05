import { makeTownsBot } from '@towns-protocol/bot'
import commands from './commands'
import {
    canStartBattle,
    initiateBattle,
    handleReaction,
    handleTip,
    startBattleLoop,
} from './battle'
import { getActiveBattle, getBattleByChannelId, getActivePublicBattle, getActivePrivateBattle, setActivePublicBattle, setActivePrivateBattle, trackChannelForPublicBattles, getPublicBattleChannels, getBattleIdByMessageId, setMessageIdToBattleId, getBattleByBattleId, getBattleByChannelIdAndAdmin, addBattlePermission, removeBattlePermission, getBattlePermissions, finishBattle, type BattleState } from './db'

const bot = await makeTownsBot(process.env.APP_PRIVATE_DATA!, process.env.JWT_SECRET!, {
    commands,
})

bot.onSlashCommand('rumble', async (handler, { channelId, spaceId, userId, args }) => {
    // Track channel for public battle announcements
    trackChannelForPublicBattles(channelId, spaceId)
    
    // Check if user is admin
    const isAdmin = await canStartBattle(handler, userId, spaceId)
    if (!isAdmin) {
        await handler.sendMessage(channelId, '❌ Only admins can start a battle!')
        return
    }

    // Parse private/public flag and theme (no rewards for regular rumble)
    let isPrivate = true // Default to private
    let theme = 'default' // Default theme
    
    if (args && args.length > 0) {
        const privateArg = args.find(arg => arg.toLowerCase() === 'private' || arg.toLowerCase() === 'p')
        const publicArg = args.find(arg => arg.toLowerCase() === 'public' || arg.toLowerCase() === 'pub')
        // Support both "christmas" and "Theme: christmas" formats
        const christmasArg = args.find(arg => {
            const lower = arg.toLowerCase()
            return lower === 'christmas' || lower === 'xmas' || lower.includes('theme:') && lower.includes('christmas')
        })
        
        if (privateArg) {
            isPrivate = true
        } else if (publicArg) {
            isPrivate = false
        }
        
        if (christmasArg) {
            theme = 'christmas'
        }
    }

    // Check for active battles based on type
    if (isPrivate) {
        // Check if there's already an active private battle in this space
        const activePrivateBattle = getActivePrivateBattle(spaceId)
        if (activePrivateBattle && activePrivateBattle.status !== 'finished') {
            await handler.sendMessage(
                channelId,
                `⚔️ There's already an active private battle in this town! Please wait for it to finish.`
            )
            return
        }
    } else {
        // Check if there's already an active public battle
        const activePublicBattle = getActivePublicBattle()
        if (activePublicBattle && activePublicBattle.status !== 'finished') {
            await handler.sendMessage(
                channelId,
                `⚔️ There's already an active public battle in progress! Please wait for it to finish.\n\n` +
                `💡 You can launch a private battle instead using: \`/rumble private\``
            )
            return
        }
    }

    // Track this channel for public battle announcements
    trackChannelForPublicBattles(channelId, spaceId)
    
    // Debug: Log existing battles before creating new one
    if (!isPrivate) {
        const existingPrivate = getActivePrivateBattle(spaceId)
        console.log(`[rumble] Creating public battle. Existing private battle in space ${spaceId}: ${existingPrivate ? existingPrivate.battleId : 'none'}`)
    }
    
    // Initiate new battle without rewards
    const battleId = initiateBattle(handler, channelId, spaceId, userId, undefined, isPrivate, false, theme)
    
    // Debug: Verify both battles still exist after creation
    if (!isPrivate) {
        const existingPrivate = getActivePrivateBattle(spaceId)
        const newPublic = getActivePublicBattle()
        console.log(`[rumble] After creating public battle ${battleId}: Private=${existingPrivate ? existingPrivate.battleId : 'none'}, Public=${newPublic ? newPublic.battleId : 'none'}`)
    }
    
    // For public battles, broadcast to all tracked channels
    if (!isPrivate) {
        // Get channels after tracking - since writeDatabase is synchronous, the write should be complete
        // But we'll get fresh data to ensure we have the latest tracked channels
        const channels = getPublicBattleChannels()
        
        // Log for debugging
        console.log(`📢 Broadcasting public battle to ${channels.length} tracked channel(s)`)
        
        for (const channel of channels) {
            try {
                // Determine if this is the originating town or another town
                const isOriginatingTown = channel.spaceId === spaceId
                const locationText = isOriginatingTown ? 'initiated in this town' : 'initiated from another town'
                
                const themeText = theme === 'christmas' ? '🎄 **Christmas Battle** 🎄\n\n' : ''
                let battleMessage: string
                if (isOriginatingTown) {
                    // Originating town gets full message with warnings
                    battleMessage = `⚔️ **BATTLE ROYALE INITIATED!** ⚔️\n\n` +
                        `${themeText}` +
                        `🌐 **Public Battle**, ${locationText} - Cross-town! Any town with the bot can join\n\n` +
                        `React with ⚔️ to join the battle!\n\n` +
                        `⏰ **You have 10 minutes to join and launch the Battle or it will auto-cancel**\n\n` +
                        `⚠️ **WARNING:** You need a minimum of **2 players** before tipping. Game will not launch and tip will be lost if there are less than 2 participants!\n\n` +
                        `Once you're ready, tip me **$1 USD worth of ETH** to launch the battle!`
                } else {
                    // Other towns get simplified message
                    battleMessage = `⚔️ **BATTLE ROYALE INITIATED!** ⚔️\n\n` +
                        `${themeText}` +
                        `🌐 **Public Battle**, ${locationText} - Cross-town! Any town with the bot can join\n\n` +
                        `React with ⚔️ to join the battle!\n\n` +
                        `⏰ **You have 10 minutes to join and launch the Battle or it will auto-cancel**\n\n` +
                        `⚔️ The Battle will start soon`
                }
                
                const sentMessage = await bot.sendMessage(channel.channelId, battleMessage)
                // Store messageId -> battleId mapping for reactions
                if (sentMessage?.eventId) {
                    setMessageIdToBattleId(sentMessage.eventId, battleId)
                    console.log(`[rumble] Stored messageId mapping: ${sentMessage.eventId} -> ${battleId}`)
                }
                // Track channel if message was sent successfully (in case it wasn't already tracked)
                trackChannelForPublicBattles(channel.channelId, channel.spaceId, channel.spaceName, sentMessage?.eventId)
            } catch (error) {
                console.error(`Error broadcasting to channel ${channel.channelId}:`, error)
                // If sending fails, the channel might not exist or bot might not have access
                // Don't track failed channels
            }
        }
    } else {
        // Private battle - only send to originating channel
        const themeText = theme === 'christmas' ? '🎄 **Christmas Battle** 🎄\n\n' : ''
        const battleMessage = `⚔️ **BATTLE ROYALE INITIATED!** ⚔️\n\n` +
            `${themeText}` +
            `🔒 **Private Battle** - Only this town can join\n\n` +
            `React with ⚔️ to join the battle!\n\n` +
            `⚠️ **WARNING:** You need a minimum of **2 players** before tipping. Game will not launch and tip will be lost if there are less than 2 participants!\n\n` +
            `Once you're ready, tip me **$1 USD worth of ETH** to launch the battle!`
        
        const sentMessage = await handler.sendMessage(channelId, battleMessage)
        // Store messageId -> battleId mapping for reactions
        if (sentMessage?.eventId) {
            setMessageIdToBattleId(sentMessage.eventId, battleId)
            console.log(`[rumble] Stored messageId mapping: ${sentMessage.eventId} -> ${battleId}`)
        }
    }

    // Update battle status to pending tip
    const battle = isPrivate ? getActivePrivateBattle(spaceId) : getActivePublicBattle()
    if (battle && battle.battleId === battleId) {
        battle.status = 'pending_tip'
        if (isPrivate) {
            setActivePrivateBattle(spaceId, battle)
        } else {
            setActivePublicBattle(battle)
            
            // Set up 10-minute auto-cancel timer for public battles
            setTimeout(async () => {
                const currentBattle = getActivePublicBattle()
                // Only cancel if battle still exists, hasn't been launched, and matches this battleId
                if (currentBattle && 
                    currentBattle.battleId === battleId && 
                    (currentBattle.status === 'pending_tip' || currentBattle.status === 'pending_approval')) {
                    
                    console.log(`[auto-cancel] Auto-cancelling public battle ${battleId} after 10 minutes`)
                    
                    // Cancel the battle
                    finishBattle(currentBattle)
                    setActivePublicBattle(undefined)
                    
                    // Broadcast cancellation message to all tracked channels
                    const channels = getPublicBattleChannels()
                    const cancelMessage = `❌ **BATTLE AUTO-CANCELLED** ❌\n\n` +
                        `The public battle was automatically cancelled after 10 minutes because it was not launched.\n\n` +
                        `You can start a new battle with \`/rumble\`.`
                    
                    for (const channel of channels) {
                        try {
                            await bot.sendMessage(channel.channelId, cancelMessage)
                        } catch (error) {
                            console.error(`Error broadcasting auto-cancel message to channel ${channel.channelId}:`, error)
                        }
                    }
                }
            }, 10 * 60 * 1000) // 10 minutes in milliseconds
        }
    }
})

bot.onSlashCommand('rumble_reward', async (handler, { channelId, spaceId, userId, args }) => {
    // Track channel for public battle announcements
    trackChannelForPublicBattles(channelId, spaceId)
    
    // Check if user is admin
    const isAdmin = await canStartBattle(handler, userId, spaceId)
    if (!isAdmin) {
        await handler.sendMessage(channelId, '❌ Only admins can start a battle!')
        return
    }

    // Parse reward amount (required for rumble-reward)
    if (!args || args.length === 0) {
        await handler.sendMessage(
            channelId,
            `❌ **Usage:** \`/rumble_reward AMOUNT [private|public]\`\n\n` +
            `Example: \`/rumble_reward 1000 private\`\n` +
            `Example: \`/rumble_reward 5000 public\``
        )
        return
    }

    // Parse reward amount (first argument should be the amount)
    const rewardAmountStr = args[0]
    if (!rewardAmountStr || isNaN(parseFloat(rewardAmountStr)) || parseFloat(rewardAmountStr) <= 0) {
        await handler.sendMessage(
            channelId,
            `❌ Invalid reward amount. Please provide a valid number.\n\n` +
            `Example: \`/rumble_reward 1000 private\``
        )
        return
    }

    const { parseTokenAmount } = await import('./token')
    const rewardAmount = parseTokenAmount(rewardAmountStr).toString()

    // Parse private/public flag and theme
    let isPrivate = true // Default to private
    let theme = 'default' // Default theme
    const privateArg = args.find(arg => arg.toLowerCase() === 'private' || arg.toLowerCase() === 'p')
    const publicArg = args.find(arg => arg.toLowerCase() === 'public' || arg.toLowerCase() === 'pub')
    // Support both "christmas" and "Theme: christmas" formats
    const christmasArg = args.find(arg => {
        const lower = arg.toLowerCase()
        return lower === 'christmas' || lower === 'xmas' || (lower.includes('theme:') && lower.includes('christmas'))
    })
    
    if (privateArg) {
        isPrivate = true
    } else if (publicArg) {
        isPrivate = false
    }
    
    if (christmasArg) {
        theme = 'christmas'
    }

    // Check for active battles based on type
    if (isPrivate) {
        // Check if there's already an active private battle in this space
        const activePrivateBattle = getActivePrivateBattle(spaceId)
        if (activePrivateBattle && activePrivateBattle.status !== 'finished') {
            await handler.sendMessage(
                channelId,
                `⚔️ There's already an active private battle in this town! Please wait for it to finish.`
            )
            return
        }
    } else {
        // Check if there's already an active public battle
        const activePublicBattle = getActivePublicBattle()
        if (activePublicBattle && activePublicBattle.status !== 'finished') {
            await handler.sendMessage(
                channelId,
                `⚔️ There's already an active public battle in progress! Please wait for it to finish.\n\n` +
                `💡 You can launch a private battle instead using: \`/rumble_reward ${rewardAmountStr} private\``
            )
            return
        }
    }

    // Initiate new battle with rewards
    const battleId = initiateBattle(handler, channelId, spaceId, userId, rewardAmount, isPrivate, false, theme)
    
    // Check token approval and send transaction interaction if needed
    const { getSmartAccountFromUserId } = await import('@towns-protocol/bot')
    const { checkTokenApproval, getTownsTokenAddress, formatTokenAmount } = await import('./token')
    const { encodeFunctionData } = await import('viem')
    
    try {
        const adminWallet = (await getSmartAccountFromUserId(bot, { userId })) as `0x${string}`
        const tokenAddress = getTownsTokenAddress()
        const requiredAmount = BigInt(rewardAmount)
        const botAddress = bot.appAddress as `0x${string}`
        
        const isApproved = await checkTokenApproval(
            bot.viem,
            adminWallet,
            botAddress,
            requiredAmount
        )
        
        if (!isApproved) {
            // Need approval - send transaction interaction request
            const battle = getActiveBattle()
            if (battle && battle.battleId === battleId) {
                battle.status = 'pending_approval'
                const { setActiveBattle } = await import('./db')
                setActiveBattle(battle)
            }

            // Encode approve function call
            const approveData = encodeFunctionData({
                abi: [
                    {
                        name: 'approve',
                        type: 'function',
                        stateMutability: 'nonpayable',
                        inputs: [
                            { name: 'spender', type: 'address' },
                            { name: 'amount', type: 'uint256' },
                        ],
                        outputs: [{ name: '', type: 'bool' }],
                    },
                ],
                functionName: 'approve',
                args: [botAddress, requiredAmount],
            })

            // Send transaction interaction request
            const { hexToBytes } = await import('viem')
            await handler.sendInteractionRequest(
                channelId,
                {
                    case: 'transaction',
                    value: {
                        id: `approve-${battleId}`,
                        title: `Approve ${formatTokenAmount(requiredAmount)} TOWNS`,
                        content: {
                            case: 'evm',
                            value: {
                                chainId: '8453', // Base network
                                to: tokenAddress,
                                value: '0',
                                data: approveData,
                                signerWallet: undefined,
                            },
                        },
                    },
                },
                hexToBytes(userId as `0x${string}`)
            )

            // Track this channel for public battle announcements
            trackChannelForPublicBattles(channelId, spaceId)
            
            // For public battles, broadcast to all tracked channels
            if (!isPrivate) {
                const channels = getPublicBattleChannels()
                for (const channel of channels) {
                    try {
                        // Determine if this is the originating town or another town
                        const isOriginatingTown = channel.spaceId === spaceId
                        const locationText = isOriginatingTown ? 'initiated in this town' : 'initiated from another town'
                        
                        let battleMessage: string
                        const themeText = theme === 'christmas' ? '🎄 **Christmas Battle** 🎄\n\n' : ''
                        if (isOriginatingTown) {
                            // Originating town gets full message with warnings
                            battleMessage = `⚔️ **BATTLE ROYALE WITH REWARDS INITIATED!** ⚔️\n\n` +
                                `${themeText}` +
                                `🌐 **Public Battle**, ${locationText} - Cross-town! Any town with the bot can join\n\n` +
                                `React with ⚔️ to join the battle!\n\n` +
                                `⏰ **You have 10 minutes to join and launch the Battle or it will auto-cancel**\n\n` +
                                `💰 **Reward Pool:** ${formatTokenAmount(requiredAmount)} TOWNS\n\n` +
                                `⚠️ **Token Approval Required**\n` +
                                `Please approve the transaction in the dialog above to allow the bot to distribute rewards.\n\n` +
                                `⚠️ **WARNING:** You need a minimum of **2 players** before tipping. Game will not launch and tip will be lost if there are less than 2 participants!\n\n` +
                                `Once approved, tip me **$1 USD worth of ETH** to launch the battle!`
                        } else {
                            // Other towns get simplified message, but with reward pool
                            battleMessage = `⚔️ **BATTLE ROYALE WITH REWARDS INITIATED!** ⚔️\n\n` +
                                `${themeText}` +
                                `🌐 **Public Battle**, ${locationText} - Cross-town! Any town with the bot can join\n\n` +
                                `React with ⚔️ to join the battle!\n\n` +
                                `⏰ **You have 10 minutes to join and launch the Battle or it will auto-cancel**\n\n` +
                                `💰 **Reward Pool:** ${formatTokenAmount(requiredAmount)} TOWNS\n\n` +
                                `⚔️ The Battle will start soon`
                        }
                        
                        const sentMessage = await bot.sendMessage(channel.channelId, battleMessage)
                        // Store messageId -> battleId mapping for reactions
                        if (sentMessage?.eventId) {
                            setMessageIdToBattleId(sentMessage.eventId, battleId)
                            console.log(`[rumble_reward] Stored messageId mapping: ${sentMessage.eventId} -> ${battleId}`)
                        }
                        // Track channel if message was sent successfully (in case it wasn't already tracked)
                        trackChannelForPublicBattles(channel.channelId, channel.spaceId, channel.spaceName, sentMessage?.eventId)
                    } catch (error) {
                        console.error(`Error broadcasting to channel ${channel.channelId}:`, error)
                    }
                }
            } else {
                const themeText = theme === 'christmas' ? '🎄 **Christmas Battle** 🎄\n\n' : ''
                const battleMessage = `⚔️ **BATTLE ROYALE WITH REWARDS INITIATED!** ⚔️\n\n` +
                    `${themeText}` +
                    `🔒 **Private Battle** - Only this town can join\n\n` +
                    `React with ⚔️ to join the battle!\n\n` +
                    `💰 **Reward Pool:** ${formatTokenAmount(requiredAmount)} TOWNS\n\n` +
                    `⚠️ **Token Approval Required**\n` +
                    `Please approve the transaction in the dialog above to allow the bot to distribute rewards.\n\n` +
                    `⚠️ **WARNING:** You need a minimum of **2 players** before tipping. Game will not launch and tip will be lost if there are less than 2 participants!\n\n` +
                    `Once approved, tip me **$1 USD worth of ETH** to launch the battle!`
                
                const sentMessage = await handler.sendMessage(channelId, battleMessage)
                // Store messageId -> battleId mapping for reactions
                if (sentMessage?.eventId) {
                    setMessageIdToBattleId(sentMessage.eventId, battleId)
                    console.log(`[rumble_reward] Stored messageId mapping: ${sentMessage.eventId} -> ${battleId}`)
                }
            }
            return
        }
    } catch (error) {
        console.error('Error checking token approval:', error)
        await handler.sendMessage(
            channelId,
            `❌ Error checking token approval. Please try again.`
        )
        return
    }
    
    // Track this channel for public battle announcements
    trackChannelForPublicBattles(channelId, spaceId)
    
    // Already approved, show warning
    const requiredAmount = BigInt(rewardAmount)
    
    // For public battles, broadcast to all tracked channels
    if (!isPrivate) {
        const channels = getPublicBattleChannels()
        for (const channel of channels) {
            try {
                // Determine if this is the originating town or another town
                const isOriginatingTown = channel.spaceId === spaceId
                const locationText = isOriginatingTown ? 'initiated in this town' : 'initiated from another town'
                
                let battleMessage: string
                const themeText = theme === 'christmas' ? '🎄 **Christmas Battle** 🎄\n\n' : ''
                if (isOriginatingTown) {
                    // Originating town gets full message with warnings
                    battleMessage = `⚔️ **BATTLE ROYALE WITH REWARDS INITIATED!** ⚔️\n\n` +
                        `${themeText}` +
                        `🌐 **Public Battle**, ${locationText} - Cross-town! Any town with the bot can join\n\n` +
                        `React with ⚔️ to join the battle!\n\n` +
                        `⏰ **You have 10 minutes to join and launch the Battle or it will auto-cancel**\n\n` +
                        `💰 **Reward Pool:** ${formatTokenAmount(requiredAmount)} TOWNS\n\n` +
                        `⚠️ **WARNING:** Be sure to have enough TOWNS before launching the Battle!\n\n` +
                        `⚠️ **WARNING:** You need a minimum of **2 players** before tipping. Game will not launch and tip will be lost if there are less than 2 participants!\n\n` +
                        `Once you're ready, tip me **$1 USD worth of ETH** to launch the battle!`
                } else {
                    // Other towns get simplified message, but with reward pool
                    battleMessage = `⚔️ **BATTLE ROYALE WITH REWARDS INITIATED!** ⚔️\n\n` +
                        `${themeText}` +
                        `🌐 **Public Battle**, ${locationText} - Cross-town! Any town with the bot can join\n\n` +
                        `React with ⚔️ to join the battle!\n\n` +
                        `⏰ **You have 10 minutes to join and launch the Battle or it will auto-cancel**\n\n` +
                        `💰 **Reward Pool:** ${formatTokenAmount(requiredAmount)} TOWNS\n\n` +
                        `⚔️ The Battle will start soon`
                }
                
                const sentMessage = await bot.sendMessage(channel.channelId, battleMessage)
                // Store messageId -> battleId mapping for reactions
                if (sentMessage?.eventId) {
                    setMessageIdToBattleId(sentMessage.eventId, battleId)
                    console.log(`[rumble_reward] Stored messageId mapping: ${sentMessage.eventId} -> ${battleId}`)
                }
            } catch (error) {
                console.error(`Error broadcasting to channel ${channel.channelId}:`, error)
            }
        }
    } else {
        const themeText = theme === 'christmas' ? '🎄 **Christmas Battle** 🎄\n\n' : ''
        const battleMessage = `⚔️ **BATTLE ROYALE WITH REWARDS INITIATED!** ⚔️\n\n` +
            `${themeText}` +
            `🔒 **Private Battle** - Only this town can join\n\n` +
            `React with ⚔️ to join the battle!\n` +
            `💰 **Reward Pool:** ${formatTokenAmount(requiredAmount)} TOWNS\n\n` +
            `⚠️ **WARNING:** Be sure to have enough TOWNS before launching the Battle!\n\n` +
            `⚠️ **WARNING:** You need a minimum of **2 players** before tipping. Game will not launch and tip will be lost if there are less than 2 participants!\n\n` +
            `Once you're ready, tip me **$1 USD worth of ETH** to launch the battle!`
        
        const sentMessage = await handler.sendMessage(channelId, battleMessage)
        // Store messageId -> battleId mapping for reactions
        if (sentMessage?.eventId) {
            setMessageIdToBattleId(sentMessage.eventId, battleId)
            console.log(`[rumble_reward] Stored messageId mapping: ${sentMessage.eventId} -> ${battleId}`)
        }
    }

    // Update battle status to pending tip
    const battle = isPrivate ? getActivePrivateBattle(spaceId) : getActivePublicBattle()
    if (battle && battle.battleId === battleId) {
        battle.status = 'pending_tip'
        if (isPrivate) {
            setActivePrivateBattle(spaceId, battle)
        } else {
            setActivePublicBattle(battle)
            
            // Set up 10-minute auto-cancel timer for public battles
            setTimeout(async () => {
                const currentBattle = getActivePublicBattle()
                // Only cancel if battle still exists, hasn't been launched, and matches this battleId
                if (currentBattle && 
                    currentBattle.battleId === battleId && 
                    (currentBattle.status === 'pending_tip' || currentBattle.status === 'pending_approval')) {
                    
                    console.log(`[auto-cancel] Auto-cancelling public battle ${battleId} after 10 minutes`)
                    
                    // Cancel the battle
                    finishBattle(currentBattle)
                    setActivePublicBattle(undefined)
                    
                    // Broadcast cancellation message to all tracked channels
                    const channels = getPublicBattleChannels()
                    const cancelMessage = `❌ **BATTLE AUTO-CANCELLED** ❌\n\n` +
                        `The public battle was automatically cancelled after 10 minutes because it was not launched.\n\n` +
                        `You can start a new battle with \`/rumble\` or \`/rumble_reward\`.`
                    
                    for (const channel of channels) {
                        try {
                            await bot.sendMessage(channel.channelId, cancelMessage)
                        } catch (error) {
                            console.error(`Error broadcasting auto-cancel message to channel ${channel.channelId}:`, error)
                        }
                    }
                }
            }, 10 * 60 * 1000) // 10 minutes in milliseconds
        }
    }
})

bot.onSlashCommand('cancel', async (handler, { channelId, spaceId, userId }) => {
    // Track channel for public battle announcements
    trackChannelForPublicBattles(channelId, spaceId)
    
    // Check if user has permission (admin or custom permission)
    const hasPermission = await canStartBattle(handler, userId, spaceId)
    if (!hasPermission) {
        await handler.sendMessage(channelId, '❌ You don\'t have permission to cancel battles!')
        return
    }

    // Check if there's an active battle
    const battle = getActiveBattle()
    if (!battle) {
        await handler.sendMessage(channelId, '❌ No active battle to cancel.')
        return
    }

    // Check if battle is in the same channel
    if (battle.channelId !== channelId) {
        await handler.sendMessage(
            channelId,
            '❌ You can only cancel battles from the channel where they were started.'
        )
        return
    }

    // Check if user is the admin who started the battle
    if (battle.adminId !== userId) {
        await handler.sendMessage(
            channelId,
            '❌ Only the admin who started the battle can cancel it.'
        )
        return
    }

    // Check if battle has already started
    if (battle.status === 'active' || battle.status === 'finished') {
        await handler.sendMessage(
            channelId,
            '❌ Cannot cancel a battle that has already started or finished.'
        )
        return
    }

    // Cancel the battle
    const { setActiveBattle } = await import('./db')
    setActiveBattle(undefined)

    const participantCount = battle.participants.length
    const rewardInfo = battle.rewardAmount 
        ? `\n💰 Reward pool of ${(await import('./token')).formatTokenAmount(BigInt(battle.rewardAmount))} TOWNS was not distributed.`
        : ''

    const cancelMessage = `❌ **BATTLE CANCELLED** ❌\n\n` +
        `The battle has been cancelled by the admin.\n` +
        `${participantCount > 0 ? `${participantCount} participant${participantCount > 1 ? 's were' : ' was'} removed from the battle.\n` : ''}` +
        `${rewardInfo}\n` +
        `You can start a new battle with \`/rumble\`.`

    if (battle.isPrivate) {
        // Private battle - only send to original channel
        await handler.sendMessage(channelId, cancelMessage)
    } else {
        // Public battle - broadcast to all tracked channels
        const channels = getPublicBattleChannels()
        for (const channel of channels) {
            try {
                await bot.sendMessage(channel.channelId, cancelMessage)
            } catch (error) {
                console.error(`Error broadcasting cancel message to channel ${channel.channelId}:`, error)
            }
        }
    }
})

bot.onInteractionResponse(async (handler, { response, channelId, userId }) => {
    // Handle token approval transaction response
    if (response.payload.content?.case === 'transaction') {
        const txResponse = response.payload.content.value
        
        // Check if this is an approval transaction
        if (txResponse.requestId?.startsWith('approve-')) {
            const battleId = txResponse.requestId.replace('approve-', '')
            const battle = getActiveBattle()
            
            if (battle && battle.battleId === battleId && battle.adminId === userId) {
                // Check if transaction was successful
                if (txResponse.txHash) {
                    // Transaction was submitted, check approval status
                    const { getSmartAccountFromUserId } = await import('@towns-protocol/bot')
                    const { checkTokenApproval } = await import('./token')
                    
                    try {
                        const adminWallet = (await getSmartAccountFromUserId(bot, { userId })) as `0x${string}`
                        const requiredAmount = BigInt(battle.rewardAmount || '0')
                        const botAddress = bot.appAddress as `0x${string}`
                        
                        // Wait a bit for transaction to be mined
                        await new Promise(resolve => setTimeout(resolve, 3000))
                        
                        const isApproved = await checkTokenApproval(
                            bot.viem,
                            adminWallet,
                            botAddress,
                            requiredAmount
                        )
                        
                        if (isApproved) {
                            const { formatTokenAmount } = await import('./token')
                            const requiredAmount = BigInt(battle.rewardAmount || '0')
                            
                            battle.status = 'pending_tip'
                            const { setActiveBattle } = await import('./db')
                            setActiveBattle(battle)
                            
                            await handler.sendMessage(
                                channelId,
                                `✅ **Token Approval Confirmed!**\n\n` +
                                `Transaction: \`${txResponse.txHash}\`\n\n` +
                                `⚠️ **WARNING:** Be sure to have enough TOWNS (${formatTokenAmount(requiredAmount)} TOWNS) before launching the Battle!\n\n` +
                                `You can now tip me **$1 USD worth of ETH** to launch the battle!`
                            )
                        } else {
                            await handler.sendMessage(
                                channelId,
                                `⏳ **Transaction Submitted**\n\n` +
                                `Transaction: \`${txResponse.txHash}\`\n\n` +
                                `Waiting for confirmation... Please wait a moment and try tipping again.`
                            )
                        }
                    } catch (error) {
                        console.error('Error verifying approval after transaction:', error)
                        await handler.sendMessage(
                            channelId,
                            `⚠️ Transaction submitted: \`${txResponse.txHash}\`\n\n` +
                            `Please wait for confirmation, then tip **$1 USD worth of ETH** to launch the battle.`
                        )
                    }
                } else {
                    // Transaction was cancelled or failed
                    await handler.sendMessage(
                        channelId,
                        `❌ Transaction was not completed. Please try again with \`/rumble_reward\`.`
                    )
                }
            }
        }
    }
})

bot.onReaction(async (handler, { reaction, channelId, userId, spaceId, messageId }) => {
    // Track channel for public battle announcements
    trackChannelForPublicBattles(channelId, spaceId)
    
    console.log(`[onReaction] Reaction received: ${reaction}, channelId: ${channelId}, userId: ${userId}, spaceId: ${spaceId}, messageId: ${messageId}`)
    
    // Handle sword emoji for battle participation
    // Towns Protocol sends reactions as string identifiers (e.g., "crossed_swords") not emojis
    if (reaction === '⚔️' || reaction === 'crossed_swords') {
        console.log(`[onReaction] Sword emoji detected, looking for battle...`)
        
        // Find the battle by the messageId they're reacting to (the announcement message)
        // This ensures users join the specific battle they're reacting to
        let battle: BattleState | undefined = undefined
        
        if (messageId) {
            // Direct lookup: messageId -> battleId
            const battleId = getBattleIdByMessageId(messageId)
            if (battleId) {
                battle = getBattleByBattleId(battleId)
                console.log(`[onReaction] Found battle by messageId mapping: ${battleId} -> ${battle ? battle.battleId : 'not found'}`)
            }
        }
        
        // Fallback: if no battle found by messageId mapping, try finding by space/channel
        // (for backward compatibility or if mapping wasn't stored)
        if (!battle) {
            if (spaceId) {
                battle = getActivePrivateBattle(spaceId)
                console.log(`[onReaction] Fallback: Private battle for space ${spaceId}: ${battle ? battle.battleId : 'none'}`)
            }
            if (!battle) {
                battle = getActivePublicBattle()
                console.log(`[onReaction] Fallback: Public battle: ${battle ? battle.battleId : 'none'}`)
            }
            if (!battle) {
                battle = getActiveBattle()
                console.log(`[onReaction] Fallback: Any battle: ${battle ? battle.battleId : 'none'}`)
            }
        }
        
        if (!battle) {
            console.log(`[onReaction] No battle found, returning early`)
            return
        }
        
        console.log(`[onReaction] Battle found: ${battle.battleId}, calling handleReaction...`)
        const joined = handleReaction(handler, userId, reaction, channelId, spaceId, battle)
        console.log(`[onReaction] handleReaction returned: ${joined}`)
        if (joined) {
            // Get fresh battle state for THIS specific battle to get accurate participant count
            const freshBattle = battle.isPrivate 
                ? getActivePrivateBattle(battle.spaceId) 
                : getActivePublicBattle()
            const finalBattle = freshBattle || battle

            const battleType = battle.isPrivate ? '🔒 Private Battle' : '🌐 Public Battle'
            const joinMessage = `<@${userId}> has joined the ${battleType}! ⚔️ (${finalBattle.participants.length} participants)`

            if (battle.isPrivate) {
                // Private battle – only notify in the current town/channel
                await handler.sendMessage(channelId, joinMessage)
            } else {
                // Public battle – broadcast join message to all tracked towns
                const channels = getPublicBattleChannels()
                console.log(`[onReaction] Broadcasting join message to ${channels.length} channels for public battle`)
                for (const channel of channels) {
                    try {
                        await bot.sendMessage(channel.channelId, joinMessage)
                    } catch (error) {
                        console.error(`[onReaction] Error broadcasting join message to channel ${channel.channelId}:`, error)
                    }
                }
            }
        } else {
            // Check if user is already in THIS SPECIFIC battle (not any battle)
            const freshBattle = battle.isPrivate 
                ? getActivePrivateBattle(battle.spaceId) 
                : getActivePublicBattle()
            const finalBattle = freshBattle || battle
            if (finalBattle && finalBattle.battleId === battle.battleId && finalBattle.participants.includes(userId)) {
                const battleType = battle.isPrivate ? '🔒 Private Battle' : '🌐 Public Battle'
                await handler.sendMessage(
                    channelId,
                    `ℹ️ You're already in this ${battleType}! ⚔️ (${finalBattle.participants.length} participants)`
                )
            } else {
                // Check if it's a private battle and user tried to join from wrong town
                if (battle.isPrivate && spaceId && battle.spaceId !== spaceId) {
                    await handler.sendMessage(
                        channelId,
                        `❌ This is a private battle. You can only join from the town where it was started.`
                    )
                } else if (battle.status !== 'collecting' && battle.status !== 'pending_tip' && battle.status !== 'pending_approval') {
                    await handler.sendMessage(
                        channelId,
                        `❌ This battle is no longer accepting participants.`
                    )
                }
            }
        }
        return
    }

    // Handle warning sign emoji for adding test users
    // Towns Protocol sends reactions as string identifiers, so check both emoji and string
    if (reaction === '⚠️' || reaction === 'warning' || reaction === 'warning_sign') {
        console.log(`[onReaction] Warning sign detected, looking for battle to add test users...`)
        
        // Find the battle by the messageId they're reacting to (the announcement message)
        let battle: BattleState | undefined = undefined
        
        if (messageId) {
            // Direct lookup: messageId -> battleId
            const battleId = getBattleIdByMessageId(messageId)
            if (battleId) {
                battle = getBattleByBattleId(battleId)
                console.log(`[onReaction] Found battle by messageId mapping: ${battleId} -> ${battle ? battle.battleId : 'not found'}`)
            }
        }
        
        if (!battle) {
            await handler.sendMessage(
                channelId,
                '❌ No battle found. Please react with ⚠️ to a battle announcement message.'
            )
            return
        }
        
        // Check if battle has already started
        if (battle.status === 'active' || battle.status === 'finished') {
            await handler.sendMessage(
                channelId,
                '❌ Cannot add test players to a battle that has already started or finished.'
            )
            return
        }
        
        // Generate 5 fake participant IDs
        const testParticipants: string[] = []
        for (let i = 1; i <= 5; i++) {
            const fakeUserId = `0x${battle.battleId.replace(/[^a-f0-9]/gi, '').substring(0, 36)}${i.toString().padStart(2, '0')}test` as `0x${string}`
            testParticipants.push(fakeUserId)
        }
        
        // Add test participants using addParticipant
        const { addParticipant, setActivePrivateBattle, setActivePublicBattle } = await import('./db')
        let addedCount = 0
        for (const fakeUserId of testParticipants) {
            if (addParticipant(battle.battleId, fakeUserId)) {
                addedCount++
            }
        }
        
        // Get fresh battle state to get accurate count
        const freshBattle = getBattleByBattleId(battle.battleId) || battle
        
        await handler.sendMessage(
            channelId,
            `🧪 **TEST USERS ADDED** 🧪\n\n` +
            `Added **${addedCount} fake users** to the battle!\n` +
            `Current participants: **${freshBattle.participants.length}**\n\n` +
            `⚠️ **Note:** These are fake users for testing purposes only.`
        )
        return
    }
    
    // Keep existing wave reaction handler
    if (reaction === '👋') {
        await handler.sendMessage(channelId, 'I saw your wave! 👋')
    }
})

bot.onTip(async (handler, { userId, senderAddress, receiverAddress, amount, channelId, messageId, spaceId }) => {
    // Check if tip is to the bot
    if (receiverAddress.toLowerCase() !== bot.appAddress.toLowerCase()) {
        return
    }

    // Find the battle by the messageId the tip is attached to (the announcement message)
    // This ensures we get the correct battle when multiple battles exist in the same channel
    let battle: BattleState | undefined = undefined
    
    if (messageId) {
        // Direct lookup: messageId -> battleId
        const battleId = getBattleIdByMessageId(messageId)
        if (battleId) {
            battle = getBattleByBattleId(battleId)
            console.log(`[onTip] Found battle by messageId mapping: ${battleId} -> ${battle ? battle.battleId : 'not found'}`)
        }
    }
    
    // Fallback: Find the battle where this user is the admin (check both public and private)
    // Prioritize battles in 'pending_tip' status since those are waiting for tips
    if (!battle) {
        // First check for a battle in pending_tip status
        const publicBattle = getActivePublicBattle()
        if (publicBattle && publicBattle.channelId === channelId && publicBattle.adminId === userId && publicBattle.status === 'pending_tip') {
            battle = publicBattle
            console.log(`[onTip] Found public battle in pending_tip status: ${battle.battleId}`)
        }
        
        // Check private battles for pending_tip
        if (!battle && spaceId) {
            const privateBattle = getActivePrivateBattle(spaceId)
            if (privateBattle && privateBattle.channelId === channelId && privateBattle.adminId === userId && privateBattle.status === 'pending_tip') {
                battle = privateBattle
                console.log(`[onTip] Found private battle in pending_tip status: ${battle.battleId}`)
            }
        }
        
        // If no pending_tip battle found, use the general lookup
        if (!battle) {
            battle = getBattleByChannelIdAndAdmin(channelId, userId)
            console.log(`[onTip] Fallback: Found battle by channelId and adminId: ${battle ? battle.battleId : 'none'}`)
        }
    }
    
    if (!battle) {
        console.log(`[onTip] No battle found for tip from userId: ${userId}, messageId: ${messageId}`)
        return
    }
    
    // Verify the user is the admin of this battle
    if (battle.adminId !== userId) {
        console.log(`[onTip] User ${userId} is not the admin of battle ${battle.battleId} (admin: ${battle.adminId})`)
        return
    }

    // If battle is pending approval, check if approval was done
    if (battle.status === 'pending_approval' && userId === battle.adminId) {
        const { getSmartAccountFromUserId } = await import('@towns-protocol/bot')
        const { checkTokenApproval } = await import('./token')
        
        try {
            const adminWallet = (await getSmartAccountFromUserId(bot, { userId })) as `0x${string}`
            const requiredAmount = BigInt(battle.rewardAmount || '0')
            const botAddress = bot.appAddress as `0x${string}`
            
            const isApproved = await checkTokenApproval(
                bot.viem,
                adminWallet,
                botAddress,
                requiredAmount
            )
            
            if (isApproved) {
                // Approval done, now wait for tip
                battle.status = 'pending_tip'
                const { setActiveBattle } = await import('./db')
                setActiveBattle(battle)
                await handler.sendMessage(
                    channelId,
                    `✅ Token approval confirmed! Now tip me **$1 USD worth of ETH** to launch the battle!`
                )
                return
            } else {
                await handler.sendMessage(
                    channelId,
                    `⚠️ Token approval not yet confirmed. Please approve the bot to spend ${(await import('./token')).formatTokenAmount(requiredAmount)} TOWNS tokens.`
                )
                return
            }
        } catch (error) {
            console.error('Error checking token approval:', error)
        }
    }

    // Handle battle tip (use userId from basePayload for consistency)
    // Pass the battle we already identified to ensure correct battle is processed
    const tipHandled = await handleTip(handler, userId, amount, channelId, battle)
    
    if (tipHandled) {
        // Re-fetch the latest battle state from the database (handleTip may have updated it)
        const freshBattle = getBattleByBattleId(battle.battleId) || battle
        
        // Use the fresh battle object from here on
        const currentBattle = freshBattle

        if (currentBattle.participants.length < 2) {
            await handler.sendMessage(
                channelId,
                '❌ Need at least 2 participants to start the battle!'
            )
            // Reset battle status
            currentBattle.status = 'collecting'
            const { setActiveBattle } = await import('./db')
            setActiveBattle(currentBattle)
            return
        }

        // If rewards are set, verify approval one more time
        if (currentBattle.rewardAmount && BigInt(currentBattle.rewardAmount) > 0n) {
            const { getSmartAccountFromUserId } = await import('@towns-protocol/bot')
            const { checkTokenApproval } = await import('./token')
            
            try {
                const adminWallet = (await getSmartAccountFromUserId(bot, { userId: currentBattle.adminId as `0x${string}` })) as `0x${string}`
                const requiredAmount = BigInt(currentBattle.rewardAmount)
                const botAddress = bot.appAddress as `0x${string}`
                
                const isApproved = await checkTokenApproval(
                    bot.viem,
                    adminWallet,
                    botAddress,
                    requiredAmount
                )
                
                if (!isApproved) {
                    await handler.sendMessage(
                        channelId,
                        `❌ Token approval required before starting battle. Please approve ${(await import('./token')).formatTokenAmount(requiredAmount)} TOWNS tokens.`
                    )
                    currentBattle.status = 'pending_approval'
                    const { setActiveBattle } = await import('./db')
                    setActiveBattle(currentBattle)
                    return
                }
            } catch (error) {
                console.error('Error verifying token approval:', error)
                await handler.sendMessage(
                    channelId,
                    `❌ Error verifying token approval. Please try again.`
                )
                return
            }
        }

        // Use the tip message as the thread root so all battle messages are grouped
        // Store threadId on the battle so the loop can reply inside this thread
        currentBattle.threadId = messageId
        {
            const { setActiveBattle } = await import('./db')
            setActiveBattle(currentBattle)
        }

        const battleStartMessage = `⚔️ **BATTLE STARTING!** ⚔️\n\n` +
            `**${currentBattle.participants.length} fighters** are entering the arena!\n` +
            (currentBattle.rewardAmount ? `💰 **Reward Pool:** ${(await import('./token')).formatTokenAmount(BigInt(currentBattle.rewardAmount))} TOWNS\n` : '') +
            `\nLet the battle begin! 🗡️`

        if (currentBattle.isPrivate) {
            // Private battle - only send to original channel in thread
            await handler.sendMessage(
                channelId,
                battleStartMessage,
                {
                    threadId: messageId,
                }
            )
        } else {
            // Public battle - broadcast to all tracked channels
            // Original channel uses thread, other channels go to main chat
            const channels = getPublicBattleChannels()
            for (const channel of channels) {
                try {
                    if (channel.channelId === channelId) {
                        // Original channel - use tip message as thread root
                        await handler.sendMessage(channelId, battleStartMessage, { threadId: messageId })
                    } else {
                        // Other channels - send to main chat
                        await bot.sendMessage(channel.channelId, battleStartMessage)
                    }
                } catch (error) {
                    console.error(`Error broadcasting battle start to channel ${channel.channelId}:`, error)
                }
            }
        }

        // Start battle loop in background (identify battle by battleId to avoid conflicts)
        startBattleLoop(bot, channelId, currentBattle.battleId).catch((error) => {
            console.error('Error in battle loop:', error)
            handler.sendMessage(channelId, '❌ An error occurred during the battle.')
        })
    } else {
        // Check if this was a battle tip attempt that failed
        if (battle.status === 'pending_tip' && userId === battle.adminId) {
            try {
                const { getTipAmountRange } = await import('./ethPrice')
                const { min, max, target } = await getTipAmountRange()
                const minEth = Number(min) / 1e18
                const maxEth = Number(max) / 1e18
                const targetEth = Number(target) / 1e18
                const receivedEth = Number(amount) / 1e18
                
                await handler.sendMessage(
                    channelId,
                    `❌ Tip amount incorrect!\n\n` +
                    `Expected: ~$$1 USD in ETH (${targetEth.toFixed(6)} ETH)\n` +
                    `Accepted range: ${minEth.toFixed(6)} - ${maxEth.toFixed(6)} ETH (10% slippage)\n` +
                    `Received: ${receivedEth.toFixed(6)} ETH\n\n` +
                    `Please tip exactly $1 USD worth of ETH to start the battle.`
                )
            } catch (error) {
                console.error('Error getting tip amount range for error message:', error)
                const receivedEth = Number(amount) / 1e18
    await handler.sendMessage(
        channelId,
                    `❌ Tip amount incorrect!\n\n` +
                    `Received: ${receivedEth.toFixed(6)} ETH\n\n` +
                    `Please tip exactly $1 USD worth of ETH to start the battle.\n` +
                    `(Unable to fetch current ETH price - please try again later)`
                )
            }
        }
    }
})

bot.onSlashCommand('leaderboard', async (handler, { channelId, spaceId }) => {
    // Track channel for public battle announcements
    trackChannelForPublicBattles(channelId, spaceId)
    
    const { getTopPlayers } = await import('./db')
    
    const topPlayers = getTopPlayers('battles', 10)
    const topWinners = getTopPlayers('wins', 10)
    const topKills = getTopPlayers('kills', 10)
    const topDeaths = getTopPlayers('deaths', 10)
    const topRevives = getTopPlayers('revives', 10)
    
    let leaderboardText = '🏆 **RUMBLE LEADERBOARD** 🏆\n\n'
    
    // Top 10 Players (by battles)
    leaderboardText += '📊 **Top 10 Players** (by battles)\n'
    if (topPlayers.length > 0) {
        topPlayers.forEach((player, index) => {
            leaderboardText += `${index + 1}. <@${player.userId}> - ${player.battles} battles\n`
        })
    } else {
        leaderboardText += 'No players yet.\n'
    }
    leaderboardText += '\n'
    
    // Top 10 Winners
    leaderboardText += '🥇 **Top 10 Winners**\n'
    if (topWinners.length > 0) {
        topWinners.forEach((player, index) => {
            leaderboardText += `${index + 1}. <@${player.userId}> - ${player.wins} wins\n`
        })
    } else {
        leaderboardText += 'No winners yet.\n'
    }
    leaderboardText += '\n'
    
    // Top 10 Kills
    leaderboardText += '⚔️ **Top 10 Kills**\n'
    if (topKills.length > 0) {
        topKills.forEach((player, index) => {
            leaderboardText += `${index + 1}. <@${player.userId}> - ${player.kills} kills\n`
        })
    } else {
        leaderboardText += 'No kills yet.\n'
    }
    leaderboardText += '\n'
    
    // Top 10 Deaths
    leaderboardText += '💀 **Top 10 Deaths**\n'
    if (topDeaths.length > 0) {
        topDeaths.forEach((player, index) => {
            leaderboardText += `${index + 1}. <@${player.userId}> - ${player.deaths} deaths\n`
        })
    } else {
        leaderboardText += 'No deaths yet.\n'
    }
    leaderboardText += '\n'
    
    // Top 10 Revives
    leaderboardText += '✨ **Top 10 Revives**\n'
    if (topRevives.length > 0) {
        topRevives.forEach((player, index) => {
            leaderboardText += `${index + 1}. <@${player.userId}> - ${player.revives} revives\n`
        })
    } else {
        leaderboardText += 'No revives yet.\n'
    }
    
    await handler.sendMessage(channelId, leaderboardText)
})

bot.onSlashCommand('perms', async (handler, { channelId, spaceId, userId, args }) => {
    // Track channel for public battle announcements
    trackChannelForPublicBattles(channelId, spaceId)
    
    // Check if user is admin (only admins can manage permissions)
    const isAdmin = await handler.hasAdminPermission(userId, spaceId)
    if (!isAdmin) {
        await handler.sendMessage(channelId, '❌ Only admins can manage battle permissions!')
        return
    }

    if (!args || args.length === 0) {
        await handler.sendMessage(
            channelId,
            `❌ **Usage:** \`/perms [add|remove|list] [userId]\`\n\n` +
            `**Examples:**\n` +
            `\`/perms add 0x1234...\` - Give permission to a user\n` +
            `\`/perms remove 0x1234...\` - Remove permission from a user\n` +
            `\`/perms list\` - List all users with permissions in this town`
        )
        return
    }

    const action = args[0]?.toLowerCase()

    if (action === 'list') {
        // List all users with permissions
        const permissions = getBattlePermissions(spaceId)
        if (permissions.length === 0) {
            await handler.sendMessage(
                channelId,
                `📋 **Battle Permissions for this Town**\n\n` +
                `No users have been granted battle permissions yet.\n\n` +
                `Use \`/perms add [userId]\` to grant permissions.`
            )
        } else {
            let permissionsList = permissions.map(userId => `- <@${userId}>`).join('\n')
            await handler.sendMessage(
                channelId,
                `📋 **Battle Permissions for this Town**\n\n` +
                `**${permissions.length} user${permissions.length > 1 ? 's have' : ' has'} permission:**\n` +
                `${permissionsList}\n\n` +
                `Use \`/perms remove [userId]\` to remove permissions.`
            )
        }
        return
    }

    if (action === 'add' || action === 'remove') {
        if (!args[1]) {
            await handler.sendMessage(
                channelId,
                `❌ Please provide a userId.\n\n` +
                `**Example:** \`/perms ${action} 0x1234567890abcdef1234567890abcdef12345678\``
            )
            return
        }

        const targetUserId = args[1].trim()
        
        // Basic validation - should be a hex address
        if (!targetUserId.startsWith('0x') || targetUserId.length < 10) {
            await handler.sendMessage(
                channelId,
                `❌ Invalid userId format. Please provide a valid Ethereum address (0x...).`
            )
            return
        }

        if (action === 'add') {
            // Check if user already has permission
            if (getBattlePermissions(spaceId).includes(targetUserId)) {
                await handler.sendMessage(
                    channelId,
                    `ℹ️ <@${targetUserId}> already has battle permissions in this town.`
                )
                return
            }

            addBattlePermission(spaceId, targetUserId)
            await handler.sendMessage(
                channelId,
                `✅ **Permission Granted**\n\n` +
                `<@${targetUserId}> can now launch and cancel battles in this town.`
            )
        } else if (action === 'remove') {
            // Check if user has permission
            if (!getBattlePermissions(spaceId).includes(targetUserId)) {
                await handler.sendMessage(
                    channelId,
                    `ℹ️ <@${targetUserId}> does not have battle permissions in this town.`
                )
                return
            }

            removeBattlePermission(spaceId, targetUserId)
            await handler.sendMessage(
                channelId,
                `✅ **Permission Removed**\n\n` +
                `<@${targetUserId}> can no longer launch or cancel battles in this town.`
            )
        }
        return
    }

    // Invalid action
    await handler.sendMessage(
        channelId,
        `❌ Invalid action. Use \`add\`, \`remove\`, or \`list\`.\n\n` +
        `**Usage:** \`/perms [add|remove|list] [userId]\``
    )
})

bot.onMessage(async (handler, { message, channelId, spaceId, eventId, createdAt }) => {
    // Track channel for public battle announcements
    trackChannelForPublicBattles(channelId, spaceId)
    
    if (message.includes('hello')) {
        await handler.sendMessage(channelId, 'Hello there! 👋')
        return
    }
    if (message.includes('ping')) {
        const now = new Date()
        await handler.sendMessage(channelId, `Pong! 🏓 ${now.getTime() - createdAt.getTime()}ms`)
        return
    }
    if (message.includes('react')) {
        await handler.sendReaction(channelId, eventId, '👍')
        return
    }
})

const app = bot.start()
export default app
