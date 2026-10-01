import type { IssueCode } from '@servo/schema';

/**
 * The content validator's own reasons, beside the schema's ISSUE_CODES. Codes are stable: tests and the
 * README key on them, and a test keeps the README's table equal to this one.
 */
export const CONTENT_ISSUE_CODES = {
  'file.unreadable': 'The file could not be read.',
  'file.bad_json': 'The file is not valid JSON.',
  'file.unknown_kind': 'The file is in no record folder, and its fields match no kind of record or more than one.',
  'content.duplicate_id': 'Another record of the same kind already uses this id.',
  'terminology.banned': 'System text uses a word or phrase on the banned list.',
  'terminology.gloss_alone': 'System text uses a plain-language gloss without its real name in the same field.',
  'terminology.not_real_name': "A part's name has no letters, or contains no real component name from the components list.",
  'terminology.name_form': "A part's name writes a real component name, a qualifier or a gloss differently from the list: another case, spacing or hyphen.",
  'terminology.not_qualifier': "A part's name holds a word or symbol beside its real name that is not a listed qualifier or gloss.",
  'terminology.proper_name': "A part's name holds a capitalised word beside its real name that is not a listed qualifier or gloss, which reads as a character's name.",
  'terminology.bad_file': 'A terminology file is not valid JSON or does not follow the terminology format.',
} as const;

export type ContentIssueCode = keyof typeof CONTENT_ISSUE_CODES;

/** One named reason a file is refused: the file, a stable code, a JSONPath into the file and a plain message. */
export interface ContentIssue {
  /** Absolute path of the file. */
  readonly file: string;
  /** One of the schema's ISSUE_CODES, or one of CONTENT_ISSUE_CODES. */
  readonly code: IssueCode | ContentIssueCode;
  /** JSONPath into the file, in the schema's style; `$` is the whole file. */
  readonly path: string;
  readonly message: string;
}

/** A finding about one place in a file, before the file is attached. */
export interface Finding {
  readonly code: ContentIssueCode;
  readonly message: string;
}
