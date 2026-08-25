import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { jquantsGetAll } from './jquants-client.js';

export const INVESTOR_TYPE_SECTIONS = [
  'TSE1st',
  'TSE2nd',
  'TSEMothers',
  'TSEJASDAQ',
  'TSEPrime',
  'TSEStandard',
  'TSEGrowth',
  'TokyoNagoya',
] as const;

export type InvestorTypeSection = typeof INVESTOR_TYPE_SECTIONS[number];

interface JQuantsInvestorTypeRow extends Record<string, unknown> {
  PubDate: string;
  StDate: string;
  EnDate: string;
  Section: InvestorTypeSection;
  PropSell: number;
  PropBuy: number;
  PropTot: number;
  PropBal: number;
  BrkSell: number;
  BrkBuy: number;
  BrkTot: number;
  BrkBal: number;
  TotSell: number;
  TotBuy: number;
  TotTot: number;
  TotBal: number;
  IndSell: number;
  IndBuy: number;
  IndTot: number;
  IndBal: number;
  FrgnSell: number;
  FrgnBuy: number;
  FrgnTot: number;
  FrgnBal: number;
  SecCoSell: number;
  SecCoBuy: number;
  SecCoTot: number;
  SecCoBal: number;
  InvTrSell: number;
  InvTrBuy: number;
  InvTrTot: number;
  InvTrBal: number;
  BusCoSell: number;
  BusCoBuy: number;
  BusCoTot: number;
  BusCoBal: number;
  OthCoSell: number;
  OthCoBuy: number;
  OthCoTot: number;
  OthCoBal: number;
  InsCoSell: number;
  InsCoBuy: number;
  InsCoTot: number;
  InsCoBal: number;
  BankSell: number;
  BankBuy: number;
  BankTot: number;
  BankBal: number;
  TrstBnkSell: number;
  TrstBnkBuy: number;
  TrstBnkTot: number;
  TrstBnkBal: number;
  OthFinSell: number;
  OthFinBuy: number;
  OthFinTot: number;
  OthFinBal: number;
}

export interface InvestorTypeTradingValue {
  sell: number;
  buy: number;
  total: number;
  balance: number;
}

export interface InvestorTypeFlowSourceRow {
  publishedDate: string;
  periodStartDate: string;
  periodEndDate: string;
  section: InvestorTypeSection;
  summary: {
    proprietary: InvestorTypeTradingValue;
    brokerage: InvestorTypeTradingValue;
    total: InvestorTypeTradingValue;
  };
  brokerageBreakdown: {
    individuals: InvestorTypeTradingValue;
    foreignInvestors: InvestorTypeTradingValue;
    securitiesCompanies: InvestorTypeTradingValue;
    investmentTrusts: InvestorTypeTradingValue;
    businessCorporations: InvestorTypeTradingValue;
    otherCorporations: InvestorTypeTradingValue;
    insuranceCompanies: InvestorTypeTradingValue;
    banks: InvestorTypeTradingValue;
    trustBanks: InvestorTypeTradingValue;
    otherFinancialInstitutions: InvestorTypeTradingValue;
  };
}

export const INVESTOR_TYPE_FLOWS_DESCRIPTION = `
Fetches weekly market-section trading values by investor type from J-Quants.

**Requires:** JQUANTS_API_KEY and a J-Quants Light plan or higher.

Values are source-provided in thousand JPY. This is market-section context, not evidence that an investor type traded a specific issuer or sector. Correction rows remain separate, and the tool does not select a correction vintage or recalculate source totals and balances. An empty result does not mean buying, selling, or balance was zero.
`.trim();

const InvestorTypeFlowsInputSchema = z.object({
  section: z
    .enum(INVESTOR_TYPE_SECTIONS)
    .optional()
    .describe('Exact J-Quants market section. Omit to retrieve every source section.'),
  from: z
    .string()
    .optional()
    .describe('Publication-date range start (YYYY-MM-DD or YYYYMMDD).'),
  to: z
    .string()
    .optional()
    .describe('Publication-date range end (YYYY-MM-DD or YYYYMMDD).'),
});

function tradingValue(
  sell: number,
  buy: number,
  total: number,
  balance: number,
): InvestorTypeTradingValue {
  return { sell, buy, total, balance };
}

function mapInvestorTypeRow(row: JQuantsInvestorTypeRow): InvestorTypeFlowSourceRow {
  return {
    publishedDate: row.PubDate,
    periodStartDate: row.StDate,
    periodEndDate: row.EnDate,
    section: row.Section,
    summary: {
      proprietary: tradingValue(row.PropSell, row.PropBuy, row.PropTot, row.PropBal),
      brokerage: tradingValue(row.BrkSell, row.BrkBuy, row.BrkTot, row.BrkBal),
      total: tradingValue(row.TotSell, row.TotBuy, row.TotTot, row.TotBal),
    },
    brokerageBreakdown: {
      individuals: tradingValue(row.IndSell, row.IndBuy, row.IndTot, row.IndBal),
      foreignInvestors: tradingValue(row.FrgnSell, row.FrgnBuy, row.FrgnTot, row.FrgnBal),
      securitiesCompanies: tradingValue(row.SecCoSell, row.SecCoBuy, row.SecCoTot, row.SecCoBal),
      investmentTrusts: tradingValue(row.InvTrSell, row.InvTrBuy, row.InvTrTot, row.InvTrBal),
      businessCorporations: tradingValue(row.BusCoSell, row.BusCoBuy, row.BusCoTot, row.BusCoBal),
      otherCorporations: tradingValue(row.OthCoSell, row.OthCoBuy, row.OthCoTot, row.OthCoBal),
      insuranceCompanies: tradingValue(row.InsCoSell, row.InsCoBuy, row.InsCoTot, row.InsCoBal),
      banks: tradingValue(row.BankSell, row.BankBuy, row.BankTot, row.BankBal),
      trustBanks: tradingValue(row.TrstBnkSell, row.TrstBnkBuy, row.TrstBnkTot, row.TrstBnkBal),
      otherFinancialInstitutions: tradingValue(row.OthFinSell, row.OthFinBuy, row.OthFinTot, row.OthFinBal),
    },
  };
}

export const getInvestorTypeFlows = new DynamicStructuredTool({
  name: 'get_investor_type_flows',
  description: INVESTOR_TYPE_FLOWS_DESCRIPTION,
  schema: InvestorTypeFlowsInputSchema,
  func: async (input) => {
    const rows = await jquantsGetAll<JQuantsInvestorTypeRow>('/equities/investor-types', {
      section: input.section,
      from: input.from,
      to: input.to,
    });

    if (rows.length === 0) {
      return formatToolResult({
        error: 'No investor-type market-section data found for the requested publication-date range',
        reason: 'no_investor_type_flow_data',
      }, []);
    }

    return formatToolResult(rows.map(mapInvestorTypeRow), []);
  },
});
