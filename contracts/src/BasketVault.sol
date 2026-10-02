// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IStockRegistry} from "./interfaces/IStockRegistry.sol";
import {IBasketVault} from "./interfaces/IBasketVault.sol";
import {ReceiptEmitter} from "./libraries/ReceiptEmitter.sol";
import {LegExecutor} from "./libraries/LegExecutor.sol";
import {ShareMath} from "./libraries/ShareMath.sol";

/// @title BasketVault
/// @notice ERC-20 basket whose unit is a fixed quantity of underlying *shares* per constituent.
///         Which issuer's token backs each constituent is decided by whoever mints or migrates, under invariants:
///           - Backing: heldShares(i) >= totalSupply * sharesPerUnit(i) / 1e18 for every i, after every call.
///           - Redeem in kind is always available: no pause, no oracle, no registry freshness required.
///           - Migrate is permissionless but can only strictly increase a constituent's shares.
///           - Issuer caps: no platform above maxIssuerBps of a constituent when >= 2 buy-eligible reps exist.
///         No price oracle is needed for mint/redeem; NAV is display-only offchain.
contract BasketVault is ERC20, ReentrancyGuard, IBasketVault, ReceiptEmitter {
    using SafeERC20 for IERC20;
    using LegExecutor for LegExecutor.Leg;

    uint8 public constant ACTION_MINT = 2;
    uint8 public constant ACTION_REDEEM = 3;
    uint8 public constant ACTION_MIGRATE = 4;
    uint16 public constant BPS = 10_000;
    uint256 internal constant WAD = 1e18;

    IStockRegistry public immutable registry;
    IERC20 public immutable usdt;

    Constituent[] private _constituents;
    mapping(bytes32 => uint256) private _constituentIndexPlusOne;

    event Minted(address indexed recipient, address indexed payer, uint256 units, uint256 usdtSpent, bytes32 quoteHash);
    event Redeemed(
        address indexed recipient, address indexed holder, uint256 units, uint256 usdtOut, bytes32 quoteHash
    );
    event RedeemedInKind(address indexed recipient, address indexed holder, uint256 units);
    event FeeCharged(bytes32 indexed quoteHash, address indexed recipient, uint256 fee);
    event Migrated(bytes32 indexed underlyingId, address indexed caller, uint256 shareGain, bytes32 quoteHash);

    error NoConstituents();
    error DuplicateConstituent(bytes32 underlyingId);
    error ZeroSharesPerUnit(bytes32 underlyingId);
    error BadIssuerCap(bytes32 underlyingId);
    error UnknownUnderlying(bytes32 underlyingId);
    error ZeroAmount();
    error ZeroAddress();
    error NoLegs();
    error UnderDelivered(bytes32 underlyingId, uint256 delivered, uint256 required);
    error InsufficientForFee(uint256 leftover, uint256 fee);
    error TargetNotAllowed(address target);
    error LegTokenInMustBeUsdt(address tokenIn);
    error LegTokenOutMustBeUsdt(address tokenOut);
    error LegTokenInNotHeld(address tokenIn);
    error LegExceedsProRata(address tokenIn, uint256 maxIn, uint256 remaining);
    error NotBuyEligible(address token);
    error NotAConstituent(address token);
    error WrongUnderlying(address token, bytes32 expected);
    error BackingViolated(bytes32 underlyingId, uint256 held, uint256 required);
    error IssuerCapExceeded(bytes32 underlyingId, bytes32 platformId, uint256 platformShares, uint256 held);
    error OverSpent(uint256 spent, uint256 maxUsdtIn);
    error InsufficientUsdtOut(uint256 usdtOut, uint256 minUsdtOut);
    error InsufficientShareGain(uint256 gain, uint256 minShareGain);
    error ConstituentDecreased(bytes32 underlyingId, uint256 before, uint256 after_);
    error UsdtDecreased(uint256 before, uint256 after_);
    error InsufficientUnits(uint256 have, uint256 want);
    error MigrateLegOutsideConstituent(address token);

    constructor(
        string memory name_,
        string memory symbol_,
        IStockRegistry registry_,
        Constituent[] memory constituents_
    ) ERC20(name_, symbol_) {
        if (constituents_.length == 0) revert NoConstituents();
        registry = registry_;
        usdt = IERC20(registry_.usdt());
        for (uint256 i = 0; i < constituents_.length; i++) {
            Constituent memory c = constituents_[i];
            if (c.sharesPerUnit == 0) revert ZeroSharesPerUnit(c.underlyingId);
            if (c.maxIssuerBps == 0 || c.maxIssuerBps > BPS) revert BadIssuerCap(c.underlyingId);
            if (_constituentIndexPlusOne[c.underlyingId] != 0) revert DuplicateConstituent(c.underlyingId);
            _constituents.push(c);
            _constituentIndexPlusOne[c.underlyingId] = i + 1;
        }
    }

    // ------------------------------------------------------------------
    // Mint
    // ------------------------------------------------------------------

    /// @inheritdoc IBasketVault
    /// @dev Every constituent must receive at least `units * sharesPerUnit / 1e18` shares from this call's legs
    ///      (audit F-1): the aggregate backing check alone would let a caller mint against slack other holders
    ///      built up, pay no fee, and skip the buy-eligibility gate with empty legs.
    function mint(
        uint256 units,
        uint256 maxUsdtIn,
        LegExecutor.Leg[] calldata legs,
        address recipient,
        bytes32 quoteHash
    ) external override nonReentrant returns (uint256 usdtSpent) {
        if (units == 0 || maxUsdtIn == 0) revert ZeroAmount();
        if (recipient == address(0)) revert ZeroAddress();
        if (legs.length == 0) revert NoLegs();

        usdt.safeTransferFrom(msg.sender, address(this), maxUsdtIn);
        uint256 usdtBefore = usdt.balanceOf(address(this));
        (uint256[] memory heldBefore, uint256[][] memory platformBefore) = _snapshotHoldings();

        for (uint256 i = 0; i < legs.length; i++) {
            LegExecutor.Leg memory leg = legs[i];
            if (!registry.isAllowedTarget(leg.target)) revert TargetNotAllowed(leg.target);
            if (leg.tokenIn != address(usdt)) revert LegTokenInMustBeUsdt(leg.tokenIn);
            if (!registry.isBuyEligible(leg.tokenOut)) revert NotBuyEligible(leg.tokenOut);
            bytes32 uid = registry.underlyingOf(leg.tokenOut);
            if (_constituentIndexPlusOne[uid] == 0) revert NotAConstituent(leg.tokenOut);

            (uint256 spent, uint256 received) = leg.execute();
            _emitReceipt(quoteHash, uid, address(usdt), spent, leg.tokenOut, received, ACTION_MINT);
        }

        usdtSpent = usdtBefore - usdt.balanceOf(address(this));
        if (usdtSpent > maxUsdtIn) revert OverSpent(usdtSpent, maxUsdtIn);

        _mint(recipient, units);
        _checkDelivered(units, heldBefore);
        _checkAllBacking();
        _checkAllIssuerCaps(heldBefore, platformBefore);

        // fee on the notional spent, out of the unspent remainder; the quote sizes maxUsdtIn to cover it
        uint256 refund = maxUsdtIn - usdtSpent;
        refund -= _chargeFee(usdtSpent, refund, quoteHash);
        if (refund > 0) usdt.safeTransfer(msg.sender, refund);

        emit Minted(recipient, msg.sender, units, usdtSpent, quoteHash);
    }

    // ------------------------------------------------------------------
    // Redeem
    // ------------------------------------------------------------------

    /// @inheritdoc IBasketVault
    function redeem(
        uint256 units,
        uint256 minUsdtOut,
        LegExecutor.Leg[] calldata legs,
        address recipient,
        bytes32 quoteHash
    ) external override nonReentrant returns (uint256 usdtOut) {
        if (units == 0) revert ZeroAmount();
        if (recipient == address(0)) revert ZeroAddress();
        uint256 have = balanceOf(msg.sender);
        if (have < units) revert InsufficientUnits(have, units);

        (address[] memory tokens, uint256[] memory remaining, uint256 usdtShare) =
            _proRataHoldings(units, totalSupply());
        _burn(msg.sender, units);

        uint256 usdtBefore = usdt.balanceOf(address(this));
        for (uint256 i = 0; i < legs.length; i++) {
            LegExecutor.Leg memory leg = legs[i];
            if (!registry.isAllowedTarget(leg.target)) revert TargetNotAllowed(leg.target);
            if (leg.tokenOut != address(usdt)) revert LegTokenOutMustBeUsdt(leg.tokenOut);
            uint256 j = _indexOfToken(tokens, leg.tokenIn);
            if (remaining[j] == 0) revert LegTokenInNotHeld(leg.tokenIn);
            if (leg.maxIn > remaining[j]) revert LegExceedsProRata(leg.tokenIn, leg.maxIn, remaining[j]);

            (uint256 spent, uint256 received) = leg.execute();
            remaining[j] -= spent;
            _emitReceipt(
                quoteHash,
                registry.underlyingOf(leg.tokenIn),
                leg.tokenIn,
                spent,
                address(usdt),
                received,
                ACTION_REDEEM
            );
        }

        usdtOut = (usdt.balanceOf(address(this)) - usdtBefore) + usdtShare;
        usdtOut -= _chargeFee(usdtOut, usdtOut, quoteHash); // minUsdtOut is net of the fee
        if (usdtOut < minUsdtOut) revert InsufficientUsdtOut(usdtOut, minUsdtOut);
        if (usdtOut > 0) usdt.safeTransfer(recipient, usdtOut);

        // Anything not sold by the legs goes out in kind: no dust trapped.
        for (uint256 j = 0; j < tokens.length; j++) {
            if (remaining[j] > 0) IERC20(tokens[j]).safeTransfer(recipient, remaining[j]);
        }

        emit Redeemed(recipient, msg.sender, units, usdtOut, quoteHash);
    }

    /// @dev Pay the registry's fee on `notional` out of `available`; returns the fee taken (0 when unset).
    ///      Only USDT flows carry it: shares, backing and in-kind redemption are never touched.
    function _chargeFee(uint256 notional, uint256 available, bytes32 quoteHash) internal returns (uint256 fee) {
        (uint16 bps, address to) = registry.fee();
        if (bps == 0) return 0;
        fee = (notional * bps) / 10_000;
        if (fee == 0) return 0;
        if (fee > available) revert InsufficientForFee(available, fee);
        usdt.safeTransfer(to, fee);
        emit FeeCharged(quoteHash, to, fee);
    }

    /// @inheritdoc IBasketVault
    function redeemInKind(uint256 units, address recipient) external override nonReentrant {
        _redeemInKind(units, recipient, new address[](0));
    }

    /// @notice Redeem in kind while skipping tokens the holder chooses to forfeit (e.g. an issuer-frozen
    ///         representation whose transfer reverts). Forfeited slices stay in the vault for remaining holders.
    function redeemInKindSkipping(uint256 units, address recipient, address[] calldata skip) external nonReentrant {
        _redeemInKind(units, recipient, skip);
    }

    function _redeemInKind(uint256 units, address recipient, address[] memory skip) internal {
        if (units == 0) revert ZeroAmount();
        if (recipient == address(0)) revert ZeroAddress();
        uint256 have = balanceOf(msg.sender);
        if (have < units) revert InsufficientUnits(have, units);

        (address[] memory tokens, uint256[] memory amounts, uint256 usdtShare) = _proRataHoldings(units, totalSupply());
        _burn(msg.sender, units);

        for (uint256 j = 0; j < tokens.length; j++) {
            if (amounts[j] == 0 || _contains(skip, tokens[j])) continue;
            IERC20(tokens[j]).safeTransfer(recipient, amounts[j]);
        }
        if (usdtShare > 0 && !_contains(skip, address(usdt))) usdt.safeTransfer(recipient, usdtShare);

        emit RedeemedInKind(recipient, msg.sender, units);
    }

    // ------------------------------------------------------------------
    // Migrate (permissionless, invariant-checked)
    // ------------------------------------------------------------------

    /// @inheritdoc IBasketVault
    function migrate(bytes32 underlyingId, LegExecutor.Leg[] calldata legs, uint256 minShareGain, bytes32 quoteHash)
        external
        override
        nonReentrant
        returns (uint256 shareGain)
    {
        uint256 idx = _constituentIndexPlusOne[underlyingId];
        if (idx == 0) revert UnknownUnderlying(underlyingId);
        idx -= 1;
        if (legs.length == 0) revert ZeroAmount();

        uint256 n = _constituents.length;
        uint256[] memory before = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            before[i] = heldShares(i);
        }
        uint256 usdtBefore = usdt.balanceOf(address(this));
        (uint256[] memory platformBefore,) = _platformSharesOf(idx);

        for (uint256 i = 0; i < legs.length; i++) {
            _runMigrateLeg(legs[i], underlyingId, quoteHash);
        }

        uint256 afterTarget = heldShares(idx);
        if (afterTarget <= before[idx]) revert InsufficientShareGain(0, minShareGain == 0 ? 1 : minShareGain);
        shareGain = afterTarget - before[idx];
        if (shareGain < minShareGain) revert InsufficientShareGain(shareGain, minShareGain);
        for (uint256 i = 0; i < n; i++) {
            if (i == idx) continue;
            uint256 a = heldShares(i);
            if (a < before[i]) revert ConstituentDecreased(_constituents[i].underlyingId, before[i], a);
        }
        uint256 usdtAfter = usdt.balanceOf(address(this));
        if (usdtAfter < usdtBefore) revert UsdtDecreased(usdtBefore, usdtAfter);
        _checkIssuerCap(idx, before[idx], platformBefore);
        _checkBacking(idx);

        emit Migrated(underlyingId, msg.sender, shareGain, quoteHash);
    }

    /// @dev One migration leg: tokenIn is vault USDT or any registered representation of *this* constituent;
    ///      tokenOut is USDT or a buy-eligible representation of it. Split out to keep `migrate`'s stack shallow.
    function _runMigrateLeg(LegExecutor.Leg memory leg, bytes32 underlyingId, bytes32 quoteHash) internal {
        if (!registry.isAllowedTarget(leg.target)) revert TargetNotAllowed(leg.target);
        if (leg.tokenIn != address(usdt)) {
            if (!registry.isSellEligible(leg.tokenIn) || registry.underlyingOf(leg.tokenIn) != underlyingId) {
                revert MigrateLegOutsideConstituent(leg.tokenIn);
            }
        }
        if (leg.tokenOut != address(usdt)) {
            if (!registry.isBuyEligible(leg.tokenOut)) revert NotBuyEligible(leg.tokenOut);
            if (registry.underlyingOf(leg.tokenOut) != underlyingId) {
                revert WrongUnderlying(leg.tokenOut, underlyingId);
            }
        }
        (uint256 spent, uint256 received) = leg.execute();
        _emitReceipt(quoteHash, underlyingId, leg.tokenIn, spent, leg.tokenOut, received, ACTION_MIGRATE);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function constituentCount() external view override returns (uint256) {
        return _constituents.length;
    }

    function constituent(uint256 i) external view returns (Constituent memory) {
        return _constituents[i];
    }

    function constituents() external view override returns (Constituent[] memory) {
        return _constituents;
    }

    /// @notice Shares of constituent `i` held across all registered representations (live ratios), rounded down.
    function heldShares(uint256 i) public view override returns (uint256) {
        return _heldSharesWad(i) / WAD;
    }

    /// @dev Shares held, 1e36-scaled (Σ balance × ratio) so the backing comparison carries no rounding at all:
    ///      summing per-representation floors could otherwise leave a vault a few wei "under-backed" after a
    ///      pro-rata burn, and the next exact mint would revert (found by the fuzz suite).
    function _heldSharesWad(uint256 i) internal view returns (uint256 total) {
        address[] memory reps = registry.representationsOf(_constituents[i].underlyingId);
        for (uint256 r = 0; r < reps.length; r++) {
            uint256 bal = IERC20(reps[r]).balanceOf(address(this));
            if (bal == 0) continue;
            (uint256 ratio,) = registry.ratioOf(reps[r]);
            total += bal * ratio;
        }
    }

    function requiredShares(uint256 i) public view returns (uint256) {
        return ShareMath.requiredShares(totalSupply(), _constituents[i].sharesPerUnit);
    }

    /// @notice Backing, checked exactly: Σ balance × ratio ≥ totalSupply × sharesPerUnit for every constituent.
    function backingOk() external view override returns (bool) {
        for (uint256 i = 0; i < _constituents.length; i++) {
            if (_heldSharesWad(i) < totalSupply() * _constituents[i].sharesPerUnit) return false;
        }
        return true;
    }

    /// @inheritdoc IBasketVault
    function composition() external view override returns (ConstituentView[] memory out) {
        uint256 n = _constituents.length;
        out = new ConstituentView[](n);
        for (uint256 i = 0; i < n; i++) {
            Constituent memory c = _constituents[i];
            address[] memory reps = registry.representationsOf(c.underlyingId);
            RepresentationView[] memory rv = new RepresentationView[](reps.length);
            uint256 held;
            for (uint256 r = 0; r < reps.length; r++) {
                uint256 bal = IERC20(reps[r]).balanceOf(address(this));
                uint256 sh = bal == 0 ? 0 : registry.sharesForTokens(reps[r], bal);
                held += sh;
                rv[r] = RepresentationView({
                    token: reps[r],
                    platformId: registry.platformOf(reps[r]),
                    tokens: bal,
                    shares: sh,
                    shareBps: 0,
                    buyEligible: registry.isBuyEligible(reps[r])
                });
            }
            for (uint256 r = 0; r < reps.length; r++) {
                rv[r].shareBps = held == 0 ? 0 : uint16(Math.mulDiv(rv[r].shares, BPS, held));
            }
            out[i] = ConstituentView({
                underlyingId: c.underlyingId,
                sharesPerUnit: c.sharesPerUnit,
                requiredShares: requiredShares(i),
                heldShares: held,
                maxIssuerBps: c.maxIssuerBps,
                representations: rv
            });
        }
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    function _checkAllBacking() internal view {
        for (uint256 i = 0; i < _constituents.length; i++) {
            _checkBacking(i);
        }
    }

    function _checkBacking(uint256 i) internal view {
        uint256 heldWad = _heldSharesWad(i);
        uint256 reqWad = totalSupply() * _constituents[i].sharesPerUnit;
        if (heldWad < reqWad) revert BackingViolated(_constituents[i].underlyingId, heldWad / WAD, requiredShares(i));
    }

    /// @dev Shares each constituent held and, per representation, the shares its platform held — taken before
    ///      a call's legs run so the call can be judged on what it changed rather than on the vault's history.
    function _snapshotHoldings() internal view returns (uint256[] memory held, uint256[][] memory platform) {
        uint256 n = _constituents.length;
        held = new uint256[](n);
        platform = new uint256[][](n);
        for (uint256 i = 0; i < n; i++) {
            (platform[i],) = _platformSharesOf(i);
            held[i] = _heldSharesWad(i);
        }
    }

    /// @dev Per representation of constituent `i` (in `representationsOf` order): the shares held across every
    ///      representation on the same platform. `held` is the constituent total.
    function _platformSharesOf(uint256 i) internal view returns (uint256[] memory ps, uint256 held) {
        address[] memory reps = registry.representationsOf(_constituents[i].underlyingId);
        uint256[] memory shares = new uint256[](reps.length);
        for (uint256 r = 0; r < reps.length; r++) {
            uint256 bal = IERC20(reps[r]).balanceOf(address(this));
            if (bal != 0) shares[r] = registry.sharesForTokens(reps[r], bal);
            held += shares[r];
        }
        ps = new uint256[](reps.length);
        for (uint256 r = 0; r < reps.length; r++) {
            bytes32 platform = registry.platformOf(reps[r]);
            for (uint256 k = 0; k < reps.length; k++) {
                if (registry.platformOf(reps[k]) == platform) ps[r] += shares[k];
            }
        }
    }

    /// @dev The legs of this call must have delivered every constituent's share of `units`, compared exactly
    ///      (`heldBefore` is 1e36-scaled, from `_snapshotHoldings`).
    function _checkDelivered(uint256 units, uint256[] memory heldBefore) internal view {
        for (uint256 i = 0; i < _constituents.length; i++) {
            uint256 deliveredWad = _heldSharesWad(i) - heldBefore[i];
            uint256 requiredWad = units * _constituents[i].sharesPerUnit;
            if (deliveredWad < requiredWad) {
                revert UnderDelivered(
                    _constituents[i].underlyingId,
                    deliveredWad / WAD,
                    ShareMath.requiredShares(units, _constituents[i].sharesPerUnit)
                );
            }
        }
    }

    function _checkAllIssuerCaps(uint256[] memory heldBefore, uint256[][] memory platformBefore) internal view {
        for (uint256 i = 0; i < _constituents.length; i++) {
            _checkIssuerCap(i, heldBefore[i] / WAD, platformBefore[i]); // snapshot is 1e36-scaled
        }
    }

    /// @dev Cap applies only when at least two representations are currently buy-eligible. A platform already
    ///      over the cap (concentration built while it was the only eligible one) does not brick the vault:
    ///      a call that adds to that platform must strictly lower its share of the constituent, so mints and
    ///      migrations that dilute it go through and the cap re-engages once it is met (audit F-4).
    function _checkIssuerCap(uint256 i, uint256 heldBefore, uint256[] memory platformBefore) internal view {
        Constituent memory c = _constituents[i];
        if (c.maxIssuerBps >= BPS) return;
        address[] memory reps = registry.representationsOf(c.underlyingId);
        uint256 eligible;
        for (uint256 r = 0; r < reps.length; r++) {
            if (registry.isBuyEligible(reps[r])) eligible++;
        }
        if (eligible < 2) return;
        (uint256[] memory ps, uint256 held) = _platformSharesOf(i);
        if (held == 0) return;
        uint256 limit = Math.mulDiv(held, c.maxIssuerBps, BPS);
        for (uint256 r = 0; r < reps.length; r++) {
            if (ps[r] <= limit) continue;
            // exact ratio comparison (ps[r] / held >= platformBefore[r] / heldBefore), not bps-floored values:
            // rounding could otherwise let the concentration creep up over many small calls
            bool worsened =
                heldBefore == 0 || (ps[r] > platformBefore[r] && ps[r] * heldBefore >= platformBefore[r] * held);
            if (worsened) revert IssuerCapExceeded(c.underlyingId, registry.platformOf(reps[r]), ps[r], held);
        }
    }

    /// @dev All representation tokens across constituents with the pro-rata slice for `units`, plus USDT slice.
    function _proRataHoldings(uint256 units, uint256 supply)
        internal
        view
        returns (address[] memory tokens, uint256[] memory amounts, uint256 usdtShare)
    {
        uint256 count;
        uint256 n = _constituents.length;
        address[][] memory lists = new address[][](n);
        for (uint256 i = 0; i < n; i++) {
            lists[i] = registry.representationsOf(_constituents[i].underlyingId);
            count += lists[i].length;
        }
        tokens = new address[](count);
        amounts = new uint256[](count);
        uint256 k;
        for (uint256 i = 0; i < n; i++) {
            for (uint256 r = 0; r < lists[i].length; r++) {
                tokens[k] = lists[i][r];
                amounts[k] = ShareMath.proRata(IERC20(lists[i][r]).balanceOf(address(this)), units, supply);
                k++;
            }
        }
        usdtShare = ShareMath.proRata(usdt.balanceOf(address(this)), units, supply);
    }

    function _indexOfToken(address[] memory tokens, address token) internal pure returns (uint256) {
        for (uint256 j = 0; j < tokens.length; j++) {
            if (tokens[j] == token) return j;
        }
        revert LegTokenInNotHeld(token);
    }

    function _contains(address[] memory list, address a) internal pure returns (bool) {
        for (uint256 j = 0; j < list.length; j++) {
            if (list[j] == a) return true;
        }
        return false;
    }

    function _emitReceipt(
        bytes32 quoteHash,
        bytes32 underlyingId,
        address tokenIn,
        uint256 amountIn,
        address tokenOut,
        uint256 amountOut,
        uint8 action
    ) internal {
        bool sellLeg = tokenOut == address(usdt);
        _emitRouteReceipt(
            registry,
            Receipt({
                quoteHash: quoteHash,
                underlyingId: underlyingId,
                tokenIn: tokenIn,
                amountIn: amountIn,
                representation: sellLeg ? tokenIn : tokenOut,
                tokensOut: sellLeg ? amountIn : amountOut,
                action: action
            })
        );
    }
}
