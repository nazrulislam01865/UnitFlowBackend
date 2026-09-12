import { bad } from '../errors/api-error';
export function identifier(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) bad('Invalid identifier.');
  return value;
}
export function field(body: object, key: string, max = 120, optional = false): string {
  const value = (body as Record<string, unknown>)[key];
  if (optional && value == null) return '';
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.length > max)
    bad(`Enter a valid ${key} (maximum ${max} characters).`);
  return value.trim();
}
export function onlyFields(body: object, allowed: readonly string[]): void {
  if (Object.keys(body).some((key) => !allowed.includes(key)))
    bad('The request contains unsupported fields.');
}
export function searchTokens(name: string, unit: string): string[] {
  const tokens = new Set<string>();
  for (const word of `${name} ${unit}`.toLowerCase().split(/\s+/).slice(0, 12))
    for (let i = 1; i <= Math.min(word.length, 30); i++) tokens.add(word.slice(0, i));
  return [...tokens].slice(0, 200);
}
