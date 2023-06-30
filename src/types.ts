import { Decimal } from '@tempusfinance/decimal';

export const WRAPPABLE_CAPPED_COLLATERAL_TOKENS = ['rETH'] as const;
export const WRAPPED_CAPPED_UNDERLYING_COLLATERAL_TOKENS = ['wcrETH'] as const;
export const UNDERLYING_COLLATERAL_TOKENS = ['wstETH', ...WRAPPED_CAPPED_UNDERLYING_COLLATERAL_TOKENS] as const;
export const COLLATERAL_TOKENS = [
  'ETH',
  'stETH',
  ...WRAPPABLE_CAPPED_COLLATERAL_TOKENS,
  ...UNDERLYING_COLLATERAL_TOKENS,
] as const;
export const R_TOKEN = 'R';
export const TOKENS = [...COLLATERAL_TOKENS, R_TOKEN] as const;

export type WrappableCappedCollateralToken = (typeof WRAPPABLE_CAPPED_COLLATERAL_TOKENS)[number];
export type WrappedCappedUnderlyingCollateralToken = (typeof WRAPPED_CAPPED_UNDERLYING_COLLATERAL_TOKENS)[number];
export type UnderlyingCollateralToken = (typeof UNDERLYING_COLLATERAL_TOKENS)[number];
export type CollateralToken = (typeof COLLATERAL_TOKENS)[number];
export type RToken = typeof R_TOKEN;
export type Token = (typeof TOKENS)[number];

/**
 * @param maxFeePercentage Maximum fee percentage to pay for transaction.
 * @param gasLimitMultiplier Multiplier to apply to estimated gas cost.
 */
export interface TransactionWithFeesOptions {
  maxFeePercentage?: Decimal;
  gasLimitMultiplier?: Decimal;
}

/**
 * @property onApprovalStart A callback that is called when the collateral token or R approval starts.
 * @property onApprovalEnd A callback that is called when the approval ends.
 */
export interface ApprovalCallbacks {
  onApprovalStart?: () => void;
  onApprovalEnd?: (error?: unknown) => void;
}

/**
 * @property approvalType The approval type for the collateral token or R token. Smart contract position owners have to
 * use `approve` since they don't support signing.
 */
export interface ApprovalOptions {
  approvalType?: 'permit' | 'approve';
}
