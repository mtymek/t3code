#!/usr/bin/env node
// Rebuilds the `hauke-jj` commit from HaukeSchnau/t3code's jj patch. See README.md beside this file.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

const HERE = NodePath.dirname(new URL(import.meta.url).pathname);
const ROOT = NodePath.resolve(HERE, "../..");
const CONFIG_PATH = NodePath.join(HERE, "config.json");
const DECISIONS_PATH = NodePath.join(HERE, "decisions.json");
const STATE_PATH = NodePath.join(HERE, "state.json");

interface Config {
  /** jj/git remote that points at HaukeSchnau/t3code. */
  readonly remote: string;
  readonly branch: string;
  readonly upstreamRemote: string;
  readonly upstreamBranch: string;
  /** Bookmarks: the tooling commit, the generated patch commit, and the local glue commit. */
  readonly bookmarks: { readonly tooling: string; readonly patch: string; readonly glue: string };
  /** Files taken whole from Hauke's fork. */
  readonly owned: ReadonlyArray<string>;
  /** Owned files whose commits belong to other patches, so touching them does not make a commit a jj commit. */
  readonly ownedNotScanned: ReadonlyArray<string>;
  /** jj commits that touch no owned file, such as adapter plumbing. */
  readonly extraJjCommits: ReadonlyArray<string>;
  /** Upstream files with jj hooks that only merges or extra commits touch; their merge hunks are asked about too. */
  readonly hookFiles: ReadonlyArray<string>;
  /** Regexes for identifiers the jj patch introduces; a hunk that matches one is always asked about. */
  readonly signals: ReadonlyArray<string>;
  /** Files Hauke's jj commits touch that this fork leaves out, with the reason. */
  readonly excluded: Readonly<Record<string, string>>;
}

interface Decision {
  readonly file: string;
  readonly take: boolean;
  readonly note?: string;
  /** A trimmed copy of the hunk, for hunks that mix jj lines with another patch's lines. */
  readonly text?: string;
}

interface State {
  readonly rev: string;
  readonly base: string;
  readonly onto: string;
}

const readJson = <T>(path: string, fallback: T): T =>
  NodeFS.existsSync(path) ? (JSON.parse(NodeFS.readFileSync(path, "utf8")) as T) : fallback;

const writeJson = (path: string, value: unknown) =>
  NodeFS.writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

const sortedRecord = <T>(record: Record<string, T>): Record<string, T> =>
  Object.fromEntries(Object.entries(record).toSorted(([a], [b]) => a.localeCompare(b)));

function run(command: string, args: ReadonlyArray<string>, cwd = ROOT): string {
  return NodeChildProcess.execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 1 << 30,
  });
}

const git = (...args: string[]) => run("git", args);
const jj = (...args: string[]) => run("jj", ["--no-pager", ...args]);

function tryRun(command: string, args: ReadonlyArray<string>, cwd = ROOT) {
  const result = NodeChildProcess.spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 1 << 30,
  });
  return { ok: result.status === 0, stdout: result.stdout, stderr: result.stderr };
}

const commitOf = (rev: string) => git("rev-parse", "--verify", `${rev}^{commit}`).trim();
const jjCommitOf = (revset: string) =>
  jj("log", "--no-graph", "-r", revset, "-T", 'commit_id ++ "\\n"').trim();
const isAncestor = (a: string, b: string) =>
  tryRun("git", ["merge-base", "--is-ancestor", a, b]).ok;

interface Hunk {
  readonly key: string;
  readonly file: string;
  /** The diff's file header (`diff --git`, mode and `---`/`+++` lines). */
  readonly fileHeader: string;
  readonly header: string;
  readonly text: string;
  /** Commits that last touched the hunk's added lines, or removed its deleted lines. */
  readonly commits: ReadonlyArray<string>;
  readonly auto: "skip" | null;
}

interface Source {
  readonly rev: string;
  readonly base: string;
  /** Non-merge fork commits that touch an owned file. */
  readonly jjCommits: ReadonlySet<string>;
  readonly merges: ReadonlySet<string>;
  readonly hookFiles: ReadonlySet<string>;
  readonly signal: RegExp;
  readonly candidates: ReadonlyArray<string>;
}

function resolveSource(config: Config, revArg: string | undefined): Source {
  const rev = commitOf(revArg ?? `refs/remotes/${config.remote}/${config.branch}`);
  const base = git(
    "merge-base",
    rev,
    `refs/remotes/${config.upstreamRemote}/${config.upstreamBranch}`,
  ).trim();
  const range = `${base}..${rev}`;
  const jjCommits = new Set(
    git(
      "log",
      "--no-merges",
      "--format=%H",
      range,
      "--",
      ...config.owned.filter((file) => !config.ownedNotScanned.includes(file)),
    )
      .split("\n")
      .filter(Boolean),
  );
  for (const commit of config.extraJjCommits) jjCommits.add(commitOf(commit));
  const merges = new Set(git("log", "--merges", "--format=%H", range).split("\n").filter(Boolean));
  const owned = new Set(config.owned);
  const changed = new Set(git("diff", "--name-only", base, rev).split("\n").filter(Boolean));
  const touched = new Set<string>();
  for (const commit of jjCommits) {
    for (const file of git("show", "--format=", "--name-only", commit).split("\n")) {
      if (file && changed.has(file) && !owned.has(file) && !(file in config.excluded)) {
        touched.add(file);
      }
    }
  }
  for (const file of config.hookFiles) if (changed.has(file) && !owned.has(file)) touched.add(file);
  return {
    rev,
    base,
    jjCommits,
    merges,
    hookFiles: new Set(config.hookFiles),
    signal: new RegExp(config.signals.join("|")),
    candidates: [...touched].toSorted(),
  };
}

/** Removed lines per commit, so a deletion-only hunk can be attributed. */
function removalsByCommit(source: Source, file: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const log = git(
    "log",
    "-m",
    "--first-parent",
    "-p",
    "--format=COMMIT %H",
    `${source.base}..${source.rev}`,
    "--",
    file,
  );
  let current: Set<string> | null = null;
  for (const line of log.split("\n")) {
    if (line.startsWith("COMMIT ")) {
      current = new Set();
      out.set(line.slice(7), current);
    } else if (current && line.startsWith("-") && !line.startsWith("---")) {
      current.add(line.slice(1).trim());
    }
  }
  return out;
}

function hunkKey(file: string, body: ReadonlyArray<string>): string {
  const normalized = body
    .filter((line) => line.startsWith("+") || line.startsWith("-"))
    .map((line) => line.trimEnd())
    .join("\n");
  return NodeCrypto.createHash("sha256")
    .update(`${file}\n${normalized}`)
    .digest("hex")
    .slice(0, 12);
}

function hunksOf(source: Source, file: string): Hunk[] {
  const diff = git("diff", "-U3", source.base, source.rev, "--", file);
  if (diff.trim() === "") return [];
  const blame = new Map<number, string>();
  const blameText = tryRun("git", ["blame", "-s", "-l", source.rev, "--", file]).stdout;
  blameText.split("\n").forEach((line, index) => {
    if (line) blame.set(index + 1, line.slice(0, 40).replace(/^\^/, ""));
  });
  let removals: Map<string, Set<string>> | null = null;
  const [fileHeader = "", ...parts] = diff.split(/^(?=@@ )/m);
  const seen = new Map<string, number>();
  return parts.map((part) => {
    const lines = part.replace(/\n$/, "").split("\n");
    const header = lines[0]!;
    const body = lines.slice(1);
    let next = Number(/^@@ -\d+(?:,\d+)? \+(\d+)/.exec(header)![1]);
    const commits = new Set<string>();
    const removed: string[] = [];
    for (const line of body) {
      if (line.startsWith("+")) commits.add(blame.get(next++) ?? "unknown");
      else if (line.startsWith("-")) removed.push(line.slice(1).trim());
      else next++;
    }
    if (removed.length > 0) {
      removals ??= removalsByCommit(source, file);
      for (const text of removed) {
        const owners = [...removals].filter(([, set]) => set.has(text)).map(([commit]) => commit);
        if (owners.length === 0) commits.add("unknown");
        for (const owner of owners) commits.add(owner);
      }
    }
    const list = [...commits];
    const changed = body.filter((line) => line.startsWith("+") || line.startsWith("-"));
    const mentionsJj = changed.some((line) => source.signal.test(line));
    const fromJjCommit = list.some((commit) => source.jjCommits.has(commit));
    // A hunk is asked about when it names jj, or a jj commit wrote it; in a listed hook file, also
    // when a merge or an unknown source wrote it. Everything else stays out.
    const fromMerge = list.some((commit) => commit === "unknown" || source.merges.has(commit));
    const strict = source.hookFiles.has(file) && fromMerge;
    const auto = mentionsJj || fromJjCommit || strict ? null : "skip";
    const baseKey = hunkKey(file, body);
    const repeat = seen.get(baseKey) ?? 0;
    seen.set(baseKey, repeat + 1);
    return {
      key: repeat === 0 ? baseKey : `${baseKey}-${repeat + 1}`,
      file,
      fileHeader: fileHeader.replace(/\n$/, ""),
      header,
      text: `${header}\n${body.join("\n")}`,
      commits: list,
      auto,
    };
  });
}

function allHunks(source: Source): Hunk[] {
  return source.candidates.flatMap((file) => hunksOf(source, file));
}

function describeCommit(commit: string): string {
  if (commit === "unknown") return "unknown";
  return git("log", "-1", "--format=%h %s", commit).trim();
}

function loadConfig(): Config {
  return readJson<Config>(CONFIG_PATH, null as unknown as Config);
}

function parseFlags(args: string[]) {
  const flags: Record<string, string> = {};
  const rest: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg.startsWith("--")) {
      const [name, inline] = arg.slice(2).split("=", 2);
      flags[name!] = inline ?? (args[index + 1]?.startsWith("--") ? "" : (args[++index] ?? ""));
    } else rest.push(arg);
  }
  return { flags, rest };
}

function cmdStatus(config: Config, flags: Record<string, string>) {
  const state = readJson<State | null>(STATE_PATH, null);
  const source = resolveSource(config, flags.rev);
  console.log(`hauke tip:     ${describeCommit(source.rev)}`);
  console.log(`hauke base:    ${describeCommit(source.base)}`);
  const tags = git("tag", "--points-at", source.base).trim();
  if (tags) console.log(`               (= ${tags.split("\n").join(", ")})`);
  if (state === null) {
    console.log("ported rev:    none yet");
    return;
  }
  console.log(`ported rev:    ${describeCommit(state.rev)} onto ${state.onto}`);
  if (state.rev === source.rev) {
    console.log("Nothing new from Hauke.");
    return;
  }
  const watched = [...config.owned, ...source.candidates];
  const commits = git(
    "log",
    "--no-merges",
    "--format=%h %cs %s",
    `${state.rev}..${source.rev}`,
    "--",
    ...watched,
  ).trim();
  console.log(
    `\nHauke commits since the port that touch jj files or hook files:\n${commits || "(none)"}`,
  );
  const notes = git("diff", state.rev, source.rev, "--", "patches/jujutsu.md").trim();
  console.log(`\npatches/jujutsu.md changes:\n${notes || "(none)"}`);
  const newFiles = git("diff", "--name-only", "--diff-filter=A", state.rev, source.rev)
    .split("\n")
    .filter((file) => /(^|\/)(jj|Jj)[^/]*$|\/jj\//.test(file))
    .filter((file) => !config.owned.includes(file) && !(file in config.excluded));
  if (newFiles.length > 0) {
    console.log(
      `\nNew jj-named files to add to config.json owned or excluded:\n${newFiles.join("\n")}`,
    );
  }
}

function cmdHunks(config: Config, flags: Record<string, string>) {
  const source = resolveSource(config, flags.rev);
  const decisions = readJson<Record<string, Decision>>(DECISIONS_PATH, {});
  const hunks = allHunks(source);
  let undecided = 0;
  for (const hunk of hunks) {
    const decision = decisions[hunk.key];
    const status = decision
      ? decision.take
        ? "take"
        : "skip"
      : hunk.auto
        ? "auto-skip"
        : "UNDECIDED";
    if (status === "UNDECIDED") undecided++;
    if (!("all" in flags) && status !== "UNDECIDED") continue;
    console.log(`\n=== ${hunk.key} [${status}] ${hunk.file}`);
    for (const commit of hunk.commits) {
      const mark = source.jjCommits.has(commit) ? "jj " : source.merges.has(commit) ? "merge " : "";
      console.log(`    ${mark}${describeCommit(commit)}`);
    }
    if (!("brief" in flags)) console.log(hunk.text);
  }
  const counts = { take: 0, skip: 0, auto: 0 };
  for (const hunk of hunks) {
    const decision = decisions[hunk.key];
    if (decision) counts[decision.take ? "take" : "skip"]++;
    else if (hunk.auto) counts.auto++;
  }
  console.log(
    `\n${hunks.length} hunks in ${source.candidates.length} files: ${counts.take} take, ${counts.skip} skip, ${counts.auto} auto-skip, ${undecided} undecided.`,
  );
}

function cmdShow(config: Config, keys: string[], flags: Record<string, string>) {
  const source = resolveSource(config, flags.rev);
  const byKey = new Map(allHunks(source).map((hunk) => [hunk.key, hunk]));
  for (const key of keys) {
    const hunk = byKey.get(key);
    if (!hunk) throw new Error(`No hunk ${key} in Hauke's current diff.`);
    process.stdout.write(`${hunk.text}\n`);
  }
}

function cmdDecide(config: Config, take: boolean, keys: string[], flags: Record<string, string>) {
  const source = resolveSource(config, flags.rev);
  const byKey = new Map(allHunks(source).map((hunk) => [hunk.key, hunk]));
  const decisions = readJson<Record<string, Decision>>(DECISIONS_PATH, {});
  for (const key of keys) {
    const hunk = byKey.get(key);
    if (!hunk) throw new Error(`No hunk ${key} in Hauke's current diff.`);
    const text = flags.edited
      ? NodeFS.readFileSync(flags.edited, "utf8").replace(/\n$/, "")
      : undefined;
    decisions[key] = {
      file: hunk.file,
      take,
      ...(flags.note ? { note: flags.note } : {}),
      ...(text === undefined ? {} : { text }),
    };
  }
  writeJson(DECISIONS_PATH, sortedRecord(decisions));
  console.log(`Recorded ${keys.length} ${take ? "take" : "skip"} decision(s).`);
}

function patchFor(hunks: ReadonlyArray<Hunk>, decisions: Record<string, Decision>): string {
  const byFile = new Map<string, Hunk[]>();
  for (const hunk of hunks) byFile.set(hunk.file, [...(byFile.get(hunk.file) ?? []), hunk]);
  let patch = "";
  for (const list of byFile.values()) {
    patch += `${list[0]!.fileHeader}\n`;
    for (const hunk of list) patch += `${decisions[hunk.key]?.text ?? hunk.text}\n`;
  }
  return patch;
}

function cmdBuild(config: Config, flags: Record<string, string>) {
  const onto = flags.onto;
  if (!onto) throw new Error("build needs --onto <upstream tag or revision>.");
  const source = resolveSource(config, flags.rev);
  const ontoCommit = commitOf(onto);
  if (!isAncestor(ontoCommit, source.rev)) {
    console.warn(
      `warning: Hauke's ${source.rev.slice(0, 10)} does not contain ${onto}; jj will merge the patch onto it and may leave conflicts.`,
    );
  }
  const decisions = readJson<Record<string, Decision>>(DECISIONS_PATH, {});
  const hunks = allHunks(source);
  const undecided = hunks.filter((hunk) => !decisions[hunk.key] && !hunk.auto);
  if (undecided.length > 0) {
    throw new Error(
      `${undecided.length} undecided hunk(s). Run \`node fork/hauke-jj/sync.ts hunks\` and decide them first.`,
    );
  }
  const taken = hunks.filter((hunk) => decisions[hunk.key]?.take === true);
  const stale = Object.keys(decisions).filter((key) => !hunks.some((hunk) => hunk.key === key));

  const { tooling, patch, glue } = config.bookmarks;
  const toolingCommit = jjCommitOf(tooling);
  const scratch = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "hauke-jj-"));
  const workspace = NodePath.join(scratch, "ws");
  const workspaceName = NodePath.basename(scratch);
  jj("workspace", "add", "--name", workspaceName, "-r", source.base, workspace);
  let generated: string | null = null;
  let built = false;
  try {
    const inWs = (...args: string[]) => run("jj", ["--no-pager", ...args], workspace);
    generated = inWs("log", "--no-graph", "-r", "@", "-T", "change_id").trim();
    inWs("restore", "--from", source.rev, ...config.owned.map((file) => `root-file:"${file}"`));
    const patchFile = NodePath.join(scratch, "hunks.patch");
    NodeFS.writeFileSync(patchFile, patchFor(taken, decisions));
    const applied = tryRun("git", ["apply", "--recount", "--verbose", patchFile], workspace);
    if (!applied.ok) throw new Error(`git apply failed:\n${applied.stderr}`);
    inWs(
      "describe",
      "-m",
      `jj: port HaukeSchnau/t3code jj patch @ ${source.rev.slice(0, 10)}\n\nGenerated by fork/hauke-jj/sync.ts from ${source.rev} (upstream base ${source.base}).\nOwned files: ${config.owned.length}. Hook hunks taken: ${taken.length}.`,
    );
    built = true;
  } finally {
    tryRun("jj", ["--no-pager", "workspace", "forget", workspaceName]);
    NodeFS.rmSync(scratch, { recursive: true, force: true });
    // jj colocates workspaces of a colocated repository, so Git keeps a worktree entry.
    tryRun("git", ["worktree", "prune"]);
    if (!built && generated !== null) tryRun("jj", ["--no-pager", "abandon", generated]);
  }
  if (generated === null) throw new Error("The build workspace has no working-copy commit.");

  if (!isAncestor(ontoCommit, toolingCommit) || jjCommitOf(`${tooling}-`) !== ontoCommit) {
    jj("rebase", "-s", tooling, "-d", onto);
  }
  // Commit ids, not change ids: release tags keep earlier versions of these changes visible,
  // which makes their change ids divergent.
  const oldPatch = tryRun("jj", [
    "--no-pager",
    "log",
    "--no-graph",
    "-r",
    patch,
    "-T",
    "commit_id",
  ]);
  const oldPatchId = oldPatch.ok ? oldPatch.stdout.trim() : null;
  jj("rebase", "-r", generated, "-d", tooling);
  if (oldPatchId !== null) {
    const children = jj(
      "log",
      "--no-graph",
      "-r",
      `children(${oldPatchId}) ~ ${generated}`,
      "-T",
      'commit_id ++ "\\n"',
    )
      .split("\n")
      .filter(Boolean);
    for (const child of children) jj("rebase", "-s", child, "-d", generated);
    jj("abandon", oldPatchId);
  }
  jj("bookmark", "set", "--allow-backwards", patch, "-r", generated);
  const glueExists = tryRun("jj", [
    "--no-pager",
    "log",
    "--no-graph",
    "-r",
    glue,
    "-T",
    "change_id",
  ]).ok;
  if (!glueExists)
    console.log(
      `note: bookmark ${glue} does not exist yet; local glue goes in a commit on top of ${patch}.`,
    );

  writeJson(STATE_PATH, { rev: source.rev, base: source.base, onto } satisfies State);
  // Decisions and state belong to the tooling commit, wherever the working copy is.
  const toolingFiles = 'root:"fork/hauke-jj"';
  if (
    jjCommitOf("@") !== jjCommitOf(tooling) &&
    jj("diff", "--name-only", "-r", "@", toolingFiles).trim()
  ) {
    jj("squash", "--from", "@", "--into", tooling, toolingFiles);
  }
  console.log(
    `Built ${patch} = ${generated.slice(0, 12)} from Hauke ${source.rev.slice(0, 10)}: ${config.owned.length} owned files, ${taken.length} hunks.`,
  );
  if (stale.length > 0) {
    console.log(
      `${stale.length} decision(s) no longer match Hauke's diff; \`prune\` removes them.`,
    );
  }
  const conflicts = jj(
    "log",
    "--no-graph",
    "-r",
    `conflicts() & (${tooling}::)`,
    "-T",
    'change_id.short() ++ " " ++ description.first_line() ++ "\\n"',
  ).trim();
  if (conflicts) console.log(`\nCommits with conflicts:\n${conflicts}`);
}

function cmdPrune(config: Config, flags: Record<string, string>) {
  const source = resolveSource(config, flags.rev);
  const keys = new Set(allHunks(source).map((hunk) => hunk.key));
  const decisions = readJson<Record<string, Decision>>(DECISIONS_PATH, {});
  const kept = Object.fromEntries(Object.entries(decisions).filter(([key]) => keys.has(key)));
  writeJson(DECISIONS_PATH, sortedRecord(kept));
  console.log(
    `Removed ${Object.keys(decisions).length - Object.keys(kept).length} stale decision(s).`,
  );
}

const USAGE = `usage: node fork/hauke-jj/sync.ts <command> [--rev <hauke commit>]

  status                  What changed in Hauke's jj patch since the last port.
  hunks [--all] [--brief] Hook-file hunks that need a decision (--all lists every hunk).
  take <key...> [--note]  Carry these hunks. --edited <file> carries a trimmed copy of one hunk.
  skip <key...> [--note]  Leave these hunks out.
  show <key...>           Print hunks as they would be applied, e.g. to trim one for --edited.
  build --onto <tag>      Regenerate the ${"`hauke-jj`"} commit and restack on <tag>.
  prune                   Drop decisions for hunks Hauke's diff no longer has.

Run \`jj git fetch --remote hauke\` and \`jj git fetch --remote upstream\` first.`;

function main() {
  const [command, ...args] = process.argv.slice(2);
  const { flags, rest } = parseFlags(args);
  const config = loadConfig();
  switch (command) {
    case "status":
      return cmdStatus(config, flags);
    case "hunks":
      return cmdHunks(config, flags);
    case "take":
    case "skip":
      return cmdDecide(config, command === "take", rest, flags);
    case "show":
      return cmdShow(config, rest, flags);
    case "build":
      return cmdBuild(config, flags);
    case "prune":
      return cmdPrune(config, flags);
    default:
      console.log(USAGE);
      process.exitCode = command ? 1 : 0;
  }
}

main();
