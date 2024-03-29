import { Decimal } from '@tempusfinance/decimal';
import { ERC20, ERC20Permit, RSavingsRate, WstETH } from './typechain';

export const WRAPPABLE_CAPPED_COLLATERAL_TOKENS = ['rETH-v1'] as const;
export const WRAPPED_CAPPED_UNDERLYING_COLLATERAL_TOKENS = ['wcrETH-v1'] as const;
export const UNDERLYING_COLLATERAL_TOKENS = [
  'wstETH',
  'wstETH-v1',
  'WETH',
  'rETH',
  'WBTC',
  'cbETH',
  'swETH',
  ...WRAPPED_CAPPED_UNDERLYING_COLLATERAL_TOKENS,
] as const;
export const COLLATERAL_TOKENS = [
  'stETH',
  ...WRAPPABLE_CAPPED_COLLATERAL_TOKENS,
  ...UNDERLYING_COLLATERAL_TOKENS,
] as const;
export const RAFT_TOKEN = 'RAFT';
export const VERAFT_TOKEN = 'veRAFT';
export const R_TOKEN = 'R';
export const RR_TOKEN = 'RR';
export const RAFT_BPT_TOKEN = 'B-80RAFT-20R';
export const TOKENS = [...COLLATERAL_TOKENS, RAFT_TOKEN, VERAFT_TOKEN, R_TOKEN, RR_TOKEN, RAFT_BPT_TOKEN] as const;

export const VAULT_VERSIONS = ['v1', 'v2'] as const;
export const VAULTS_V1 = ['wstETH-v1', 'wcrETH-v1'] as const;
export const VAULTS_V2 = ['wstETH', 'WETH', 'rETH', 'WBTC', 'cbETH', 'swETH'] as const;

export type WrappableCappedCollateralToken = (typeof WRAPPABLE_CAPPED_COLLATERAL_TOKENS)[number];
export type WrappedCappedUnderlyingCollateralToken = (typeof WRAPPED_CAPPED_UNDERLYING_COLLATERAL_TOKENS)[number];
export type UnderlyingCollateralToken = (typeof UNDERLYING_COLLATERAL_TOKENS)[number];
export type CollateralToken = (typeof COLLATERAL_TOKENS)[number];
export type RaftToken = typeof RAFT_TOKEN;
export type VeRaftToken = typeof VERAFT_TOKEN;
export type RaftCollateralToken = `r${UnderlyingCollateralToken}-c`;
export type RaftDebtToken = `r${UnderlyingCollateralToken}-d`;
export type RToken = typeof R_TOKEN;
export type RRToken = typeof RR_TOKEN;
export type Token = (typeof TOKENS)[number];

export type Erc20TokenContract = ERC20 | ERC20Permit | WstETH | RSavingsRate;
export type Erc20PermitTokenContract = ERC20Permit | WstETH;

export type VaultVersion = (typeof VAULT_VERSIONS)[number];
export type VaultV1 = (typeof VAULTS_V1)[number];
export type InterestRateVault = Exclude<UnderlyingCollateralToken, VaultV1>;

/**
 * @param maxFeePercentage Maximum fee percentage to pay for transaction.
 * @param gasLimitMultiplier Multiplier to apply to estimated gas cost.
 */
export interface TransactionWithFeesOptions {
  maxFeePercentage?: Decimal;
  gasLimitMultiplier?: Decimal;
}

export type SwapRouter = '1inch';
