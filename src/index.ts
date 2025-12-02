import { makeTownsBot } from '@towns-protocol/bot'
import commands from './commands'
import {
    canStartBattle,
    initiateBattle,
    handleReaction,
    handleTip,
    startBattleLoop,
} from './battle'
import { getActiveBattle } from './db'

const bot = await makeTownsBot(process.env.APP_PRIVATE_DATA!, process.env.JWT_SECRET!, {
    commands,
})

bot.onSlashCommand('rumble', async (handler, { channelId, spaceId, userId, args }) => {
    // Check if user is admin
    const isAdmin = await canStartBattle(handler, userId, spaceId)
    if (!isAdmin) {
        await handler.sendMessage(channelId, '❌ Only admins can start a battle!')
        return
    }

    // Check if there's already an active battle
    const activeBattle = getActiveBattle()
    if (activeBattle && activeBattle.status !== 'finished') {
        await handler.sendMessage(
            channelId,
            `⚔️ There's already an active battle in progress! Please wait for it to finish.`
        )
        return
    }

    // Parse reward amount if provided (format: "reward:1000" or "r:1000")
    let rewardAmount: string | undefined
    let isPrivate = false
    
    if (args && args.length > 0) {
        // Parse reward amount
        const rewardArg = args.find(arg => arg.startsWith('reward:') || arg.startsWith('r:'))
        if (rewardArg) {
            const amount = rewardArg.split(':')[1]
            if (amount && !isNaN(parseFloat(amount)) && parseFloat(amount) > 0) {
                const { parseTokenAmount } = await import('./token')
                rewardAmount = parseTokenAmount(amount).toString()
            }
        }
        
        // Parse private/public flag
        const privateArg = args.find(arg => arg.toLowerCase() === 'private' || arg.toLowerCase() === 'p')
        const publicArg = args.find(arg => arg.toLowerCase() === 'public' || arg.toLowerCase() === 'pub')
        
        if (privateArg) {
            isPrivate = true
        } else if (publicArg) {
            isPrivate = false
        }
        // Default to private if not specified
        else {
            isPrivate = true
        }
    } else {
        // Default to private if no args
        isPrivate = true
    }

    // Initiate new battle
    const battleId = initiateBattle(handler, channelId, spaceId, userId, rewardAmount, isPrivate)
    
    // If reward amount is set, check token approval
    if (rewardAmount && BigInt(rewardAmount) > 0n) {
        const { getSmartAccountFromUserId } = await import('@towns-protocol/bot')
        const { checkTokenApproval, getTownsTokenAddress, formatTokenAmount } = await import('./token')
        
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
                // Need approval
                const battle = getActiveBattle()
                if (battle && battle.battleId === battleId) {
                    battle.status = 'pending_approval'
                    const { setActiveBattle } = await import('./db')
                    setActiveBattle(battle)
                }
                
                await handler.sendMessage(
                    channelId,
                    `⚔️ **BATTLE ROYALE INITIATED!** ⚔️\n\n` +
                    `${isPrivate ? '🔒 **Private Battle** - Only this town can join\n\n' : '🌐 **Public Battle** - Cross-town! Any town with the bot can join\n\n'}` +
                    `React with ⚔️ to join the battle!\n\n` +
                    `💰 **Reward Pool:** ${formatTokenAmount(BigInt(rewardAmount))} TOWNS\n\n` +
                    `⚠️ **Token Approval Required**\n` +
                    `Please approve the bot to spend ${formatTokenAmount(requiredAmount)} TOWNS tokens.\n` +
                    `Token Contract: \`${tokenAddress}\`\n` +
                    `Bot Address: \`${botAddress}\`\n\n` +
                    `Once approved, tip me **$1 USD worth of ETH** to launch the battle!`
                )
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
    }
    
    await handler.sendMessage(
        channelId,
        `⚔️ **BATTLE ROYALE INITIATED!** ⚔️\n\n` +
        `${isPrivate ? '🔒 **Private Battle** - Only this town can join\n\n' : '🌐 **Public Battle** - Cross-town! Any town with the bot can join\n\n'}` +
        `React with ⚔️ to join the battle!\n` +
        (rewardAmount ? `💰 **Reward Pool:** ${(await import('./token')).formatTokenAmount(BigInt(rewardAmount))} TOWNS\n\n` : '') +
        `Once you're ready, tip me **$1 USD worth of ETH** to launch the battle!`
    )

    // Update battle status to pending tip
    const battle = getActiveBattle()
    if (battle && battle.battleId === battleId) {
        battle.status = 'pending_tip'
        const { setActiveBattle } = await import('./db')
        setActiveBattle(battle)
    }
})

bot.onSlashCommand('cancel', async (handler, { channelId, spaceId, userId }) => {
    // Check if user is admin
    const isAdmin = await canStartBattle(handler, userId, spaceId)
    if (!isAdmin) {
        await handler.sendMessage(channelId, '❌ Only admins can cancel a battle!')
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

    await handler.sendMessage(
        channelId,
        `❌ **BATTLE CANCELLED** ❌\n\n` +
        `The battle has been cancelled by the admin.\n` +
        `${participantCount > 0 ? `${participantCount} participant${participantCount > 1 ? 's were' : ' was'} removed from the battle.\n` : ''}` +
        `${rewardInfo}\n` +
        `You can start a new battle with \`/rumble\`.`
    )
})

bot.onReaction(async (handler, { reaction, channelId, userId, spaceId }) => {
    // Handle sword emoji for battle participation
    if (reaction === '⚔️') {
        const battle = getActiveBattle()
        if (!battle) return
        
        const joined = handleReaction(handler, userId, reaction, channelId, spaceId)
        if (joined) {
            await handler.sendMessage(
                channelId,
                `<@${userId}> has joined the battle! ⚔️ (${battle.participants.length} participants)`
            )
        } else {
            // Check if it's a private battle and user tried to join from wrong town
            if (battle.isPrivate && spaceId && battle.spaceId !== spaceId) {
                await handler.sendMessage(
                    channelId,
                    `❌ This is a private battle. You can only join from the town where it was started.`
                )
            } else if (battle.status !== 'collecting' && battle.status !== 'pending_tip') {
                await handler.sendMessage(
                    channelId,
                    `❌ This battle is no longer accepting participants.`
                )
            }
        }
        return
    }

    // Keep existing wave reaction handler
    if (reaction === '👋') {
        await handler.sendMessage(channelId, 'I saw your wave! 👋')
    }
})

bot.onTip(async (handler, { userId, senderAddress, receiverAddress, amount, channelId, messageId }) => {
    // Check if tip is to the bot
    if (receiverAddress.toLowerCase() !== bot.appAddress.toLowerCase()) {
        return
    }

    const battle = getActiveBattle()
    if (!battle || battle.channelId !== channelId) {
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
    const tipHandled = await handleTip(handler, userId, amount, channelId)
    
    if (tipHandled) {
        if (battle.participants.length < 2) {
            await handler.sendMessage(
                channelId,
                '❌ Need at least 2 participants to start the battle!'
            )
            // Reset battle status
            battle.status = 'collecting'
            const { setActiveBattle } = await import('./db')
            setActiveBattle(battle)
            return
        }

        // If rewards are set, verify approval one more time
        if (battle.rewardAmount && BigInt(battle.rewardAmount) > 0n) {
            const { getSmartAccountFromUserId } = await import('@towns-protocol/bot')
            const { checkTokenApproval } = await import('./token')
            
            try {
                const adminWallet = (await getSmartAccountFromUserId(bot, { userId: battle.adminId as `0x${string}` })) as `0x${string}`
                const requiredAmount = BigInt(battle.rewardAmount)
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
                    battle.status = 'pending_approval'
                    const { setActiveBattle } = await import('./db')
                    setActiveBattle(battle)
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

        await handler.sendMessage(
            channelId,
            `⚔️ **BATTLE STARTING!** ⚔️\n\n` +
            `**${battle.participants.length} fighters** are entering the arena!\n` +
            (battle.rewardAmount ? `💰 **Reward Pool:** ${(await import('./token')).formatTokenAmount(BigInt(battle.rewardAmount))} TOWNS\n` : '') +
            `\nLet the battle begin! 🗡️`
        )

        // Start battle loop in background
        startBattleLoop(bot, battle.battleId).catch((error) => {
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

bot.onMessage(async (handler, { message, channelId, eventId, createdAt }) => {
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
