// The content validator (task 0.5): `pnpm validate-content <path>`. See README.md.

export { CONTENT_ISSUE_CODES } from './codes.ts';
export type { ContentIssue, ContentIssueCode } from './codes.ts';
export { validateContent } from './validate.ts';
export type { ContentReport, ValidateContentOptions } from './validate.ts';
export { loadTerminology, TERMINOLOGY_FILES } from './terminology.ts';
export type { BannedPhrase, ComponentTerm, LoadedTerminology, Terminology } from './terminology.ts';
export { RECORD_KINDS } from './records.ts';
export type { RecordKind } from './records.ts';
export { runValidateContent, USAGE as VALIDATE_CONTENT_USAGE } from './cli.ts';
export type { ValidateContentEnvironment } from './cli.ts';
