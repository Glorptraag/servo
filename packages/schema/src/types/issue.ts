/**
 * Every reason a validator can refuse data. Codes are stable: tests, the content validator and UI copy
 * key on them. The `wire.*` codes other than `wire.duplicate` and `wire.reversed` are impossible drops,
 * refused at the socket (brief Section 10). Legal-but-wrong wiring is never refused; it is simulated.
 */
export const ISSUE_CODES = {
  'value.missing': 'A required field is absent.',
  'value.unknown_key': 'A field the schema does not define, such as a misspelt one.',
  'value.wrong_type': 'The value has the wrong JSON type, or a number is not finite.',
  'value.not_integer': 'A whole number is required.',
  'value.out_of_range': 'A number is outside its allowed range.',
  'value.bad_format': 'A string does not match its format: id, colour, timestamp, asset key or name.',
  'value.not_allowed': 'The value is not one of the allowed words.',
  'value.empty': 'A list has fewer items than it needs.',
  'value.wrong_count': 'A list that holds exactly two items holds another number.',
  'value.duplicate': 'A list holds the same item twice.',
  'value.inconsistent': 'Fields contradict each other, for example a minimum above its maximum.',
  'value.too_deep': 'Goals or conditions are nested more than 8 levels deep.',
  'value.unreadable': 'The data could not be read, for example a property that throws.',
  'text.format': 'System text is empty, has a line break, or starts or ends with a space.',
  'text.exclamation': 'System text contains an exclamation mark (ground rule 7).',
  'id.duplicate': 'Two items in one collection share an id.',
  'id.above_high_water': "A p<n> or w<n> id is above the blueprint's high-water mark, so it could be given out again.",
  'ref.unknown_part_type': 'No part record has this id.',
  'ref.unknown_placed_part': 'No placed part has this id.',
  'ref.unknown_port': 'The part has no port with this id.',
  'ref.unknown_primitive': 'The part has no behaviour primitive with this id.',
  'ref.unknown_need': 'The part has no need with this id.',
  'ref.unknown_setting': 'The part has no setting with this id.',
  'ref.unknown_option': 'The setting has no option with this id.',
  'ref.unknown_failure_mode': 'The part has no failure mode with this id.',
  'ref.unknown_arena': 'No arena preset has this id.',
  'ref.unknown_arena_feature': 'The arena has no zone or wall with this id.',
  'ref.unknown_kit': 'No kit has this id.',
  'port.wrong_kind': 'A primitive, need or hint uses a port of the wrong type, direction or role.',
  'port.wrong_polarity': 'A + binding uses a port marked negative, or a − binding one marked positive.',
  'port.bound_twice': 'Two primitives use the same signal or mechanical port.',
  'need.wrong_part': 'A floor need belongs only to a part with a wheel or support primitive.',
  'setting.bad_binding': 'A setting drives a parameter its primitive does not have, or maps outside its range.',
  'setting.bad_option': "A choice option's value does not suit the parameter it drives.",
  'setting.default_mismatch': "A setting's default differs from the value in its primitive.",
  'setting.duplicate_binding': 'Two settings drive the same parameter.',
  'setting.unlock_before_part': 'A setting unlocks before the level that introduces its part.',
  'setting.wrong_type': 'A blueprint setting value has the wrong type for its setting.',
  'setting.out_of_range': "A blueprint setting value is outside the setting's range.",
  'setting.off_step': "A blueprint setting value is not on one of the setting's steps.",
  'failure.bad_unmet': 'A failure mode names a way its need cannot go unmet.',
  'failure.duplicate_condition': 'Two failure modes name the same need and the same way.',
  'blueprint.unsupported_version': 'The blueprint is not version 1.',
  'blueprint.newer_version': 'The blueprint is a newer version than this schema reads.',
  'wire.same_port': 'Both ends are the same port.',
  'wire.type_mismatch': 'The ports are of different types, for example power into signal.',
  'wire.signal_direction': 'A signal line runs from a signal out to a signal in.',
  'wire.mechanical_mismatch': 'A drive port and a mount port cannot be joined.',
  'wire.mechanical_direction': 'A drive-out joins a drive-in; a mount joins a mount point.',
  'wire.mechanical_same_part': 'A mechanical linkage cannot join a part to itself.',
  'wire.port_full': 'The port already takes as many wires as it can.',
  'wire.duplicate': 'The same two ports are already joined.',
  'wire.reversed': 'A directional wire is written from its in end; the stored form runs source first.',
  'mount.cycle': 'Mounts form a loop.',
  'mount.misplaced': "A mounted part's canvas position or rotation differs from where its mount puts it.",
  'arena.outside': 'A feature, prop or start lies outside the floor.',
  'kit.tray_mismatch': 'Kit entries and tray parts differ.',
  'kit.wrong_family': 'A tray group holds a part of another family.',
  'kit.part_above_level': 'The kit holds a part introduced at a later level.',
  'challenge.start_required': 'Breakdowns and what-ifs need a starting blueprint.',
  'challenge.introduces_required': 'A part introduction names the part it introduces.',
  'challenge.introduces_unexpected': 'Only a part introduction names a part to introduce.',
  'challenge.arena_mismatch': "The starting blueprint's arena preset differs from the challenge's.",
  'hint.bad_order': 'Ladder steps are out of order, repeat a rung, or do not end with do-it.',
  'run.event_order': 'Events or inputs are not in tick order.',
  'run.tick_out_of_range': 'A tick falls after the last tick of the run.',
  'run.unrecorded_fault':
    'Fault events and faults disagree: an event with no entry, an entry with no starting event or another start tick, or an end with no start.',
  'run.goal_without_challenge': 'A run record has a goal but no challenge.',
} as const;

export type IssueCode = keyof typeof ISSUE_CODES;

/** One named reason for a refusal: a stable code, a JSONPath into the data, and a plain message. */
export interface Issue {
  readonly code: IssueCode;
  /** JSONPath from the document root, for example `$.wires[3].from.port` or `$.parts[0].settings['gear-ratio']`. */
  readonly path: string;
  readonly message: string;
}

/** Validators never throw: they return the typed value, or every issue found. */
export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly Issue[] };
