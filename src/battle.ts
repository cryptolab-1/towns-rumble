import type { BotHandler } from '@towns-protocol/bot'
import { getActiveBattle, setActiveBattle, finishBattle, addParticipant, getFightEvents } from './db'
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
    setActiveBattle(battle)
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
    
    const battle = getActiveBattle()
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
    
    // Allow joining during 'collecting' or 'pending_tip' phases
    if (battle.status !== 'collecting' && battle.status !== 'pending_tip') {
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
    const battle = getActiveBattle()
    if (!battle || battle.channelId !== channelId) return false
    
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
    setActiveBattle(battle)
    return true
}

export async function startBattleLoop(
    bot: any,
    battleId: string
): Promise<void> {
    const battle = getActiveBattle()
    if (!battle || battle.battleId !== battleId || battle.status !== 'active') {
        return
    }
    
    let participants = [...battle.participants]
    const eliminated = new Set(battle.eliminated)
    let round = battle.currentRound
    
    const fightEvents = getFightEvents()
    
    while (true) {
        // Wait 10 seconds
        await new Promise(resolve => setTimeout(resolve, 10000))
        
        // Check if battle still exists and is active
        const currentBattle = getActiveBattle()
        if (!currentBattle || currentBattle.battleId !== battleId || currentBattle.status !== 'active') {
            return
        }
        
        // Select two random participants who haven't been eliminated
        const activeParticipants = participants.filter(p => !eliminated.has(p))
        if (activeParticipants.length < 2) break
        
        // Ensure we have at least 2 different fighters
        let fighter1Index = Math.floor(Math.random() * activeParticipants.length)
        let fighter2Index = Math.floor(Math.random() * activeParticipants.length)
        
        // Make sure they're different
        while (fighter2Index === fighter1Index && activeParticipants.length > 1) {
            fighter2Index = Math.floor(Math.random() * activeParticipants.length)
        }
        
        const fighter1 = activeParticipants[fighter1Index]
        const fighter2 = activeParticipants[fighter2Index]
        
        // Get random fight event
        const eventTemplate = fightEvents[Math.floor(Math.random() * fightEvents.length)]
        const fightDescription = eventTemplate
            .replace('{fighter1}', `<@${fighter1}>`)
            .replace('{fighter2}', `<@${fighter2}>`)
        
        // Randomly eliminate one fighter (50% chance each)
        const eliminatedFighter = Math.random() < 0.5 ? fighter1 : fighter2
        eliminated.add(eliminatedFighter)
        
        // Track top 3 winners as participants are eliminated
        const activeCount = activeParticipants.filter(p => !eliminated.has(p)).length
        const updatedBattle = getActiveBattle()
        if (updatedBattle && updatedBattle.battleId === battleId) {
            // When we go from 4 to 3 participants, the eliminated one is 4th place (not tracked)
            // When we go from 3 to 2 participants, the eliminated one is 3rd place
            if (activeCount === 2 && updatedBattle.winners.length === 0) {
                updatedBattle.winners = [eliminatedFighter] // 3rd place
            }
            // When we go from 2 to 1 participant, the eliminated one is 2nd place
            else if (activeCount === 1 && updatedBattle.winners.length === 1) {
                updatedBattle.winners = [updatedBattle.winners[0], eliminatedFighter] // [3rd, 2nd]
            }
        }
        
        round++
        
        // Update battle state
        const updatedBattle2 = getActiveBattle()
        if (updatedBattle2 && updatedBattle2.battleId === battleId) {
            updatedBattle2.currentRound = round
            updatedBattle2.eliminated = Array.from(eliminated)
            setActiveBattle(updatedBattle2)
        }
        
        // Send fight message
        await bot.sendMessage(battle.channelId, `⚔️ **Round ${round}**\n\n${fightDescription}\n\n<@${eliminatedFighter}> has been eliminated!`)
        
        participants = activeParticipants.filter(p => !eliminated.has(p))
    }
    
    // Determine winners (top 3)
    const finalBattle = getActiveBattle()
    if (finalBattle && finalBattle.battleId === battleId) {
        const remaining = participants.filter(p => !eliminated.has(p))
        
        if (remaining.length >= 1) {
            // Add 1st place (last one standing)
            finalBattle.winners = [remaining[0], ...finalBattle.winners].slice(0, 3) // [1st, 2nd, 3rd]
            
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
                
                await bot.sendMessage(
                    battle.channelId,
                    `🏆 **BATTLE ROYALE COMPLETE!** 🏆\n\n${winnerText}\n\nThanks to all participants for an epic battle!`
                )
            }
        } else {
            // Edge case: no winner
            finishBattle(finalBattle)
            await bot.sendMessage(battle.channelId, '⚔️ The battle ended with no clear winner.')
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
        const { setActiveBattle } = await import('./db')
        setActiveBattle(battle)
    } catch (error) {
        console.error('Error distributing rewards:', error)
        await bot.sendMessage(
            battle.channelId,
            `❌ Error distributing rewards. Please contact an admin.\n\n` +
            `Winners: ${battle.winners.map((w: string) => `<@${w}>`).join(', ')}`
        )
    }
}

