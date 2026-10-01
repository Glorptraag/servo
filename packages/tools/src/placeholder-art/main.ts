// `pnpm art`: node packages/tools/src/placeholder-art/main.ts [--parts <folder>] [--out <folder>] [--final <folder>]
import process from 'node:process';
import { runArt } from './cli.ts';

process.exitCode = runArt(process.argv.slice(2), process.cwd(), console);
