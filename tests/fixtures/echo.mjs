/* eslint-env node */
// Simple echo script for tests. Prints all args space-joined.
const [, , ...args] = process.argv;
process.stdout.write(`${args.join(" ")}\n`);
