import { CLEAN_SLUG_PATTERN } from './constants.js';

export function isCleanSlug(value: string): boolean {
  return CLEAN_SLUG_PATTERN.test(value);
}

export function normalizeSlug(value: string): string {
  const spaced = value
    .trim()
    .replaceAll(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replaceAll(/([a-z\d])([A-Z])/g, '$1-$2');

  const normalized = spaced
    .normalize('NFKD')
    .replaceAll(/[\u0300-\u036F]/g, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/-{2,}/g, '-')
    .replaceAll(/^-+|-+$/g, '');

  return normalized.length > 0 ? normalized : 'workflow';
}
