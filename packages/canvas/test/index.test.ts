import { describe, expect, it } from 'vitest';
import * as entry from '../src/index.ts';
import { fixture, catalogue } from './helpers/catalogue.ts';

describe('@servo/canvas', () => {
  it('exports mountCanvas (task 3.1) and applyEdit (task 3.2; connect and disconnect come with task 3.3)', () => {
    expect(entry.mountCanvas).toBeTypeOf('function');
    expect(entry.applyEdit).toBeTypeOf('function');
    const build = fixture('led-circuit');
    expect(() => entry.applyEdit(build, { kind: 'disconnect', wireId: 'w1' }, catalogue)).toThrow(/task 3\.3/);
  });
});
