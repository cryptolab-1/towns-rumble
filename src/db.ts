import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'

const dbPath = process.env.DATABASE_PATH || join(process.cwd(), 'battle.json')

// Log the database path for debugging
console.log(`📁 Database path: ${dbPath}`)
console.log(`📁 DATABASE_PATH env var: ${process.env.DATABASE_PATH || 'NOT SET'}`)

// Ensure directory exists for database file
try {
    const dbDir = dirname(dbPath)
    if (!existsSync(dbDir)) {
        mkdirSync(dbDir, { recursive: true })
        console.log(`📁 Created database directory: ${dbDir}`)
    } else {
        console.log(`📁 Database directory exists: ${dbDir}`)
    }
} catch (error) {
    console.error('Error creating database directory:', error)
}

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
    theme?: string // Battle theme: 'default' or 'christmas'
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
    fightEvents: string[] // Default theme events
    themes?: Record<string, string[]> // theme name -> events array
    lastEthPrice?: number
    lastEthPriceTimestamp?: number
    playerStats: Record<string, PlayerStats> // userId -> stats
    publicBattleChannels?: Array<{ channelId: string; spaceId: string; spaceName?: string; announcementEventId?: string }> // Channels to announce public battles, with announcement message eventId
    spaceNames?: Record<string, string> // spaceId -> spaceName
    messageIdToBattleId?: Record<string, string> // messageId (announcement eventId) -> battleId
    battlePermissions?: Record<string, string[]> // spaceId -> userId[] (users with permission to launch/cancel battles in this space)
    usernames?: Record<string, string> // userId -> username (cache)
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
    
    // Mass events - Natural Disasters (10 total)
    'MASS_EVENT:Earthquake',
    'MASS_EVENT:Volcanic Eruption',
    'MASS_EVENT:Tsunami',
    'MASS_EVENT:Tornado',
    'MASS_EVENT:Lightning Storm',
    'MASS_EVENT:Avalanche',
    'MASS_EVENT:Wildfire',
    'MASS_EVENT:Flood',
    'MASS_EVENT:Meteor Shower',
    'MASS_EVENT:Sandstorm',
]

const CHRISTMAS_FIGHT_EVENTS = [
    // Regular fight events (40 total) - Christmas themed
    '{fighter1} throws a snowball at {fighter2}!',
    '{fighter1} dodges {fighter2}\'s candy cane strike and counters with a gingerbread cookie!',
    '{fighter1} and {fighter2} clash with Christmas ornaments!',
    '{fighter1} parries {fighter2}\'s wreath attack and lands a critical hit!',
    '{fighter1} uses a spinning attack with a Christmas tree branch!',
    '{fighter2} blocks {fighter1}\'s present throw and retaliates!',
    '{fighter1} delivers a devastating combo with mistletoe!',
    '{fighter1} and {fighter2} engage in an intense snowball fight!',
    '{fighter1} strikes {fighter2} with a candy cane sword!',
    '{fighter2} evades {fighter1}\'s reindeer charge and strikes back!',
    '{fighter1} unleashes a powerful finisher with a Christmas star!',
    '{fighter1} and {fighter2} trade blows with stockings filled with coal!',
    '{fighter1} performs a backflip and lands a kick with a Christmas bell!',
    '{fighter2} sidesteps {fighter1}\'s sleigh ride and delivers a roundhouse!',
    '{fighter1} throws a series of jabs with tinsel!',
    '{fighter2} catches {fighter1}\'s arm and executes a throw using a Christmas garland!',
    '{fighter1} leaps into the air and comes down with a powerful strike using a nutcracker!',
    '{fighter2} uses a defensive stance with a Christmas wreath and counters {fighter1}\'s advance!',
    '{fighter1} feints left then strikes right with a candy cane, catching {fighter2} off guard!',
    '{fighter2} blocks with a Christmas cookie shield and pushes {fighter1} back!',
    '{fighter1} channels energy and releases a shockwave of Christmas lights at {fighter2}!',
    '{fighter2} rolls under {fighter1}\'s attack and sweeps their legs with a Christmas tree!',
    '{fighter1} uses a whirlwind technique with a Santa hat against {fighter2}!',
    '{fighter2} deflects {fighter1}\'s gingerbread blade with precision!',
    '{fighter1} performs a triple strike combo with Christmas ornaments!',
    '{fighter2} uses a counter-attack technique with a Christmas stocking on {fighter1}!',
    '{fighter1} charges forward with a battle cry and a candy cane lance!',
    '{fighter2} meets {fighter1}\'s charge head-on with equal force using a Christmas wreath!',
    '{fighter1} uses a feint to create an opening with a mistletoe branch!',
    '{fighter2} reads {fighter1}\'s movements and anticipates the attack with a Christmas bell!',
    '{fighter1} unleashes a flurry of strikes with Christmas cookies!',
    '{fighter2} weaves through {fighter1}\'s attacks with agility and a candy cane!',
    '{fighter1} delivers a crushing overhead strike with a nutcracker!',
    '{fighter2} deflects the blow and spins into a counter with a Christmas star!',
    '{fighter1} uses a grappling technique with tinsel on {fighter2}!',
    '{fighter2} breaks free and creates distance using a Christmas garland!',
    '{fighter1} throws a snowball bomb and strikes from the shadows!',
    '{fighter2} clears the snow and finds {fighter1} with a Christmas light!',
    '{fighter1} performs a spinning kick that connects with a candy cane!',
    '{fighter2} recovers quickly and launches a counter-offensive with a gingerbread sword!',
    '{fighter1} uses a combination of strikes and kicks with Christmas ornaments!',
    '{fighter2} blocks and parries with expert timing using a Christmas wreath!',
    
    // Revive events (10 total) - Christmas themed
    'REVIVE:{fighter1} finds a Christmas cookie and is revived back into the battle!',
    'REVIVE:{fighter2} gets back up with renewed determination thanks to Christmas spirit!',
    'REVIVE:{fighter1} is resurrected by Santa\'s magic!',
    'REVIVE:{fighter2} refuses to stay down and rejoins the fight with Christmas cheer!',
    'REVIVE:{fighter1} uses a Christmas potion and returns to battle!',
    'REVIVE:{fighter2} is healed by a Christmas elf and continues fighting!',
    'REVIVE:{fighter1} finds inner strength from the Christmas spirit and gets back up!',
    'REVIVE:{fighter2} is saved by a Christmas angel and rejoins!',
    'REVIVE:{fighter1} uses a second wind ability powered by Christmas magic to return!',
    'REVIVE:{fighter2} regenerates with Christmas joy and comes back stronger!',
    
    // Mass events - Christmas Disasters (10 total)
    'MASS_EVENT:Blizzard',
    'MASS_EVENT:Ice Storm',
    'MASS_EVENT:Snow Avalanche',
    'MASS_EVENT:Frozen Tundra',
    'MASS_EVENT:Christmas Tree Fire',
    'MASS_EVENT:Ornament Explosion',
    'MASS_EVENT:Reindeer Stampede',
    'MASS_EVENT:Elf Uprising',
    'MASS_EVENT:Coal Mine Collapse',
    'MASS_EVENT:North Pole Earthquake',
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
            if (!parsed.usernames) {
                parsed.usernames = {}
            }
            // Initialize themes if not exists
            if (!parsed.themes) {
                parsed.themes = {
                    default: DEFAULT_FIGHT_EVENTS,
                    christmas: CHRISTMAS_FIGHT_EVENTS,
                }
            } else {
                // Ensure both themes exist
                if (!parsed.themes.default) {
                    parsed.themes.default = DEFAULT_FIGHT_EVENTS
                }
                if (!parsed.themes.christmas) {
                    parsed.themes.christmas = CHRISTMAS_FIGHT_EVENTS
                }
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
            return { 
                pastBattles: [], 
                fightEvents: DEFAULT_FIGHT_EVENTS, 
                themes: { default: DEFAULT_FIGHT_EVENTS, christmas: CHRISTMAS_FIGHT_EVENTS },
                playerStats: {}, 
                activeBattles: { private: {} }, 
                publicBattleChannels: [], 
                spaceNames: {} 
            }
        }
    }
    return { 
        pastBattles: [], 
        fightEvents: DEFAULT_FIGHT_EVENTS, 
        themes: { default: DEFAULT_FIGHT_EVENTS, christmas: CHRISTMAS_FIGHT_EVENTS },
        playerStats: {}, 
        activeBattles: { private: {} } 
    }
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

// Get battle by channelId and adminId (searches both public and private battles)
// This is useful when multiple battles exist in the same channel
export function getBattleByChannelIdAndAdmin(channelId: string, adminId: string): BattleState | undefined {
    const data = readDatabase()
    
    // Check public battle
    if (data.activeBattles?.public && 
        data.activeBattles.public.channelId === channelId && 
        data.activeBattles.public.adminId === adminId &&
        data.activeBattles.public.status !== 'finished') {
        return data.activeBattles.public
    }
    
    // Check private battles
    if (data.activeBattles?.private) {
        for (const spaceId in data.activeBattles.private) {
            const battle = data.activeBattles.private[spaceId]
            if (battle && 
                battle.channelId === channelId && 
                battle.adminId === adminId &&
                battle.status !== 'finished') {
                return battle
            }
        }
    }
    
    // Legacy fallback
    if (data.activeBattle && 
        data.activeBattle.channelId === channelId && 
        data.activeBattle.adminId === adminId &&
        data.activeBattle.status !== 'finished') {
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
            return false // User is already in this battle
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
                } else {
                    console.log(`[addParticipant] User already in private battle`)
                    return false // User is already in this battle
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

export function getRegularFightEvents(theme: string = 'default'): string[] {
    const data = readDatabase()
    const events = theme === 'christmas' && data.themes?.christmas 
        ? data.themes.christmas 
        : (data.themes?.default || data.fightEvents || DEFAULT_FIGHT_EVENTS)
    return events.filter(event => !event.startsWith('REVIVE:') && !event.startsWith('MASS_EVENT:'))
}

export function getReviveEvents(theme: string = 'default'): string[] {
    const data = readDatabase()
    const events = theme === 'christmas' && data.themes?.christmas 
        ? data.themes.christmas 
        : (data.themes?.default || data.fightEvents || DEFAULT_FIGHT_EVENTS)
    return events.filter(event => event.startsWith('REVIVE:'))
}

export function getMassEvents(theme: string = 'default'): string[] {
    const data = readDatabase()
    const events = theme === 'christmas' && data.themes?.christmas 
        ? data.themes.christmas 
        : (data.themes?.default || data.fightEvents || DEFAULT_FIGHT_EVENTS)
    return events.filter(event => event.startsWith('MASS_EVENT:'))
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

export function getTotalBattles(): number {
    const data = readDatabase()
    return data.pastBattles ? data.pastBattles.length : 0
}

/**
 * Track a channel for public battle announcements
 */
export function trackChannelForPublicBattles(channelId: string, spaceId: string, spaceName?: string, announcementEventId?: string): void {
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
        data.publicBattleChannels.push({ channelId, spaceId, spaceName, announcementEventId })
    } else {
        if (spaceName) {
            existing.spaceName = spaceName
        }
        if (announcementEventId) {
            existing.announcementEventId = announcementEventId
        }
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
export function getPublicBattleChannels(): Array<{ channelId: string; spaceId: string; spaceName?: string; announcementEventId?: string }> {
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

/**
 * Map a messageId (announcement eventId) to a battleId
 */
export function setMessageIdToBattleId(messageId: string, battleId: string): void {
    const data = readDatabase()
    if (!data.messageIdToBattleId) {
        data.messageIdToBattleId = {}
    }
    data.messageIdToBattleId[messageId] = battleId
    writeDatabase(data)
}

/**
 * Get battleId by messageId (announcement eventId)
 */
export function getBattleIdByMessageId(messageId: string): string | undefined {
    const data = readDatabase()
    return data.messageIdToBattleId?.[messageId]
}

/**
 * Remove messageId mapping (when battle ends)
 */
export function removeMessageIdMapping(messageId: string): void {
    const data = readDatabase()
    if (data.messageIdToBattleId && messageId in data.messageIdToBattleId) {
        delete data.messageIdToBattleId[messageId]
        writeDatabase(data)
    }
}

/**
 * Add battle permission for a user in a specific space
 */
export function addBattlePermission(spaceId: string, userId: string): void {
    const data = readDatabase()
    if (!data.battlePermissions) {
        data.battlePermissions = {}
    }
    if (!data.battlePermissions[spaceId]) {
        data.battlePermissions[spaceId] = []
    }
    if (!data.battlePermissions[spaceId].includes(userId)) {
        data.battlePermissions[spaceId].push(userId)
        writeDatabase(data)
        console.log(`[addBattlePermission] Added permission for userId ${userId} in space ${spaceId}`)
    }
}

/**
 * Remove battle permission for a user in a specific space
 */
export function removeBattlePermission(spaceId: string, userId: string): void {
    const data = readDatabase()
    if (!data.battlePermissions) {
        return
    }
    if (data.battlePermissions[spaceId]) {
        data.battlePermissions[spaceId] = data.battlePermissions[spaceId].filter(id => id !== userId)
        writeDatabase(data)
        console.log(`[removeBattlePermission] Removed permission for userId ${userId} in space ${spaceId}`)
    }
}

/**
 * Check if a user has battle permission in a specific space
 */
export function hasBattlePermission(spaceId: string, userId: string): boolean {
    const data = readDatabase()
    if (!data.battlePermissions || !data.battlePermissions[spaceId]) {
        return false
    }
    return data.battlePermissions[spaceId].includes(userId)
}

/**
 * Get all users with battle permissions in a specific space
 */
export function getBattlePermissions(spaceId: string): string[] {
    const data = readDatabase()
    if (!data.battlePermissions || !data.battlePermissions[spaceId]) {
        return []
    }
    return [...data.battlePermissions[spaceId]]
}

/**
 * Format a user ID to mention format (like @userId, without brackets)
 * This matches the format used in join messages
 */
export function formatUserId(userId: string): string {
    if (!userId) {
        return userId
    }
    // Use @userId format (without brackets) to match join message format
    // Towns Protocol will render this as a mention/username
    return `@${userId}`
}

/**
 * Get username from cache, or return formatted user ID
 */
export function getUsername(userId: string): string {
    const data = readDatabase()
    if (data.usernames && data.usernames[userId]) {
        return data.usernames[userId]
    }
    return formatUserId(userId)
}

/**
 * Set username in cache
 */
export function setUsername(userId: string, username: string): void {
    const data = readDatabase()
    if (!data.usernames) {
        data.usernames = {}
    }
    data.usernames[userId] = username
    writeDatabase(data)
}

/**
 * Get multiple usernames at once
 */
export function getUsernames(userIds: string[]): string[] {
    return userIds.map(id => getUsername(id))
}

// Initialize database on first load
const initialData = readDatabase()
console.log(`📊 Battle database initialized (${initialData.fightEvents.length} fight events)`)
console.log(`📁 Database path: ${dbPath}`)
console.log(`📁 DATABASE_PATH env var: ${process.env.DATABASE_PATH || 'NOT SET - using fallback'}`)

