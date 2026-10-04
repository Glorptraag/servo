import type { Finding } from './codes.ts';

/** The schema's exclamation marks (`@servo/schema` reader.ts, ground rule 7): `!`, `¡`, `！`, `‼`, `⁉`, `❗` and `❕`. */
const EXCLAMATIONS = /[!¡！‼⁉❗❕]/u;
/** Question marks: `?`, `¿`, `？`, `⁇` and `⁈`. */
const QUESTIONS = /[?¿？⁇⁈]/u;
/**
 * Emoji, flags and the interrobang. `©`, `®` and `™` are pictographic in Unicode but are not emoji in text, and
 * `‼` and `⁉` are exclamation marks, so they are left out.
 */
const SYMBOLS = /(?![©®™‼⁉])[\p{Extended_Pictographic}\u{1f1e6}-\u{1f1ff}‽]/u;

const first = (text: string, pattern: RegExp): string | undefined => pattern.exec(text)?.[0];

/**
 * Marks system text never holds, beyond the schema's: a question mark, because system text never asks a
 * rhetorical question (brief Section 12), and an emoji or the interrobang, because Servo never celebrates
 * (ground rule 7, brief Section 8). With `exclamations`, also the schema's exclamation marks, for authored text
 * the schema does not read as system text: a content blueprint's name. One finding per kind of mark.
 */
export const markFindings = (text: string, options: { readonly exclamations?: boolean } = {}): Finding[] => {
  const findings: Finding[] = [];
  const exclamation = options.exclamations ? first(text, EXCLAMATIONS) : undefined;
  if (exclamation !== undefined) {
    findings.push({ code: 'text.exclamation', message: `'${exclamation}' is an exclamation mark: system text has none (ground rule 7).` });
  }
  const question = first(text, QUESTIONS);
  if (question !== undefined) {
    findings.push({ code: 'text.question', message: `'${question}' is a question mark: system text never asks a rhetorical question (brief Section 12).` });
  }
  const symbol = first(text, SYMBOLS);
  if (symbol !== undefined) {
    findings.push({ code: 'text.symbol', message: `'${symbol}' is an emoji or a celebratory symbol: system text never celebrates (ground rule 7, brief Section 8).` });
  }
  return findings;
};
