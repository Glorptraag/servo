import { describe, expect, it } from 'vitest';
import * as entry from '../src/index.ts';
import { fixture, catalogue } from './helpers/catalogue.ts';

describe('@servo/canvas', () => {
  it('exports mountCanvas (task 3.1) and applyEdit (tasks 3.2 and 3.3), wiring commands included', () => {
    expect(entry.mountCanvas).toBeTypeOf('function');
    expect(entry.applyEdit).toBeTypeOf('function');
    const build = fixture('led-circuit');
    const result = entry.applyEdit(build, { kind: 'disconnect', wireId: 'w1' }, catalogue);
    expect(result.ok && result.blueprint.wires.map((wire) => wire.id)).toEqual(['w2', 'w3']);
  });
});
