import { Provider } from 'ethers';
import { Decimal } from '@tempusfinance/decimal';
import { Token, UnderlyingCollateralToken, WrappedCappedUnderlyingCollateralToken } from '../types';

export type SupportedNetwork = 'goerli' | 'mainnet';

export type SupportedCollateralTokens = {
  wstETH: 'stETH' | 'wstETH';
  wcrETH: 'rETH' | 'wcrETH';
};

export type UnderlyingCollateralTokenConfig<U extends UnderlyingCollateralToken> = {
  supportedCollateralTokens: Record<SupportedCollateralTokens[U], CollateralTokenConfig>;
};

export type UnderlyingTokens = {
  [underlyingToken in UnderlyingCollateralToken]: UnderlyingCollateralTokenConfig<underlyingToken>;
};

export type CollateralTokenConfig = {
  positionManager: string;
  underlyingTokenTicker: UnderlyingCollateralToken;
  underlyingCollateralRate: Decimal | ((address: string, provider: Provider) => Promise<Decimal>);
};

export type TokenConfig = {
  address: string;
  ticker: Token;
  supportsPermit: boolean;
  priceFeedTicker: UnderlyingCollateralToken | null;
  hardcodedPrice: Decimal | null;
  subgraphPriceDataTicker: Token | null;
};

export interface NetworkConfig {
  positionManager: string;
  positionManagerStEth: string;
  oneStepLeverageStEth: string;
  wrappedCollateralTokenPositionManagers: Record<WrappedCappedUnderlyingCollateralToken, string>;
  raftCollateralTokens: Record<UnderlyingCollateralToken, string>;
  raftDebtTokens: Record<UnderlyingCollateralToken, string>;
  priceFeeds: Record<UnderlyingCollateralToken, string>;
  underlyingTokens: UnderlyingTokens;
  tokens: Record<Token, TokenConfig>;
  testNetwork: boolean;
  balancerVault: string;
}
