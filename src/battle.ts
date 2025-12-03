import type { BotHandler } from '@towns-protocol/bot'
import { getActiveBattle, getBattleByChannelId, getBattleByBattleId, getActivePublicBattle, getActivePrivateBattle, setActiveBattle, setActivePublicBattle, setActivePrivateBattle, finishBattle, addParticipant, getRegularFightEvents, getReviveEvents, incrementPlayerStat } from './db'
import { getTipAmountRange } from './ethPrice'

const SWORD_EMOJI = '⚔️'

export function canStartBattle(handler: BotHandler, userId: string, spaceId: string): Promise<boolean> {
    return handler.hasAdminPermission(userId, spaceId)
}

export function initiateBattle(
    handler: BotHandler,
    channelId: string,
    spaceId: string,
    adminId: string,
    rewardAmount?: string,
    isPrivate: boolean = false,
    isTest: boolean = false
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
    spaceId?: string
): boolean {
    if (reaction !== SWORD_EMOJI) return false
    
    // For private battles, check the specific space's battle
    // For public battles, check the global public battle
    let battle: BattleState | undefined
    if (spaceId) {
        const privateBattle = getActivePrivateBattle(spaceId)
        if (privateBattle && privateBattle.channelId === channelId) {
            battle = privateBattle
        }
    }
    
    // If no private battle found, check public battle
    if (!battle) {
        const publicBattle = getActivePublicBattle()
        if (publicBattle && publicBattle.channelId === channelId) {
            battle = publicBattle
        }
    }
    
    // Fallback: search by channelId (for backward compatibility)
    if (!battle) {
        battle = getBattleByChannelId(channelId)
    }
    
    if (!battle) return false
    
    // For private battles, only allow joining from the original space (town)
    // Any channel in that space can join
    if (battle.isPrivate) {
        if (!spaceId || battle.spaceId !== spaceId) {
            return false
        }
    }
    
    // For public battles, allow joining from any space (town) with the bot installed
    // No space restriction - cross-town participation
    
    // Allow joining during 'collecting', 'pending_tip', or 'pending_approval' phases
    if (battle.status !== 'collecting' && battle.status !== 'pending_tip' && battle.status !== 'pending_approval') {
        return false
    }
    
    return addParticipant(battle.battleId, userId)
}

export async function handleTip(
    handler: BotHandler,
    senderId: string,
    amount: bigint,
    channelId: string
): Promise<boolean> {
    const battle = getBattleByChannelId(channelId)
    if (!battle) return false
    
    if (battle.status !== 'pending_tip') return false
    if (senderId !== battle.adminId) return false
    
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
    
    battle.status = 'active'
    battle.tipReceived = true
    battle.tipAmount = amount.toString()
    battle.startedAt = Date.now()
    
    if (battle.isPrivate) {
        setActivePrivateBattle(battle.spaceId, battle)
    } else {
        setActivePublicBattle(battle)
    }
    return true
}

export async function startBattleLoop(
    bot: any,
    battleId: string
): Promise<void> {
    const battle = getBattleByBattleId(battleId)
    if (!battle || battle.status !== 'active') {
        return
    }
    
    let participants = [...battle.participants]
    const eliminated = new Set(battle.eliminated)
    let round = battle.currentRound
    
    const regularEvents = getRegularFightEvents()
    const reviveEvents = getReviveEvents()
    
    while (true) {
        // Wait 10 seconds
        await new Promise(resolve => setTimeout(resolve, 10000))
        
        // Check if battle still exists and is active
        const currentBattle = getBattleByBattleId(battleId)
        if (!currentBattle || currentBattle.status !== 'active') {
            return
        }
        
        // Select two random participants who haven't been eliminated
        const activeParticipants = participants.filter(p => !eliminated.has(p))
        if (activeParticipants.length < 2) break
        
        round++
        
        // Random number of fight events per round (1-4 events)
        const numEvents = Math.floor(Math.random() * 4) + 1
        const roundDescriptions: string[] = []
        const eliminatedThisRound: string[] = []
        const revivedThisRound: string[] = []
        
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
                        .replace('{fighter1}', `<@${revivedPlayer}>`)
                        .replace('{fighter2}', `<@${revivedPlayer}>`)
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
                    .replace('{fighter1}', `<@${fighter1}>`)
                    .replace('{fighter2}', `<@${fighter2}>`)
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
        
        // Track top 3 winners as participants are eliminated (in order of elimination)
        const updatedBattle = getBattleByBattleId(battleId)
        if (updatedBattle && eliminatedThisRound.length > 0) {
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
        const updatedBattle2 = getBattleByBattleId(battleId)
        if (updatedBattle2) {
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
        
        if (revivedThisRound.length > 0) {
            if (revivedThisRound.length === 1) {
                roundMessage += `\n\n✨ <@${revivedThisRound[0]}> has been revived and rejoined the battle!`
            } else {
                roundMessage += `\n\n✨ **Revived:** ${revivedThisRound.map(id => `<@${id}>`).join(', ')}`
            }
        }
        if (eliminatedThisRound.length > 0) {
            if (eliminatedThisRound.length === 1) {
                roundMessage += `\n\n💀 <@${eliminatedThisRound[0]}> has been eliminated!`
            } else {
                roundMessage += `\n\n💀 **Eliminated:** ${eliminatedThisRound.map(id => `<@${id}>`).join(', ')}`
            }
        }
        
        // Send fight message as a reply inside the battle thread (if any).
        // We use both threadId and replyId pointing to the root message (the tipped message)
        // so Towns renders a visible thread under that message.
        const sendOpts = currentBattle.threadId
            ? { threadId: currentBattle.threadId, replyId: currentBattle.threadId }
            : undefined
        await bot.sendMessage(battle.channelId, roundMessage, sendOpts)
        
        participants = participants.filter(p => !eliminated.has(p))
    }
    
    // Determine winners (top 3)
    const finalBattle = getBattleByBattleId(battleId)
    if (finalBattle) {
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
                    ? `🎉 <@${finalBattle.winners[0]}> is the winner! 🎉`
                    : finalBattle.winners.length === 2
                    ? `🥇 1st: <@${finalBattle.winners[0]}>\n🥈 2nd: <@${finalBattle.winners[1]}>`
                    : `🥇 1st: <@${finalBattle.winners[0]}>\n🥈 2nd: <@${finalBattle.winners[1]}>\n🥉 3rd: <@${finalBattle.winners[2]}>`

                const sendOpts = finalBattle.threadId
                    ? { threadId: finalBattle.threadId, replyId: finalBattle.threadId }
                    : undefined

                await bot.sendMessage(
                    battle.channelId,
                    `🏆 **BATTLE ROYALE COMPLETE!** 🏆\n\n${winnerText}\n\nThanks to all participants for an epic battle!`,
                    sendOpts
                )
            }
        } else {
            // Edge case: no winner
            finishBattle(finalBattle)
            const sendOpts = finalBattle.threadId
                ? { threadId: finalBattle.threadId, replyId: finalBattle.threadId }
                : undefined
            await bot.sendMessage(battle.channelId, '⚔️ The battle ended with no clear winner.', sendOpts)
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
                winnerText += `🥇 **1st Place:** <@${battle.winners[0]}> - ${formatTokenAmount(firstPlaceReward)} TOWNS (60%)\n`
            }
            if (battle.winners.length >= 2) {
                winnerText += `🥈 **2nd Place:** <@${battle.winners[1]}> - ${formatTokenAmount(secondPlaceReward)} TOWNS (25%)\n`
            }
            if (battle.winners.length >= 3) {
                winnerText += `🥉 **3rd Place:** <@${battle.winners[2]}> - ${formatTokenAmount(thirdPlaceReward)} TOWNS (15%)\n`
            }
        }
        
        await bot.sendMessage(
            battle.channelId,
            `🏆 **BATTLE ROYALE COMPLETE!** 🏆\n\n${winnerText}\n` +
            `✅ Rewards distributed! Transaction: \`${txHash}\`\n\n` +
            `Thanks to all participants for an epic battle!`
        )
        
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
        await bot.sendMessage(
            battle.channelId,
            `❌ Error distributing rewards. Please contact an admin.\n\n` +
            `Winners: ${battle.winners.map((w: string) => `<@${w}>`).join(', ')}`
        )
    }
}

