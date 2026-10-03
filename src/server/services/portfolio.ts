export type Transaction = {
  symbol: string | null
  transaction_type: 'BUY' | 'SELL' | 'DIVIDEND' | 'CASH_ADJUSTMENT'
  transaction_date: string
  quantity: number | null
  price: number | null
  fees: number
  cash_amount: number | null
}
export type Position = { symbol: string; quantity: number; costBasis: number; averageCost: number | null; realizedPnL: number }

export function calculatePortfolio(transactions: Transaction[]) {
  const positions = new Map<string, Position>()
  let cash = 0
  for (const transaction of [...transactions].sort((a, b) => a.transaction_date.localeCompare(b.transaction_date))) {
    if (transaction.transaction_type === 'CASH_ADJUSTMENT') { cash += transaction.cash_amount ?? 0; continue }
    if (transaction.transaction_type === 'DIVIDEND') { cash += transaction.cash_amount ?? 0; continue }
    if (!transaction.symbol || transaction.quantity === null || transaction.price === null) continue
    const position = positions.get(transaction.symbol) ?? { symbol: transaction.symbol, quantity: 0, costBasis: 0, averageCost: null, realizedPnL: 0 }
    const gross = transaction.quantity * transaction.price
    if (transaction.transaction_type === 'BUY') {
      position.quantity += transaction.quantity
      position.costBasis += gross + transaction.fees
      cash -= gross + transaction.fees
    } else {
      if (transaction.quantity > position.quantity) throw new Error(`SELL exceeds position for ${transaction.symbol}`)
      const removedCost = position.quantity ? position.costBasis * transaction.quantity / position.quantity : 0
      position.quantity -= transaction.quantity
      position.costBasis -= removedCost
      position.realizedPnL += gross - transaction.fees - removedCost
      cash += gross - transaction.fees
    }
    position.averageCost = position.quantity > 0 ? position.costBasis / position.quantity : null
    positions.set(transaction.symbol, position)
  }
  return { cash, positions: [...positions.values()], realizedPnL: [...positions.values()].reduce((sum, row) => sum + row.realizedPnL, 0) }
}
