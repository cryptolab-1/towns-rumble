import { makeTownsBot } from '@towns-protocol/bot'
import commands from './commands'
import {
    canStartBattle,
    initiateBattle,
    handleReaction,
    handleTip,
    startBattleLoop,
} from './battle'
import { getActiveBattle, getActivePublicBattle, getActivePrivateBattle, setActivePublicBattle, setActivePrivateBattle } from './db'

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

    // Parse private/public flag (no rewards for regular rumble)
    let isPrivate = true // Default to private
    
    if (args && args.length > 0) {
        const privateArg = args.find(arg => arg.toLowerCase() === 'private' || arg.toLowerCase() === 'p')
        const publicArg = args.find(arg => arg.toLowerCase() === 'public' || arg.toLowerCase() === 'pub')
        
        if (privateArg) {
            isPrivate = true
        } else if (publicArg) {
            isPrivate = false
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

    // Initiate new battle without rewards
    const battleId = initiateBattle(handler, channelId, spaceId, userId, undefined, isPrivate)
    
    await handler.sendMessage(
        channelId,
        `⚔️ **BATTLE ROYALE INITIATED!** ⚔️\n\n` +
        `${isPrivate ? '🔒 **Private Battle** - Only this town can join\n\n' : '🌐 **Public Battle** - Cross-town! Any town with the bot can join\n\n'}` +
        `React with ⚔️ to join the battle!\n\n` +
        `⚠️ **WARNING:** You need a minimum of **2 players** before tipping. Game will not launch and tip will be lost if there are less than 2 participants!\n\n` +
        `Once you're ready, tip me **$1 USD worth of ETH** to launch the battle!`
    )

    // Update battle status to pending tip
    const battle = isPrivate ? getActivePrivateBattle(spaceId) : getActivePublicBattle()
    if (battle && battle.battleId === battleId) {
        battle.status = 'pending_tip'
        if (isPrivate) {
            setActivePrivateBattle(spaceId, battle)
        } else {
            setActivePublicBattle(battle)
        }
    }
})

bot.onSlashCommand('rumble_reward', async (handler, { channelId, spaceId, userId, args }) => {
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

    // Parse private/public flag
    let isPrivate = true // Default to private
    const privateArg = args.find(arg => arg.toLowerCase() === 'private' || arg.toLowerCase() === 'p')
    const publicArg = args.find(arg => arg.toLowerCase() === 'public' || arg.toLowerCase() === 'pub')
    
    if (privateArg) {
        isPrivate = true
    } else if (publicArg) {
        isPrivate = false
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
    const battleId = initiateBattle(handler, channelId, spaceId, userId, rewardAmount, isPrivate)
    
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

            await handler.sendMessage(
                channelId,
                `⚔️ **BATTLE ROYALE WITH REWARDS INITIATED!** ⚔️\n\n` +
                `${isPrivate ? '🔒 **Private Battle** - Only this town can join\n\n' : '🌐 **Public Battle** - Cross-town! Any town with the bot can join\n\n'}` +
                `React with ⚔️ to join the battle!\n\n` +
                `💰 **Reward Pool:** ${formatTokenAmount(requiredAmount)} TOWNS\n\n` +
                    `⚠️ **Token Approval Required**\n` +
                    `Please approve the transaction in the dialog above to allow the bot to distribute rewards.\n\n` +
                    `⚠️ **WARNING:** You need a minimum of **2 players** before tipping. Game will not launch and tip will be lost if there are less than 2 participants!\n\n` +
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
    
    // Already approved, show warning
    const requiredAmount = BigInt(rewardAmount)
    
    await handler.sendMessage(
        channelId,
        `⚔️ **BATTLE ROYALE WITH REWARDS INITIATED!** ⚔️\n\n` +
        `${isPrivate ? '🔒 **Private Battle** - Only this town can join\n\n' : '🌐 **Public Battle** - Cross-town! Any town with the bot can join\n\n'}` +
        `React with ⚔️ to join the battle!\n` +
        `💰 **Reward Pool:** ${formatTokenAmount(requiredAmount)} TOWNS\n\n` +
        `⚠️ **WARNING:** Be sure to have enough TOWNS before launching the Battle!\n\n` +
        `⚠️ **WARNING:** You need a minimum of **2 players** before tipping. Game will not launch and tip will be lost if there are less than 2 participants!\n\n` +
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

bot.onSlashCommand('test', async (handler, { channelId, spaceId, userId }) => {
    // Check if user is admin
    const isAdmin = await canStartBattle(handler, userId, spaceId)
    if (!isAdmin) {
        await handler.sendMessage(channelId, '❌ Only admins can use test mode!')
        return
    }

    // Check if there's an active battle
    const battle = getActiveBattle()
    if (!battle) {
        await handler.sendMessage(
            channelId,
            '❌ No active battle found. Start a battle with `/rumble` or `/rumble_reward` first.'
        )
        return
    }

    // Check if battle is in the same channel
    if (battle.channelId !== channelId) {
        await handler.sendMessage(
            channelId,
            '❌ You can only add test players to battles in this channel.'
        )
        return
    }

    // Check if user is the admin who started the battle
    if (battle.adminId !== userId) {
        await handler.sendMessage(
            channelId,
            '❌ Only the admin who started the battle can add test players.'
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

    // Generate 5 fake participant IDs (using pattern: test-{battleId}-{index})
    const testParticipants: string[] = []
    for (let i = 1; i <= 5; i++) {
        const fakeUserId = `0x${battle.battleId.replace(/[^a-f0-9]/gi, '').substring(0, 38)}${i.toString().padStart(2, '0')}` as `0x${string}`
        testParticipants.push(fakeUserId)
    }

    // Add test participants and ensure admin is included
    const { setActiveBattle } = await import('./db')
    const allParticipants = new Set([userId, ...battle.participants, ...testParticipants])
    battle.participants = Array.from(allParticipants)
    battle.isTest = true
    setActiveBattle(battle)

    await handler.sendMessage(
        channelId,
        `🧪 **TEST MODE ACTIVATED** 🧪\n\n` +
        `Added **5 test players** to the battle!\n` +
        `Current participants: **${battle.participants.length}** (including you)\n\n` +
        `${battle.rewardAmount ? `💰 **Reward Pool:** ${(await import('./token')).formatTokenAmount(BigInt(battle.rewardAmount))} TOWNS\n` : ''}` +
        `⚠️ **Note:** In test mode, all rewards will be sent to your address (admin).\n\n` +
        `You can now tip **$1 USD worth of ETH** to launch the test battle!`
    )
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

        // Use the tip message as the thread root so all battle messages are grouped
        // Store threadId on the battle so the loop can reply inside this thread
        battle.threadId = messageId
        {
            const { setActiveBattle } = await import('./db')
            setActiveBattle(battle)
        }

        await handler.sendMessage(
            channelId,
            `⚔️ **BATTLE STARTING!** ⚔️\n\n` +
            `**${battle.participants.length} fighters** are entering the arena!\n` +
            (battle.rewardAmount ? `💰 **Reward Pool:** ${(await import('./token')).formatTokenAmount(BigInt(battle.rewardAmount))} TOWNS\n` : '') +
            `\nLet the battle begin! 🗡️`,
            {
                // Start the thread under the tip message (messageId)
                threadId: messageId,
            }
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

bot.onSlashCommand('leaderboard', async (handler, { channelId }) => {
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
