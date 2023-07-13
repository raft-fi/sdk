import { Decimal } from '@tempusfinance/decimal';
import { Provider } from 'ethers';
import { getTokenContract } from '../src/utils';
import { Balance } from '../src';

jest.mock('../src/utils', () => ({
  ...jest.requireActual('../src/utils'),
  getTokenContract: jest.fn(),
}));

const mockProvider = {
  getBalance: () => Promise.resolve(Decimal.ONE),
} as unknown as Provider;

describe('Balance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetAllMocks();
  });

  it('should fetch mocked allowance', async () => {
    const expectedAllowance = new Decimal(123);

    (getTokenContract as jest.Mock).mockReturnValue({
      balanceOf: jest.fn().mockResolvedValue(expectedAllowance),
    });

    const allowance = new Balance('R', '0x123', mockProvider);

    const result = await allowance.fetchBalance();
    expect(result).toEqual(expectedAllowance);
  });

  it('should return mocked balance for ETH', async () => {
    (getTokenContract as jest.Mock).mockReturnValue(null);

    const allowance = new Balance('ETH', '0x123', mockProvider);
    const result = await allowance.fetchBalance();

    expect(result).toEqual(Decimal.ONE);
  });
});
