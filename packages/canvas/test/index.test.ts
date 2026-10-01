import { describe, expect, it } from 'vitest';
import * as entry from '../src/index.ts';

describe('@servo/canvas', () => {
  it('exports mountCanvas (task 3.1) and the applyEdit stub (tasks 3.2 and 3.3)', () => {
    expect(entry.mountCanvas).toBeTypeOf('function');
    expect(() => entry.applyEdit(undefined as never, undefined as never, undefined as never)).toThrow(/tasks 3\.2 and 3\.3/);
  });
});
