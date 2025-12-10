import type { BotHandler } from '@towns-protocol/bot'
import { getActiveBattle, getBattleByChannelId, getBattleByBattleId, getActivePublicBattle, getActivePrivateBattle, setActiveBattle, setActivePublicBattle, setActivePrivateBattle, finishBattle, addParticipant, getRegularFightEvents, getReviveEvents, getMassEvents, incrementPlayerStat, getPublicBattleChannels, hasBattlePermission, type BattleState } from './db'
import { getTipAmountRange } from './ethPrice'

const SWORD_EMOJI = '⚔️'
const SWORD_EMOJI_NAME = 'crossed_swords' // Towns Protocol sends reactions as string identifiers

export async function canStartBattle(handler: BotHandler, userId: string, spaceId: string): Promise<boolean> {
    // Check if user is admin
    const isAdmin = await handler.hasAdminPermission(userId, spaceId)
    if (isAdmin) {
        return true
    }
    // Check if user has custom battle permission
    return hasBattlePermission(spaceId, userId)
}

export function initiateBattle(
    handler: BotHandler,
    channelId: string,
    spaceId: string,
    adminId: string,
    rewardAmount?: string,
    isPrivate: boolean = false,
    isTest: boolean = false,
    theme: string = 'default'
): string {
    const battleId = `battle-${Date.now()}-${Math.random().toString(36).substring(7)}`
    const battle = {
        battleId,
        channelId,
        spaceId,
        adminId,
        participants: [],
        status: 'collecting' as const,
        currentRound: 0,
        eliminated: [],
        winners: [],
        rewardAmount,
        rewardDistributed: false,
        tipReceived: false,
        tipAmount: '0',
        isPrivate,
        isTest,
        theme,
        createdAt: Date.now(),
    }
    if (isPrivate) {
        setActivePrivateBattle(spaceId, battle)
    } else {
        setActivePublicBattle(battle)
    }
    return battleId
}

export function handleReaction(
    handler: BotHandler,
    userId: string,
    reaction: string,
    channelId: string,
    spaceId?: string,
    battle?: BattleState
): boolean {
    console.log(`[handleReaction] Called with reaction: ${reaction}, userId: ${userId}, channelId: ${channelId}, spaceId: ${spaceId}, battle: ${battle ? battle.battleId : 'none'}`)
    // Towns Protocol sends reactions as string identifiers (e.g., "crossed_swords") not emojis
    if (reaction !== SWORD_EMOJI && reaction !== SWORD_EMOJI_NAME) {
        console.log(`[handleReaction] Reaction doesn't match SWORD_EMOJI or SWORD_EMOJI_NAME, returning false. Got: ${reaction}`)
        return false
    }
    
    // If battle is not provided, try to find it
    if (!battle) {
        // For public battles, check first (works from any town)
        // For private battles, check the specific space's battle
        // Check public battle first (can be joined from any town)
        const publicBattle = getActivePublicBattle()
        if (publicBattle && !publicBattle.isPrivate) {
            battle = publicBattle
        }
        
        // If no public battle, check private battle for this space
        if (!battle && spaceId) {
            const privateBattle = getActivePrivateBattle(spaceId)
            if (privateBattle && privateBattle.channelId === channelId) {
                battle = privateBattle
            }
        }
        
        // Fallback: search by channelId (for backward compatibility or same-channel battles)
        if (!battle) {
            battle = getBattleByChannelId(channelId)
        }
    }
    
    if (!battle) {
        console.log(`[handleReaction] No battle found. channelId: ${channelId}, spaceId: ${spaceId}`)
        return false
    }
    
    console.log(`[handleReaction] Found battle: ${battle.battleId}, isPrivate: ${battle.isPrivate}, status: ${battle.status}, spaceId: ${battle.spaceId}`)
    
    // For private battles, only allow joining from the original space (town)
    // Any channel in that space can join
    if (battle.isPrivate) {
        if (!spaceId || battle.spaceId !== spaceId) {
            console.log(`[handleReaction] Private battle - wrong town. battle.spaceId: ${battle.spaceId}, current spaceId: ${spaceId}`)
            return false
        }
    }
    
    // For public battles, allow joining from any space (town) with the bot installed
    // No space restriction - cross-town participation
    
    // Allow joining during 'collecting', 'pending_tip', or 'pending_approval' phases
    if (battle.status !== 'collecting' && battle.status !== 'pending_tip' && battle.status !== 'pending_approval') {
        console.log(`[handleReaction] Battle status not accepting participants: ${battle.status}`)
        return false
    }
    
    const result = addParticipant(battle.battleId, userId)
    console.log(`[handleReaction] addParticipant result: ${result} for userId: ${userId}, battleId: ${battle.battleId}`)
    return result
}

export async function handleTip(
    handler: BotHandler,
    senderId: string,
    amount: bigint,
    channelId: string,
    battle?: BattleState
): Promise<boolean> {
    // If battle is provided, use it; otherwise fall back to channelId lookup
    const currentBattle = battle || getBattleByChannelId(channelId)
    if (!currentBattle) return false
    
    if (currentBattle.status !== 'pending_tip') return false
    if (senderId !== currentBattle.adminId) return false
    
    // Get the acceptable tip amount range ($1 USD with 10% slippage)
    try {
        const { min, max } = await getTipAmountRange()
        
        // Check if tip amount is within acceptable range (90% to 110% of $1 USD)
        if (amount < min || amount > max) {
            return false
        }
    } catch (error) {
        console.error('Error getting tip amount range:', error)
        // If we can't get ETH price, reject the tip
        return false
    }
    
    currentBattle.status = 'active'
    currentBattle.tipReceived = true
    currentBattle.tipAmount = amount.toString()
    currentBattle.startedAt = Date.now()
    
    if (currentBattle.isPrivate) {
        setActivePrivateBattle(currentBattle.spaceId, currentBattle)
    } else {
        setActivePublicBattle(currentBattle)
    }
    return true
}

export async function startBattleLoop(
    bot: any,
    channelId: string,
    battleId?: string
): Promise<void> {
    // Use battleId if provided, otherwise fall back to channelId lookup
    const battle = battleId 
        ? getBattleByBattleId(battleId)
        : getBattleByChannelId(channelId)
    if (!battle || battle.status !== 'active') {
        return
    }
    
    // Store battleId for use throughout the loop
    const currentBattleId = battle.battleId
    
    let participants = [...battle.participants]
    const eliminated = new Set(battle.eliminated)
    let round = battle.currentRound
    
    const theme = battle.theme || 'default'
    const regularEvents = getRegularFightEvents(theme)
    const reviveEvents = getReviveEvents(theme)
    const massEvents = getMassEvents(theme)
    
    while (true) {
        // Wait 10 seconds
        await new Promise(resolve => setTimeout(resolve, 10000))
        
        // Check if battle still exists and is active (by battleId to avoid conflicts)
        const currentBattle = getBattleByBattleId(currentBattleId)
        if (!currentBattle || currentBattle.status !== 'active' || currentBattle.battleId !== currentBattleId) {
            return
        }
        
        // Select two random participants who haven't been eliminated
        const activeParticipants = participants.filter(p => !eliminated.has(p))
        if (activeParticipants.length < 2) break
        
        round++
        
        const roundDescriptions: string[] = []
        const eliminatedThisRound: string[] = []
        const revivedThisRound: string[] = []
        
        // Check if we should have a mass event (8% chance per round, not too often)
        const shouldMassEvent = Math.random() < 0.08
        
        if (shouldMassEvent && activeParticipants.length >= 3) {
            // MASS EVENT - Natural Disaster
            const massEventTemplate = massEvents[Math.floor(Math.random() * massEvents.length)]
            const eventName = massEventTemplate.replace('MASS_EVENT:', '')
            
            // Eliminate 20-50% of active participants (minimum 2, but leave at least 1)
            const numToEliminate = Math.max(2, Math.min(
                Math.floor(activeParticipants.length * (0.2 + Math.random() * 0.3)), // 20-50%
                activeParticipants.length - 1 // Always leave at least 1
            ))
            
            // Randomly select participants to eliminate
            const shuffled = [...activeParticipants].sort(() => Math.random() - 0.5)
            const victims = shuffled.slice(0, numToEliminate)
            
            // Eliminate victims
            for (const victim of victims) {
                if (!eliminated.has(victim)) {
                    eliminated.add(victim)
                    eliminatedThisRound.push(victim)
                    incrementPlayerStat(victim, 'deaths')
                }
            }
            
            // Format mass event description
            const victimList = victims.map(v => `💀 ${v}`).join('\n')
            roundDescriptions.push(`**MASS EVENT**\n\n**${eventName}:**\n${victimList}`)
        } else {
            // Regular round with multiple fight events
            // Random number of fight events per round (1-4 events)
            const numEvents = Math.floor(Math.random() * 4) + 1
            
            for (let eventNum = 0; eventNum < numEvents; eventNum++) {
                // Check if we should have a revive event (10% chance per event, but only if there are eliminated players)
                const hasEliminated = eliminated.size > 0
                const shouldRevive = hasEliminated && Math.random() < 0.1
                
                if (shouldRevive) {
                    // Revive event - bring back a random eliminated player
                    const eliminatedArray = Array.from(eliminated)
                    if (eliminatedArray.length > 0) {
                        const revivedPlayer = eliminatedArray[Math.floor(Math.random() * eliminatedArray.length)]
                        eliminated.delete(revivedPlayer)
                        revivedThisRound.push(revivedPlayer)
                        
                        // Track revive stat
                        incrementPlayerStat(revivedPlayer, 'revives')
                        
                        const reviveTemplate = reviveEvents[Math.floor(Math.random() * reviveEvents.length)]
                        const reviveDescription = reviveTemplate
                            .replace('REVIVE:', '')
                            .replace('{fighter1}', `${revivedPlayer}`)
                            .replace('{fighter2}', `${revivedPlayer}`)
                        roundDescriptions.push(reviveDescription)
                    }
                } else {
                    // Regular fight event
                    const currentActive = participants.filter(p => !eliminated.has(p))
                    if (currentActive.length < 2) break
                    
                    let fighter1Index = Math.floor(Math.random() * currentActive.length)
                    let fighter2Index = Math.floor(Math.random() * currentActive.length)
                    
                    // Make sure they're different
                    while (fighter2Index === fighter1Index && currentActive.length > 1) {
                        fighter2Index = Math.floor(Math.random() * currentActive.length)
                    }
                    
                    const fighter1 = currentActive[fighter1Index]
                    const fighter2 = currentActive[fighter2Index]
                    
                    // Get random regular fight event
                    const eventTemplate = regularEvents[Math.floor(Math.random() * regularEvents.length)]
                    const fightDescription = eventTemplate
                        .replace('{fighter1}', `${fighter1}`)
                        .replace('{fighter2}', `${fighter2}`)
                    roundDescriptions.push(fightDescription)
                    
                    // Randomly eliminate one fighter (30% chance per fight event)
                    const shouldEliminate = Math.random() < 0.3
                    if (shouldEliminate && currentActive.length > 1) {
                        const victim = Math.random() < 0.5 ? fighter1 : fighter2
                        const killer = victim === fighter1 ? fighter2 : fighter1
                        
                        // Only eliminate if not already eliminated this round
                        if (!eliminated.has(victim)) {
                            eliminated.add(victim)
                            eliminatedThisRound.push(victim)
                            
                            // Track stats: killer gets a kill, victim gets a death
                            incrementPlayerStat(killer, 'kills')
                            incrementPlayerStat(victim, 'deaths')
                        }
                    }
                }
            }
        }
        
        // Track top 3 winners as participants are eliminated (in order of elimination)
        const updatedBattle = getBattleByBattleId(currentBattleId)
        if (updatedBattle && updatedBattle.battleId === currentBattleId && eliminatedThisRound.length > 0) {
            // Create a temporary set to track eliminations as we process them
            const tempEliminated = new Set(eliminated)
            // Remove the eliminations from this round to calculate counts correctly
            for (const player of eliminatedThisRound) {
                tempEliminated.delete(player)
            }
            
            // Process eliminations in order to determine winners
            // We track the last 2 eliminations (2nd and 3rd place) in chronological order
            for (const eliminatedPlayer of eliminatedThisRound) {
                // Calculate active count before this elimination
                const activeCountBefore = participants.filter(p => !tempEliminated.has(p)).length
                tempEliminated.add(eliminatedPlayer)
                
                // When we go from 3 to 2 participants, the eliminated one is 3rd place
                if (activeCountBefore === 3) {
                    // If we already have a 3rd place, shift it out (it becomes 4th or lower)
                    updatedBattle.winners = [eliminatedPlayer] // New 3rd place
                }
                // When we go from 2 to 1 participant, the eliminated one is 2nd place
                else if (activeCountBefore === 2) {
                    // Keep 3rd place if it exists, add 2nd place
                    if (updatedBattle.winners.length === 0) {
                        updatedBattle.winners = [eliminatedPlayer] // 2nd place (no 3rd tracked yet)
                    } else {
                        updatedBattle.winners = [updatedBattle.winners[0], eliminatedPlayer] // [3rd, 2nd]
                    }
                }
            }
        }
        
        // Update battle state
        const updatedBattle2 = getBattleByBattleId(currentBattleId)
        if (updatedBattle2 && updatedBattle2.battleId === currentBattleId) {
            updatedBattle2.currentRound = round
            updatedBattle2.eliminated = Array.from(eliminated)
            if (updatedBattle && updatedBattle.winners.length > 0) {
                updatedBattle2.winners = updatedBattle.winners
            }
            if (updatedBattle2.isPrivate) {
                setActivePrivateBattle(updatedBattle2.spaceId, updatedBattle2)
            } else {
                setActivePublicBattle(updatedBattle2)
            }
        }
        
        // Build round message
        let roundMessage = `⚔️ **Round ${round}**\n\n`
        roundMessage += roundDescriptions.join('\n\n')
        
        // Check if this was a mass event (mass events already list eliminated players)
        const isMassEvent = roundDescriptions.some(desc => desc.includes('**MASS EVENT**'))
        
        if (revivedThisRound.length > 0) {
            if (revivedThisRound.length === 1) {
                roundMessage += `\n\n✨ ${revivedThisRound[0]} has been revived and rejoined the battle!`
            } else {
                roundMessage += `\n\n✨ **Revived:** ${revivedThisRound.map(id => `${id}`).join(', ')}`
            }
        }
        // Only show eliminated section if it's not a mass event (mass events already show eliminated players)
        if (eliminatedThisRound.length > 0 && !isMassEvent) {
            if (eliminatedThisRound.length === 1) {
                roundMessage += `\n\n💀 ${eliminatedThisRound[0]} has been eliminated!`
            } else {
                roundMessage += `\n\n💀 **Eliminated:** ${eliminatedThisRound.map(id => `${id}`).join(', ')}`
            }
        }
        
        // For public battles, broadcast to all tracked channels
        // For private battles, only send to the original channel
        if (currentBattle.isPrivate) {
            // Private battle - only send to original channel in thread
            const sendOpts = currentBattle.threadId
                ? { threadId: currentBattle.threadId }
                : undefined
            await bot.sendMessage(battle.channelId, roundMessage, sendOpts)
        } else {
            // Public battle - broadcast to all tracked channels
            const channels = getPublicBattleChannels()
            for (const channel of channels) {
                try {
                    // Original channel uses the thread, others are regular messages
                    if (channel.channelId === battle.channelId && currentBattle.threadId) {
                        await bot.sendMessage(channel.channelId, roundMessage, { threadId: currentBattle.threadId })
                    } else {
                        await bot.sendMessage(channel.channelId, roundMessage)
                    }
                } catch (error) {
                    console.error(`Error broadcasting round to channel ${channel.channelId}:`, error)
                }
            }
        }
        
        participants = participants.filter(p => !eliminated.has(p))
    }
    
    // Determine winners (top 3)
    const finalBattle = getBattleByBattleId(currentBattleId)
    if (finalBattle && finalBattle.battleId === currentBattleId) {
        const remaining = participants.filter(p => !eliminated.has(p))
        
        if (remaining.length >= 1) {
            // Winners array is built as [3rd, 2nd] during battle, reverse it to get [2nd, 3rd]
            // Then prepend 1st place to get [1st, 2nd, 3rd]
            const reversedWinners = [...finalBattle.winners].reverse()
            finalBattle.winners = [remaining[0], ...reversedWinners].slice(0, 3) // [1st, 2nd, 3rd]
            
            // Track stats for all participants
            const allParticipants = finalBattle.participants
            for (const participantId of allParticipants) {
                incrementPlayerStat(participantId, 'battles')
            }
            
            // Track wins for top 3
            for (const winnerId of finalBattle.winners) {
                incrementPlayerStat(winnerId, 'wins')
            }
            
            finishBattle(finalBattle)
            
            // Distribute rewards if configured
            if (finalBattle.rewardAmount && BigInt(finalBattle.rewardAmount) > 0n) {
                await distributeRewards(bot, finalBattle)
            } else {
                // No rewards, just announce winners
                const winnerText = finalBattle.winners.length === 1
                    ? `🎉 ${finalBattle.winners[0]} is the winner! 🎉`
                    : finalBattle.winners.length === 2
                    ? `🥇 1st: ${finalBattle.winners[0]}\n🥈 2nd: ${finalBattle.winners[1]}`
                    : `🥇 1st: ${finalBattle.winners[0]}\n🥈 2nd: ${finalBattle.winners[1]}\n🥉 3rd: ${finalBattle.winners[2]}`

                // For public battles, broadcast to all tracked channels
                if (finalBattle.isPrivate) {
                    // Private battle - only send to original channel in thread
                    const sendOpts = finalBattle.threadId
                        ? { threadId: finalBattle.threadId }
                        : undefined
                    await bot.sendMessage(
                        battle.channelId,
                        `🏆 **BATTLE ROYALE COMPLETE!** 🏆\n\n${winnerText}\n\nThanks to all participants for an epic battle!`,
                        sendOpts
                    )
                } else {
                    // Public battle - broadcast to all tracked channels
                    const channels = getPublicBattleChannels()
                    const finalMessage = `🏆 **BATTLE ROYALE COMPLETE!** 🏆\n\n${winnerText}\n\nThanks to all participants for an epic battle!`
                    for (const channel of channels) {
                        try {
                            // Original channel uses the thread, others are regular messages
                            if (channel.channelId === battle.channelId && finalBattle.threadId) {
                                await bot.sendMessage(channel.channelId, finalMessage, { threadId: finalBattle.threadId })
                            } else {
                                await bot.sendMessage(channel.channelId, finalMessage)
                            }
                        } catch (error) {
                            console.error(`Error broadcasting final message to channel ${channel.channelId}:`, error)
                        }
                    }
                }
            }
        } else {
            // Edge case: no winner
            finishBattle(finalBattle)
            if (finalBattle.isPrivate) {
                // Private battle - only send to original channel in thread
                const sendOpts = finalBattle.threadId
                    ? { threadId: finalBattle.threadId }
                    : undefined
                await bot.sendMessage(battle.channelId, '⚔️ The battle ended with no clear winner.', sendOpts)
            } else {
                // Public battle - broadcast to all tracked channels
                const channels = getPublicBattleChannels()
                const noWinnerMessage = '⚔️ The battle ended with no clear winner.'
                for (const channel of channels) {
                    try {
                        // Original channel uses the thread, others are regular messages
                        if (channel.channelId === battle.channelId && finalBattle.threadId) {
                            await bot.sendMessage(channel.channelId, noWinnerMessage, { threadId: finalBattle.threadId })
                        } else {
                            await bot.sendMessage(channel.channelId, noWinnerMessage)
                        }
                    } catch (error) {
                        console.error(`Error broadcasting no winner message to channel ${channel.channelId}:`, error)
                    }
                }
            }
        }
    }
}

/**
 * Distribute TOWNS token rewards to top 3 winners
 * Split: 1st place 60%, 2nd place 25%, 3rd place 15%
 * Transfers from admin's wallet using transferFrom (requires approval)
 */
async function distributeRewards(bot: any, battle: any): Promise<void> {
    const { getTownsTokenAddress, formatTokenAmount } = await import('./token')
    const { getSmartAccountFromUserId } = await import('@towns-protocol/bot')
    const { execute } = await import('viem/experimental/erc7821')
    
    const totalReward = BigInt(battle.rewardAmount)
    const tokenAddress = getTownsTokenAddress()
    
    // ERC20 ABI for transferFrom
    const ERC20_ABI = [
        {
            name: 'transferFrom',
            type: 'function',
            stateMutability: 'nonpayable',
            inputs: [
                { name: 'from', type: 'address' },
                { name: 'to', type: 'address' },
                { name: 'amount', type: 'uint256' },
            ],
            outputs: [{ name: '', type: 'bool' }],
        },
    ] as const
    
    // Calculate rewards: 60%, 25%, 15%
    const firstPlaceReward = (totalReward * BigInt(60)) / BigInt(100)
    const secondPlaceReward = (totalReward * BigInt(25)) / BigInt(100)
    const thirdPlaceReward = (totalReward * BigInt(15)) / BigInt(100)
    
    const adminWallet = await getSmartAccountFromUserId(bot, { userId: battle.adminId })
    const calls: Array<{ to: `0x${string}`; abi: typeof ERC20_ABI; functionName: 'transferFrom'; args: [`0x${string}`, `0x${string}`, bigint] }> = []
    
    // For test battles, send all rewards to admin
    if (battle.isTest) {
        calls.push({
            to: tokenAddress,
            abi: ERC20_ABI,
            functionName: 'transferFrom',
            args: [adminWallet as `0x${string}`, adminWallet as `0x${string}`, totalReward],
        })
    } else {
        // Get wallet addresses for winners and create transferFrom calls
        if (battle.winners.length >= 1) {
            const firstPlaceWallet = await getSmartAccountFromUserId(bot, { userId: battle.winners[0] })
            calls.push({
                to: tokenAddress,
                abi: ERC20_ABI,
                functionName: 'transferFrom',
                args: [adminWallet as `0x${string}`, firstPlaceWallet as `0x${string}`, firstPlaceReward],
            })
        }
        
        if (battle.winners.length >= 2) {
            const secondPlaceWallet = await getSmartAccountFromUserId(bot, { userId: battle.winners[1] })
            calls.push({
                to: tokenAddress,
                abi: ERC20_ABI,
                functionName: 'transferFrom',
                args: [adminWallet as `0x${string}`, secondPlaceWallet as `0x${string}`, secondPlaceReward],
            })
        }
        
        if (battle.winners.length >= 3) {
            const thirdPlaceWallet = await getSmartAccountFromUserId(bot, { userId: battle.winners[2] })
            calls.push({
                to: tokenAddress,
                abi: ERC20_ABI,
                functionName: 'transferFrom',
                args: [adminWallet as `0x${string}`, thirdPlaceWallet as `0x${string}`, thirdPlaceReward],
            })
        }
    }
    
    try {
        // Execute batch transferFrom calls atomically
        const txHash = await execute(bot.viem, {
            address: bot.appAddress,
            account: bot.viem.account,
            calls,
        })
        
        // Build winner announcement
        let winnerText = ''
        if (battle.isTest) {
            winnerText += `🧪 **TEST BATTLE** - All rewards sent to admin: ${formatTokenAmount(totalReward)} TOWNS\n`
        } else {
            if (battle.winners.length >= 1) {
                winnerText += `🥇 **1st Place:** ${battle.winners[0]} - ${formatTokenAmount(firstPlaceReward)} TOWNS (60%)\n`
            }
            if (battle.winners.length >= 2) {
                winnerText += `🥈 **2nd Place:** ${battle.winners[1]} - ${formatTokenAmount(secondPlaceReward)} TOWNS (25%)\n`
            }
            if (battle.winners.length >= 3) {
                winnerText += `🥉 **3rd Place:** ${battle.winners[2]} - ${formatTokenAmount(thirdPlaceReward)} TOWNS (15%)\n`
            }
        }
        
        // For public battles, broadcast to all tracked channels
        const finalMessage = `🏆 **BATTLE ROYALE COMPLETE!** 🏆\n\n${winnerText}\n` +
            `✅ Rewards distributed! Transaction: \`${txHash}\`\n\n` +
            `Thanks to all participants for an epic battle!`
        
        if (battle.isPrivate) {
            // Private battle - only send to original channel in thread
            const sendOpts = battle.threadId
                ? { threadId: battle.threadId }
                : undefined
            await bot.sendMessage(battle.channelId, finalMessage, sendOpts)
        } else {
            // Public battle - broadcast to all tracked channels
            const { getPublicBattleChannels } = await import('./db')
            const channels = getPublicBattleChannels()
            for (const channel of channels) {
                try {
                    // Original channel uses the thread, others are regular messages
                    if (channel.channelId === battle.channelId && battle.threadId) {
                        await bot.sendMessage(channel.channelId, finalMessage, { threadId: battle.threadId })
                    } else {
                        await bot.sendMessage(channel.channelId, finalMessage)
                    }
                } catch (error) {
                    console.error(`Error broadcasting final message to channel ${channel.channelId}:`, error)
                }
            }
        }
        
        // Mark rewards as distributed
        battle.rewardDistributed = true
        const { setActivePublicBattle, setActivePrivateBattle } = await import('./db')
        if (battle.isPrivate) {
            setActivePrivateBattle(battle.spaceId, battle)
        } else {
            setActivePublicBattle(battle)
        }
    } catch (error) {
        console.error('Error distributing rewards:', error)
        const errorMessage = `❌ Error distributing rewards. Please contact an admin.\n\n` +
            `Winners: ${battle.winners.map((w: string) => `${w}`).join(', ')}`
        
        if (battle.isPrivate) {
            await bot.sendMessage(battle.channelId, errorMessage)
        } else {
            // Broadcast error to all channels
            const channels = getPublicBattleChannels()
            for (const channel of channels) {
                try {
                    await bot.sendMessage(channel.channelId, errorMessage)
                } catch (err) {
                    console.error(`Error broadcasting error message to channel ${channel.channelId}:`, err)
                }
            }
        }
    }
}

