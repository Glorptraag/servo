import { field } from './records.ts';
import type { RecordKind } from './records.ts';

/** One line of text in a record that the terminology lists apply to. */
export interface TextField {
  /** JSONPath, in the schema's style. */
  readonly path: string;
  readonly text: string;
  /** The part's name (`identity.name`), which is also checked against the components list. */
  readonly partName?: true;
}

const items = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

const CARD_LINES = ['does', 'needs', 'gives', 'popularMechanics', 'specLine', 'safetyNote'] as const;
const FAILURE_LINES = ['teachingNote', 'cardLine', 'hint'] as const;

/**
 * The text fields of a record the terminology lists apply to, in record order. These are the fields the
 * schema reads as system text (`Text`), plus the name of a blueprint written as content: in the app a
 * blueprint's `meta.name` is the child's own text, but a fixture's or a challenge's starting blueprint is
 * authored, and the child sees its name. Fields that are not strings are skipped; the schema reports them.
 */
export const systemText = (kind: RecordKind, record: unknown): TextField[] => {
  const out: TextField[] = [];
  const take = (value: unknown, path: string): void => {
    if (typeof value === 'string') out.push({ path, text: value });
  };
  switch (kind) {
    case 'part': {
      const name = field(field(record, 'identity'), 'name');
      if (typeof name === 'string') out.push({ path: '$.identity.name', text: name, partName: true });
      items(field(record, 'ports')).forEach((port, index) => take(field(port, 'label'), `$.ports[${index}].label`));
      items(field(record, 'settings')).forEach((setting, index) => {
        take(field(setting, 'label'), `$.settings[${index}].label`);
        items(field(setting, 'options')).forEach((option, at) => take(field(option, 'label'), `$.settings[${index}].options[${at}].label`));
      });
      items(field(record, 'failureModes')).forEach((mode, index) => {
        for (const key of FAILURE_LINES) take(field(mode, key), `$.failureModes[${index}].${key}`);
      });
      for (const key of CARD_LINES) take(field(field(record, 'card'), key), `$.card.${key}`);
      break;
    }
    case 'arena':
    case 'kit':
      take(field(record, 'name'), '$.name');
      break;
    case 'challenge':
      take(field(record, 'title'), '$.title');
      take(field(record, 'goalLine'), '$.goalLine');
      items(field(record, 'hints')).forEach((ladder, index) => {
        items(field(ladder, 'steps')).forEach((step, at) => take(field(step, 'line'), `$.hints[${index}].steps[${at}].line`));
      });
      take(field(field(field(record, 'start'), 'meta'), 'name'), '$.start.meta.name');
      break;
    case 'blueprint':
      take(field(field(record, 'meta'), 'name'), '$.meta.name');
      break;
    case 'run-record':
      // A run record is made by sim-core from a child's build, so its text is not content.
      break;
  }
  return out;
};
