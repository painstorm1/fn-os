export type DirectShippingPartner = "JB" | "케이모아";

export type DirectShippingBundleRow = {
  sourceIndex: number;
  bundleOrderNo: string;
  recipient: string;
  orderOption: string;
  assignedPartner?: DirectShippingPartner | "";
  storedPartner?: DirectShippingPartner | "";
};

export type DirectShippingBundlePromptRow = DirectShippingBundleRow & {
  status: "unassigned" | "same-partner" | "opposite-partner";
};

export type DirectShippingBundlePromptGroup = {
  bundleOrderNo: string;
  rows: DirectShippingBundlePromptRow[];
};

export type DirectShippingBundleSelectionPlan = {
  partner: DirectShippingPartner;
  selectedSourceIndexes: number[];
  eligibleMissingSourceIndexes: number[];
  blockedMissingSourceIndexes: number[];
  bundles: DirectShippingBundlePromptGroup[];
};

export type DirectShippingBundleDecision = "include-eligible" | "selected-only" | "cancel";

function normalizedSourceIndexes(sourceIndexes: number[]) {
  return Array.from(new Set(sourceIndexes.filter((value) => Number.isInteger(value) && value >= 0)))
    .sort((left, right) => left - right);
}

function normalizedBundleOrderNo(value: string | undefined) {
  return String(value || "").trim();
}

export function splitDirectShippingDisplayedSources(
  displayedSourceIndexes: number[],
  deletedDisplayRowIndexes: number[],
) {
  const deletedRows = new Set(deletedDisplayRowIndexes.filter((value) => Number.isInteger(value) && value >= 0));
  return displayedSourceIndexes.reduce<{ removedSourceIndexes: number[]; retainedSourceIndexes: number[] }>((result, sourceIndex, displayRowIndex) => {
    if (deletedRows.has(displayRowIndex)) result.removedSourceIndexes.push(sourceIndex);
    else result.retainedSourceIndexes.push(sourceIndex);
    return result;
  }, { removedSourceIndexes: [], retainedSourceIndexes: [] });
}

/**
 * Orders saved source rows by first appearance in the original worksheet while
 * keeping every non-empty bundle contiguous. Blank bundle numbers deliberately
 * receive a source-index-specific key so unrelated rows are never merged.
 */
export function groupDirectShippingSourceIndexes(
  sourceIndexes: number[],
  rows: DirectShippingBundleRow[],
) {
  const rowBySourceIndex = new Map(rows.map((row) => [row.sourceIndex, row]));
  const groups = new Map<string, number[]>();

  normalizedSourceIndexes(sourceIndexes).forEach((sourceIndex) => {
    const bundleOrderNo = normalizedBundleOrderNo(rowBySourceIndex.get(sourceIndex)?.bundleOrderNo);
    const groupKey = bundleOrderNo ? `bundle:${bundleOrderNo}` : `row:${sourceIndex}`;
    const group = groups.get(groupKey);
    if (group) group.push(sourceIndex);
    else groups.set(groupKey, [sourceIndex]);
  });

  return Array.from(groups.entries()).flatMap(([groupKey, indexes], groupIndex) => (
    indexes
      .sort((left, right) => left - right)
      .map((sourceIndex) => ({ sourceIndex, sequence: groupIndex + 1, groupKey }))
  ));
}

/** Builds one serializable React-popup payload for all partially selected bundles. */
export function planDirectShippingBundleSelection({
  partner,
  selectedSourceIndexes,
  rows,
}: {
  partner: DirectShippingPartner;
  selectedSourceIndexes: number[];
  rows: DirectShippingBundleRow[];
}): DirectShippingBundleSelectionPlan {
  const sortedRows = [...rows].sort((left, right) => left.sourceIndex - right.sourceIndex);
  const rowBySourceIndex = new Map(sortedRows.map((row) => [row.sourceIndex, row]));
  const selected = normalizedSourceIndexes(selectedSourceIndexes).filter((sourceIndex) => {
    const selectedRow = rowBySourceIndex.get(sourceIndex);
    const assignedPartner = selectedRow?.storedPartner || selectedRow?.assignedPartner || "";
    return !assignedPartner || assignedPartner === partner;
  });
  const selectedSet = new Set(selected);
  const selectedBundleOrder = Array.from(new Set(selected
    .map((sourceIndex) => normalizedBundleOrderNo(rowBySourceIndex.get(sourceIndex)?.bundleOrderNo))
    .filter(Boolean)));
  const bundles: DirectShippingBundlePromptGroup[] = [];
  const eligibleMissingSourceIndexes: number[] = [];
  const blockedMissingSourceIndexes: number[] = [];

  selectedBundleOrder.forEach((bundleOrderNo) => {
    const promptRows: DirectShippingBundlePromptRow[] = [];
    sortedRows.forEach((row) => {
      if (normalizedBundleOrderNo(row.bundleOrderNo) !== bundleOrderNo || selectedSet.has(row.sourceIndex)) return;
      if (row.storedPartner === partner) return;

      const assignedPartner = row.storedPartner || row.assignedPartner || "";
      const status: DirectShippingBundlePromptRow["status"] = assignedPartner && assignedPartner !== partner
        ? "opposite-partner"
        : assignedPartner === partner
          ? "same-partner"
          : "unassigned";
      promptRows.push({ ...row, bundleOrderNo, status });
      if (status === "opposite-partner") blockedMissingSourceIndexes.push(row.sourceIndex);
      else eligibleMissingSourceIndexes.push(row.sourceIndex);
    });
    if (promptRows.length) bundles.push({ bundleOrderNo, rows: promptRows });
  });

  return {
    partner,
    selectedSourceIndexes: selected,
    eligibleMissingSourceIndexes,
    blockedMissingSourceIndexes,
    bundles,
  };
}

export function resolveDirectShippingBundleSelection(
  plan: DirectShippingBundleSelectionPlan,
  decision: DirectShippingBundleDecision,
) {
  if (decision === "cancel") return [];
  if (decision === "selected-only") return [...plan.selectedSourceIndexes];
  return normalizedSourceIndexes([
    ...plan.selectedSourceIndexes,
    ...plan.eligibleMissingSourceIndexes,
  ]);
}
