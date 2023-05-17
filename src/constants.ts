import { Decimal } from '@tempusfinance/decimal';

// Protocol constants

export const MIN_COLLATERAL_RATIO = new Decimal(1.1); // 110%
export const MIN_NET_DEBT = new Decimal(3000); // 3000 R

export const GAS_LIMIT_MULTIPLIER = new Decimal(1.2); // 20%

export const SUBGRAPH_ENDPOINT_URL = 'https://api.studio.thegraph.com/proxy/46633/raft-test/0.1.1';
