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

