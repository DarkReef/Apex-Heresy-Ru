import {onlyWarTerms} from './only-war-terms.mjs';

const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const terms = Object.entries(onlyWarTerms).sort(([a], [b]) => b.length - a.length);
const names = new Map(terms.map(([en, ru]) => [en.toLowerCase(), ru]));
const pattern = new RegExp(`(?<![A-Za-z])(?:${terms.map(([en]) => escape(en)).join('|')})(?![A-Za-z])`, 'gi');

/** Translate plain text at render time. Stored requirements, enums and formulas stay canonical. */
export function ruleText(value, book, language = 'en', field = '') {
    const text = value == null ? '' : String(value);
    if (language !== 'ru' || !(book === 'ow' || /\bOnly War\b/i.test(String(book ?? '')))) return text;
    return text.replace(pattern, hit => field === 'aptitudes' && hit.toLowerCase() === 'psyker'
        ? 'Псайкерство' : names.get(hit.toLowerCase()));
}
