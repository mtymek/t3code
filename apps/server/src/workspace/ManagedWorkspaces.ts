// @effect-diagnostics nodeBuiltinImport:off -- workspace directories are probed on disk.
/**
 * jj workspaces for forked threads (patches/jujutsu.md). Hauke's fork builds these into its
 * workspaces patch, which this fork does not carry, so this keeps only the jj backend that
 * `JjTurnHooks` needs. Git projects keep upstream's worktrees.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { ProjectId, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import { findRepositoryMarker } from "../vcs/RepositoryMarker.ts";
import { createJjWorkspace, deleteJjWorkspace, listJjWorkspaces } from "./JjWorkspaces.ts";
import { ManagedWorkspaceError } from "./WorkspaceCommand.ts";

type WorkspaceBackend = "git" | "jj" | "directory";

const NAME_MAX_LENGTH = 32;

export interface CreateManagedWorkspaceInput {
  readonly projectId: ProjectId;
  readonly projectRoot: string;
  readonly threadId: ThreadId;
  readonly title: string;
  readonly baseRef?: string | undefined;
  readonly startFromOrigin?: boolean | undefined;
}

export class ManagedWorkspaces extends Context.Service<
  ManagedWorkspaces,
  {
    readonly backendFor: (projectRoot: string) => Effect.Effect<WorkspaceBackend>;
    /** Always false: this fork has no agent-exec isolation. */
    readonly isIsolated: (path: string) => Effect.Effect<boolean, ManagedWorkspaceError>;
    readonly create: (
      input: CreateManagedWorkspaceInput,
    ) => Effect.Effect<
      { readonly worktreePath: string; readonly backend: WorkspaceBackend },
      ManagedWorkspaceError
    >;
    /** Forgets and deletes the jj workspace that holds `path`; false when `path` is not one. */
    readonly removeJjWorkspace: (path: string) => Effect.Effect<boolean, ManagedWorkspaceError>;
  }
>()("t3/workspace/ManagedWorkspaces") {}

function slug(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, NAME_MAX_LENGTH)
    .replace(/-+$/g, "");
  return normalized.length > 0 ? normalized : "workspace";
}

const isInside = (path: string, root: string) => {
  const relative = NodePath.relative(root, path);
  return relative !== "" && !relative.startsWith("..") && !NodePath.isAbsolute(relative);
};

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const context = yield* Effect.context<ProcessRunner.ProcessRunner>();
  const workspacesRoot = NodePath.join(config.baseDir, "workspaces");

  const backendFor: ManagedWorkspaces["Service"]["backendFor"] = (projectRoot) =>
    Effect.sync(() => findRepositoryMarker(projectRoot)?.kind ?? "directory");

  const create: ManagedWorkspaces["Service"]["create"] = Effect.fn("ManagedWorkspaces.create")(
    function* (input) {
      const marker = findRepositoryMarker(input.projectRoot);
      if (marker?.kind !== "jj") {
        return yield* new ManagedWorkspaceError({
          operation: "ManagedWorkspaces.create",
          detail: "Only jj repositories get workspaces in this fork.",
        });
      }
      const parent = NodePath.join(workspacesRoot, slug(NodePath.basename(input.projectRoot)));
      const taken = new Set((yield* listJjWorkspaces(marker.root)).map((entry) => entry.name));
      const seed = slug(input.title);
      let name = seed;
      for (
        let index = 2;
        taken.has(name) || NodeFS.existsSync(NodePath.join(parent, name));
        index++
      ) {
        name = `${seed}-${index}`;
      }
      yield* Effect.sync(() => NodeFS.mkdirSync(parent, { recursive: true }));
      const worktreePath = yield* createJjWorkspace({
        projectRoot: input.projectRoot,
        destination: NodePath.join(parent, name),
        name,
        description: `wip: ${input.title || name}`,
        baseRef: input.baseRef,
        startFromOrigin: input.startFromOrigin,
      });
      return { worktreePath, backend: "jj" as const };
    },
    Effect.provide(context),
  );

  const removeJjWorkspace: ManagedWorkspaces["Service"]["removeJjWorkspace"] = Effect.fn(
    "ManagedWorkspaces.removeJjWorkspace",
  )(function* (path) {
    const resolved = NodePath.resolve(path);
    if (!isInside(resolved, workspacesRoot)) return false;
    const [project, name] = NodePath.relative(workspacesRoot, resolved).split(NodePath.sep);
    if (project === undefined || name === undefined) return false;
    const root = NodePath.join(workspacesRoot, project, name);
    if (!NodeFS.statSync(NodePath.join(root, ".jj"), { throwIfNoEntry: false })?.isDirectory()) {
      return false;
    }
    yield* deleteJjWorkspace(root);
    return true;
  }, Effect.provide(context));

  const isIsolated: ManagedWorkspaces["Service"]["isIsolated"] = Effect.fn(
    "ManagedWorkspaces.isIsolated",
  )(function* () {
    return yield* Effect.succeed(false);
  });

  return ManagedWorkspaces.of({
    backendFor,
    isIsolated,
    create,
    removeJjWorkspace,
  });
});

export const layer = Layer.effect(ManagedWorkspaces, make).pipe(Layer.provide(ProcessRunner.layer));
