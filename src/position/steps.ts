import { Decimal } from '@tempusfinance/decimal';
import { Signer, TransactionResponse } from 'ethers';
import { ERC20, ERC20Permit } from '../typechain';
import { Token } from '../types';
import { ERC20PermitSignatureStruct, PositionManager } from '../typechain/PositionManager';
import { createEmptyPermitSignature, createPermitSignature } from '../utils';

type WhitelistStep = {
  type: {
    name: 'whitelist';
  };
  stepNumber: number;
  numberOfSteps: number;
  action: () => Promise<TransactionResponse>;
};

type PermitStep<T extends Token> = {
  type: {
    name: 'permit';
    token: T;
  };
  stepNumber: number;
  numberOfSteps: number;
  action: () => Promise<ERC20PermitSignatureStruct>;
};

type ApproveStep<T extends Token> = {
  type: {
    name: 'approve';
    token: T;
  };
  stepNumber: number;
  numberOfSteps: number;
  action: () => Promise<TransactionResponse>;
};

export function* getWhitelistStep(
  positionManager: PositionManager,
  delegatorAddress: string,
  getStepNumber: () => number,
  numberOfSteps: number,
): Generator<WhitelistStep, void, unknown> {
  yield {
    type: {
      name: 'whitelist',
    },
    stepNumber: getStepNumber(),
    numberOfSteps,
    action: () => positionManager.whitelistDelegate(delegatorAddress, true),
  };
}

export function* getSignTokenPermitStep<T extends Token>(
  signer: Signer,
  token: T,
  tokenContract: ERC20Permit,
  approveAmount: Decimal,
  spenderAddress: string,
  getStepNumber: () => number,
  numberOfSteps: number,
  cachedSignature?: ERC20PermitSignatureStruct,
): Generator<PermitStep<T>, ERC20PermitSignatureStruct, ERC20PermitSignatureStruct | undefined> {
  const signature =
    cachedSignature ??
    (yield {
      type: {
        name: 'permit' as const,
        token: token,
      },
      stepNumber: getStepNumber(),
      numberOfSteps,
      action: () => createPermitSignature(signer, approveAmount, spenderAddress, tokenContract),
    });

  if (!signature) {
    throw new Error(`${token} permit signature is required`);
  }

  return signature;
}

export function* getApproveTokenStep<T extends Token>(
  token: T,
  tokenContract: ERC20 | ERC20Permit,
  approveAmount: Decimal,
  spenderAddress: string,
  getStepNumber: () => number,
  numberOfSteps: number,
): Generator<ApproveStep<T>, void, unknown> {
  yield {
    type: {
      name: 'approve' as const,
      token: token,
    },
    stepNumber: getStepNumber(),
    numberOfSteps,
    action: () => tokenContract.approve(spenderAddress, approveAmount.toBigInt(Decimal.PRECISION)),
  };
}

export function* getPermitOrApproveTokenStep<T extends Token>(
  signer: Signer,
  token: T,
  tokenContract: ERC20 | ERC20Permit,
  approveAmount: Decimal,
  spenderAddress: string,
  getStepNumber: () => number,
  numberOfSteps: number,
  canUsePermit: boolean,
  cachedPermitSignature?: ERC20PermitSignatureStruct,
): Generator<PermitStep<T> | ApproveStep<T>, ERC20PermitSignatureStruct, ERC20PermitSignatureStruct | undefined> {
  let permitSignature = createEmptyPermitSignature();

  if (canUsePermit) {
    permitSignature = yield* getSignTokenPermitStep(
      signer,
      token,
      tokenContract,
      approveAmount,
      spenderAddress,
      getStepNumber,
      numberOfSteps,
      cachedPermitSignature,
    );
  } else {
    yield* getApproveTokenStep(token, tokenContract, approveAmount, spenderAddress, getStepNumber, numberOfSteps);
  }

  return permitSignature;
}
