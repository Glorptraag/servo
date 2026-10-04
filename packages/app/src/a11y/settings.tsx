// The access options as four switches (task 5.7), shown on Home and on the Settings page. Each is a native checkbox
// with the switch role inside its label, so a tap or a click anywhere on the row, Space, and a screen reader all reach
// it the same way (ground rule 8). Space ticks a checkbox and is never Run and Stop there (src/run-bar/keys.ts).
import { useId, useSyncExternalStore } from 'react';
import { ACCESS_OPTIONS } from './prefs.ts';
import type { AccessStore } from './prefs.ts';
import { ACCESS_TEXT } from './text.ts';
import './a11y.css';

export interface AccessSettingsProps {
  readonly store: AccessStore;
}

export const AccessSettings = ({ store }: AccessSettingsProps) => {
  const id = useId();
  const prefs = useSyncExternalStore(store.subscribe, () => store.prefs);
  return (
    <fieldset className="a11y-settings" data-region="access">
      <legend className="a11y-settings-heading">{ACCESS_TEXT.heading}</legend>
      {ACCESS_OPTIONS.map((option) => {
        const text = ACCESS_TEXT.options[option];
        return (
          <label key={option} className="a11y-option" data-option={option} data-on={prefs[option]}>
            <input
              type="checkbox"
              role="switch"
              className="a11y-switch"
              checked={prefs[option]}
              aria-labelledby={`${id}-${option}-name`}
              aria-describedby={`${id}-${option}`}
              onChange={(event) => store.set(option, event.currentTarget.checked)}
            />
            <span className="a11y-option-text">
              <span id={`${id}-${option}-name`} className="a11y-option-name">
                {text.name}
              </span>
              <span id={`${id}-${option}`} className="a11y-option-line">
                {text.line}
              </span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
};
