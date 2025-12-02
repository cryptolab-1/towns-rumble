// Utility to get current ETH price in USD and calculate tip amounts

import { setLastEthPrice, getLastEthPrice } from './db'

async function fetchFromCoinbase(): Promise<number> {
    const response = await fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot')
    
    if (!response.ok) {
        throw new Error(`Coinbase API returned ${response.status}`)
    }
    
    const data = await response.json()
    
    if (data.data?.amount) {
        const price = parseFloat(data.data.amount)
        if (isNaN(price) || price <= 0) {
            throw new Error('Invalid price from Coinbase API')
        }
        return price
    }
    
    throw new Error('Invalid response format from Coinbase API')
}

async function fetchFromCoinGecko(): Promise<number> {
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd')
    
    if (!response.ok) {
        throw new Error(`CoinGecko API returned ${response.status}`)
    }
    
    const data = await response.json()
    
    if (data.ethereum?.usd) {
        const price = parseFloat(data.ethereum.usd.toString())
        if (isNaN(price) || price <= 0) {
            throw new Error('Invalid price from CoinGecko API')
        }
        return price
    }
    
    throw new Error('Invalid response format from CoinGecko API')
}

async function fetchFromBinance(): Promise<number> {
    const response = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT')
    
    if (!response.ok) {
        throw new Error(`Binance API returned ${response.status}`)
    }
    
    const data = await response.json()
    
    if (data.price) {
        const price = parseFloat(data.price)
        if (isNaN(price) || price <= 0) {
            throw new Error('Invalid price from Binance API')
        }
        return price
    }
    
    throw new Error('Invalid response format from Binance API')
}

export async function getEthPriceInUsd(): Promise<number> {
    // Try Coinbase first (primary)
    try {
        const price = await fetchFromCoinbase()
        console.log('✅ ETH price fetched from Coinbase:', price)
        setLastEthPrice(price)
        return price
    } catch (error) {
        console.error('❌ Coinbase API failed:', error)
    }
    
    // Fallback to CoinGecko
    try {
        const price = await fetchFromCoinGecko()
        console.log('✅ ETH price fetched from CoinGecko:', price)
        setLastEthPrice(price)
        return price
    } catch (error) {
        console.error('❌ CoinGecko API failed:', error)
    }
    
    // Fallback to Binance
    try {
        const price = await fetchFromBinance()
        console.log('✅ ETH price fetched from Binance:', price)
        setLastEthPrice(price)
        return price
    } catch (error) {
        console.error('❌ Binance API failed:', error)
    }
    
    // All APIs failed - use last stored price from database
    const lastPrice = getLastEthPrice()
    if (lastPrice) {
        console.log('⚠️ All ETH price APIs failed, using last stored price from database:', lastPrice)
        return lastPrice
    }
    
    // No stored price available - throw error
    throw new Error('All ETH price APIs failed and no stored price available in database')
}

/**
 * Calculate $1 USD in ETH (Wei) with 10% slippage tolerance
 * Returns the minimum and maximum acceptable amounts
 */
export async function getTipAmountRange(): Promise<{ min: bigint; max: bigint; target: bigint }> {
    const ethPrice = await getEthPriceInUsd()
    
    // $1 USD in ETH
    const oneDollarInEth = 1 / ethPrice
    
    // Convert to Wei (1 ETH = 10^18 Wei)
    const oneDollarInWei = BigInt(Math.floor(oneDollarInEth * 1e18))
    
    // Apply 10% slippage: accept 90% to 110% of $1
    const minAmount = (oneDollarInWei * BigInt(90)) / BigInt(100) // 90%
    const maxAmount = (oneDollarInWei * BigInt(110)) / BigInt(100) // 110%
    
    return {
        min: minAmount,
        max: maxAmount,
        target: oneDollarInWei,
    }
}

