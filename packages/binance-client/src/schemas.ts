import { z } from "zod";

/** Envelope: { code: 0 on success, msg, data, success }. Some endpoints use "000000". */
export const EnvelopeSchema = z.object({
  code: z.union([z.number(), z.string()]),
  msg: z.string().nullable().optional(),
  message: z.string().nullable().optional(),
  data: z.unknown(),
  success: z.boolean().optional(),
  timestamp: z.number().optional(),
}).passthrough();

const numStr = z.union([z.string(), z.number()]).transform((v) => String(v));
const optNumStr = numStr.nullable().optional();

export const StatusInfoSchema = z.object({
  openState: z.boolean().nullable().optional(),
  marketStatus: z.string().nullable().optional(),
  reasonCode: z.string().nullable().optional(),
  reasonMsg: z.string().nullable().optional(),
  nextOpenTime: z.number().nullable().optional(),
  nextCloseTime: z.number().nullable().optional(),
}).passthrough();

export const RwaTokenSchema = z.object({
  binanceChainId: numStr,
  tokenContractAddress: z.string(),
  platformId: z.string(),
  assetType: z.number().nullable().optional(),
  tokenName: z.string().nullable().optional(),
  tokenSymbol: z.string(),
  tokenLogoUrl: z.string().nullable().optional(),
  decimals: optNumStr,
  underlyingTicker: z.string().nullable().optional(),
  underlyingName: z.string().nullable().optional(),
  tokenToShareRatio: optNumStr,
  tags: z.array(z.string()).nullable().optional(),
  statusInfo: StatusInfoSchema.nullable().optional(),
  tokenPrice: optNumStr,
  referencePrice: optNumStr,
  volume24h: optNumStr,
  marketCap: optNumStr,
  peRatioTtm: optNumStr,
}).passthrough();
export type RwaToken = z.infer<typeof RwaTokenSchema>;

export const RwaPlatformSchema = z.object({
  platformId: z.string(),
  platformName: z.string().nullable().optional(),
  tickerCount: z.number().nullable().optional(),
  chainDistribution: z.array(z.object({ binanceChainId: numStr, count: z.number().nullable().optional() }).passthrough()).nullable().optional(),
}).passthrough();

export const RwaSearchResultSchema = z.object({
  ticker: z.string().nullable().optional(),
  companyName: z.string().nullable().optional(),
  assets: z.array(z.object({
    platformId: z.string(),
    binanceChainId: numStr,
    tokenContractAddress: z.string(),
    tokenSymbol: z.string().nullable().optional(),
    assetType: z.number().nullable().optional(),
  }).passthrough()).default([]),
}).passthrough();

export const RwaPriceSchema = z.object({
  binanceChainId: numStr,
  tokenContractAddress: z.string(),
  platformId: z.string().nullable().optional(),
  tokenPrice: optNumStr,
  referencePrice: optNumStr,
  tokenPriceUpdatedAt: z.number().nullable().optional(),
}).passthrough();

export const RwaUnderlyingProfileSchema = z.object({
  binanceChainId: numStr,
  tokenContractAddress: z.string(),
  platformId: z.string().nullable().optional(),
  underlyingTicker: z.string().nullable().optional(),
  underlyingFullName: z.string().nullable().optional(),
  assetType: z.number().nullable().optional(),
  tokenToShareRatio: optNumStr,
  protections: z.record(z.object({ url: z.string().nullable().optional(), title: z.string().nullable().optional(), updatedAt: z.number().nullable().optional() }).passthrough()).nullable().optional(),
  companyInfo: z.record(z.unknown()).nullable().optional(),
}).passthrough();

export const RwaUnderlyingMarketSchema = z.object({
  marketData: z.record(z.unknown()).nullable().optional(),
  statusInfo: StatusInfoSchema.nullable().optional(),
}).passthrough();

export const AggregatedQuoteSchema = z.object({
  quoteId: z.string().nullable().optional(),
  vendorName: z.string().nullable().optional(),
  binanceChainId: numStr.optional(),
  fromTokenAmount: optNumStr,
  toTokenAmount: optNumStr,
  tradeFee: optNumStr,
  estimateGasFee: optNumStr,
  priceImpactPercent: optNumStr,
  router: z.string().nullable().optional(),
  executionMode: z.string().nullable().optional(),
  approveTarget: z.string().nullable().optional(),
  isBest: z.boolean().nullable().optional(),
  dexRouterList: z.array(z.unknown()).nullable().optional(),
}).passthrough();

export const SwapTxSchema = z.object({
  from: z.string().nullable().optional(),
  to: z.string().nullable().optional(),
  data: z.string().nullable().optional(),
  value: optNumStr,
  gas: optNumStr,
  gasPrice: optNumStr,
  minReceiveAmount: optNumStr,
  slippagePercent: optNumStr,
}).passthrough();

export const BuildSwapSchema = z.object({
  routerResult: z.unknown().optional(),
  tx: SwapTxSchema.nullable().optional(),
  executionMode: z.string().nullable().optional(),
  rfq: z.object({ vendor: z.string().nullable().optional(), typedDataToSign: z.string().nullable().optional(), signingScheme: z.string().nullable().optional() }).passthrough().nullable().optional(),
}).passthrough();

export const TopLiquidityPoolSchema = z.object({
  poolAddress: z.string().nullable().optional(),
  poolName: z.string().nullable().optional(),
  protocol: z.string().nullable().optional(),
  liquidityUsd: optNumStr,
}).passthrough();

export const SimulateResultSchema = z.unknown();
export const GasPriceSchema = z.unknown();
