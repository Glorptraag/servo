import { describe, expect, it } from 'vitest';
import * as entry from '../src/index.ts';

describe('@servo/tools', () => {
  it('loads the package entry', () => {
    expect(entry).toBeTypeOf('object');
  });
});
