import { describe, expect, it } from 'vitest';
import * as entry from '../src/index.ts';

describe('@servo/sim-core', () => {
  it('loads the package entry', () => {
    expect(entry).toBeTypeOf('object');
  });
});
