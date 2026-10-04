// Shared CLI helpers for the asset scripts.
//
// Every script walks the same tree and accepts the same `--folder <path>`
// override, so the default root and the flag parsing live here. Semantics are
// the ones meta_generator.js has always had: a flag is present if it appears
// anywhere in argv, and a valued flag takes the next argument verbatim.

export const DEFAULT_ROOT =
  "/Users/dwhitty/Documents/Hand_Theracraft/Component_assets";

export function parseArgs(argv) {
  const args = argv.slice();
  return {
    args,
    has(flag) {
      return args.includes(flag);
    },
    value(flag) {
      const idx = args.indexOf(flag);
      return idx !== -1 && args[idx + 1] ? args[idx + 1] : undefined;
    },
  };
}
