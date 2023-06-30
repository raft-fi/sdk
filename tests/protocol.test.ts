import { JsonRpcProvider, Signer } from 'ethers';
import { ERC20PermitSignatureStruct, Protocol } from '../src';
import { Decimal } from '@tempusfinance/decimal';
import { createEmptyPermitSignature, createPermitSignature } from '../src/utils';

jest.mock('../src/utils/permit', () => ({
  ...jest.requireActual('../src/utils/permit'),
  createPermitSignature: jest.fn(),
}));

const mockProvider = {} as JsonRpcProvider;
const mockEoaRedeemer = {
  provider: {
    getCode: () => Promise.resolve('0x'),
  },
  getAddress: () => Promise.resolve('0x123'),
} as unknown as Signer;
const mockContractRedeemer = {
  provider: {
    getCode: () => Promise.resolve('0x456'),
  },
  getAddress: () => Promise.resolve('0x123'),
} as unknown as Signer;

const EMPTY_SIGNATURE = createEmptyPermitSignature();

describe('Protocol', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetAllMocks();
  });

  describe('getRedeemCollateralSteps', () => {
    it('should generate steps [redeem] for wstETH redemption', async () => {
      const protocol = Protocol.getInstance(mockProvider);
      const steps = protocol.getRedeemCollateralSteps('wstETH', Decimal.ONE, mockEoaRedeemer);

      const firstStep = await steps.next();

      expect(firstStep.done).toBe(false);
      expect(firstStep.value?.type).toEqual({
        name: 'redeem',
      });
      expect(firstStep.value?.stepNumber).toEqual(1);
      expect(firstStep.value?.numberOfSteps).toEqual(1);

      const termination = await steps.next();

      expect(termination.done).toBe(true);
    });

    it('should generate steps [R permit + redeem] for wcrETH redemption', async () => {
      const protocol = Protocol.getInstance(mockProvider);
      const steps = protocol.getRedeemCollateralSteps('wcrETH', Decimal.ONE, mockEoaRedeemer);
      const numberOfSteps = 2;

      (createPermitSignature as jest.Mock).mockResolvedValue(EMPTY_SIGNATURE);

      const firstStep = await steps.next();
      const signature = await firstStep.value?.action?.();

      expect(firstStep.done).toBe(false);
      expect(firstStep.value?.type).toEqual({
        name: 'permit',
        token: 'R',
      });
      expect(firstStep.value?.stepNumber).toEqual(1);
      expect(firstStep.value?.numberOfSteps).toEqual(numberOfSteps);
      expect(signature).toEqual(EMPTY_SIGNATURE);

      const secondStep = await steps.next(signature as ERC20PermitSignatureStruct);

      expect(secondStep.done).toBe(false);
      expect(secondStep.value?.type).toEqual({
        name: 'redeem',
      });
      expect(secondStep.value?.stepNumber).toEqual(2);
      expect(secondStep.value?.numberOfSteps).toEqual(numberOfSteps);

      const termination = await steps.next();

      expect(termination.done).toBe(true);
    });

    it('should generate steps [R approve + redeem] for wcrETH redemption with non-EOA provider', async () => {
      const protocol = Protocol.getInstance(mockProvider);
      const steps = protocol.getRedeemCollateralSteps('wcrETH', Decimal.ONE, mockContractRedeemer);
      const numberOfSteps = 2;

      const firstStep = await steps.next();

      expect(firstStep.done).toBe(false);
      expect(firstStep.value?.type).toEqual({
        name: 'approve',
        token: 'R',
      });
      expect(firstStep.value?.stepNumber).toEqual(1);
      expect(firstStep.value?.numberOfSteps).toEqual(numberOfSteps);

      const secondStep = await steps.next();

      expect(secondStep.done).toBe(false);
      expect(secondStep.value?.type).toEqual({
        name: 'redeem',
      });
      expect(secondStep.value?.stepNumber).toEqual(2);
      expect(secondStep.value?.numberOfSteps).toEqual(numberOfSteps);

      const termination = await steps.next();

      expect(termination.done).toBe(true);
    });

    it('should throw an error if R token permit signature is not passed', async () => {
      const protocol = Protocol.getInstance(mockProvider);
      const steps = protocol.getRedeemCollateralSteps('wcrETH', Decimal.ONE, mockEoaRedeemer);

      (createPermitSignature as jest.Mock).mockResolvedValue(EMPTY_SIGNATURE);

      await steps.next();

      expect(() => steps.next()).rejects.toThrow('R permit signature is required');
    });
  });
});
