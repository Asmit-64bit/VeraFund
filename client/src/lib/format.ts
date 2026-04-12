import { ethers } from "ethers";

export function formatEth(value: bigint, maximumFractionDigits = 4): string {
  const raw = ethers.formatEther(value);
  const formatted = Number(raw);

  if (!Number.isFinite(formatted)) {
    return "0";
  }

  const absoluteValue = Math.abs(formatted);
  let digits = maximumFractionDigits;

  if (absoluteValue > 0 && absoluteValue < 1 / 10 ** maximumFractionDigits) {
    const fractionPart = raw.split(".")[1] ?? "";
    const firstNonZeroIndex = fractionPart.search(/[1-9]/);

    if (firstNonZeroIndex >= 0) {
      digits = Math.min(Math.max(firstNonZeroIndex + 2, maximumFractionDigits), 8);
    }
  }

  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(formatted);
}

export function formatEthLabel(value: bigint, maximumFractionDigits = 4): string {
  return `${formatEth(value, maximumFractionDigits)} ETH`;
}

export function formatPercent(numerator: bigint, denominator: bigint): string {
  if (denominator <= 0n || numerator <= 0n) {
    return "0";
  }

  const percentScaled = (numerator * 1_000_000n + denominator / 2n) / denominator;
  const integerPart = percentScaled / 10_000n;
  const fractionalPart = (percentScaled % 10_000n).toString().padStart(4, "0");
  const percentValue = Number(`${integerPart}.${fractionalPart}`);

  if (percentValue >= 100) {
    return "100";
  }

  if (percentValue >= 10) {
    return percentValue.toFixed(0);
  }

  if (percentValue >= 1) {
    return percentValue.toFixed(1).replace(/\.0$/, "");
  }

  if (percentValue >= 0.01) {
    return percentValue.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  }

  if (percentValue >= 0.0001) {
    return percentValue.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  }

  return "<0.0001";
}
