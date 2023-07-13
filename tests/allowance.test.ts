import { Decimal } from '@tempusfinance/decimal';
import { Provider } from 'ethers';
import { getTokenContract } from '../src/utils';
import { Allowance } from '../src';

jest.mock('../src/utils', () => ({
  ...jest.requireActual('../src/utils'),
  getTokenContract: jest.fn(),
}));

const mockProvider = {} as unknown as Provider;

describe('Allowance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetAllMocks();
  });

  it('should fetch mocked allowance', async () => {
    const expectedAllowance = new Decimal(123);

    (getTokenContract as jest.Mock).mockReturnValue({
      allowance: jest.fn().mockResolvedValue(expectedAllowance),
    });

    const allowance = new Allowance('R', '0x123', '0x456', mockProvider);

    const result = await allowance.fetchAllowance();
    expect(result).toEqual(expectedAllowance);
  });

  it('should return infinite allowance for ETH', async () => {
    (getTokenContract as jest.Mock).mockReturnValue(null);

    const allowance = new Allowance('ETH', '0x123', '0x456', mockProvider);
    const result = await allowance.fetchAllowance();

    expect(result).toEqual(Decimal.MAX_DECIMAL);
  });
});
