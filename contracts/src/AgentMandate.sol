// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IShareRouter} from "./interfaces/IShareRouter.sol";
import {IBasketVault} from "./interfaces/IBasketVault.sol";
import {IStockRegistry} from "./interfaces/IStockRegistry.sol";
import {LegExecutor} from "./libraries/LegExecutor.sol";

/// @title AgentMandate
/// @notice A wallet owner authorizes an agent key to buy stocks or mint baskets on their behalf within hard limits.
///         Output assets always go to the owner. USDG is pulled from the owner (prior approval to this contract).
///         Revocation is instant. Daily cap uses a 24h window that starts at the first spend of the window.
/// @dev The caps bound how much USDG the agent can move; `maxSlippageBps` bounds what it must be worth coming
///      back (audit F-2). The floor is computed from the registry's reference price (Chainlink feed on mainnet,
///      keeper-posted elsewhere), so an agent cannot pass a dust `minShares`/`units` and route the swap output
///      to itself through the leg calldata. A stale or missing price blocks agent buys only — never the owner's
///      own trades or exits.
contract AgentMandate is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Mandate {
        address owner;
        address agent;
        uint128 perTxCapUsdg;
        uint128 dailyCapUsdg;
        uint64 expiry;
        bool active;
        uint128 spentInWindow;
        uint64 windowStart;
        uint16 maxSlippageBps; // worst execution vs the reference price the agent may accept, incl. fees
    }

    uint256 public constant BPS = 10_000;
    /// @notice Owners cannot hand an agent more than this much room below the reference price.
    uint16 public constant MAX_SLIPPAGE_BPS = 2_000; // 20 %
    uint256 internal constant WAD = 1e18;

    IShareRouter public immutable router;
    IStockRegistry public immutable registry;
    IERC20 public immutable usdg;
    /// @notice Lifts a USDG amount to 1e18-scaled USD: 1e12 for 6-decimal USDG. Reference prices are 1e18 USD
    ///         per share, so the floors would be off by this factor without it.
    uint256 public immutable quoteScale;

    uint256 public nextId = 1;
    mapping(uint256 => Mandate) private _mandates;
    mapping(uint256 => mapping(bytes32 => bool)) public allowedUnderlying;
    mapping(uint256 => mapping(address => bool)) public allowedBasket;
    mapping(address => uint256[]) private _ownerMandates;
    mapping(address => uint256[]) private _agentMandates;

    event MandateCreated(
        uint256 indexed id,
        address indexed owner,
        address indexed agent,
        uint128 perTxCapUsdg,
        uint128 dailyCapUsdg,
        uint64 expiry,
        uint16 maxSlippageBps
    );
    event MandateRevoked(uint256 indexed id, address indexed owner);
    event MandateSpend(uint256 indexed id, uint256 amount, address indexed target, bytes32 indexed quoteHash);
    event AllowedUnderlyingSet(uint256 indexed id, bytes32 indexed underlyingId, bool allowed);
    event AllowedBasketSet(uint256 indexed id, address indexed basket, bool allowed);

    error ZeroAddress();
    error BadCaps();
    error BadExpiry();
    error NotOwner();
    error NotAgent();
    error MandateInactive();
    error MandateExpired();
    error PerTxCapExceeded(uint256 amount, uint128 cap);
    error DailyCapExceeded(uint256 amount, uint128 remaining);
    error UnderlyingNotAllowed(bytes32 underlyingId);
    error BasketNotAllowed(address basket);
    error BadSlippage(uint16 maxSlippageBps);
    error StaleReferencePrice(bytes32 underlyingId);
    error SharesBelowFloor(uint256 sharesOut, uint256 floor);
    error UnitsBelowFloor(uint256 units, uint256 floor);
    error BadQuoteDecimals(uint8 decimals);

    constructor(IShareRouter router_, IStockRegistry registry_, IERC20 usdg_) {
        router = router_;
        registry = registry_;
        usdg = usdg_;
        uint8 dec = IERC20Metadata(address(usdg_)).decimals();
        if (dec > 18) revert BadQuoteDecimals(dec);
        quoteScale = 10 ** (18 - dec);
    }

    // ------------------------------------------------------------------
    // Owner
    // ------------------------------------------------------------------

    /// @param maxSlippageBps Worst execution the agent may accept, in bps below the registry's reference price,
    ///        inclusive of the protocol fee and venue fees. 1-MAX_SLIPPAGE_BPS.
    function createMandate(
        address agent,
        uint128 perTxCapUsdg,
        uint128 dailyCapUsdg,
        uint64 expiry,
        uint16 maxSlippageBps,
        bytes32[] calldata underlyings,
        address[] calldata baskets
    ) external returns (uint256 id) {
        if (agent == address(0)) revert ZeroAddress();
        if (perTxCapUsdg == 0 || dailyCapUsdg == 0 || perTxCapUsdg > dailyCapUsdg) revert BadCaps();
        if (expiry <= block.timestamp) revert BadExpiry();
        if (maxSlippageBps == 0 || maxSlippageBps > MAX_SLIPPAGE_BPS) revert BadSlippage(maxSlippageBps);
        id = nextId++;
        _mandates[id] = Mandate({
            owner: msg.sender,
            agent: agent,
            perTxCapUsdg: perTxCapUsdg,
            dailyCapUsdg: dailyCapUsdg,
            expiry: expiry,
            active: true,
            spentInWindow: 0,
            windowStart: 0,
            maxSlippageBps: maxSlippageBps
        });
        for (uint256 i = 0; i < underlyings.length; i++) {
            allowedUnderlying[id][underlyings[i]] = true;
            emit AllowedUnderlyingSet(id, underlyings[i], true);
        }
        for (uint256 i = 0; i < baskets.length; i++) {
            allowedBasket[id][baskets[i]] = true;
            emit AllowedBasketSet(id, baskets[i], true);
        }
        _ownerMandates[msg.sender].push(id);
        _agentMandates[agent].push(id);
        emit MandateCreated(id, msg.sender, agent, perTxCapUsdg, dailyCapUsdg, expiry, maxSlippageBps);
    }

    function revoke(uint256 id) external {
        Mandate storage m = _mandates[id];
        if (m.owner != msg.sender) revert NotOwner();
        m.active = false;
        emit MandateRevoked(id, msg.sender);
    }

    function setAllowedUnderlying(uint256 id, bytes32 underlyingId, bool allowed) external {
        if (_mandates[id].owner != msg.sender) revert NotOwner();
        allowedUnderlying[id][underlyingId] = allowed;
        emit AllowedUnderlyingSet(id, underlyingId, allowed);
    }

    function setAllowedBasket(uint256 id, address basket, bool allowed) external {
        if (_mandates[id].owner != msg.sender) revert NotOwner();
        allowedBasket[id][basket] = allowed;
        emit AllowedBasketSet(id, basket, allowed);
    }

    // ------------------------------------------------------------------
    // Agent
    // ------------------------------------------------------------------

    function agentBuyShares(
        uint256 id,
        bytes32 underlyingId,
        uint256 usdgIn,
        uint256 minShares,
        LegExecutor.Leg[] calldata legs,
        bytes32 quoteHash
    ) external nonReentrant returns (uint256 sharesOut) {
        Mandate storage m = _authorize(id, usdgIn);
        if (!allowedUnderlying[id][underlyingId]) revert UnderlyingNotAllowed(underlyingId);

        uint256 balanceBefore = usdg.balanceOf(address(this));
        usdg.safeTransferFrom(m.owner, address(this), usdgIn);
        usdg.forceApprove(address(router), usdgIn);
        sharesOut = router.buyShares(underlyingId, usdgIn, minShares, legs, m.owner, quoteHash);
        usdg.forceApprove(address(router), 0);

        // what actually left the owner (incl. the protocol fee) must have bought enough at the reference price
        uint256 spent = _settle(m, usdgIn, balanceBefore);
        uint256 floor = sharesFloor(id, underlyingId, spent);
        if (sharesOut < floor) revert SharesBelowFloor(sharesOut, floor);
        emit MandateSpend(id, spent, address(router), quoteHash);
    }

    function agentMintBasket(
        uint256 id,
        address basket,
        uint256 units,
        uint256 maxUsdgIn,
        LegExecutor.Leg[] calldata legs,
        bytes32 quoteHash
    ) external nonReentrant returns (uint256 usdgSpent) {
        Mandate storage m = _authorize(id, maxUsdgIn);
        if (!allowedBasket[id][basket]) revert BasketNotAllowed(basket);

        uint256 balanceBefore = usdg.balanceOf(address(this));
        usdg.safeTransferFrom(m.owner, address(this), maxUsdgIn);
        usdg.forceApprove(basket, maxUsdgIn);
        IBasketVault(basket).mint(units, maxUsdgIn, legs, m.owner, quoteHash);
        usdg.forceApprove(basket, 0);

        usdgSpent = _settle(m, maxUsdgIn, balanceBefore);
        uint256 floor = unitsFloor(id, basket, usdgSpent);
        if (units < floor) revert UnitsBelowFloor(units, floor);
        emit MandateSpend(id, usdgSpent, basket, quoteHash);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function getMandate(uint256 id) external view returns (Mandate memory) {
        return _mandates[id];
    }

    function mandatesOfOwner(address owner) external view returns (uint256[] memory) {
        return _ownerMandates[owner];
    }

    function mandatesOfAgent(address agent) external view returns (uint256[] memory) {
        return _agentMandates[agent];
    }

    /// @notice Fewest underlying shares `usdgSpent` must have bought under mandate `id`: the reference price
    ///         less the owner's slippage allowance. Reverts if the reference price is missing or stale.
    function sharesFloor(uint256 id, bytes32 underlyingId, uint256 usdgSpent) public view returns (uint256) {
        uint256 price = _freshPrice(underlyingId);
        uint256 worstUsd = usdgSpent * quoteScale * (BPS - _mandates[id].maxSlippageBps) / BPS;
        return worstUsd * WAD / price;
    }

    /// @notice Fewest basket units `usdgSpent` must have minted under mandate `id`: the unit's constituents
    ///         valued at their reference prices, less the owner's slippage allowance.
    function unitsFloor(uint256 id, address basket, uint256 usdgSpent) public view returns (uint256) {
        IBasketVault.Constituent[] memory cs = IBasketVault(basket).constituents();
        uint256 unitUsd;
        for (uint256 i = 0; i < cs.length; i++) {
            unitUsd += cs[i].sharesPerUnit * _freshPrice(cs[i].underlyingId) / WAD;
        }
        uint256 worstUsd = usdgSpent * quoteScale * (BPS - _mandates[id].maxSlippageBps) / BPS;
        return worstUsd * WAD / unitUsd;
    }

    /// @notice USDG still spendable in the current 24h window (0 if inactive/expired).
    function remainingDaily(uint256 id) public view returns (uint256) {
        Mandate storage m = _mandates[id];
        if (!m.active || block.timestamp >= m.expiry) return 0;
        if (m.windowStart == 0 || block.timestamp >= m.windowStart + 1 days) return m.dailyCapUsdg;
        return m.dailyCapUsdg - m.spentInWindow;
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    function _authorize(uint256 id, uint256 amount) internal returns (Mandate storage m) {
        m = _mandates[id];
        if (m.agent != msg.sender) revert NotAgent();
        if (!m.active) revert MandateInactive();
        if (block.timestamp >= m.expiry) revert MandateExpired();
        if (amount > m.perTxCapUsdg) revert PerTxCapExceeded(amount, m.perTxCapUsdg);
        if (m.windowStart == 0 || block.timestamp >= m.windowStart + 1 days) {
            m.windowStart = uint64(block.timestamp);
            m.spentInWindow = 0;
        }
        uint128 remaining = m.dailyCapUsdg - m.spentInWindow;
        if (amount > remaining) revert DailyCapExceeded(amount, remaining);
    }

    function _freshPrice(bytes32 underlyingId) internal view returns (uint256 price) {
        uint64 updatedAt;
        (price, updatedAt) = registry.referencePrice(underlyingId);
        if (price == 0 || block.timestamp - updatedAt > registry.maxPriceAge()) {
            revert StaleReferencePrice(underlyingId);
        }
    }

    /// @dev Forward this call's refund to the owner and record the amount actually spent against the window.
    ///      Only the balance gained since `balanceBefore` is the owner's (audit F-3): the contract is shared by
    ///      every mandate, so anything else sitting here is not this owner's to sweep.
    function _settle(Mandate storage m, uint256 authorized, uint256 balanceBefore) internal returns (uint256 spent) {
        uint256 balance = usdg.balanceOf(address(this));
        uint256 leftover = balance > balanceBefore ? balance - balanceBefore : 0;
        if (leftover > authorized) leftover = authorized;
        if (leftover > 0) usdg.safeTransfer(m.owner, leftover);
        spent = authorized - leftover;
        m.spentInWindow += uint128(spent);
    }
}
