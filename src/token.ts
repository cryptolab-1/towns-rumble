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
 * Get TOWNS token balance for an address using BaseScan API
 */
export async function getTokenBalance(viem: any, address: Address): Promise<bigint> {
    try {
        const apiKey = process.env.BASESCAN_API_KEY || ''
        const url = `https://api.basescan.org/api?module=account&action=tokenbalance&contractaddress=${TOWNS_TOKEN_ADDRESS}&address=${address}&tag=latest${apiKey ? `&apikey=${apiKey}` : ''}`
        
        const response = await fetch(url)
        const data = await response.json()
        
        if (data.status === '1' && data.result) {
            return BigInt(data.result)
        } else {
            console.error('BaseScan API error:', data.message || 'Unknown error')
            // Fallback to RPC if API fails
            try {
                const balance = await readContract(viem, {
                    address: TOWNS_TOKEN_ADDRESS,
                    abi: ERC20_ABI,
                    functionName: 'balanceOf',
                    args: [address],
                })
                return balance as bigint
            } catch (rpcError) {
                console.error('RPC fallback also failed:', rpcError)
                return 0n
            }
        }
    } catch (error) {
        console.error('Error getting token balance from BaseScan:', error)
        // Fallback to RPC
        try {
            const balance = await readContract(viem, {
                address: TOWNS_TOKEN_ADDRESS,
                abi: ERC20_ABI,
                functionName: 'balanceOf',
                args: [address],
            })
            return balance as bigint
        } catch (rpcError) {
            console.error('RPC fallback also failed:', rpcError)
            return 0n
        }
    }
}

/**
 * Get allowance of TOWNS tokens that owner has approved for spender
 * Uses RPC (allowance not available via BaseScan API)
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
    } catch (error: any) {
        const isRateLimit = error?.message?.includes('rate limit') || 
                           error?.message?.includes('over rate limit') ||
                           error?.details?.includes('rate limit')
        
        if (isRateLimit) {
            console.warn('RPC rate limit for allowance check. Returning 0. Please try again later.')
            return 0n
        }
        
        console.error('Error getting token allowance:', error)
        return 0n
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

