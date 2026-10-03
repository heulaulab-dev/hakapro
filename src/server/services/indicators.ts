export type ClosePoint = { time: string; close: number }
export type IndicatorPoint = { time: string; value: number }
export type MacdPoint = { time: string; macd: number; signal: number; histogram: number }

function finiteRows(rows: ClosePoint[]) {
  return rows.filter((row) => Number.isFinite(row.close))
}

export function calculateSimpleMovingAverage(rows: ClosePoint[], period: number): IndicatorPoint[] {
  if (!Number.isInteger(period) || period <= 0) return []
  const valid = finiteRows(rows)
  if (valid.length < period) return []
  let sum = 0
  const result: IndicatorPoint[] = []
  for (let index = 0; index < valid.length; index += 1) {
    sum += valid[index].close
    if (index >= period) sum -= valid[index - period].close
    if (index >= period - 1) result.push({ time: valid[index].time, value: sum / period })
  }
  return result
}

function exponentialMovingAverage(values: number[], period: number): Array<number | null> {
  const result: Array<number | null> = Array(values.length).fill(null)
  if (values.length < period) return result
  let value = values.slice(0, period).reduce((sum, current) => sum + current, 0) / period
  result[period - 1] = value
  const multiplier = 2 / (period + 1)
  for (let index = period; index < values.length; index += 1) {
    value = (values[index] - value) * multiplier + value
    result[index] = value
  }
  return result
}

export function calculateMacd(rows: ClosePoint[], fast = 12, slow = 26, signalPeriod = 9): MacdPoint[] {
  const valid = finiteRows(rows)
  if (valid.length < slow + signalPeriod - 1) return []
  const closes = valid.map((row) => row.close)
  const fastValues = exponentialMovingAverage(closes, fast)
  const slowValues = exponentialMovingAverage(closes, slow)
  const macdValues = closes.map((_, index) => fastValues[index] === null || slowValues[index] === null ? null : fastValues[index]! - slowValues[index]!)
  const first = macdValues.findIndex((value) => value !== null)
  const compact = macdValues.slice(first).map((value) => value!)
  const signals = exponentialMovingAverage(compact, signalPeriod)
  const result: MacdPoint[] = []
  for (let index = 0; index < compact.length; index += 1) {
    const signal = signals[index]
    if (signal === null) continue
    const macd = compact[index]
    const histogram = macd - signal
    if ([macd, signal, histogram].every(Number.isFinite)) result.push({ time: valid[first + index].time, macd, signal, histogram })
  }
  return result
}
