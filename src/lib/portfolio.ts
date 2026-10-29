export type PortfolioLot = { symbol: string; quantity: number; cost: number; averagePrice: number };
export function summarizePortfolio(transactions: Array<{ symbol: string; transactionType: "BUY" | "SELL"; quantity: number; price: number; fees: number }>): PortfolioLot[] {
  const map = new Map<string, { quantity: number; cost: number }>();
  for (const tx of transactions) {
    const row = map.get(tx.symbol) ?? { quantity: 0, cost: 0 };
    if (tx.transactionType === "BUY") { row.quantity += tx.quantity; row.cost += tx.quantity * tx.price + tx.fees; }
    else {
      if (tx.quantity > row.quantity) throw new Error(`SELL exceeds position for ${tx.symbol}`);
      const average = row.cost / row.quantity;
      row.quantity -= tx.quantity;
      row.cost = row.quantity === 0 ? 0 : row.cost - average * tx.quantity;
    }
    map.set(tx.symbol, row);
  }
  return [...map.entries()].filter(([, row]) => row.quantity > 0).map(([symbol, row]) => ({ symbol, quantity: row.quantity, cost: row.cost, averagePrice: row.cost / row.quantity }));
}
