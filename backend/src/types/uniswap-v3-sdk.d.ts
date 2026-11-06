declare module '@uniswap/v3-sdk' {
  export interface TickDataProvider {
    getTick(tick: number): Promise<{ liquidityNet: string | number | bigint }>
    nextInitializedTickWithinOneWord(
      tick: number,
      lte: boolean,
      tickSpacing: number,
    ): Promise<[number, boolean]>
  }

  export function v3Swap(
    fee: any,
    sqrtRatioX96: any,
    tickCurrent: number,
    liquidity: any,
    tickSpacing: number,
    tickDataProvider: TickDataProvider,
    zeroForOne: boolean,
    amountSpecified: any,
    sqrtPriceLimitX96?: any,
  ): Promise<{
    amountCalculated: any
    sqrtRatioX96: any
    liquidity: any
    tickCurrent: number
  }>
}
