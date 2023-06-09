import { Decimal } from '@tempusfinance/decimal';
import { Signature, Signer, ZeroAddress } from 'ethers';
import { ERC20PermitSignatureStruct } from '../typechain/PositionManager';
import { ERC20Permit } from '../typechain';
import { RaftConfig } from '../config';

const PERMIT_DEADLINE_SHIFT = 30 * 60; // 30 minutes

const TYPES = {
  Permit: [
    {
      name: 'owner',
      type: 'address',
    },
    {
      name: 'spender',
      type: 'address',
    },
    {
      name: 'value',
      type: 'uint256',
    },
    {
      name: 'nonce',
      type: 'uint256',
    },
    {
      name: 'deadline',
      type: 'uint256',
    },
  ],
};

export function createEmptyPermitSignature(): ERC20PermitSignatureStruct {
  return {
    token: ZeroAddress,
    value: 0,
    deadline: 0,
    v: 0,
    r: '0x0000000000000000000000000000000000000000000000000000000000000000',
    s: '0x0000000000000000000000000000000000000000000000000000000000000000',
  };
}

export async function createPermitSignature(
  signer: Signer,
  amount: Decimal,
  spenderAddress: string,
  tokenContract: ERC20Permit,
): Promise<ERC20PermitSignatureStruct> {
  const signerAddress = await signer.getAddress();
  const [nonce, tokenAddress, tokenName] = await Promise.all([
    tokenContract.nonces(signerAddress),
    tokenContract.getAddress(),
    tokenContract.name(),
  ]);

  const deadline = Math.floor(Date.now() / 1000) + PERMIT_DEADLINE_SHIFT;

  const domain = {
    name: tokenName,
    chainId: RaftConfig.networkId,
    version: '1',
    verifyingContract: tokenAddress,
  };
  const values = {
    owner: signerAddress,
    spender: spenderAddress,
    value: amount.toBigInt(Decimal.PRECISION),
    nonce,
    deadline,
  };

  const signature = await signer.signTypedData(domain, TYPES, values);
  const { v, r, s } = Signature.from(signature);

  return {
    token: tokenAddress,
    value: amount.toBigInt(Decimal.PRECISION),
    deadline,
    v,
    r,
    s,
  };
}
