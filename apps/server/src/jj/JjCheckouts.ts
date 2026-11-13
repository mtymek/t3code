/**
 * Every checkout of a jj repository, for the composer's workspace menu: the jj workspaces, plus
 * Git worktrees of a colocated repository that have no jj workspace (`git worktree add`). Git
 * worktrees are read from `.git/worktrees/*` on disk, so a status read spawns no Git process.
 */
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";

import type { JjCheckout } from "@t3tools/contracts";
import { realpathOrResolve, type RepositoryMarker } from "../vcs/RepositoryMarker.ts";
import { decodeJsonBoolean, decodeJsonString, parseJjOutput } from "./jjTemplateJson.ts";

export const WORKSPACE_TEMPLATE = `${[
  "json(name)",
  "json(root)",
  "json(target.change_id().short(8))",
  "json(target.description().first_line())",
  "json(target.empty())",
].join(' ++ "\\t" ++ ')} ++ "\\n"`;

interface Io {
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
}

/** Roots of the Git worktrees that share the repository's Git directory, the main one included. */
const gitWorktreeRoots = Effect.fn("JjCheckouts.gitWorktreeRoots")(
  function* (io: Io, checkoutRoot: string) {
    const { fileSystem, path } = io;
    const dotGit = path.join(checkoutRoot, ".git");
    let commonDir = dotGit;
    if ((yield* fileSystem.stat(dotGit)).type === "File") {
      const pointer = /^gitdir:\s*(.+)$/m.exec(yield* fileSystem.readFileString(dotGit))?.[1];
      if (pointer === undefined) return [];
      // A linked worktree's `.git` names `<common>/worktrees/<name>`.
      commonDir = path.dirname(path.dirname(path.resolve(checkoutRoot, pointer.trim())));
    }
    const roots = path.basename(commonDir) === ".git" ? [path.dirname(commonDir)] : [];
    const worktrees = path.join(commonDir, "worktrees");
    for (const name of yield* fileSystem.readDirectory(worktrees)) {
      const gitdirFile = path.join(worktrees, name, "gitdir");
      const gitdir = yield* fileSystem
        .readFileString(gitdirFile)
        .pipe(Effect.orElseSucceed(() => ""));
      if (gitdir.trim().length === 0) continue;
      roots.push(path.dirname(path.resolve(path.dirname(gitdirFile), gitdir.trim())));
    }
    return roots;
  },
  Effect.orElseSucceed((): ReadonlyArray<string> => []),
);

/** The checkouts for a status read of `cwd`, from `jj workspace list -T WORKSPACE_TEMPLATE`. */
export const readCheckouts = Effect.fn("JjCheckouts.read")(function* (
  io: Io,
  input: { readonly marker: RepositoryMarker; readonly cwd: string; readonly workspaces: string },
) {
  const { fileSystem, path } = io;
  const subdirectory = path.relative(input.marker.root, realpathOrResolve(input.cwd));
  const cwdIn = (root: string) => (subdirectory === "" ? root : path.join(root, subdirectory));
  const jjCheckouts = yield* parseJjOutput(() =>
    input.workspaces
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => {
        const [name = "", root = "", changeId = "", description = "", empty = ""] =
          line.split("\t");
        return {
          name: decodeJsonString(name),
          kind: "jj" as const,
          root: realpathOrResolve(decodeJsonString(root)),
          changeId: decodeJsonString(changeId),
          description: decodeJsonString(description),
          empty: decodeJsonBoolean(empty),
        };
      }),
  );
  const known = new Set(jjCheckouts.map((checkout) => checkout.root));
  const gitCheckouts = input.marker.colocated
    ? (yield* gitWorktreeRoots(io, input.marker.root))
        .map(realpathOrResolve)
        .filter((root) => !known.has(root))
        .map((root) => ({
          name: path.basename(root),
          kind: "git" as const,
          root,
          changeId: null,
          description: "",
          empty: false,
        }))
    : [];
  const checkouts: Array<JjCheckout> = [];
  for (const { root, ...checkout } of [...jjCheckouts, ...gitCheckouts]) {
    // A workspace whose directory was deleted without `jj workspace forget` cannot host a thread.
    if (!(yield* fileSystem.exists(root).pipe(Effect.orElseSucceed(() => false)))) continue;
    checkouts.push({ ...checkout, cwd: cwdIn(root), current: root === input.marker.root });
  }
  return checkouts;
});
