import { Decimal } from '@tempusfinance/decimal';
import { MIN_COLLATERAL_RATIO, MIN_NET_DEBT } from '../constants';
import { ContractRunner } from 'ethers';
import { CollateralToken, UnderlyingCollateralToken } from '../types';
import { ERC20Indexable, ERC20Indexable__factory } from '../typechain';
import { RaftConfig } from '../config';
import request, { gql } from 'graphql-request';

export type PositionTransactionType = 'OPEN' | 'ADJUST' | 'CLOSE' | 'LIQUIDATION';

interface PositionTransactionQuery {
  id: string;
  type: PositionTransactionType;
  collateralToken: string | null;
  collateralChange: string | null;
  underlyingCollateralToken: string;
  underlyingCollateralChange: string;
  debtChange: string;
  timestamp: string;
}

interface PositionTransactionsQuery {
  position: {
    transactions: PositionTransactionQuery[];
  } | null;
}

/**
 * Represents a position transaction.
 * @property id The transaction hash.
 * @property type The type of the transaction.
 * @property collateralToken The collateral token ticker.
 * @property collateralChange The collateral change amount.
 * @property debtChange The debt change amount.
 * @property timestamp The timestamp of the transaction.
 */
export interface PositionTransaction {
  id: string;
  type: PositionTransactionType;
  collateralToken: CollateralToken | null;
  collateralChange: Decimal | null;
  underlyingCollateralToken: UnderlyingCollateralToken;
  underlyingCollateralChange: Decimal;
  debtChange: Decimal;
  timestamp: Date;
}

/**
 * Represents a position without direct contact to any opened position. It is used for calculations (e.g. collateral
 * ratio) that do not require reading data from blockchain. It is also used as a base class for other position classes,
 * like {@link PositionWithAddress} (read-only operations) and {@link UserPosition} (full managing access to
 * positions).
 */
export class Position {
  private collateral: Decimal;
  private debt: Decimal;

  /**
   * Creates a new representation of a position.
   * @param collateral The collateral amount. Defaults to 0.
   * @param debt The debt amount. Defaults to 0.
   */
  public constructor(collateral: Decimal = Decimal.ZERO, debt: Decimal = Decimal.ZERO) {
    this.checkNonNegativeAmount(collateral);
    this.checkNonNegativeAmount(debt);

    this.collateral = collateral;
    this.debt = debt;
  }

  /**
   * Sets the collateral amount of the position.
   * @param collateral The collateral amount.
   */
  public setCollateral(collateral: Decimal): void {
    this.checkNonNegativeAmount(collateral);
    this.collateral = collateral;
  }

  /**
   * Returns the collateral amount of the position.
   * @returns The collateral amount.
   */
  public getCollateral(): Decimal {
    return this.collateral;
  }

  /**
   * Sets the debt amount of the position.
   * @param debt The debt amount.
   */
  public setDebt(debt: Decimal): void {
    this.checkNonNegativeAmount(debt);
    this.debt = debt;
  }

  /**
   * Returns the debt amount of the position.
   * @returns The debt amount.
   */
  public getDebt(): Decimal {
    return this.debt;
  }

  /**
   * Returns the collateral ratio of the position for a given price.
   * @param collateralPrice The price of the collateral asset.
   * @returns The collateral ratio. If the debt is 0, returns the maximum decimal value (represents infinity).
   */
  public getCollateralRatio(collateralPrice: Decimal): Decimal {
    if (this.debt.equals(Decimal.ZERO)) {
      return Decimal.MAX_DECIMAL;
    }

    return this.collateral.mul(collateralPrice).div(this.debt);
  }

  /**
   * Returns true if the collateral ratio of the position is below the minimum collateral ratio.
   * @param price The price of the collateral asset.
   * @returns True if the collateral ratio is below the minimum collateral ratio.
   */
  public isCollateralRatioBelowMinimum(price: Decimal): boolean {
    return this.getCollateralRatio(price).lt(MIN_COLLATERAL_RATIO);
  }

  /**
   * Returns the position's liquidation price limit under which the position can be liquidated.
   * @returns The liquidation price limit.
   */
  public getLiquidationPriceLimit(): Decimal {
    return MIN_COLLATERAL_RATIO.mul(this.debt).div(this.collateral);
  }

  /**
   * Returns whether the position is valid. A position is valid if it is either closed or if it has a positive debt
   * amount greater than or equal to the minimum net debt and has a healthy collateral ratio.
   * @param collateralPrice The price of the collateral asset.
   * @returns True if the position is valid, false otherwise.
   */
  public isValid(collateralPrice: Decimal): boolean {
    if (!this.isOpened) {
      return true;
    }

    return this.debt.gte(MIN_NET_DEBT) && this.getCollateralRatio(collateralPrice).gte(MIN_COLLATERAL_RATIO);
  }

  /**
   * Returns whether the position is opened. A position is opened if it has a positive collateral and debt amount.
   * @returns True if the position is opened, false otherwise.
   */
  public get isOpened(): boolean {
    return this.collateral.gt(Decimal.ZERO) && this.debt.gt(Decimal.ZERO);
  }

  private checkNonNegativeAmount(amount: Decimal): void {
    if (amount.lt(Decimal.ZERO)) {
      throw new Error('Amount cannot be negative');
    }
  }
}

export class PositionWithRunner extends Position {
  protected readonly contractRunner: ContractRunner;
  protected userAddress: string;
  protected readonly underlyingCollateralToken: UnderlyingCollateralToken;

  private readonly indexCollateralToken: ERC20Indexable;
  private readonly indexDebtToken: ERC20Indexable;

  /**
   * Creates a new representation of a position with attached address and given initial collateral and debt amounts.
   * @param userAddress The address of the owner of the position.
   * @param contractRunner The blockchain contract runner (either provider or signer).
   * @param underlyingCollateralToken The underlying collateral token.
   * @param collateral The collateral amount. Defaults to 0.
   * @param debt The debt amount. Defaults to 0.
   */
  public constructor(
    userAddress: string,
    contractRunner: ContractRunner,
    underlyingCollateralToken: UnderlyingCollateralToken,
    collateral: Decimal = Decimal.ZERO,
    debt: Decimal = Decimal.ZERO,
  ) {
    super(collateral, debt);

    this.contractRunner = contractRunner;
    this.userAddress = userAddress;
    this.underlyingCollateralToken = underlyingCollateralToken;
    this.indexCollateralToken = ERC20Indexable__factory.connect(
      RaftConfig.networkConfig.raftCollateralTokens[underlyingCollateralToken],
      contractRunner,
    );
    this.indexDebtToken = ERC20Indexable__factory.connect(
      RaftConfig.networkConfig.raftDebtTokens[underlyingCollateralToken],
      contractRunner,
    );
  }

  /**
   * Fetches the collateral and debt amounts of the position from the blockchain.
   */
  public async fetch(): Promise<void> {
    const collateral = this.fetchCollateral();
    const debt = this.fetchDebt();
    await Promise.all([collateral, debt]);
  }

  /**
   * Returns the underlying collateral token of the position.
   * @returns The underlying collateral token.
   */
  public getUnderlyingCollateralToken(): UnderlyingCollateralToken {
    return this.underlyingCollateralToken;
  }

  /**
   * Fetches the list of transactions of the position.
   * @returns The list of transactions.
   */
  public async getTransactions(): Promise<PositionTransaction[]> {
    const query = gql`
      query GetTransactions($ownerAddress: String!) {
        position(id: $ownerAddress) {
          transactions(orderBy: timestamp, orderDirection: desc) {
            id
            type
            collateralToken
            collateralChange
            underlyingCollateralToken
            underlyingCollateralChange
            debtChange
            timestamp
          }
        }
      }
    `;

    const userAddress = await this.getUserAddress();
    const response = await request<PositionTransactionsQuery>(RaftConfig.subgraphEndpoint, query, {
      ownerAddress: userAddress.toLowerCase(),
    });

    if (!response.position?.transactions) {
      return [];
    }

    return response.position.transactions.map(transaction => ({
      ...transaction,
      collateralToken: transaction.collateralToken
        ? (RaftConfig.getTokenTicker(transaction.collateralToken) as CollateralToken)
        : null,
      collateralChange: transaction.collateralChange
        ? Decimal.parse(BigInt(transaction.collateralChange), 0n, Decimal.PRECISION)
        : null,
      underlyingCollateralToken: RaftConfig.getTokenTicker(
        transaction.underlyingCollateralToken,
      ) as UnderlyingCollateralToken,
      underlyingCollateralChange: Decimal.parse(BigInt(transaction.underlyingCollateralChange), 0n, Decimal.PRECISION),
      debtChange: Decimal.parse(BigInt(transaction.debtChange), 0n, Decimal.PRECISION),
      timestamp: new Date(Number(transaction.timestamp) * 1000),
    }));
  }

  /**
   * Returns the address of the owner of the position.
   * @returns The address of the owner.
   */
  public async getUserAddress(): Promise<string> {
    return this.userAddress;
  }

  protected isUnderlyingCollateralToken(collateralToken: CollateralToken): boolean {
    return this.underlyingCollateralToken === collateralToken;
  }

  public async fetchCollateral(): Promise<Decimal> {
    const userAddress = await this.getUserAddress();
    const collateral = await this.indexCollateralToken.balanceOf(userAddress);
    this.setCollateral(new Decimal(collateral, Decimal.PRECISION));

    return this.getCollateral();
  }

  public async fetchDebt(): Promise<Decimal> {
    const userAddress = await this.getUserAddress();
    const debt = await this.indexDebtToken.balanceOf(userAddress);
    this.setDebt(new Decimal(debt, Decimal.PRECISION));

    return this.getDebt();
  }
}
