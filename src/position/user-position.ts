import { Decimal } from '@tempusfinance/decimal';
import { Signer, ContractTransactionResponse, TransactionResponse, ethers } from 'ethers';
import { request, gql } from 'graphql-request';
import { getTokenAllowance } from '../allowance';
import { RaftConfig, SupportedCollateralTokens } from '../config';
import { PriceFeed } from '../price';
import {
  ERC20,
  PositionManager,
  ERC20Permit,
  ERC20Permit__factory,
  OneInchOneStepLeverageStETH__factory,
  OneInchOneStepLeverageStETH,
} from '../typechain';
import OneInchOneStepLeverageStETHABI from './../abi/OneInchOneStepLeverageStETH.json';
import { ERC20PermitSignatureStruct } from '../typechain/PositionManager';
import {
  CollateralToken,
  R_TOKEN,
  SwapRouter,
  Token,
  TransactionWithFeesOptions,
  UnderlyingCollateralToken,
} from '../types';
import {
  createEmptyPermitSignature,
  createPermitSignature,
  getPositionManagerContract,
  getTokenContract,
  isEoaAddress,
  isUnderlyingCollateralToken,
  isWrappableCappedCollateralToken,
  sendTransactionWithGasLimit,
} from '../utils';
import { PositionWithRunner } from './base';
import { SWAP_ROUTER_MAX_SLIPPAGE } from '../constants';

export interface ManagePositionStepType {
  name: 'whitelist' | 'approve' | 'permit' | 'manage';
  token?: Token;
}

export interface LeveragePositionStepType {
  name: 'whitelist' | 'approve' | 'permit' | 'leverage';
  token?: Token;
}

interface ManagePositionStepsPrefetch {
  isDelegateWhitelisted?: boolean;
  collateralTokenAllowance?: Decimal;
  collateralPermitSignature?: ERC20PermitSignatureStruct;
  rTokenAllowance?: Decimal;
  rPermitSignature?: ERC20PermitSignatureStruct;
}

interface LeveragePositionStepsPrefetch {
  isDelegateWhitelisted?: boolean;
  currentDebt?: Decimal;
  currentCollateral?: Decimal;
  collateralTokenAllowance?: Decimal;
  underlyingRate?: Decimal;
}

type WhitelistStep = {
  type: {
    name: 'whitelist';
  };
  stepNumber: number;
  numberOfSteps: number;
  action: () => Promise<TransactionResponse>;
};

type PermitStep = {
  type: {
    name: 'permit';
    token: Token;
  };
  stepNumber: number;
  numberOfSteps: number;
  action: () => Promise<ERC20PermitSignatureStruct>;
};

type ApproveStep = {
  type: {
    name: 'approve';
    token: Token;
  };
  stepNumber: number;
  numberOfSteps: number;
  action: () => Promise<TransactionResponse>;
};

export interface ManagePositionStep {
  type: ManagePositionStepType;
  stepNumber: number;
  numberOfSteps: number;
  action: () => Promise<TransactionResponse | ERC20PermitSignatureStruct>;
}

export interface LeveragePositionStep {
  type: LeveragePositionStepType;
  stepNumber: number;
  numberOfSteps: number;
  action: () => Promise<TransactionResponse | ERC20PermitSignatureStruct>;
}

interface UserPositionResponse {
  underlyingCollateralToken: string | null;
  principalCollateral: string | null;
}

const DEBT_CHANGE_TO_CLOSE = Decimal.MAX_DECIMAL.mul(-1);

/**
 * Options for managing a position.
 * @property collateralToken The collateral token to use for the operation.
 * @property frontendTag The frontend operator tag for the transaction.
 * @property approvalType The approval type for the collateral token or R token. Smart contract position owners have to
 * use `approve` since they don't support signing. Defaults to permit.
 */
export interface ManagePositionOptions<C extends CollateralToken> extends TransactionWithFeesOptions {
  collateralToken?: C;
  frontendTag?: string;
  approvalType?: 'permit' | 'approve';
}

/**
 * Options for leveraging a position.
 * @property collateralToken The collateral token to use for the operation.
 * @property frontendTag The frontend operator tag for the transaction.
 * @property approvalType The approval type for the collateral token. Smart contract position owners have to
 * use `approve` since they don't support signing. Defaults to permit.
 * @property swapRouter Swap router that swap will use for the operation
 */
export interface LeveragePositionOptions<C extends CollateralToken> extends TransactionWithFeesOptions {
  collateralToken?: C;
  frontendTag?: string;
  approvalType?: 'permit' | 'approve';
  swapRouter?: SwapRouter;
}

/**
 * Callbacks for managing a position.
 * @property onDelegateWhitelistingStart A callback that is called when the delegate whitelisting starts.
 * @property onDelegateWhitelistingEnd A callback that is called when the delegate whitelisting ends.
 * @property onApprovalStart A callback that is called when the collateral token or R approval starts.
 * @property onApprovalEnd A callback that is called when the approval ends.
 */
export interface ManagePositionCallbacks {
  onDelegateWhitelistingStart?: () => void;
  onDelegateWhitelistingEnd?: (error?: unknown) => void;
  onApprovalStart?: () => void;
  onApprovalEnd?: (error?: unknown) => void;
}

/**
 * A position with an attached signer that is the position's owner. This class is used for operations that modify the
 * position (e.g. managing collateral and debt). For read-only operations on the position, use the
 * {@link PositionWithAddress} class.
 */
export class UserPosition<T extends UnderlyingCollateralToken> extends PositionWithRunner {
  private user: Signer;
  private collateralTokens = new Map<CollateralToken, ERC20>();
  private positionManager: PositionManager;
  private rToken: ERC20Permit;

  /**
   * Fetches the position of a given user or returns null if the user does not have a position. Differs from the
   * constructor in that it fetches the underlying collateral token of the position and checks whether it is valid,
   * where it is required to know the position's underlying collateral token when calling the constructor.
   * @param user The signer of the position's owner.
   * @returns The position of the user or null.
   */
  public static async fromUser<C extends UnderlyingCollateralToken>(user: Signer): Promise<UserPosition<C> | null> {
    const query = gql`
      query getPosition($positionId: String!) {
        position(id: $positionId) {
          underlyingCollateralToken
          principalCollateral
        }
      }
    `;
    const variables = {
      positionId: (await user.getAddress()).toLowerCase(),
    };

    const response = await request<{ position: UserPositionResponse | null }>(
      RaftConfig.subgraphEndpoint,
      query,
      variables,
    );
    const underlyingCollateralTokenAddress = response.position?.underlyingCollateralToken;

    if (!underlyingCollateralTokenAddress) {
      return null;
    }

    const underlyingCollateralToken = RaftConfig.getTokenTicker(underlyingCollateralTokenAddress);

    if (underlyingCollateralToken === null || !isUnderlyingCollateralToken(underlyingCollateralToken)) {
      return null;
    }

    const principalCollateral = response.position?.principalCollateral
      ? Decimal.parse(BigInt(response.position.principalCollateral), 0n, Decimal.PRECISION)
      : null;

    const position = new UserPosition(user, underlyingCollateralToken);
    position.setPrincipalCollateral(principalCollateral);
    await position.fetch();

    return position;
  }

  /**
   * Creates a new representation of a position or a given user with given initial collateral and debt amounts.
   * @param user The signer of the position's owner.
   * @param underlyingCollateralToken The underlying collateral token.
   * @param collateral The collateral amount. Defaults to 0.
   * @param debt The debt amount. Defaults to 0.
   */
  public constructor(
    user: Signer,
    underlyingCollateralToken: T,
    collateral: Decimal = Decimal.ZERO,
    debt: Decimal = Decimal.ZERO,
  ) {
    super('', user, underlyingCollateralToken, collateral, debt);

    this.user = user;
    this.positionManager = getPositionManagerContract('base', RaftConfig.networkConfig.positionManager, user);
    this.rToken = ERC20Permit__factory.connect(RaftConfig.networkConfig.tokens[R_TOKEN].address, this.user);
  }

  /**
   * Manages the position's collateral and debt amounts by depositing or withdrawing from the position manager. Does not
   * fetch the position's collateral and debt amounts after the operation. In case of adding collateral more collateral,
   * it checks whether the collateral token allowance is sufficient and if not, it asks the user to approve the
   * collateral change.
   *
   * This method is used as a generic method for managing the position's collateral and debt amounts. For more specific
   * methods, use the {@link UserPosition.open}, {@link UserPosition.close}, {@link UserPosition.addCollateral},
   * {@link UserPosition.withdrawCollateral}, {@link UserPosition.borrow}, and {@link UserPosition.repayDebt}.
   * @param collateralChange The amount to change the collateral by. Positive values deposit collateral, negative values
   * withdraw collateral.
   *
   * For more granular control over the transaction, use {@link getManageSteps} instead.
   * @param collateralChange The amount of collateral to deposit. Positive values deposit collateral, negative values
   * withdraw it.
   * @param debtChange The amount to change the debt by. Positive values borrow debt, negative values repay debt.
   * @param options.maxFeePercentage The maximum fee percentage to pay for the operation. Defaults to 1 (100%).
   * @param options.collateralToken The collateral token to use for the operation. Defaults to the position's underlying
   * collateral token.
   * @param options.gasLimitMultiplier The multiplier for the gas limit of the transaction. Defaults to 1.
   * @param options.frontendTag The frontend operator tag for the transaction. Optional.
   * @param options.approvalType The approval type for the collateral token or R token. Smart contract position owners
   * have to use `approve` since they don't support signing. Defaults to permit.
   * @param options.onDelegateWhitelistingStart A callback that is called when the delegate whitelisting starts.
   * Optional.
   * @param options.onDelegateWhitelistingEnd A callback that is called when the delegate whitelisting ends. Optional.
   * @param options.onApprovalStart A callback that is called when the collateral token or R approval starts. If
   * approval is not needed, the callback will never be called. Optional.
   * @param options.onApprovalEnd A callback that is called when the approval ends. Optional.
   * @throws If the collateral change is negative and the collateral token is ETH.
   */
  public async manage(
    collateralChange: Decimal,
    debtChange: Decimal,
    options: ManagePositionOptions<SupportedCollateralTokens[T]> & ManagePositionCallbacks = {},
  ): Promise<void> {
    const { onDelegateWhitelistingStart, onDelegateWhitelistingEnd, onApprovalStart, onApprovalEnd, ...otherOptions } =
      options;

    const steps = this.getManageSteps(collateralChange, debtChange, otherOptions);
    let collateralPermitSignature: ERC20PermitSignatureStruct | undefined;

    for (let step = await steps.next(); !step.done; step = await steps.next(collateralPermitSignature)) {
      const { type: stepType, action } = step.value;

      switch (stepType.name) {
        case 'whitelist':
          onDelegateWhitelistingStart?.();
          break;

        case 'manage':
          break;

        default:
          onApprovalStart?.();
      }

      const result = await action();

      if (result instanceof TransactionResponse) {
        await result.wait();
        collateralPermitSignature = undefined;

        switch (stepType.name) {
          case 'whitelist':
            onDelegateWhitelistingEnd?.();
            break;

          case 'manage':
            break;

          default:
            onApprovalEnd?.();
        }
      } else {
        collateralPermitSignature = result;
      }
    }
  }

  /**
   * Returns the steps for managing the position's collateral and debt amounts. The steps are not dispatched
   * automatically and it is the caller's response to dispatch them. Each step contains the type of the step, the total
   * number of steps, and the action to perform. The action is either a transaction to dispatch or a function that
   * returns a permit signature for the collateral token or R token.
   * @param collateralChange The amount of change the collateral by. Positive values deposit collateral, negative values
   * withdraw it.
   * @param debtChange The amount to change the debt by. Positive values borrow debt, negative values repay debt.
   * @param options.maxFeePercentage The maximum fee percentage to pay for the operation. Defaults to 1 (100%).
   * @param options.collateralToken The collateral token to use for the operation. Defaults to the position's underlying
   * collateral token.
   * @param options.gasLimitMultiplier The multiplier for the gas limit of the transaction. Defaults to 1.
   * @param options.frontendTag The frontend operator tag for the transaction. Optional.
   * @param options.approvalType The approval type for the collateral token or R token. Smart contract position owners
   * have to use `approve` since they don't support signing. Defaults to permit.
   * @param options.isDelegateWhitelisted Whether the delegate is whitelisted for the position owner. If not provided,
   * it will be fetched automatically.
   * @param options.collateralTokenAllowance The collateral token allowance of the position owner for the position
   * manager. If not provided, it will be fetched automatically.
   * @param options.collateralPermitSignature The collateral token permit signature. If not provided, it will be asked
   * from the user.
   * @param options.rTokenAllowance The R token allowance of the position owner for the position manager. If not
   * provided, it will be fetched automatically.
   * @param options.rPermitSignature The R token permit signature. If not provided, it will be asked from the user.
   */
  public async *getManageSteps(
    collateralChange: Decimal,
    debtChange: Decimal,
    options: ManagePositionOptions<SupportedCollateralTokens[T]> & ManagePositionStepsPrefetch = {},
  ): AsyncGenerator<ManagePositionStep, void, ERC20PermitSignatureStruct | undefined> {
    const {
      maxFeePercentage = Decimal.ONE,
      gasLimitMultiplier = Decimal.ONE,
      frontendTag,
      approvalType = 'permit',
    } = options;
    let { collateralToken = this.underlyingCollateralToken as T } = options;

    // check whether it's closing position (i.e. collateralChange is ZERO while debtChange is -ve MAX)
    if (collateralChange.isZero() && !debtChange.equals(DEBT_CHANGE_TO_CLOSE)) {
      if (debtChange.isZero()) {
        throw Error('Collateral and debt change cannot be both zero');
      }

      // It saves gas by not using the delegate contract if the collateral token is not the underlying collateral token.
      // It does it by skipping the delegate whitelisting (if it is not whitelisted) and approving the R token.
      collateralToken = this.underlyingCollateralToken as T;
    }

    const absoluteCollateralChangeValue = collateralChange.abs().value;
    const isCollateralIncrease = collateralChange.gt(Decimal.ZERO);
    const absoluteDebtChangeValue = debtChange.abs().value;
    const isDebtIncrease = debtChange.gt(Decimal.ZERO);
    const maxFeePercentageValue = maxFeePercentage.value;
    const isUnderlyingToken = this.isUnderlyingCollateralToken(collateralToken);

    const whitelistingRequired = !isUnderlyingToken;
    const collateralTokenContract = getTokenContract(collateralToken, this.user);
    const collateralTokenAllowanceRequired = collateralTokenContract !== null && isCollateralIncrease;
    const rTokenAllowanceRequired = !isDebtIncrease && !isUnderlyingToken;
    const positionManagerAddress = RaftConfig.getPositionManagerAddress(
      this.underlyingCollateralToken,
      collateralToken,
    );
    const userAddress = await this.getUserAddress();

    const { collateralPermitSignature: cachedCollateralPermitSignature, rPermitSignature: cachedRPermitSignature } =
      options;
    let { isDelegateWhitelisted, collateralTokenAllowance, rTokenAllowance } = options;

    // In case the delegate whitelisting check is not passed externally, check the whitelist status
    if (isDelegateWhitelisted === undefined) {
      isDelegateWhitelisted = whitelistingRequired
        ? await this.isDelegateWhitelisted(positionManagerAddress, userAddress)
        : false;
    }

    // In case the collateral token allowance check is not passed externally, check the allowance
    if (collateralTokenAllowance === undefined) {
      collateralTokenAllowance = collateralTokenAllowanceRequired
        ? await getTokenAllowance(collateralTokenContract, userAddress, positionManagerAddress)
        : Decimal.MAX_DECIMAL;
    }

    // In case the R token allowance check is not passed externally, check the allowance
    if (rTokenAllowance === undefined) {
      rTokenAllowance = rTokenAllowanceRequired
        ? await getTokenAllowance(this.rToken, userAddress, positionManagerAddress)
        : Decimal.MAX_DECIMAL;
    }

    const isEoaPositionOwner = await isEoaAddress(userAddress, this.contractRunner);
    const canUsePermit = isEoaPositionOwner && approvalType === 'permit';
    const collateralTokenConfig = RaftConfig.networkConfig.tokens[collateralToken];
    const canCollateralTokenUsePermit = collateralTokenConfig.supportsPermit && canUsePermit;

    const whitelistingStepNeeded = whitelistingRequired && !isDelegateWhitelisted;
    const collateralApprovalStepNeeded =
      collateralTokenAllowanceRequired && // action needs collateral token allowance check
      collateralChange.gt(collateralTokenAllowance ?? Decimal.ZERO) && // current allowance is not enough
      (!canCollateralTokenUsePermit || !cachedCollateralPermitSignature); // approval step or signing a permit is needed
    const rTokenApprovalStepNeeded =
      rTokenAllowanceRequired && // action needs R token allowance check
      debtChange.abs().gt(rTokenAllowance ?? Decimal.ZERO) && // current allowance is not enough
      (!canUsePermit || !cachedRPermitSignature); // approval step or signing a permit is needed

    // The number of steps is the number of optional steps that are required based on input values plus one required
    // step (`manage`)
    const numberOfSteps =
      Number(whitelistingStepNeeded) + Number(collateralApprovalStepNeeded) + Number(rTokenApprovalStepNeeded) + 1;
    let stepCounter = 1;

    if (whitelistingStepNeeded) {
      yield* this.getWhitelistStep(positionManagerAddress, () => stepCounter++, numberOfSteps);
    }

    let collateralPermitSignature = createEmptyPermitSignature();
    let rPermitSignature = createEmptyPermitSignature();

    if (collateralApprovalStepNeeded) {
      collateralPermitSignature = yield* this.getApproveOrPermitStep(
        collateralToken,
        collateralTokenContract,
        collateralChange,
        positionManagerAddress,
        () => stepCounter++,
        numberOfSteps,
        canCollateralTokenUsePermit,
        cachedCollateralPermitSignature,
      );
    }

    if (rTokenApprovalStepNeeded) {
      rPermitSignature = yield* this.getApproveOrPermitStep(
        R_TOKEN,
        this.rToken,
        debtChange.abs(),
        positionManagerAddress,
        () => stepCounter++,
        numberOfSteps,
        canUsePermit,
        cachedRPermitSignature,
      );
    }

    if (isUnderlyingCollateralToken(collateralToken)) {
      yield {
        type: {
          name: 'manage',
        },
        stepNumber: stepCounter++,
        numberOfSteps,
        action: () =>
          sendTransactionWithGasLimit(
            this.positionManager.managePosition,
            [
              RaftConfig.getTokenAddress(collateralToken),
              userAddress,
              absoluteCollateralChangeValue,
              isCollateralIncrease,
              absoluteDebtChangeValue,
              isDebtIncrease,
              maxFeePercentageValue,
              collateralPermitSignature,
            ],
            gasLimitMultiplier,
            frontendTag,
            this.user,
          ),
      };
    } else if (
      isWrappableCappedCollateralToken(collateralToken) ||
      (collateralToken === 'stETH' && this.underlyingCollateralToken === 'wstETH')
    ) {
      const method = isWrappableCappedCollateralToken(collateralToken)
        ? getPositionManagerContract('wrapped', positionManagerAddress, this.user).managePosition
        : getPositionManagerContract('stETH', positionManagerAddress, this.user).managePositionStETH;

      yield {
        type: {
          name: 'manage',
        },
        stepNumber: stepCounter++,
        numberOfSteps,
        action: () =>
          sendTransactionWithGasLimit(
            method,
            [
              absoluteCollateralChangeValue,
              isCollateralIncrease,
              absoluteDebtChangeValue,
              isDebtIncrease,
              maxFeePercentageValue,
              rPermitSignature,
            ],
            gasLimitMultiplier,
            frontendTag,
            this.user,
          ),
      };
    } else {
      throw new Error(
        `Underlying collateral token ${this.underlyingCollateralToken} does not support collateral token ${collateralToken}`,
      );
    }
  }

  /**
   * Returns the steps for managing the leverage position's collateral and leverage multiplier. The steps are not dispatched
   * automatically and it is the caller's response to dispatch them. Each step contains the type of the step, the total
   * number of steps, and the action to perform. The action is either a transaction to dispatch or a function that
   * returns a permit signature for the collateral token.
   * @param actualPrincipalCollateralChange The amount of change the collateral by. Positive values deposit collateral, negative values
   * withdraw it.
   * @param leverage The leverage multiplier for the position.
   * @param options.maxFeePercentage The maximum fee percentage to pay for the operation. Defaults to 1 (100%).
   * @param options.collateralToken The collateral token to use for the operation. Defaults to the position's underlying
   * collateral token.
   * @param options.gasLimitMultiplier The multiplier for the gas limit of the transaction. Defaults to 1.
   * @param options.frontendTag The frontend operator tag for the transaction. Optional.
   * @param options.approvalType The approval type for the collateral token or R token. Smart contract position owners
   * have to use `approve` since they don't support signing. Defaults to permit.
   * @param swapRouter Swap router that swap will use for the operation
   * @param options.isDelegateWhitelisted Whether the delegate is whitelisted for the position owner. If not provided,
   * it will be fetched automatically.
   * @param options.collateralTokenAllowance The collateral token allowance of the position owner for the position
   * manager. If not provided, it will be fetched automatically.
   * @param options.collateralPermitSignature The collateral token permit signature. If not provided, it will be asked
   * from the user.
   */
  public async *getLeverageSteps(
    currentPrincipalCollateral: Decimal,
    principalCollateralChange: Decimal,
    leverage: Decimal,
    slippage: Decimal,
    options: LeveragePositionOptions<SupportedCollateralTokens[T]> & LeveragePositionStepsPrefetch = {},
  ): AsyncGenerator<LeveragePositionStep, void, ERC20PermitSignatureStruct | undefined> {
    if (!this.user.provider) {
      throw new Error('Provider not set, please set provider before calling this method');
    }
    console.log('\n=====\n');
    const {
      maxFeePercentage = Decimal.ONE,
      gasLimitMultiplier = Decimal.ONE,
      frontendTag,
      swapRouter = '1inch',
    } = options;
    const { collateralToken = this.underlyingCollateralToken as T } = options;

    let { isDelegateWhitelisted, collateralTokenAllowance, currentDebt, currentCollateral, underlyingRate } = options;

    const priceFeed = new PriceFeed(this.user.provider);
    if (!underlyingRate) {
      underlyingRate = await priceFeed.getUnderlyingCollateralRate(this.underlyingCollateralToken, collateralToken);
    }

    const actualPrincipalCollateralChange = principalCollateralChange.mul(Decimal.ONE.div(underlyingRate));

    const absolutePrincipalCollateralChangeValue = actualPrincipalCollateralChange.abs().value;
    const isPrincipalCollateralIncrease = actualPrincipalCollateralChange.gt(Decimal.ZERO);
    let debtChange = Decimal.ZERO;
    const isClosePosition = leverage.equals(1) && actualPrincipalCollateralChange.isZero();
    const collateralTokenContract = getTokenContract(collateralToken, this.user);
    const collateralTokenAllowanceRequired = collateralTokenContract !== null && isPrincipalCollateralIncrease;
    const userAddress = await this.getUserAddress();

    console.log(`underlyingCollateralToken: ${this.underlyingCollateralToken}`);
    console.log(`collateralToken: ${collateralToken}`);
    console.log(`underlyingRate: ${Decimal.ONE.div(underlyingRate)}`);
    console.log(`isPrincipalCollateralIncrease: ${isPrincipalCollateralIncrease}`);

    console.log(`absolutePrincipalCollateralChangeValue: ${actualPrincipalCollateralChange.abs().toString()}`);

    if (slippage.gt(SWAP_ROUTER_MAX_SLIPPAGE[swapRouter])) {
      throw new Error(
        `Slippage (${slippage.toTruncated(4)}) should not be greater than ${SWAP_ROUTER_MAX_SLIPPAGE[swapRouter]}`,
      );
    }

    if (!currentDebt) {
      // Make sure we have latest debt balance data before proceeding
      currentDebt = await this.fetchDebt();
    }
    if (!currentCollateral) {
      currentCollateral = await this.fetchCollateral();
    }

    console.log(`currentCollateral: ${currentCollateral.toString()}`);
    console.log(`currentPrincipalCollateral: ${currentPrincipalCollateral.toString()}`);
    console.log(`currentDebt: ${currentDebt.toString()}`);

    // In case the delegate whitelisting check is not passed externally, check the whitelist status
    if (isDelegateWhitelisted === undefined) {
      isDelegateWhitelisted = await this.isDelegateWhitelisted(
        RaftConfig.networkConfig.oneInchOneStepLeverageStEth,
        userAddress,
      );
    }

    // In case the collateral token allowance check is not passed externally, check the allowance
    if (collateralTokenAllowance === undefined) {
      if (collateralTokenAllowanceRequired) {
        collateralTokenAllowance = await getTokenAllowance(
          collateralTokenContract,
          userAddress,
          RaftConfig.networkConfig.oneInchOneStepLeverageStEth,
        );
      } else {
        collateralTokenAllowance = Decimal.MAX_DECIMAL;
      }
    }

    const whitelistingStepNeeded = !isDelegateWhitelisted;
    const collateralApprovalStepNeeded =
      collateralTokenAllowanceRequired && // action needs collateral token allowance check
      principalCollateralChange.gt(collateralTokenAllowance ?? Decimal.ZERO); // current allowance is not enough

    // The number of steps is the number of optional steps that are required based on input values plus one required
    // step (`leverage`)
    const numberOfSteps = Number(whitelistingStepNeeded) + Number(collateralApprovalStepNeeded) + 1;
    let stepCounter = 1;

    if (whitelistingStepNeeded) {
      yield* this.getWhitelistStep(
        RaftConfig.networkConfig.oneInchOneStepLeverageStEth,
        () => stepCounter++,
        numberOfSteps,
      );
    }

    if (collateralApprovalStepNeeded) {
      yield* this.getApproveOrPermitStep(
        collateralToken,
        collateralTokenContract,
        principalCollateralChange,
        RaftConfig.networkConfig.oneInchOneStepLeverageStEth,
        () => stepCounter++,
        numberOfSteps,
        false, // One step leverage doesn't support permit
      );
    }

    if (collateralToken === 'wstETH' || collateralToken === 'stETH') {
      const price = await priceFeed.getPrice(this.underlyingCollateralToken);

      // User is closing the position
      if (isClosePosition) {
        debtChange = Decimal.MAX_DECIMAL.mul(-1);
      }
      // User is opening the position
      else if (currentCollateral.isZero() && currentDebt.isZero()) {
        debtChange = actualPrincipalCollateralChange.mul(price).mul(leverage.sub(Decimal.ONE));
      }
      // User is adjusting the position
      else {
        const newTotalDebt = currentPrincipalCollateral
          .add(actualPrincipalCollateralChange)
          .mul(price)
          .mul(leverage.sub(Decimal.ONE));

        debtChange = newTotalDebt.sub(currentDebt);
      }
      console.log(`debtChange: ${debtChange.toString()}`);

      const isDebtIncrease = debtChange.gt(Decimal.ZERO);
      console.log(`isDebtIncrease: ${isDebtIncrease}`);

      const underlyingCollateralTokenAddress = RaftConfig.getTokenAddress(this.underlyingCollateralToken);
      const rAddress = RaftConfig.networkConfig.tokens['R'].address;

      let amountToSwap: Decimal;
      // User is closing the position
      if (isClosePosition) {
        // When closing the position, we do not need to set swap amount, contracts will calculate correct amount and inject it in ammData
        amountToSwap = Decimal.ONE;
      }
      // User is opening the position
      else if (currentCollateral.isZero() && currentDebt.isZero()) {
        amountToSwap = actualPrincipalCollateralChange.mul(price).mul(leverage.sub(1));
      }
      // User is adjusting the position
      else {
        if (isDebtIncrease) {
          amountToSwap = debtChange.abs();
        } else {
          amountToSwap = debtChange.abs().mul(Decimal.ONE.add(0.001)).div(price);
        }
      }

      const swapCalldata = await this.getSwapCallDataFrom1inch(
        isDebtIncrease ? rAddress : underlyingCollateralTokenAddress,
        isDebtIncrease ? underlyingCollateralTokenAddress : rAddress,
        amountToSwap,
        slippage,
      );

      console.log(`oneInch amountToSwap: ${amountToSwap.toString()}`);

      const functionSignatureToFromAmountOffset: { [key: string]: number } = {
        '0x12aa3caf': 164, // swap
        '0x0502b1c5': 36, // unoswap
        '0x84bd6d29': 100, // clipperSwap
        '0xe449022e': 4, // uniswapV3Swap
      };

      const swapFunctionSignature = swapCalldata.data.tx.data.substr(0, 10);

      const fromAmountOffset = functionSignatureToFromAmountOffset[swapFunctionSignature];

      const abi = new ethers.Interface(OneInchOneStepLeverageStETHABI);

      // TODO - Remove console logs once we finalize everything for OSL
      console.log(`fromAmountOffset: ${fromAmountOffset}`);
      console.log(`1InchData: ${swapCalldata.data.tx.data}`);
      const oneInchDataAmmData = abi
        .getAbiCoder()
        .encode(['uint256', 'bytes'], [fromAmountOffset, swapCalldata.data.tx.data]);

      const swapToTokenAmount = new Decimal(
        BigInt(swapCalldata.data.toTokenAmount),
        swapCalldata.data.toToken.decimals,
      );
      console.log(`swapCalldata.data.toTokenAmount: ${swapCalldata.data.toTokenAmount}`);
      console.log(`swapCalldata.data.toToken.decimals ${swapCalldata.data.toToken.decimals}`);
      // TODO: slippage already apply on 1inch swap. should not needed here or else user will lose more
      const minReturn = swapToTokenAmount.mul(Decimal.ONE.sub(slippage));
      console.log(`minReturn: ${minReturn.toString()}`);

      let collateralToSwap: Decimal;
      if (isClosePosition) {
        collateralToSwap = currentDebt.mul(Decimal.ONE.add(0.001)).div(price);
      } else {
        collateralToSwap = debtChange.abs().mul(Decimal.ONE.add(0.001)).div(price);
      }

      console.log(`collateralToSwap: ${collateralToSwap.toString()}`);

      yield {
        type: {
          name: 'leverage',
        },
        stepNumber: stepCounter++,
        numberOfSteps,
        // TODO: implement the actual leverage function
        action: () =>
          sendTransactionWithGasLimit(
            collateralToken === 'wstETH'
              ? this.loadOneStepLeverageStETH().manageLeveragedPosition // used for wstETH
              : this.loadOneStepLeverageStETH().manageLeveragedPositionStETH, // used to stETH
            [
              debtChange.abs().toBigInt(),
              isDebtIncrease,
              principalCollateralChange.abs().toBigInt(),
              isPrincipalCollateralIncrease,
              oneInchDataAmmData,
              isDebtIncrease ? minReturn.toBigInt() : collateralToSwap.toBigInt(),
              maxFeePercentage.toBigInt(),
            ],
            gasLimitMultiplier,
            frontendTag,
            this.user,
          ),
      };
    } else if (isWrappableCappedCollateralToken(collateralToken)) {
      // TODO - Add support for rETH (wrapped capped tokens)
      yield {
        type: {
          name: 'leverage',
        },
        stepNumber: stepCounter++,
        numberOfSteps,
        // TODO: implement the actual leverage function
        action: async () => {
          const dummyFunc = (
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            _absoluteCollateralChangeValue: bigint,
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            _isCollateralIncrease: boolean,
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            _leverage: Decimal,
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            _maxFeePercentageValue: bigint,
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            _gasLimitMultiplier: Decimal,
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            _frontendTag?: string,
          ) => false;
          dummyFunc(
            absolutePrincipalCollateralChangeValue,
            isPrincipalCollateralIncrease,
            leverage,
            maxFeePercentage.toBigInt(),
            gasLimitMultiplier,
            frontendTag,
          );
          return {} as TransactionResponse;
        },
      };
    } else {
      throw new Error(
        `Underlying collateral token ${this.underlyingCollateralToken} does not support collateral token ${collateralToken}`,
      );
    }
  }

  /**
   * Checks if delegate for a given collateral token is whitelisted for the position owner.
   * @param collateralToken Collateral token to check the whitelist for.
   * @returns True if the delegate is whitelisted or the collateral token is the position's underlying collateral token,
   * otherwise false.
   */
  public async isDelegateWhitelisted(delegateAddress: string, userAddress: string): Promise<boolean> {
    return await this.positionManager.isDelegateWhitelisted(userAddress, delegateAddress);
  }

  /**
   * Whitelists the delegate for a given collateral token. This is needed for the position owner to be able to open the
   * position for the first time or after the delegate has been removed from the whitelist. {@link managePosition}
   * handles the whitelisting automatically.
   * @param collateralToken The collateral token for which the delegate should be whitelisted.
   * @returns Transaction response if the whitelisting is needed, otherwise null.
   */
  public async whitelistDelegate(
    collateralToken: T | SupportedCollateralTokens[T],
  ): Promise<ContractTransactionResponse | null> {
    if (!this.isUnderlyingCollateralToken(collateralToken)) {
      return await this.positionManager.whitelistDelegate(
        RaftConfig.getPositionManagerAddress(this.underlyingCollateralToken, collateralToken),
        true,
      );
    }

    return null;
  }

  /**
   * Opens the position by depositing collateral and borrowing debt from the position manager. Does not fetch the
   * position's collateral and debt amounts after the operation. Checks whether the collateral token allowance is
   * sufficient and if not, it asks the user to approve the collateral change.
   * @param collateralAmount The amount of collateral to deposit. Must be greater than 0.
   * @param debtAmount The amount of debt to borrow. Must be greater than 0.
   * @param options.maxFeePercentage The maximum fee percentage to pay for the operation. Defaults to 1 (100%).
   * @param options.collateralToken The collateral token to use for the operation. Defaults to the position's underlying
   * collateral token.
   * @param options.gasLimitMultiplier The multiplier for the gas limit of the transaction. Defaults to 1.
   * @param options.frontendTag The frontend operator tag for the transaction. Optional.
   * @param options.approvalType The approval type for the collateral token or R token. Smart contract position owners
   * have to use `approve` since they don't support signing. Defaults to permit.
   * @param options.onDelegateWhitelistingStart A callback that is called when the delegate whitelisting starts.
   * Optional.
   * @param options.onDelegateWhitelistingEnd A callback that is called when the delegate whitelisting ends. Optional.
   * @param options.onApprovalStart A callback that is called when the collateral token or R approval starts. If
   * approval is not needed, the callback will never be called. Optional.
   * @param options.onApprovalEnd A callback that is called when the approval ends. Optional.
   * @throws An error if the collateral amount is less than or equal to 0.
   * @throws An error if the debt amount is less than or equal to 0.
   */
  public async open(
    collateralAmount: Decimal,
    debtAmount: Decimal,
    options: ManagePositionOptions<SupportedCollateralTokens[T]> & ManagePositionCallbacks = {},
  ): Promise<void> {
    if (collateralAmount.lte(Decimal.ZERO)) {
      throw new Error('Collateral amount must be greater than 0');
    }
    if (debtAmount.lte(Decimal.ZERO)) {
      throw new Error('Debt amount must be greater than 0');
    }

    this.manage(collateralAmount, debtAmount, options);
  }

  /**
   * Closes the position by withdrawing collateral and repaying debt to the position manager. Fetches the position's
   * collateral and debt amounts before the operation, but does not fetch them after.
   * @param options.maxFeePercentage The maximum fee percentage to pay for the operation. Defaults to 1 (100%).
   * @param options.collateralToken The collateral token to use for the operation. Defaults to the position's underlying
   * collateral token.
   * @param options.gasLimitMultiplier The multiplier for the gas limit of the transaction. Defaults to 1.
   * @param options.frontendTag The frontend operator tag for the transaction. Optional.
   * @param options.approvalType The approval type for the collateral token or R token. Smart contract position owners
   * have to use `approve` since they don't support signing. Defaults to permit.
   * @param options.onDelegateWhitelistingStart A callback that is called when the delegate whitelisting starts.
   * Optional.
   * @param options.onDelegateWhitelistingEnd A callback that is called when the delegate whitelisting ends. Optional.
   * @param options.onApprovalStart A callback that is called when the collateral token or R approval starts. If
   * approval is not needed, the callback will never be called. Optional.
   * @param options.onApprovalEnd A callback that is called when the approval ends. Optional.
   */
  public async close(
    options: ManagePositionOptions<SupportedCollateralTokens[T]> & ManagePositionCallbacks = {},
  ): Promise<void> {
    this.manage(Decimal.ZERO, DEBT_CHANGE_TO_CLOSE, options);
  }

  /**
   * Adds more collateral to the position by depositing it to the position manager. Does not fetch the position's
   * collateral and debt amounts after the operation. Checks whether the collateral token allowance is sufficient and if
   * not, it asks the user to approve the collateral change.
   * @param amount The amount of collateral to deposit. Must be greater than 0.
   * @param options.maxFeePercentage The maximum fee percentage to pay for the operation. Defaults to 1 (100%).
   * @param options.collateralToken The collateral token to use for the operation. Defaults to the position's underlying
   * collateral token.
   * @param options.gasLimitMultiplier The multiplier for the gas limit of the transaction. Defaults to 1.
   * @param options.frontendTag The frontend operator tag for the transaction. Optional.
   * @param options.approvalType The approval type for the collateral token or R token. Smart contract position owners
   * have to use `approve` since they don't support signing. Defaults to permit.
   * @param options.onDelegateWhitelistingStart A callback that is called when the delegate whitelisting starts.
   * Optional.
   * @param options.onDelegateWhitelistingEnd A callback that is called when the delegate whitelisting ends. Optional.
   * @param options.onApprovalStart A callback that is called when the collateral token or R approval starts. If
   * approval is not needed, the callback will never be called. Optional.
   * @param options.onApprovalEnd A callback that is called when the approval ends. Optional.
   * @throws An error if the amount is less than or equal to 0.
   */
  public async addCollateral(
    amount: Decimal,
    options: ManagePositionOptions<SupportedCollateralTokens[T]> & ManagePositionCallbacks = {},
  ): Promise<void> {
    if (amount.lte(Decimal.ZERO)) {
      throw new Error('Amount must be greater than 0.');
    }

    this.manage(amount, Decimal.ZERO, options);
  }

  /**
   * Removes collateral from the position by withdrawing it from the position manager. Does not fetch the position's
   * collateral and debt amounts after the operation.
   * @param amount The amount of collateral to withdraw. Must be greater than 0.
   * @param options.maxFeePercentage The maximum fee percentage to pay for the operation. Defaults to 1 (100%).
   * @param options.collateralToken The collateral token to use for the withdrawal. Defaults to the position's underlying
   * collateral token.
   * @param options.gasLimitMultiplier The multiplier for the gas limit of the transaction. Defaults to 1.
   * @param options.frontendTag The frontend operator tag for the transaction. Optional.
   * @param options.approvalType The approval type for the collateral token or R token. Smart contract position owners
   * have to use `approve` since they don't support signing. Defaults to permit.
   * @param options.onDelegateWhitelistingStart A callback that is called when the delegate whitelisting starts.
   * Optional.
   * @param options.onDelegateWhitelistingEnd A callback that is called when the delegate whitelisting ends. Optional.
   * @param options.onApprovalStart A callback that is called when the collateral token or R approval starts. If
   * approval is not needed, the callback will never be called. Optional.
   * @param options.onApprovalEnd A callback that is called when the approval ends. Optional.
   * @throws An error if the amount is less than or equal to 0.
   */
  public async withdrawCollateral(
    amount: Decimal,
    options: ManagePositionOptions<SupportedCollateralTokens[T]> & ManagePositionCallbacks = {},
  ): Promise<void> {
    if (amount.lte(Decimal.ZERO)) {
      throw new Error('Amount must be greater than 0.');
    }

    this.manage(amount.mul(-1), Decimal.ZERO, options);
  }

  /**
   * Borrows more debt from the position by borrowing it from the position manager. Does not fetch the position's
   * collateral and debt amounts after the operation.
   * @param amount The amount of debt to borrow. Must be greater than 0.
   * @param options.maxFeePercentage The maximum fee percentage to pay for the operation. Defaults to 1 (100%).
   * @param options.collateralToken The collateral token to use for the operation. Defaults to the position's underlying
   * collateral token.
   * @param options.gasLimitMultiplier The multiplier for the gas limit of the transaction. Defaults to 1.
   * @param options.frontendTag The frontend operator tag for the transaction. Optional.
   * @param options.approvalType The approval type for the collateral token or R token. Smart contract position owners
   * have to use `approve` since they don't support signing. Defaults to permit.
   * @param options.onDelegateWhitelistingStart A callback that is called when the delegate whitelisting starts.
   * Optional.
   * @param options.onDelegateWhitelistingEnd A callback that is called when the delegate whitelisting ends. Optional.
   * @param options.onApprovalStart A callback that is called when the collateral token or R approval starts. If
   * approval is not needed, the callback will never be called. Optional.
   * @param options.onApprovalEnd A callback that is called when the approval ends. Optional.
   * @throws An error if the amount is less than or equal to 0.
   */
  public async borrow(
    amount: Decimal,
    options: ManagePositionOptions<SupportedCollateralTokens[T]> & ManagePositionCallbacks = {},
  ): Promise<void> {
    if (amount.lte(Decimal.ZERO)) {
      throw new Error('Amount must be greater than 0.');
    }

    this.manage(Decimal.ZERO, amount, options);
  }

  /**
   * Repays debt to the position by repaying it to the position manager. Does not fetch the position's collateral and
   * debt amounts after the operation.
   * @param amount The amount of debt to repay. Must be greater than 0.
   * @param options.maxFeePercentage The maximum fee percentage to pay for the operation. Defaults to 1 (100%).
   * @param options.collateralToken The collateral token to use for the operation. Defaults to the position's underlying
   * collateral token.
   * @param options.gasLimitMultiplier The multiplier for the gas limit of the transaction. Defaults to 1.
   * @param options.frontendTag The frontend operator tag for the transaction. Optional.
   * @param options.approvalType The approval type for the collateral token or R token. Smart contract position owners
   * have to use `approve` since they don't support signing. Defaults to permit.
   * @param options.onDelegateWhitelistingStart A callback that is called when the delegate whitelisting starts.
   * Optional.
   * @param options.onDelegateWhitelistingEnd A callback that is called when the delegate whitelisting ends. Optional.
   * @param options.onApprovalStart A callback that is called when the collateral token or R approval starts. If
   * approval is not needed, the callback will never be called. Optional.
   * @param options.onApprovalEnd A callback that is called when the approval ends. Optional.
   * @throws An error if the amount is less than or equal to 0.
   */
  public async repayDebt(
    amount: Decimal,
    options: ManagePositionOptions<SupportedCollateralTokens[T]> & ManagePositionCallbacks = {},
  ): Promise<void> {
    if (amount.lte(Decimal.ZERO)) {
      throw new Error('Amount must be greater than 0.');
    }

    this.manage(Decimal.ZERO, amount.mul(-1), options);
  }

  /**
   * Returns the address of the owner of the position.
   * @returns The address of the owner.
   */
  public async getUserAddress(): Promise<string> {
    if (this.userAddress === '') {
      this.userAddress = await this.user.getAddress();
    }

    return this.userAddress;
  }

  private *getWhitelistStep(
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
      action: () => this.positionManager.whitelistDelegate(delegatorAddress, true),
    };
  }

  private loadOneStepLeverageStETH(): OneInchOneStepLeverageStETH {
    return OneInchOneStepLeverageStETH__factory.connect(
      RaftConfig.networkConfig.oneInchOneStepLeverageStEth,
      this.user,
    );
  }

  private *getSignTokenPermitStep(
    token: Token,
    tokenContract: ERC20Permit,
    approveAmount: Decimal,
    spenderAddress: string,
    getStepNumber: () => number,
    numberOfSteps: number,
    cachedSignature?: ERC20PermitSignatureStruct,
  ): Generator<PermitStep, ERC20PermitSignatureStruct, ERC20PermitSignatureStruct | undefined> {
    const signature =
      cachedSignature ??
      (yield {
        type: {
          name: 'permit' as const,
          token: token,
        },
        stepNumber: getStepNumber(),
        numberOfSteps,
        action: () => createPermitSignature(this.user, approveAmount, spenderAddress, tokenContract),
      });

    if (!signature) {
      throw new Error(`${token} permit signature is required`);
    }

    return signature;
  }

  private *getApproveTokenStep(
    token: Token,
    tokenContract: ERC20 | ERC20Permit,
    approveAmount: Decimal,
    spenderAddress: string,
    getStepNumber: () => number,
    numberOfSteps: number,
  ): Generator<ApproveStep, void, unknown> {
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

  private *getApproveOrPermitStep(
    token: Token,
    tokenContract: ERC20 | ERC20Permit,
    approveAmount: Decimal,
    spenderAddress: string,
    getStepNumber: () => number,
    numberOfSteps: number,
    canUsePermit: boolean,
    cachedPermitSignature?: ERC20PermitSignatureStruct,
  ): Generator<PermitStep | ApproveStep, ERC20PermitSignatureStruct, ERC20PermitSignatureStruct | undefined> {
    let permitSignature = createEmptyPermitSignature();

    if (canUsePermit) {
      permitSignature = yield* this.getSignTokenPermitStep(
        token,
        tokenContract,
        approveAmount,
        spenderAddress,
        getStepNumber,
        numberOfSteps,
        cachedPermitSignature,
      );
    } else {
      yield* this.getApproveTokenStep(
        token,
        tokenContract,
        approveAmount,
        spenderAddress,
        getStepNumber,
        numberOfSteps,
      );
    }

    return permitSignature;
  }
}
