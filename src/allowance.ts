import { Provider } from 'ethers';
import { Decimal } from '@tempusfinance/decimal';
import { Token } from './types';
import { ERC20, ERC20Permit } from './typechain';
import { getTokenContract } from './utils';

/**
 * Fetches and returns token allowance. In case of `null` token contract, returns infinity (`Decimal.MAX_DECIMAL`).
 * @param tokenContract Token contract to check allowance for.
 * @param walletAddress Wallet to check allowance for.
 * @param spender Address to which allowance belongs.
 * @returns Token allowance.
 */
export async function getTokenAllowance(
  tokenContract: ERC20 | ERC20Permit | null,
  walletAddress: string,
  spender: string,
): Promise<Decimal> {
  return tokenContract !== null
    ? new Decimal(await tokenContract.allowance(walletAddress, spender), Decimal.PRECISION)
    : Decimal.MAX_DECIMAL;
}

export class Allowance {
  protected readonly token: Token;

  private allowance: Decimal | null = null;
  private walletAddress: string;
  private spender: string;
  private provider: Provider;
  private tokenContract: ERC20Permit | ERC20 | null;

  /**
   * Creates a new representation of an allowance.
   * @param token The token for the allowance.
   * @param walletAddress Wallet to check allowance for.
   * @param spender Address to which allowance belongs.
   * @param provider: Provider to use for data fetching.
   */
  public constructor(token: Token, walletAddress: string, spender: string, provider: Provider) {
    this.token = token;
    this.walletAddress = walletAddress;
    this.spender = spender;
    this.provider = provider;
    this.tokenContract = getTokenContract(this.token, this.provider);
  }

  /**
   * Fetches and returns token allowance.
   */
  public async fetchAllowance(): Promise<Decimal | null> {
    this.allowance = await getTokenAllowance(this.tokenContract, this.walletAddress, this.spender);

    return this.allowance;
  }
}
