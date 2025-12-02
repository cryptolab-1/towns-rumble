// TOWNS token utilities
import { readContract, writeContract } from 'viem/actions'
import { execute } from 'viem/experimental/erc7821'
import { parseUnits, formatUnits } from 'viem'
import type { Address } from 'viem'

// Standard ERC20 ABI
const ERC20_ABI = [
    {
        name: 'balanceOf',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ name: '', type: 'uint256' }],
    },
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
    {
        name: 'allowance',
        type: 'function',
        stateMutability: 'view',
        inputs: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
        ],
        outputs: [{ name: '', type: 'uint256' }],
    },
    {
        name: 'transfer',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'to', type: 'address' },
            { name: 'amount', type: 'uint256' },
        ],
        outputs: [{ name: '', type: 'bool' }],
    },
] as const

// TOWNS token address on Base (update if different)
const TOWNS_TOKEN_ADDRESS = (process.env.TOWNS_TOKEN_ADDRESS || '0x0000000000000000000000000000000000000000') as Address

export function getTownsTokenAddress(): Address {
    return TOWNS_TOKEN_ADDRESS
}

/**
 * Get TOWNS token balance for an address
 */
export async function getTokenBalance(viem: any, address: Address): Promise<bigint> {
    try {
        const balance = await readContract(viem, {
            address: TOWNS_TOKEN_ADDRESS,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [address],
        })
        return balance as bigint
    } catch (error) {
        console.error('Error getting token balance:', error)
        throw error
    }
}

/**
 * Get allowance of TOWNS tokens that owner has approved for spender
 */
export async function getTokenAllowance(
    viem: any,
    owner: Address,
    spender: Address
): Promise<bigint> {
    try {
        const allowance = await readContract(viem, {
            address: TOWNS_TOKEN_ADDRESS,
            abi: ERC20_ABI,
            functionName: 'allowance',
            args: [owner, spender],
        })
        return allowance as bigint
    } catch (error) {
        console.error('Error getting token allowance:', error)
        throw error
    }
}

/**
 * Check if admin has approved enough tokens for the bot to spend
 */
export async function checkTokenApproval(
    viem: any,
    adminAddress: Address | string,
    botAddress: Address | string,
    requiredAmount: bigint
): Promise<boolean> {
    const adminAddr = adminAddress as Address
    const botAddr = botAddress as Address
    const allowance = await getTokenAllowance(viem, adminAddr, botAddr)
    return allowance >= requiredAmount
}

/**
 * Transfer TOWNS tokens from bot's treasury to recipients
 * Uses execute() for ERC-7821 batch execution
 */
export async function distributeTokenRewards(
    viem: any,
    bot: any,
    rewards: Array<{ recipient: Address; amount: bigint }>
): Promise<string> {
    try {
        // Create transfer calls for each recipient
        const calls = rewards.map(({ recipient, amount }) => ({
            to: TOWNS_TOKEN_ADDRESS,
            abi: ERC20_ABI,
            functionName: 'transfer' as const,
            args: [recipient, amount],
        }))

        // Execute batch transfer atomically
        const hash = await execute(viem, {
            address: bot.appAddress,
            account: bot.viem.account,
            calls,
        })

        return hash
    } catch (error) {
        console.error('Error distributing token rewards:', error)
        throw error
    }
}

/**
 * Format token amount for display
 */
export function formatTokenAmount(amount: bigint, decimals: number = 18): string {
    return formatUnits(amount, decimals)
}

/**
 * Parse token amount from string
 */
export function parseTokenAmount(amount: string, decimals: number = 18): bigint {
    return parseUnits(amount, decimals)
}

