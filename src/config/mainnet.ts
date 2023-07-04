import { ZeroAddress } from 'ethers';
import { Decimal } from '@tempusfinance/decimal';
import { NetworkConfig, TokenConfig, UnderlyingTokens } from './types';
import { getWstEthToStEthRate } from '../price';
import { Token } from '../types';

const POSITION_MANAGER_ADDRESS = '0x5f59b322eb3e16a0c78846195af1f588b77403fc';
const POSITION_MANAGER_STETH_ADDRESS = '0x839d6833cee34ffab6fa9057b39f02bd3091a1d6';
const POSITION_MANAGER_RETH = '0x29f8abb4cab4bbb56f617d9a3c0f62d33758e74e';
const ONE_STEP_LEVERAGE_STETH_ADDRESS = '0x0892ea4adbf901d35848832d3005a31ee9c84e38';

const underlyingTokensConfig: UnderlyingTokens = {
  wstETH: {
    supportedCollateralTokens: {
      stETH: {
        positionManager: POSITION_MANAGER_STETH_ADDRESS,
        underlyingCollateralRate: getWstEthToStEthRate,
        underlyingTokenTicker: 'wstETH',
      },
      wstETH: {
        positionManager: POSITION_MANAGER_ADDRESS,
        underlyingCollateralRate: Decimal.ONE,
        underlyingTokenTicker: 'wstETH',
      },
    },
  },
  wcrETH: {
    supportedCollateralTokens: {
      rETH: {
        positionManager: POSITION_MANAGER_RETH,
        underlyingCollateralRate: Decimal.ONE,
        underlyingTokenTicker: 'wcrETH',
      },
      wcrETH: {
        positionManager: POSITION_MANAGER_ADDRESS,
        underlyingCollateralRate: Decimal.ONE,
        underlyingTokenTicker: 'wcrETH',
      },
    },
  },
};

const tokensConfig: Record<Token, TokenConfig> = {
  ETH: {
    address: ZeroAddress,
    ticker: 'ETH',
    hardcodedPrice: null,
    priceFeedTicker: null,
    subgraphPriceDataTicker: 'ETH',
    supportsPermit: false,
  },
  stETH: {
    address: '0xae7ab96520de3a18e5e111b5eaab095312d7fe84',
    hardcodedPrice: null,
    priceFeedTicker: null,
    subgraphPriceDataTicker: 'stETH',
    supportsPermit: false,
    ticker: 'stETH',
  },
  wstETH: {
    address: '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0',
    hardcodedPrice: null,
    priceFeedTicker: 'wstETH',
    subgraphPriceDataTicker: null,
    supportsPermit: true,
    ticker: 'wstETH',
  },
  rETH: {
    address: '0xae78736cd615f374d3085123a210448e74fc6393',
    hardcodedPrice: null,
    priceFeedTicker: 'wcrETH',
    subgraphPriceDataTicker: null,
    supportsPermit: false,
    ticker: 'rETH',
  },
  wcrETH: {
    address: '0xb69e35fb4a157028b92f42655090b984609ae598',
    hardcodedPrice: null,
    priceFeedTicker: 'wcrETH',
    subgraphPriceDataTicker: null,
    supportsPermit: true,
    ticker: 'wcrETH',
  },
  R: {
    address: '0x183015a9ba6ff60230fdeadc3f43b3d788b13e21',
    hardcodedPrice: Decimal.ONE,
    priceFeedTicker: null,
    subgraphPriceDataTicker: null,
    supportsPermit: true,
    ticker: 'R',
  },
};

export const mainnetConfig: NetworkConfig = {
  positionManager: POSITION_MANAGER_ADDRESS,
  positionManagerStEth: POSITION_MANAGER_STETH_ADDRESS,
  oneStepLeverageStEth: ONE_STEP_LEVERAGE_STETH_ADDRESS,
  wrappedCollateralTokenPositionManagers: {
    wcrETH: POSITION_MANAGER_RETH,
  },
  raftCollateralTokens: {
    wstETH: '0xa7820009f79687d39f51909a01e7fd4b4d0663f8',
    wcrETH: '0xc38a040faC5769bDed5dDa8Dea1aef609e755363',
  },
  raftDebtTokens: {
    wstETH: '0x1C1D49D8F601f19D2Fa88b14BEf491759aaaF5d8',
    wcrETH: '0xF22Cd22B5Cf439825C6B75c816A4daf8fB44375B',
  },
  priceFeeds: {
    wstETH: '0xDB5De0A34b29fFDeEc61E2D8ab4dB63f6641C730',
    wcrETH: '0x62ac8d1ebf61636e17d92ec3b24e8e03fb853cda',
  },
  underlyingTokens: underlyingTokensConfig,
  tokens: tokensConfig,
  testNetwork: false,
  balancerVault: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
};
