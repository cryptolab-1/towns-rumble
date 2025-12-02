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
    createdAt: number
    startedAt?: number
    endedAt?: number
}

interface BattleData {
    activeBattle?: BattleState
    pastBattles: BattleState[]
    fightEvents: string[]
    lastEthPrice?: number
    lastEthPriceTimestamp?: number
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
            return parsed
        } catch (error) {
            console.error('Error reading database:', error)
            return { pastBattles: [], fightEvents: DEFAULT_FIGHT_EVENTS }
        }
    }
    return { pastBattles: [], fightEvents: DEFAULT_FIGHT_EVENTS }
}

function writeDatabase(data: BattleData): void {
    try {
        writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf-8')
    } catch (error) {
        console.error('❌ Error writing database:', error)
        console.error(`Database path: ${dbPath}`)
    }
}

export function getActiveBattle(): BattleState | undefined {
    const data = readDatabase()
    return data.activeBattle
}

export function setActiveBattle(battle: BattleState | undefined): void {
    const data = readDatabase()
    data.activeBattle = battle
    writeDatabase(data)
}

export function finishBattle(battle: BattleState): void {
    const data = readDatabase()
    if (data.activeBattle?.battleId === battle.battleId) {
        data.activeBattle = undefined
    }
    battle.status = 'finished'
    battle.endedAt = Date.now()
    data.pastBattles.push(battle)
    // Keep only last 100 battles
    if (data.pastBattles.length > 100) {
        data.pastBattles = data.pastBattles.slice(-100)
    }
    writeDatabase(data)
}

export function addParticipant(battleId: string, userId: string): boolean {
    const data = readDatabase()
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

// Initialize database on first load
const initialData = readDatabase()
console.log(`📊 Battle database initialized (${initialData.fightEvents.length} fight events)`)
console.log(`📁 Database path: ${dbPath}`)

