// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IStockRegistry} from "./interfaces/IStockRegistry.sol";
import {IERC8056} from "./interfaces/IERC8056.sol";
import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";
import {ShareMath} from "./libraries/ShareMath.sol";

/// @title StockRegistry
/// @notice Source of truth for "which tokens represent which stock, at what share ratio, and are they fresh".
/// @dev Roles:
///      - DEFAULT_ADMIN_ROLE (ADMIN): registers underlyings/representations, sets limits, confirms out-of-band ratios,
///        manages the swap-target allowlist. Deployer EOA for the hackathon; multisig + timelock in production.
///      - KEEPER_ROLE: posts ratios (bounded by maxRatioStepBps), reference prices (bounded by maxPriceStepBps),
///        attestation timestamps, market state. Step bounds are checked against the previous post *and* against
///        the value at the start of a rolling STEP_WINDOW, so a run of small posts cannot compound past the bound.
///      - GUARDIAN_ROLE: can pause buys only. Never sells, never in-kind redemption.
contract StockRegistry is AccessControl, IStockRegistry {
    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    address public immutable override usdt;

    uint64 public override maxAttestationAge = 36 hours;
    uint64 public override maxRatioAge = 12 hours;
    uint16 public override maxRatioStepBps = 500; // 5 %
    bool public override buysPaused;

    uint64 public override maxPriceAge = 36 hours; // stock feeds heartbeat daily and pause over weekends
    uint16 public maxPriceStepBps = 2_000; // 20 % per window for keeper-posted prices
    /// @notice Window over which keeper step bounds are anchored (see `_boundedStep`).
    uint64 public constant STEP_WINDOW = 1 days;

    struct StepAnchor {
        uint256 value;
        uint64 at;
    }

    /// @notice Hard ceiling on the protocol fee, so no admin action can make a trade unreasonable.
    uint16 public constant MAX_FEE_BPS = 100; // 1 %
    uint16 public feeBps;
    address public feeRecipient;

    mapping(bytes32 => Underlying) private _underlyings;
    bytes32[] private _underlyingIds;
    mapping(address => Representation) private _reps;
    mapping(bytes32 => address[]) private _repsOf;
    mapping(address => PostedRatio) private _posted; // KEEPER source: live value; ERC8056 source: last confirmed checkpoint
    mapping(bytes32 => uint64) private _attestedAt;
    mapping(bytes32 => MarketState) private _market;
    mapping(address => bool) private _allowedTargets;
    mapping(address => StepAnchor) private _ratioAnchor;
    mapping(bytes32 => ReferencePrice) private _refPrice; // keeper-posted fallback when no feed is set
    mapping(bytes32 => StepAnchor) private _priceAnchor;
    mapping(bytes32 => address) public priceFeedOf; // Chainlink AggregatorV3 per underlying (mainnet Mag 7)

    event UnderlyingSet(bytes32 indexed id, string ticker, bool active);
    event RepresentationSet(
        address indexed token, bytes32 indexed underlyingId, bytes32 indexed platformId, RatioSource source, bool active
    );
    event RatioPosted(address indexed token, uint256 ratio, uint64 updatedAt, bool adminConfirmed);
    event RatioRejected(address indexed token, uint256 attempted, uint256 last, uint256 stepBps);
    event AttestationPosted(bytes32 indexed platformId, uint64 attestedAt);
    event MarketStatePosted(bytes32 indexed underlyingId, bool open, uint64 updatedAt);
    event TargetAllowed(address indexed target, bool allowed);
    event LimitsSet(uint64 maxAttestationAge, uint64 maxRatioAge, uint16 maxRatioStepBps);
    event BuysPaused(bool paused);
    event FeeSet(uint16 feeBps, address indexed recipient);
    event ReferencePricePosted(bytes32 indexed underlyingId, uint256 priceUsd, uint64 updatedAt);
    event PriceRejected(bytes32 indexed underlyingId, uint256 attempted, uint256 last, uint256 stepBps);
    event PriceFeedSet(bytes32 indexed underlyingId, address indexed feed);
    event PriceLimitsSet(uint64 maxPriceAge, uint16 maxPriceStepBps);

    error UnknownUnderlying(bytes32 id);
    error UnknownRepresentation(address token);
    error AlreadyRegistered(address token);
    error ZeroRatio();
    error RatioStepTooLarge(uint256 stepBps, uint16 maxStepBps);
    error PriceStepTooLarge(uint256 stepBps, uint16 maxStepBps);
    error ZeroPrice();
    error BadLimits();
    error WrongRatioSource();
    error StaleTimestamp();
    error ZeroAddress();
    error FeeTooHigh(uint16 feeBps, uint16 maxFeeBps);

    constructor(address admin, address usdt_) {
        if (admin == address(0) || usdt_ == address(0)) revert ZeroAddress();
        usdt = usdt_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ------------------------------------------------------------------
    // Admin configuration
    // ------------------------------------------------------------------

    function setUnderlying(bytes32 id, string calldata ticker, bool active) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_underlyings[id].id == bytes32(0)) _underlyingIds.push(id);
        _underlyings[id] = Underlying({id: id, ticker: ticker, active: active});
        emit UnderlyingSet(id, ticker, active);
    }

    /// @notice Register a representation. `initialRatio` seeds the keeper ratio (KEEPER) or the checkpoint (ERC8056).
    function addRepresentation(
        address token,
        bytes32 underlyingId,
        bytes32 platformId,
        RatioSource source,
        uint256 initialRatio
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (token == address(0)) revert ZeroAddress();
        if (_underlyings[underlyingId].id == bytes32(0)) revert UnknownUnderlying(underlyingId);
        if (_reps[token].exists) revert AlreadyRegistered(token);
        if (initialRatio == 0) revert ZeroRatio();
        uint8 dec = IERC20Metadata(token).decimals();
        _reps[token] = Representation({
            token: token,
            underlyingId: underlyingId,
            platformId: platformId,
            decimals: dec,
            ratioSource: source,
            active: true,
            exists: true
        });
        _repsOf[underlyingId].push(token);
        _posted[token] = PostedRatio({ratio: initialRatio, updatedAt: uint64(block.timestamp)});
        _ratioAnchor[token] = StepAnchor({value: initialRatio, at: uint64(block.timestamp)});
        emit RepresentationSet(token, underlyingId, platformId, source, true);
        emit RatioPosted(token, initialRatio, uint64(block.timestamp), true);
    }

    /// @notice Activate / deprecate a representation. Deprecated reps stay sellable and countable.
    function setRepresentationActive(address token, bool active) external onlyRole(DEFAULT_ADMIN_ROLE) {
        Representation storage r = _reps[token];
        if (!r.exists) revert UnknownRepresentation(token);
        r.active = active;
        emit RepresentationSet(token, r.underlyingId, r.platformId, r.ratioSource, active);
    }

    function setAllowedTarget(address target, bool allowed) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (target == address(0)) revert ZeroAddress();
        _allowedTargets[target] = allowed;
        emit TargetAllowed(target, allowed);
    }

    /// @notice Set the protocol fee (bps of USDT notional on buys, sells, mints and USDT redemptions) and its
    ///         recipient. In-kind redemption and migrations never carry a fee. A zero recipient disables it.
    function setFee(uint16 feeBps_, address recipient) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh(feeBps_, MAX_FEE_BPS);
        feeBps = feeBps_;
        feeRecipient = recipient;
        emit FeeSet(feeBps_, recipient);
    }

    /// @inheritdoc IStockRegistry
    function fee() external view override returns (uint16 bps, address recipient) {
        return (feeRecipient == address(0) ? 0 : feeBps, feeRecipient);
    }

    function setLimits(uint64 maxAttestationAge_, uint64 maxRatioAge_, uint16 maxRatioStepBps_)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (maxRatioStepBps_ == 0 || maxRatioStepBps_ > 10_000) revert BadLimits();
        maxAttestationAge = maxAttestationAge_;
        maxRatioAge = maxRatioAge_;
        maxRatioStepBps = maxRatioStepBps_;
        emit LimitsSet(maxAttestationAge_, maxRatioAge_, maxRatioStepBps_);
    }

    function setPriceLimits(uint64 maxPriceAge_, uint16 maxPriceStepBps_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (maxPriceStepBps_ == 0 || maxPriceStepBps_ > 10_000) revert BadLimits();
        maxPriceAge = maxPriceAge_;
        maxPriceStepBps = maxPriceStepBps_;
        emit PriceLimitsSet(maxPriceAge_, maxPriceStepBps_);
    }

    /// @notice Point an underlying at a Chainlink USD feed; it then overrides keeper-posted prices. Zero clears it.
    function setPriceFeed(bytes32 underlyingId, address feed) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_underlyings[underlyingId].id == bytes32(0)) revert UnknownUnderlying(underlyingId);
        priceFeedOf[underlyingId] = feed;
        emit PriceFeedSet(underlyingId, feed);
    }

    /// @notice ADMIN override for a ratio outside the step bound (corporate action: split, reverse split).
    function confirmRatio(address token, uint256 ratio) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!_reps[token].exists) revert UnknownRepresentation(token);
        if (ratio == 0) revert ZeroRatio();
        _posted[token] = PostedRatio({ratio: ratio, updatedAt: uint64(block.timestamp)});
        _ratioAnchor[token] = StepAnchor({value: ratio, at: uint64(block.timestamp)});
        emit RatioPosted(token, ratio, uint64(block.timestamp), true);
    }

    // ------------------------------------------------------------------
    // Guardian
    // ------------------------------------------------------------------

    function setBuysPaused(bool paused) external onlyRole(GUARDIAN_ROLE) {
        buysPaused = paused;
        emit BuysPaused(paused);
    }

    // ------------------------------------------------------------------
    // Keeper
    // ------------------------------------------------------------------

    /// @notice Post a keeper ratio. Reverts if the step from the last value, or from the value at the start of
    ///         the current STEP_WINDOW, exceeds maxRatioStepBps.
    function postRatio(address token, uint256 ratio) external onlyRole(KEEPER_ROLE) {
        Representation storage r = _reps[token];
        if (!r.exists) revert UnknownRepresentation(token);
        if (r.ratioSource != RatioSource.KEEPER) revert WrongRatioSource();
        if (ratio == 0) revert ZeroRatio();
        uint256 last = _posted[token].ratio;
        uint256 step = _boundedStep(_ratioAnchor[token], last, ratio);
        if (step > maxRatioStepBps) {
            emit RatioRejected(token, ratio, last, step);
            revert RatioStepTooLarge(step, maxRatioStepBps);
        }
        _posted[token] = PostedRatio({ratio: ratio, updatedAt: uint64(block.timestamp)});
        emit RatioPosted(token, ratio, uint64(block.timestamp), false);
    }

    /// @notice Post the keeper's USD reference price for an underlying (ignored while a feed is set). Bounded
    ///         by maxPriceStepBps over STEP_WINDOW; the first post is unbounded.
    function postReferencePrice(bytes32 underlyingId, uint256 priceUsd) external onlyRole(KEEPER_ROLE) {
        if (_underlyings[underlyingId].id == bytes32(0)) revert UnknownUnderlying(underlyingId);
        if (priceUsd == 0) revert ZeroPrice();
        uint256 last = _refPrice[underlyingId].priceUsd;
        if (last != 0) {
            uint256 step = _boundedStep(_priceAnchor[underlyingId], last, priceUsd);
            if (step > maxPriceStepBps) {
                emit PriceRejected(underlyingId, priceUsd, last, step);
                revert PriceStepTooLarge(step, maxPriceStepBps);
            }
        } else {
            _priceAnchor[underlyingId] = StepAnchor({value: priceUsd, at: uint64(block.timestamp)});
        }
        _refPrice[underlyingId] = ReferencePrice({priceUsd: priceUsd, updatedAt: uint64(block.timestamp)});
        emit ReferencePricePosted(underlyingId, priceUsd, uint64(block.timestamp));
    }

    /// @notice Checkpoint an ERC-8056 token's live multiplier. Keeper-only: the checkpoint is what
    ///         isBuyEligible's corporate-action guard compares the live value against, so letting anyone
    ///         re-anchor it would let a buyer reset the guard in the same transaction. Bounded by the step
    ///         limit so a corporate-action jump keeps buys paused until ADMIN confirms via confirmRatio.
    function checkpointRatio(address token) external onlyRole(KEEPER_ROLE) {
        Representation storage r = _reps[token];
        if (!r.exists) revert UnknownRepresentation(token);
        if (r.ratioSource != RatioSource.ERC8056) revert WrongRatioSource();
        uint256 live = IERC8056(token).uiMultiplier();
        if (live == 0) revert ZeroRatio();
        uint256 last = _posted[token].ratio;
        uint256 step = _boundedStep(_ratioAnchor[token], last, live);
        if (step > maxRatioStepBps) {
            emit RatioRejected(token, live, last, step);
            revert RatioStepTooLarge(step, maxRatioStepBps);
        }
        _posted[token] = PostedRatio({ratio: live, updatedAt: uint64(block.timestamp)});
        emit RatioPosted(token, live, uint64(block.timestamp), false);
    }

    function postAttestation(bytes32 platformId, uint64 attestedAt_) external onlyRole(KEEPER_ROLE) {
        if (attestedAt_ > block.timestamp) revert StaleTimestamp();
        if (attestedAt_ < _attestedAt[platformId]) revert StaleTimestamp();
        _attestedAt[platformId] = attestedAt_;
        emit AttestationPosted(platformId, attestedAt_);
    }

    function postMarketState(bytes32 underlyingId, bool open) external onlyRole(KEEPER_ROLE) {
        if (_underlyings[underlyingId].id == bytes32(0)) revert UnknownUnderlying(underlyingId);
        _market[underlyingId] = MarketState({open: open, updatedAt: uint64(block.timestamp)});
        emit MarketStatePosted(underlyingId, open, uint64(block.timestamp));
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function isAllowedTarget(address target) external view override returns (bool) {
        return _allowedTargets[target];
    }

    function underlyingIds() external view returns (bytes32[] memory) {
        return _underlyingIds;
    }

    function getUnderlying(bytes32 id) external view returns (Underlying memory) {
        return _underlyings[id];
    }

    function representationsOf(bytes32 underlyingId) external view override returns (address[] memory) {
        return _repsOf[underlyingId];
    }

    function getRepresentation(address token) external view override returns (Representation memory) {
        return _reps[token];
    }

    function underlyingOf(address token) external view override returns (bytes32) {
        return _reps[token].underlyingId;
    }

    function platformOf(address token) external view override returns (bytes32) {
        return _reps[token].platformId;
    }

    function attestedAt(bytes32 platformId) external view override returns (uint64) {
        return _attestedAt[platformId];
    }

    function marketState(bytes32 underlyingId) external view override returns (MarketState memory) {
        return _market[underlyingId];
    }

    function postedRatio(address token) external view returns (PostedRatio memory) {
        return _posted[token];
    }

    /// @notice Live ratio. ERC8056 reads the token; KEEPER returns the posted value.
    function ratioOf(address token) public view override returns (uint256 ratio, uint64 updatedAt) {
        Representation storage r = _reps[token];
        if (!r.exists) revert UnknownRepresentation(token);
        if (r.ratioSource == RatioSource.ERC8056) {
            return (IERC8056(token).uiMultiplier(), uint64(block.timestamp));
        }
        PostedRatio storage p = _posted[token];
        return (p.ratio, p.updatedAt);
    }

    function sharesForTokens(address token, uint256 amount) external view override returns (uint256) {
        (uint256 ratio,) = ratioOf(token);
        return ShareMath.sharesForTokens(amount, ratio);
    }

    function tokensForShares(address token, uint256 shares) external view override returns (uint256) {
        (uint256 ratio,) = ratioOf(token);
        return ShareMath.tokensForShares(shares, ratio);
    }

    /// @notice Buy-eligible = registered, active, buys not paused, ratio fresh & within step of checkpoint,
    ///         platform attestation fresh.
    function isBuyEligible(address token) public view override returns (bool) {
        Representation storage r = _reps[token];
        if (!r.exists || !r.active || buysPaused) return false;
        if (block.timestamp - _attestedAt[r.platformId] > maxAttestationAge) return false;
        PostedRatio storage p = _posted[token];
        if (r.ratioSource == RatioSource.KEEPER) {
            return block.timestamp - p.updatedAt <= maxRatioAge;
        }
        // ERC8056: live must be within step of the last checkpoint (corporate-action guard).
        uint256 live = IERC8056(token).uiMultiplier();
        if (live == 0) return false;
        return ShareMath.stepBps(p.ratio, live) <= maxRatioStepBps;
    }

    /// @inheritdoc IStockRegistry
    function referencePrice(bytes32 underlyingId) external view override returns (uint256 priceUsd, uint64 updatedAt) {
        address feed = priceFeedOf[underlyingId];
        if (feed == address(0)) {
            ReferencePrice storage p = _refPrice[underlyingId];
            return (p.priceUsd, p.updatedAt);
        }
        (, int256 answer,, uint256 at,) = IAggregatorV3(feed).latestRoundData();
        if (answer <= 0) return (0, 0);
        uint8 dec = IAggregatorV3(feed).decimals();
        priceUsd = dec == 18 ? uint256(answer) : uint256(answer) * 1e18 / (10 ** dec);
        updatedAt = uint64(at);
    }

    /// @notice Selling out of any registered representation (even deprecated or stale) is always allowed.
    function isSellEligible(address token) external view override returns (bool) {
        return _reps[token].exists;
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    /// @dev Step of `next` in bps against both the previous value and the value at the start of the current
    ///      STEP_WINDOW (the anchor rolls forward to `previous` once the window has elapsed). Returns the larger
    ///      of the two so bounded posts cannot compound within a window.
    function _boundedStep(StepAnchor storage anchor, uint256 previous, uint256 next) internal returns (uint256 step) {
        if (block.timestamp >= anchor.at + STEP_WINDOW) {
            anchor.value = previous;
            anchor.at = uint64(block.timestamp);
        }
        step = ShareMath.stepBps(previous, next);
        uint256 windowStep = ShareMath.stepBps(anchor.value, next);
        if (windowStep > step) step = windowStep;
    }
}
