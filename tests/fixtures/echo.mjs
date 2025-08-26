// Simple echo script for tests. Prints all args space-joined.
const [, , ...args] = process.argv;
console.log(args.join(' '));
