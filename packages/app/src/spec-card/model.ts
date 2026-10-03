// What a part's spec card shows at a level (brief Section 12, the schema's SPEC_CARD_LAYERS), worked out from the part
// record and the placed part alone (ground rule 1): no part is named here. Pure, so it runs in Node tests.
import { SPEC_CARD_LAYERS } from '@servo/schema';
import type {
  FailureModeId,
  Level,
  PartRecord,
  PlacedPart,
  PortType,
  Setting,
  SettingValue,
  SpecCardLayer,
  Text,
} from '@servo/schema';

/** A layer with a level of its own shows from that level; the others say when they show themselves. */
export const layerShows = (layer: SpecCardLayer, level: Level): boolean => {
  const from = SPEC_CARD_LAYERS.find((entry) => entry.layer === layer)?.from;
  return typeof from === 'number' && level >= from;
};

/** A real name as a title: the first letter capitalised, the rest as written (`DC motor`, `LED`, `2-cell battery pack`). */
export const titleOf = (name: Text): string => name.charAt(0).toUpperCase() + name.slice(1);

/** A value with its real unit beside it: `90°` and `50%` close up, `6 V` with a space (as the list view writes it). */
export const withUnit = (value: number, unit: string): string =>
  unit === '' || unit === '%' || unit === '°' ? `${value}${unit}` : `${value} ${unit}`;

export interface CardPort {
  readonly id: string;
  readonly label: Text;
  readonly type: PortType;
}

/** A setting the child can change at this level, with the value the placed part has now. */
export interface CardSetting {
  readonly setting: Setting;
  readonly value: SettingValue;
}

/** The card's authored text at a level. A layer that does not show at the level is absent. */
export interface CardText {
  readonly title: string;
  readonly does?: Text;
  readonly needs?: Text;
  readonly gives?: Text;
  readonly specLine?: Text;
  readonly popularMechanics?: Text;
  /** Shown with the popular-mechanics line, where the card points at real things. */
  readonly safetyNote?: Text;
}

export interface CardModel {
  readonly partId: string;
  readonly record: PartRecord;
  readonly text: CardText;
  /** In the record's order: its display order. */
  readonly ports: readonly CardPort[];
  /** Only the settings unlocked at this level (canvas ChangeSetting: unlock levels are the input path's concern). */
  readonly settings: readonly CardSetting[];
}

/** A placed part's current value of a setting: what the blueprint holds, else the record's default. */
export const settingValue = (setting: Setting, placed: PlacedPart): SettingValue => {
  const value = placed.settings[setting.id];
  if (setting.kind === 'number') return typeof value === 'number' ? value : setting.default;
  return typeof value === 'string' && setting.options.some((option) => option.id === value) ? value : setting.default;
};

export const cardModel = (record: PartRecord, placed: PlacedPart, level: Level): CardModel => {
  const { card } = record;
  const needsGives = layerShows('needs-gives', level);
  const popular = layerShows('popular-mechanics', level);
  const text: CardText = {
    title: titleOf(record.identity.name),
    ...(layerShows('does', level) ? { does: card.does } : {}),
    ...(needsGives ? { needs: card.needs, gives: card.gives } : {}),
    ...(layerShows('spec-line', level) && card.specLine ? { specLine: card.specLine } : {}),
    ...(popular ? { popularMechanics: card.popularMechanics } : {}),
    ...(popular && card.safetyNote ? { safetyNote: card.safetyNote } : {}),
  };
  return {
    partId: placed.id,
    record,
    text,
    ports: record.ports.map((port) => ({ id: port.id, label: port.label, type: port.type })),
    settings: record.settings
      .filter((setting) => setting.unlockLevel <= level)
      .map((setting) => ({ setting, value: settingValue(setting, placed) })),
  };
};

/** The card lines of the failure modes active now (a fault shows on the card while it happens), in the record's order. */
export const failureNotes = (record: PartRecord, faults: readonly FailureModeId[]): readonly Text[] =>
  record.failureModes.filter((mode) => faults.includes(mode.id)).map((mode) => mode.cardLine);
