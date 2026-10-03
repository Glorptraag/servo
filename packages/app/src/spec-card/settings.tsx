// A part's settings on its card (brief Section 10): a choice as big buttons side by side, a number as a big slider in
// the record's child-sized steps with the real unit beside it. Both are native controls, so touch, pointer, keyboard
// (arrows) and screen readers all work them. A change goes to the canvas as a `set-setting` command (`onChange`), so
// it is one Undo step and the list view follows it. A slider being dragged changes the build once, on release.
import { useEffect, useId, useRef, useState } from 'react';
import type { ChoiceSetting, NumberSetting, SettingValue } from '@servo/schema';
import { withUnit } from './model.ts';
import type { CardSetting } from './model.ts';

interface SettingProps<S> {
  readonly setting: S;
  readonly value: SettingValue;
  /** True in Run mode: the card shows the setting but the build cannot change (ground rule 4). */
  readonly locked: boolean;
  /** Applies the change; false when the canvas refused it. */
  onChange(value: SettingValue): boolean;
}

const Choice = ({ setting, value, locked, onChange }: SettingProps<ChoiceSetting>) => {
  const name = useId();
  return (
    <fieldset className="spec-card-setting" data-setting={setting.id} disabled={locked}>
      <legend className="spec-card-setting-label" data-speak="">
        {setting.label}
      </legend>
      <div className="spec-card-choices">
        {setting.options.map((option) => {
          const checked = option.id === value;
          return (
            <label key={option.id} className="spec-card-choice" data-checked={checked} {...(checked ? { 'data-speak': '' } : {})}>
              <input type="radio" name={name} value={option.id} checked={checked} onChange={() => onChange(option.id)} />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
};

const Slider = ({ setting, value, locked, onChange }: SettingProps<NumberSetting>) => {
  const id = useId();
  const current = typeof value === 'number' ? value : setting.default;
  const [draft, setDraft] = useState(current);
  const input = useRef<HTMLInputElement>(null);
  const commit = useRef(onChange);
  commit.current = onChange;

  useEffect(() => setDraft(current), [current]);
  // The native change event fires once a drag ends and on each arrow key; React's onChange fires on every move.
  useEffect(() => {
    const element = input.current;
    if (!element) return;
    const changed = (): void => {
      const next = Number(element.value);
      if (next !== current && !commit.current(next)) setDraft(current);
    };
    element.addEventListener('change', changed);
    return () => element.removeEventListener('change', changed);
  }, [current]);

  const shown = withUnit(draft, setting.unit);
  return (
    <div className="spec-card-setting" data-setting={setting.id}>
      <div className="spec-card-slider-head">
        <label className="spec-card-setting-label" htmlFor={id} data-speak="">
          {setting.label}
        </label>
        <output className="spec-card-slider-value" htmlFor={id} data-speak="">
          {shown}
        </output>
      </div>
      <input
        ref={input}
        id={id}
        className="spec-card-slider"
        type="range"
        min={setting.min}
        max={setting.max}
        step={setting.step}
        value={draft}
        aria-valuetext={shown}
        disabled={locked}
        onChange={(event) => setDraft(Number(event.currentTarget.value))}
      />
    </div>
  );
};

export const SettingControl = ({ entry, locked, onChange }: { readonly entry: CardSetting; readonly locked: boolean; onChange(value: SettingValue): boolean }) =>
  entry.setting.kind === 'number' ? (
    <Slider setting={entry.setting} value={entry.value} locked={locked} onChange={onChange} />
  ) : (
    <Choice setting={entry.setting} value={entry.value} locked={locked} onChange={onChange} />
  );
