import assert from "node:assert/strict";
import {
  cleanAccountingFixedCostPayload,
  cleanAccountingLoanPayload,
  shouldAutoMarkLoanPaid,
} from "../src/lib/accounting-ledger-payloads.ts";

const fixedPayload = cleanAccountingFixedCostPayload(
  { id: "fc-1", expected_amount: "100000" },
  { id: "fc-1", fixed_cost_name: "기업은행 보증서_1", base_day: "17", expected_amount: 0, payment_type: "bank", payment_source: "기업은행 통장" },
);
assert.equal(fixedPayload.fixed_cost_name, "기업은행 보증서_1");
assert.equal(fixedPayload.base_day, "17");
assert.equal(fixedPayload.expected_amount, 100000);
assert.equal(fixedPayload.payment_source, "기업은행 통장");

const loanPayload = cleanAccountingLoanPayload(
  { id: "loan-1", expected_payment_amount: "100000" },
  { id: "loan-1", loan_name: "기업은행 보증서_1", payment_day: "17", loan_type: "interest_only", expected_payment_amount: 0, bank_name: "기업은행" },
);
assert.equal(loanPayload.loan_name, "기업은행 보증서_1");
assert.equal(loanPayload.payment_day, "17");
assert.equal(loanPayload.loan_type, "interest_only");
assert.equal(loanPayload.expected_interest_amount, 100000);
assert.equal(loanPayload.expected_payment_amount, 100000);
assert.equal(loanPayload.bank_name, "기업은행");

assert.equal(
  shouldAutoMarkLoanPaid({ loan_name: "기업은행 보증서_1", bank_name: "기업은행" }, "2026-06-17", "2026-06-19"),
  true,
);
assert.equal(
  shouldAutoMarkLoanPaid({ loan_name: "기업은행 보증서_1", bank_name: "기업은행" }, "2026-06-17", "2026-06-17"),
  false,
);
assert.equal(
  shouldAutoMarkLoanPaid({ loan_name: "다른 대출", bank_name: "기업은행" }, "2026-06-17", "2026-06-19"),
  false,
);

console.log("accounting fixed-cost regression checks passed");
