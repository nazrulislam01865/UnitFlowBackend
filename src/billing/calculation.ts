import { bad } from '../common/errors/api-error';
import { Calculation } from '../common/models';
export function parseDecimal(input: string, places: number, max = 100000000000): number {
  const value = input.trim();
  if (!new RegExp(`^\\d{1,12}(\\.\\d{1,${places}})?$`).test(value))
    bad(`Enter a positive number with up to ${places} decimal places.`);
  const [whole, fraction = ''] = value.split('.');
  const result = BigInt(whole) * 10n ** BigInt(places) + BigInt(fraction.padEnd(places, '0'));
  if (result > BigInt(max)) bad('The number exceeds the supported limit.');
  return Number(result);
}
export function dateOnly(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) bad('Use a date in YYYY-MM-DD format.');
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    bad('Enter a valid calendar date.');
  return date;
}
export function nextCycle(today: string): string {
  const date = dateOnly(today);
  date.setUTCMonth(date.getUTCMonth() + 1, 1);
  return date.toISOString().slice(0, 7);
}
export function calculate(
  previousWh: number,
  currentKwh: string,
  ratePaisa: number,
  fixedPaisa: number,
): Calculation {
  const currentWh = parseDecimal(currentKwh, 3);
  if (previousWh < 0 || currentWh < previousWh)
    bad('The reading cannot be lower than the previous reading.');
  if (ratePaisa < 0 || ratePaisa > 1000000 || fixedPaisa < 0 || fixedPaisa > 100000000)
    bad('The tariff is outside the supported range.');
  const usageWh = currentWh - previousWh;
  // Dart uses exact integers. BigInt preserves half-up paisa rounding even above 2^53 during multiplication.
  const energyPaisa = Number((BigInt(usageWh) * BigInt(ratePaisa) + 500n) / 1000n);
  return {
    previousWh,
    currentWh,
    usageWh,
    ratePaisa,
    fixedPaisa,
    energyPaisa,
    totalPaisa: energyPaisa + fixedPaisa,
    currency: 'BDT',
  };
}
