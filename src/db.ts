import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

const dbPath = process.env.DATABASE_PATH || join(process.cwd(), 'battle.json')

export interface BattleState {
    battleId: string
    channelId: string
    spaceId: string
    adminId: string
    participants: string[] // userIds
    status: 'collecting' | 'pending_tip' | 'pending_approval' | 'active' | 'finished'
    currentRound: number
    eliminated: string[] // userIds
    winners: string[] // Top 3 winners: [1st, 2nd, 3rd]
    rewardAmount?: string // TOWNS token amount in Wei as string
    rewardDistributed: boolean
    tipReceived: boolean
    tipAmount: string // Wei as string
    isPrivate: boolean // If true, only participants from the original space can join
    isTest: boolean // If true, this is a test battle and rewards go to admin
    threadId?: string // Thread root eventId for battle messages (tip that started the battle)
    announcementEventId?: string // EventId of the announcement message (for reactions)
    createdAt: number
    startedAt?: number
    endedAt?: number
}

export interface PlayerStats {
    userId: string
    battles: number // Total battles participated
    wins: number // Total wins (1st, 2nd, or 3rd place)
    kills: number // Total eliminations
    deaths: number // Total times eliminated
    revives: number // Total times revived
}

interface BattleData {
    activeBattle?: BattleState // Legacy: for backward compatibility
    activeBattles?: {
        public?: BattleState
        private: Record<string, BattleState> // spaceId -> BattleState
    }
    pastBattles: BattleState[]
    fightEvents: string[]
    lastEthPrice?: number
    lastEthPriceTimestamp?: number
    playerStats: Record<string, PlayerStats> // userId -> stats
    publicBattleChannels?: Array<{ channelId: string; spaceId: string; spaceName?: string }> // Channels to announce public battles
    spaceNames?: Record<string, string> // spaceId -> spaceName
}

const DEFAULT_FIGHT_EVENTS = [
    // Regular fight events (40 total)
    '{fighter1} lunges at {fighter2} with a swift strike!',
    '{fighter1} dodges {fighter2}\'s attack and counters with a powerful blow!',
    '{fighter1} and {fighter2} clash swords in a fierce exchange!',
    '{fighter1} parries {fighter2}\'s attack and lands a critical hit!',
    '{fighter1} uses a spinning attack against {fighter2}!',
    '{fighter2} blocks {fighter1}\'s strike and retaliates!',
    '{fighter1} delivers a devastating combo on {fighter2}!',
    '{fighter1} and {fighter2} engage in an intense duel!',
    '{fighter1} strikes {fighter2} with lightning speed!',
    '{fighter2} evades {fighter1}\'s attack and strikes back!',
    '{fighter1} unleashes a powerful finisher on {fighter2}!',
    '{fighter1} and {fighter2} trade blows in rapid succession!',
    '{fighter1} performs a backflip and lands a kick on {fighter2}!',
    '{fighter2} sidesteps {fighter1}\'s charge and delivers a roundhouse!',
    '{fighter1} throws a series of jabs at {fighter2}!',
    '{fighter2} catches {fighter1}\'s arm and executes a throw!',
    '{fighter1} leaps into the air and comes down with a powerful strike!',
    '{fighter2} uses a defensive stance and counters {fighter1}\'s advance!',
    '{fighter1} feints left then strikes right, catching {fighter2} off guard!',
    '{fighter2} blocks with a shield and pushes {fighter1} back!',
    '{fighter1} channels energy and releases a shockwave at {fighter2}!',
    '{fighter2} rolls under {fighter1}\'s attack and sweeps their legs!',
    '{fighter1} uses a whirlwind technique against {fighter2}!',
    '{fighter2} deflects {fighter1}\'s blade with precision!',
    '{fighter1} performs a triple strike combo on {fighter2}!',
    '{fighter2} uses a counter-attack technique on {fighter1}!',
    '{fighter1} charges forward with a battle cry!',
    '{fighter2} meets {fighter1}\'s charge head-on with equal force!',
    '{fighter1} uses a feint to create an opening!',
    '{fighter2} reads {fighter1}\'s movements and anticipates the attack!',
    '{fighter1} unleashes a flurry of strikes!',
    '{fighter2} weaves through {fighter1}\'s attacks with agility!',
    '{fighter1} delivers a crushing overhead strike!',
    '{fighter2} deflects the blow and spins into a counter!',
    '{fighter1} uses a grappling technique on {fighter2}!',
    '{fighter2} breaks free and creates distance!',
    '{fighter1} throws a smoke bomb and strikes from the shadows!',
    '{fighter2} clears the smoke and finds {fighter1}!',
    '{fighter1} performs a spinning kick that connects!',
    '{fighter2} recovers quickly and launches a counter-offensive!',
    '{fighter1} uses a combination of strikes and kicks!',
    '{fighter2} blocks and parries with expert timing!',
    
    // Revive events (10 total)
    'REVIVE:{fighter1} finds a healing potion and is revived back into the battle!',
    'REVIVE:{fighter2} gets back up with renewed determination!',
    'REVIVE:{fighter1} is resurrected by a mysterious force!',
    'REVIVE:{fighter2} refuses to stay down and rejoins the fight!',
    'REVIVE:{fighter1} uses a phoenix down and returns to battle!',
    'REVIVE:{fighter2} is healed by a passing medic and continues fighting!',
    'REVIVE:{fighter1} finds inner strength and gets back up!',
    'REVIVE:{fighter2} is saved by a guardian angel and rejoins!',
    'REVIVE:{fighter1} uses a second wind ability to return!',
    'REVIVE:{fighter2} regenerates and comes back stronger!',
]

function readDatabase(): BattleData {
    if (existsSync(dbPath)) {
        try {
            const data = readFileSync(dbPath, 'utf-8')
            const parsed = JSON.parse(data) as BattleData
            // Ensure fightEvents exists
            if (!parsed.fightEvents || parsed.fightEvents.length === 0) {
                parsed.fightEvents = DEFAULT_FIGHT_EVENTS
            }
            if (!parsed.pastBattles) {
                parsed.pastBattles = []
            }
            if (!parsed.playerStats) {
                parsed.playerStats = {}
            }
            if (!parsed.publicBattleChannels) {
                parsed.publicBattleChannels = []
            }
            if (!parsed.spaceNames) {
                parsed.spaceNames = {}
            }
            // Migrate old structure to new structure
            if (!parsed.activeBattles) {
                parsed.activeBattles = { private: {} }
                if (parsed.activeBattle && parsed.activeBattle.status !== 'finished') {
                    if (parsed.activeBattle.isPrivate) {
                        parsed.activeBattles.private[parsed.activeBattle.spaceId] = parsed.activeBattle
                    } else {
                        parsed.activeBattles.public = parsed.activeBattle
                    }
                }
            } else if (!parsed.activeBattles.private) {
                parsed.activeBattles.private = {}
            }
            return parsed
        } catch (error) {
            console.error('Error reading database:', error)
            return { pastBattles: [], fightEvents: DEFAULT_FIGHT_EVENTS, playerStats: {}, activeBattles: { private: {} }, publicBattleChannels: [], spaceNames: {} }
        }
    }
    return { pastBattles: [], fightEvents: DEFAULT_FIGHT_EVENTS, playerStats: {}, activeBattles: { private: {} } }
}

function writeDatabase(data: BattleData): void {
    try {
        writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf-8')
    } catch (error) {
        console.error('❌ Error writing database:', error)
        console.error(`Database path: ${dbPath}`)
    }
}

// Get battle by channelId (searches both public and private battles)
export function getBattleByChannelId(channelId: string): BattleState | undefined {
    const data = readDatabase()
    if (data.activeBattles) {
        if (data.activeBattles.public && data.activeBattles.public.channelId === channelId && data.activeBattles.public.status !== 'finished') {
            return data.activeBattles.public
        }
        for (const spaceId in data.activeBattles.private) {
            const battle = data.activeBattles.private[spaceId]
            if (battle && battle.channelId === channelId && battle.status !== 'finished') {
                return battle
            }
        }
    }
    // Fallback to old structure
    if (data.activeBattle && data.activeBattle.channelId === channelId && data.activeBattle.status !== 'finished') {
        return data.activeBattle
    }
    return undefined
}

// Get battle by battleId (searches both public and private battles)
export function getBattleByBattleId(battleId: string): BattleState | undefined {
    const data = readDatabase()
    if (data.activeBattles) {
        if (data.activeBattles.public && data.activeBattles.public.battleId === battleId && data.activeBattles.public.status !== 'finished') {
            return data.activeBattles.public
        }
        for (const spaceId in data.activeBattles.private) {
            const battle = data.activeBattles.private[spaceId]
            if (battle && battle.battleId === battleId && battle.status !== 'finished') {
                return battle
            }
        }
    }
    // Fallback to old structure
    if (data.activeBattle && data.activeBattle.battleId === battleId && data.activeBattle.status !== 'finished') {
        return data.activeBattle
    }
    return undefined
}

// Legacy function for backward compatibility - returns first active battle found
export function getActiveBattle(): BattleState | undefined {
    const data = readDatabase()
    if (data.activeBattles) {
        if (data.activeBattles.public && data.activeBattles.public.status !== 'finished') {
            return data.activeBattles.public
        }
        // Return first private battle found (for backward compatibility)
        for (const spaceId in data.activeBattles.private) {
            const battle = data.activeBattles.private[spaceId]
            if (battle && battle.status !== 'finished') {
                return battle
            }
        }
    }
    // Fallback to old structure
    return data.activeBattle
}

// Get active public battle
export function getActivePublicBattle(): BattleState | undefined {
    const data = readDatabase()
    if (data.activeBattles?.public && data.activeBattles.public.status !== 'finished') {
        return data.activeBattles.public
    }
    return undefined
}

// Get active private battle for a specific space
export function getActivePrivateBattle(spaceId: string): BattleState | undefined {
    const data = readDatabase()
    const battle = data.activeBattles?.private[spaceId]
    if (battle && battle.status !== 'finished') {
        return battle
    }
    return undefined
}

// Set active public battle
export function setActivePublicBattle(battle: BattleState | undefined): void {
    const data = readDatabase()
    if (!data.activeBattles) {
        data.activeBattles = { private: {} }
    }
    if (battle) {
        data.activeBattles.public = battle
    } else {
        delete data.activeBattles.public
    }
    // Also update legacy field for backward compatibility
    if (battle && !battle.isPrivate) {
        data.activeBattle = battle
    } else if (!battle) {
        data.activeBattle = undefined
    }
    writeDatabase(data)
}

// Set active private battle for a specific space
export function setActivePrivateBattle(spaceId: string, battle: BattleState | undefined): void {
    const data = readDatabase()
    if (!data.activeBattles) {
        data.activeBattles = { private: {} }
    }
    if (battle) {
        data.activeBattles.private[spaceId] = battle
    } else {
        delete data.activeBattles.private[spaceId]
    }
    // Also update legacy field for backward compatibility if this is the only battle
    if (data.activeBattles) {
        const activeBattles = data.activeBattles
        if (battle && battle.isPrivate) {
            const hasPublic = activeBattles.public && activeBattles.public.status !== 'finished'
            const hasOtherPrivate = activeBattles.private && Object.keys(activeBattles.private).some(
                sid => sid !== spaceId && activeBattles.private[sid]?.status !== 'finished'
            )
            if (!hasPublic && !hasOtherPrivate) {
                data.activeBattle = battle
            }
        } else if (!battle) {
            const hasPublic = activeBattles.public && activeBattles.public.status !== 'finished'
            const hasOtherPrivate = activeBattles.private && Object.keys(activeBattles.private).some(
                sid => activeBattles.private[sid]?.status !== 'finished'
            )
            if (!hasPublic && !hasOtherPrivate) {
                data.activeBattle = undefined
            }
        }
    }
    writeDatabase(data)
}

// Legacy function for backward compatibility
export function setActiveBattle(battle: BattleState | undefined): void {
    if (!battle) {
        const data = readDatabase()
        if (data.activeBattles) {
            if (data.activeBattles.public) {
                delete data.activeBattles.public
            }
            data.activeBattles.private = {}
        }
        data.activeBattle = undefined
        writeDatabase(data)
        return
    }
    
    if (battle.isPrivate) {
        setActivePrivateBattle(battle.spaceId, battle)
    } else {
        setActivePublicBattle(battle)
    }
}

export function finishBattle(battle: BattleState): void {
    const data = readDatabase()
    battle.status = 'finished'
    battle.endedAt = Date.now()
    
    // Remove from active battles
    if (data.activeBattles) {
        if (data.activeBattles.public?.battleId === battle.battleId) {
            delete data.activeBattles.public
        }
        if (data.activeBattles.private && data.activeBattles.private[battle.spaceId]?.battleId === battle.battleId) {
            delete data.activeBattles.private[battle.spaceId]
        }
    }
    // Legacy cleanup
    if (data.activeBattle?.battleId === battle.battleId) {
        data.activeBattle = undefined
    }
    
    data.pastBattles.push(battle)
    // Keep only last 100 battles
    if (data.pastBattles.length > 100) {
        data.pastBattles = data.pastBattles.slice(-100)
    }
    writeDatabase(data)
}

export function addParticipant(battleId: string, userId: string): boolean {
    const data = readDatabase()
    
    console.log(`[addParticipant] Attempting to add userId: ${userId} to battleId: ${battleId}`)
    console.log(`[addParticipant] Public battle exists: ${!!data.activeBattles?.public}, battleId: ${data.activeBattles?.public?.battleId}, status: ${data.activeBattles?.public?.status}`)
    
    // Check public battle
    if (data.activeBattles?.public?.battleId === battleId && 
        (data.activeBattles.public.status === 'collecting' || data.activeBattles.public.status === 'pending_tip' || data.activeBattles.public.status === 'pending_approval')) {
        if (!data.activeBattles.public.participants.includes(userId)) {
            data.activeBattles.public.participants.push(userId)
            writeDatabase(data)
            console.log(`[addParticipant] Successfully added to public battle. New participant count: ${data.activeBattles.public.participants.length}`)
            return true
        } else {
            console.log(`[addParticipant] User already in public battle`)
        }
    }
    
    // Check private battles
    if (data.activeBattles?.private) {
        for (const spaceId in data.activeBattles.private) {
            const battle = data.activeBattles.private[spaceId]
            if (battle?.battleId === battleId && 
                (battle.status === 'collecting' || battle.status === 'pending_tip' || battle.status === 'pending_approval')) {
                if (!battle.participants.includes(userId)) {
                    battle.participants.push(userId)
                    writeDatabase(data)
                    return true
                }
            }
        }
    }
    
    // Legacy fallback
    if (data.activeBattle?.battleId === battleId && 
        (data.activeBattle.status === 'collecting' || data.activeBattle.status === 'pending_tip')) {
        if (!data.activeBattle.participants.includes(userId)) {
            data.activeBattle.participants.push(userId)
            writeDatabase(data)
            return true
        }
    }
    
    return false
}

export function getFightEvents(): string[] {
    const data = readDatabase()
    return data.fightEvents
}

export function getRegularFightEvents(): string[] {
    const data = readDatabase()
    return data.fightEvents.filter(event => !event.startsWith('REVIVE:'))
}

export function getReviveEvents(): string[] {
    const data = readDatabase()
    return data.fightEvents.filter(event => event.startsWith('REVIVE:'))
}

export function addFightEvent(event: string): void {
    const data = readDatabase()
    if (!data.fightEvents.includes(event)) {
        data.fightEvents.push(event)
        writeDatabase(data)
    }
}

export function setLastEthPrice(price: number): void {
    const data = readDatabase()
    data.lastEthPrice = price
    data.lastEthPriceTimestamp = Date.now()
    writeDatabase(data)
}

export function getLastEthPrice(): number | undefined {
    const data = readDatabase()
    return data.lastEthPrice
}

/**
 * Get or create player stats
 */
export function getPlayerStats(userId: string): PlayerStats {
    const data = readDatabase()
    if (!data.playerStats[userId]) {
        data.playerStats[userId] = {
            userId,
            battles: 0,
            wins: 0,
            kills: 0,
            deaths: 0,
            revives: 0,
        }
        writeDatabase(data)
    }
    return data.playerStats[userId]
}

/**
 * Update player stats
 */
export function updatePlayerStats(userId: string, updates: Partial<PlayerStats>): void {
    const data = readDatabase()
    if (!data.playerStats[userId]) {
        data.playerStats[userId] = {
            userId,
            battles: 0,
            wins: 0,
            kills: 0,
            deaths: 0,
            revives: 0,
        }
    }
    Object.assign(data.playerStats[userId], updates)
    writeDatabase(data)
}

/**
 * Increment a stat for a player
 */
export function incrementPlayerStat(userId: string, stat: 'battles' | 'wins' | 'kills' | 'deaths' | 'revives', amount: number = 1): void {
    const data = readDatabase()
    if (!data.playerStats[userId]) {
        data.playerStats[userId] = {
            userId,
            battles: 0,
            wins: 0,
            kills: 0,
            deaths: 0,
            revives: 0,
        }
    }
    data.playerStats[userId][stat] = (data.playerStats[userId][stat] || 0) + amount
    writeDatabase(data)
}

/**
 * Get all player stats sorted by a field
 */
export function getTopPlayers(sortBy: 'battles' | 'wins' | 'kills' | 'deaths' | 'revives', limit: number = 10): PlayerStats[] {
    const data = readDatabase()
    const stats = Object.values(data.playerStats)
    return stats
        .sort((a, b) => b[sortBy] - a[sortBy])
        .slice(0, limit)
        .filter(player => player[sortBy] > 0) // Only show players with stats > 0
}

/**
 * Track a channel for public battle announcements
 */
export function trackChannelForPublicBattles(channelId: string, spaceId: string, spaceName?: string): void {
    const data = readDatabase()
    if (!data.publicBattleChannels) {
        data.publicBattleChannels = []
    }
    if (!data.spaceNames) {
        data.spaceNames = {}
    }
    
    // Check if channel already tracked
    const existing = data.publicBattleChannels.find(c => c.channelId === channelId)
    if (!existing) {
        data.publicBattleChannels.push({ channelId, spaceId, spaceName })
    } else if (spaceName) {
        existing.spaceName = spaceName
    }
    
    // Update space name mapping
    if (spaceName) {
        data.spaceNames[spaceId] = spaceName
    }
    
    writeDatabase(data)
}

/**
 * Get all channels where public battles should be announced
 */
export function getPublicBattleChannels(): Array<{ channelId: string; spaceId: string; spaceName?: string }> {
    const data = readDatabase()
    return data.publicBattleChannels || []
}

/**
 * Get space name by spaceId
 */
export function getSpaceName(spaceId: string): string | undefined {
    const data = readDatabase()
    return data.spaceNames?.[spaceId]
}

// Initialize database on first load
const initialData = readDatabase()
console.log(`📊 Battle database initialized (${initialData.fightEvents.length} fight events)`)
console.log(`📁 Database path: ${dbPath}`)

