import { calculate, dateOnly, nextCycle, parseDecimal } from '../src/billing/calculation';
import { FixedClock } from './support';
describe('Dart domain compatibility', () => {
  test.each([
    ['0', 3, 0],
    ['1842.5', 3, 1842500],
    ['8', 2, 800],
    [' 1.01 ', 2, 101],
  ])('decimal %s', (text, places, value) =>
    expect(parseDecimal(text as string, places as number)).toBe(value),
  );
  test.each(['-1', '1e3', '1,000', '.5', '1.', '1.0001', 'NaN', 'Infinity', '1000000000000'])(
    'rejects invalid reading %s',
    (text) => expect(() => parseDecimal(text, 3)).toThrow(),
  );
  test('sample bill agrees with Dart', () =>
    expect(calculate(1842500, '1987', 800, 5000)).toEqual({
      previousWh: 1842500,
      currentWh: 1987000,
      usageWh: 144500,
      ratePaisa: 800,
      fixedPaisa: 5000,
      energyPaisa: 115600,
      totalPaisa: 120600,
      currency: 'BDT',
    }));
  test('rounds half paisa up', () => expect(calculate(0, '0.001', 500, 0).totalPaisa).toBe(1));
  test('retains precision when intermediate multiplication exceeds JS safe integers', () => {
    const result = calculate(0, '99999999.999', 999999, 100000000);
    expect(result.energyPaisa).toBe(Number((99999999999n * 999999n + 500n) / 1000n));
    expect(Number.isSafeInteger(result.totalPaisa)).toBe(true);
  });
  test.each(['2026-02-29', '2026-13-01', '2026-04-31', '26-01-01'])(
    'rejects invalid date %s',
    (value) => expect(() => dateOnly(value)).toThrow(),
  );
  test('leap date and next year', () => {
    expect(dateOnly('2024-02-29').getUTCDate()).toBe(29);
    expect(nextCycle('2026-12-31')).toBe('2027-01');
  });
  test('uses Bangladesh business date at UTC rollover', () => {
    const clock = new FixedClock();
    clock.value = new Date('2026-09-30T18:00:00Z');
    expect(clock.today).toBe('2026-10-01');
    expect(clock.cycle).toBe('2026-10');
  });
});
