import { ZeroAddress } from 'ethers';
import { Decimal } from '@tempusfinance/decimal';
import { NetworkConfig, TokenConfig, UnderlyingTokens } from './types';
import { getWstEthToStEthRate } from '../price';
import { Token } from '../types';

const POSITION_MANAGER_ADDRESS = '0xeaf8aad45d563f14d8b443277dd51c426ad8607f';
const POSITION_MANAGER_STETH_ADDRESS = '0x4e01f8c03893be67b60af6a1b49d6e51a8781e3c';
const POSITION_MANAGER_WRAPPED_RETH = '0x109a9dace6e89cc5ddffebe374e15f029f6b1440';

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
        positionManager: POSITION_MANAGER_WRAPPED_RETH,
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
    subgraphPriceDataTicker: null,
    supportsPermit: false,
  },
  stETH: {
    address: '0x1643E812aE58766192Cf7D2Cf9567dF2C37e9B7F',
    hardcodedPrice: null,
    priceFeedTicker: null,
    subgraphPriceDataTicker: null,
    supportsPermit: false,
    ticker: 'stETH',
  },
  wstETH: {
    address: '0x6320cD32aA674d2898A68ec82e869385Fc5f7E2f',
    hardcodedPrice: null,
    priceFeedTicker: 'wstETH',
    subgraphPriceDataTicker: null,
    supportsPermit: true,
    ticker: 'wstETH',
  },
  rETH: {
    address: '0x0b26a03413aCca79eE539015f036B7dF79ddD1c5',
    hardcodedPrice: null,
    priceFeedTicker: 'wcrETH',
    subgraphPriceDataTicker: null,
    supportsPermit: false,
    ticker: 'rETH',
  },
  wcrETH: {
    address: '0x27d7f9921933DfA737B1006E5EFb637cC4b21fc8',
    hardcodedPrice: null,
    priceFeedTicker: 'wcrETH',
    subgraphPriceDataTicker: null,
    supportsPermit: true,
    ticker: 'wcrETH',
  },
  R: {
    address: '0x9b41fE4EE4F23507953CCA339A4eC27eAc9e02b8',
    hardcodedPrice: Decimal.ONE,
    priceFeedTicker: null,
    subgraphPriceDataTicker: null,
    supportsPermit: true,
    ticker: 'R',
  },
};

export const goerliConfig: NetworkConfig = {
  positionManager: POSITION_MANAGER_ADDRESS,
  positionManagerStEth: POSITION_MANAGER_STETH_ADDRESS,
  oneStepLeverageStEth: '', // Add address if we ever deploy one step leverage on goerli
  wrappedCollateralTokenPositionManagers: {
    wcrETH: POSITION_MANAGER_WRAPPED_RETH,
  },
  raftCollateralTokens: {
    wstETH: '0x86695745Ce31FBd45Db7F6866d5d3Abe048ce033',
    wcrETH: '0x1678f15179dF5608786561A8d56E498449dF2f28',
  },
  raftDebtTokens: {
    wstETH: '0xAABF1f5e5C9b559aaCD3c97B41B0B1ae593e31A8',
    wcrETH: '0xB9F64d21b776abCA4aD2d04846D65cB0d072925F',
  },
  priceFeeds: {
    wstETH: '0x0341b185e55A0860D6a7e853fd44D1f4fe37dB37',
    wcrETH: '0xfd7970eE3eF2E717346016f439A691Ea3DFd71BA',
  },
  underlyingTokens: underlyingTokensConfig,
  tokens: tokensConfig,
  testNetwork: true,
  balancerVault: '', // Add address if we ever deploy one step leverage on goerli
};
