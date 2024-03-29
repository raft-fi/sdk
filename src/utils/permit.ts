import { Decimal } from '@tempusfinance/decimal';
import { AddressLike, Signature, Signer, ZeroAddress } from 'ethers';
import { ERC20PermitSignatureStruct } from '../typechain/PositionManager';
import { RaftConfig } from '../config';
import { Erc20PermitTokenContract, Token } from '../types';

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

export const EMPTY_PERMIT_SIGNATURE: ERC20PermitSignatureStruct = {
  token: ZeroAddress,
  value: 0,
  deadline: 0,
  v: 0,
  r: '0x0000000000000000000000000000000000000000000000000000000000000000',
  s: '0x0000000000000000000000000000000000000000000000000000000000000000',
};

export async function createPermitSignature(
  token: Token,
  signer: Signer,
  amount: Decimal,
  spender: AddressLike,
  tokenContract: Erc20PermitTokenContract,
): Promise<ERC20PermitSignatureStruct> {
  const resolvedSpender = await Promise.resolve(spender);
  const [signerAddress, spenderAddress, nonce, tokenAddress, tokenName] = await Promise.all([
    signer.getAddress(),
    typeof resolvedSpender === 'string' ? resolvedSpender : resolvedSpender.getAddress(),
    tokenContract.nonces(signer),
    tokenContract.getAddress(),
    tokenContract.name(),
  ]);

  const deadline = Math.floor(Date.now() / 1000) + PERMIT_DEADLINE_SHIFT;

  const decimals = RaftConfig.networkConfig.tokens[token].decimals;

  const domain = {
    name: tokenName,
    chainId: RaftConfig.networkId,
    version: '1',
    verifyingContract: tokenAddress,
  };
  const values = {
    owner: signerAddress,
    spender: spenderAddress,
    value: amount.toBigInt(Number(decimals)),
    nonce,
    deadline,
  };

  const signature = await signer.signTypedData(domain, TYPES, values);
  const { v, r, s } = Signature.from(signature);

  return {
    token: tokenAddress,
    value: amount.toBigInt(Number(decimals)),
    deadline,
    v,
    r,
    s,
  };
}
