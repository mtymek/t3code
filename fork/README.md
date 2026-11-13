# mtymek/t3code

This fork is upstream T3 Code (`pingdotgg/t3code`) at a stable release tag, plus a few local layers. It publishes its own CLI builds, and its `t3 update` installs them.

## Stack

Every layer is a jj commit with a bookmark, rebased onto each new upstream release:

| Bookmark           | Contents                                                                               | Who edits it                                |
| ------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------- |
| `v0.1.9` (a tag)   | upstream stable release                                                                | upstream                                    |
| `hauke-jj-tooling` | `fork/hauke-jj/`: the sync tool for Hauke's jj patch                                   | you, rarely                                 |
| `hauke-jj`         | Hauke's jj patch, generated                                                            | `fork/hauke-jj/sync.ts` only, never by hand |
| `jj-glue`          | code the jj patch needs because Hauke's other patches are left out                     | you, when a sync breaks something           |
| `main`             | the release workflow, the release repository constant, this file, and your own patches | you                                         |

`main` is the published head and the default branch on GitHub. Put new patches on top of `main` as their own commits, and describe each one so a later rebase conflict is easy to place.

How the jj patch is selected and refreshed is in [hauke-jj/README.md](hauke-jj/README.md).

## Fork-only changes outside the jj patch

- **`.github/workflows/fork-release.yml`** builds the Linux x64 and arm64 CLI archives and desktop AppImages, and the macOS arm64 CLI archive when asked, then publishes them as a GitHub release.
  - It reuses upstream's `release-desktop.yml` without editing it.
  - A desktop app built there takes `mtymek/t3code` as its update feed (`GITHUB_REPOSITORY` in `scripts/build-desktop-artifact.ts`), so it updates itself from this fork's releases through `latest-linux*.yml`.
  - The macOS desktop app is not published: an ad-hoc signed app cannot install its own updates.
- **`packages/shared/src/cliRelease.ts`** sets `CLI_RELEASE_REPOSITORY` to `"mtymek/t3code"`.
  - `t3 update` and server self-updates read releases from this fork.
  - `T3CODE_RELEASE_BASE_URL` and a managed-policy update mirror still override it.
  - `apps/server/src/cli/update.test.ts` and `apps/mobile/src/features/settings/environment-maintenance.test.ts` expect the fork's URL.
- **Upstream workflows** are disabled in the GitHub repository settings, except `fork-release.yml` and `release-desktop.yml`.
  - They need Blacksmith runners or upstream credentials.
  - To turn one back on: `gh workflow enable <file> --repo mtymek/t3code`.
  - A new upstream workflow file arrives enabled. Disable it after the push that brings it in.
- **Flexible split layout** (the `feat(web): flexible split layout` commit), off by default under Settings → Labs → Flexible layout.
  - Each thread's area becomes splits and tabs of chats, terminals, diffs, files, browsers and pull requests. Each thread keeps its own layout, saved in that frontend's browser storage.
  - `Ctrl+B` is the prefix (`v`/`-` split, `c` new tab, `h`/`j`/`k`/`l` move, `x` close, `z` zoom, `?` all keys). Pressing it twice sends one `Ctrl+B` to the focused pane.
  - New code is in `apps/web/src/workspaceLayout/`. It also edits 11 upstream files; `ChatView.tsx` is the one most likely to conflict.
  - In `ChatView.tsx` the patch reads `LayoutPaneContext`, hides the terminal and right-panel toggles in layout panes, renders `LayoutSurfaceHost` from `rightPanelContent.props`, and adds `backgroundThread` to the two composer-focus effects. Re-apply those when resolving a conflict there.
- **Terminal ANSI palette in themes** (the `feat(web): themes set the terminal's 16 ANSI colors` commit).
  - Themes gain `terminalAnsiBlack` … `terminalAnsiBrightWhite`, defaulting to the VS Code palettes the terminal used before. The VS Code importer maps `terminal.ansi*`, and the theme editor's advanced view has a Terminal palette group.
  - Based on Mathias Aerts' branch for upstream Ideas discussion [#31385](https://github.com/pingdotgg/t3code/discussions/31385). Drop this commit if upstream merges that feature.
  - Published theme files (`~/.t3/userdata/themes/`) may carry the new keys safely: builds without this patch ignore unknown roles there. A theme file imported through the editor's import does not; it is rejected.
  - `ThemeEditorPanel.tsx`'s import block is the likely conflict.
- **Arrange layout popup** (the `feat(web): Arrange layout popup` commit).
  - `Ctrl+.` (`Cmd+.` on macOS) or **Arrange layout…** in the command palette takes a plain-language request for the current thread, such as "browser on the right, terminal below". A model plans it as typed commands and the web client runs them, with Undo in the toast.
  - The plan runs through `TextGeneration.generateUiAssistantPlan` with the `uiAssistantModelSelection` setting (Settings → Threads → Layout assistant model, single-environment scope), which follows the text generation model when unset.
  - New code is in `apps/web/src/components/uiAssistant/`, `apps/server/src/uiAssistant/` and `packages/contracts/src/uiAssistant.ts`. Every `ProviderTextGeneration` implementation and test fake gains `generateUiAssistantPlan`; a new upstream driver or fake needs it too.
  - Likely conflicts: `ChatView.tsx` (the `useUiAssistant` call, the `uiAssistant.open` shortcut and the dialog next to `DeviceSetupDialogHost`), `CommandPalette.tsx`, `SettingsPanels.tsx` and `useChatTerminalActions.ts` (`splitPanelTerminal` reads the active surface from the store).
  - Unsupported on mobile.
- **New worktree in jj projects** (the `feat: New worktree in a jj project creates a jj workspace` commit).
  - The composer bases a jj thread's workspace on the checkout's `@-`, because jj leaves no current branch (`planComposerTurn`).
  - `ThreadLaunchService` asks `VcsTurnHooks.ownsLaunchWorkspace` and, for jj, creates and removes the workspace through `createLaunchWorkspace` and `removeLaunchWorkspace` (`JjTurnHooks`, `ManagedWorkspaces`) in place of `git worktree add`.
  - Drop it if a Hauke sync brings his workspaces patch's launch path.
  - Likely conflicts: `ThreadLaunchService.ts` (the worktree block in `prepareInBackground` and its failure cleanup) and `useComposerSend.ts` (the `startFromOrigin` spread).
  - Mobile still requires a base branch for jj projects.

## Versions

A fork build is named `<upstream version>-mtymek.<N>`, such as `0.1.9-mtymek.1`:

- T3 treats it as Stable, because only `-nightly.YYYYMMDD.N` and `-preview.YYYYMMDD.N` count as other channels.
- It sorts below the upstream version of the same number and above every fork build of an older upstream version.
- Start `N` at 1 for each upstream version. Raise it for another build on the same upstream version, for example after adding a patch.

## Checkout

The working checkout is a colocated jj repository with these remotes:

| Remote     | URL                                     |
| ---------- | --------------------------------------- |
| `origin`   | `git@github.com:mtymek/t3code.git`      |
| `upstream` | `https://github.com/pingdotgg/t3code`   |
| `hauke`    | `https://github.com/HaukeSchnau/t3code` |

To set up a new machine:

```sh
git clone --no-tags git@github.com:mtymek/t3code.git t3code-fork && cd t3code-fork
git remote add upstream https://github.com/pingdotgg/t3code
git remote add hauke https://github.com/HaukeSchnau/t3code
jj git init --colocate
jj config set --repo remotes.origin.fetch-tags '* ~ v*'
jj config set --repo 'revset-aliases."trunk()"' main@upstream
jj git fetch --remote upstream && jj git fetch --remote hauke && jj git fetch --remote origin
for b in hauke-jj-tooling hauke-jj jj-glue main; do jj bookmark track $b@origin; done
pnpm install --frozen-lockfile
```

The two `jj config` lines keep the fork stack mutable. jj treats `trunk()` and every tag as immutable, along with all their ancestors:

- **`trunk()`:** `jj git init` may point `trunk()` at `main@origin`, which freezes everything pushed. It must name `main@upstream`.
- **Release tags:** a fork release tag (`v*-mtymek.*`) on a stack commit freezes the stack below it. After a rebase, it also keeps the old commits visible, so every fork change shows up twice (divergent).
- **The symptom:** `sync.ts build` fails with `Error: Commit … is immutable`.

`--no-tags` and the `fetch-tags` setting keep the release tags out. Upstream's `v*` tags come from the `upstream` remote.

If a release tag gets in anyway, `git tag -l 'v*-mtymek.*'` lists it, and `git tag -d <tag>` followed by any jj command removes it from jj too.

`jj log -r 'immutable() & (hauke-jj-tooling::main)'` must print nothing. Do not edit `immutable_heads()` itself: with release tags no longer immutable, jj would rebase the commits the tags hold.

The tools a sync needs:

- jj 0.46 or newer
- Node from `package.json` `engines`
- pnpm from `packageManager`
- `gh`, authenticated with push and Actions rights on `mtymek/t3code`

`vp` is `node_modules/.bin/vp` after the install.

**Node must match `engines.node`.** `fork/node-bin-dir.sh` prints the directory of that Node version, from `PATH` or from mise. It exits non-zero with the reason when neither has it. Put it first on `PATH`:

```sh
dir="$(fork/node-bin-dir.sh)" && export PATH="$dir:$PATH" && node --version
```

An agent's shell commands each start a fresh shell, so an agent repeats that prefix in every command that runs `node`, `pnpm` or `vp`.

## Publishing a build

```sh
jj git push --remote origin -b hauke-jj-tooling -b hauke-jj -b jj-glue -b main
gh workflow run fork-release.yml --repo mtymek/t3code --ref main -f version=0.1.9-mtymek.1
gh run watch "$(gh run list --repo mtymek/t3code --workflow fork-release.yml --limit 1 --json databaseId --jq '.[0].databaseId')" --repo mtymek/t3code --exit-status
```

The workflow refuses a version without the `-mtymek.N` suffix, and one that is already released.

To check a published archive the way `t3 update` does:

1. Download `t3-<version>-linux-x64.tar.gz` and `SHA256SUMS` from the release.
2. Check the archive with `sha256sum -c`.
3. Unpack it and run `t3 --version`. It must print `t3 v<version>`.

## Installing on a machine

A machine has up to two parts to install: the T3 background service, and the desktop app if it uses one.

### Desktop app (Linux)

The desktop app shows the web UI it was built with, so fork UI changes appear only in a fork desktop app. It also writes `~/.t3/bin/t3`, the `t3` command, to run its own bundled CLI. With the upstream app, that `t3` reports the upstream version and looks for releases on `pingdotgg/t3code`.

Install the fork app once, from a plain terminal, with the app quit. The AppImage path is wherever the machine keeps it:

```sh
app=~/.local/share/t3code/T3-Code.AppImage
version=0.1.9-mtymek.3
cp "$app" "$app.bak"
curl -fL -o "$app.new" "https://github.com/mtymek/t3code/releases/download/v$version/T3-Code-$version-x86_64.AppImage"
chmod +x "$app.new" && mv "$app.new" "$app"
```

Start the app once so it rewrites `~/.t3/bin/t3`. From then on the app updates itself from this fork, and `t3` is the fork's CLI. Use the `arm64` AppImage on arm64 machines.

### Background service

The service owns the T3 home, and a desktop app connects to it, so the two update separately. On a machine whose `t3` is already the fork's CLI, plain `t3 update` installs the newest fork release.

A machine still on an upstream build needs the fork's address once. Its `t3` does not know the fork yet:

```sh
T3CODE_RELEASE_BASE_URL=https://github.com/mtymek/t3code/releases/download t3 update 0.1.9-mtymek.1 --allow-downgrade --yes
```

From then on, plain `t3 update` installs the newest fork release.

`--allow-downgrade` is needed only when the fork build sorts below the installed upstream build of the same version.

The update restarts the T3 background service, which ends every running agent turn on that machine. Run it from a plain terminal, never from a T3 thread on the same machine.

To go back to upstream:

```sh
T3CODE_RELEASE_BASE_URL=https://github.com/pingdotgg/t3code/releases/download t3 update <upstream version> --yes
```

## Weekly upgrade

A scheduled T3 task on sajaki follows this procedure every Sunday morning. Follow it by hand the same way.

0. **Prepare.** Run everything from the checkout root.
   - Get Node from `engines.node` as described in [Checkout](#checkout). If `fork/node-bin-dir.sh` fails, stop and report its message.
   - Check that `git tag -l 'v*-mtymek.*'` prints nothing; delete any tag it lists with `git tag -d`.
   - Check that `jj log -r 'immutable() & (hauke-jj-tooling::main)'` prints nothing. If it prints commits, fix the checkout's `trunk()` and tag settings as [Checkout](#checkout) describes before going on.

1. **Find the newest upstream stable release.** Run:

   ```sh
   gh release list --repo pingdotgg/t3code --exclude-pre-releases --limit 20 --json tagName,isDraft --jq '[.[] | select(.isDraft | not) | .tagName | select(test("^v[0-9]+\\.[0-9]+\\.[0-9]+$"))][0]'
   ```

   Call the result `TAG` (such as `v0.1.10`) and `VERSION` (such as `0.1.10`).

2. **Find what the fork last published.** Run:

   ```sh
   gh release list --repo mtymek/t3code --limit 20 --json tagName --jq '.[].tagName'
   ```

   Then decide:
   - If a `v$VERSION-mtymek.N` release exists, upstream has nothing new. Report that and stop.
   - If `TAG` is older than the newest fork release's base version, upstream has nothing new either. Stop.

3. **Fetch.** Run:

   ```sh
   jj git fetch --remote upstream
   jj git fetch --remote hauke
   jj git fetch --remote origin
   ```
   - Check that the local bookmarks match `origin` with `jj log -r 'bookmarks() & ~remote_bookmarks(remote=origin)'`.
   - If a local bookmark differs from `origin`, stop and report. Someone has unpushed work in this checkout.
   - Run `jj new main` so the working copy is empty.

4. **Read what Hauke changed.** Run `node fork/hauke-jj/sync.ts status`.
   - Read the `patches/jujutsu.md` diff it prints.
   - `hauke base` is the upstream commit Hauke last merged.
   - If `TAG` is not below that commit (`jj log -r "$TAG & ::main@hauke"` prints nothing), Hauke has not merged this release yet. Continue anyway, but say so in the report. Conflicts and type errors are then more likely.
   - If `status` lists new jj-named files, add each one to `owned` in `fork/hauke-jj/config.json`. A file that belongs to another of Hauke's patches goes under `excluded`, with the reason.

5. **Decide new hunks.** Run `node fork/hauke-jj/sync.ts hunks`. For each undecided hunk:
   - Take it (`take <key>`) when it is part of the jj patch. That means jj status, checkpoints, seals and reverts, the jj UI, jj RPC or MCP tools, or the adapter work that reports changed paths, command cwd and per-thread environment.
   - Skip it (`skip <key>`) when it belongs to another of Hauke's patches. These include workspaces and agent-exec isolation, skill packs, scheduled tasks, agent awareness, mobile distribution, Nix, Calder CI and his migration renumbering.
   - When one hunk mixes both, run `show <key> > /tmp/hunk.patch`. Delete the non-jj `+` lines, turn the non-jj `-` lines back into context lines (a leading space), and run `take <key> --edited /tmp/hunk.patch`.
   - Record every decision in the report.

6. **Build.** Run `node fork/hauke-jj/sync.ts build --onto "$TAG"`.
   - The tool rebases `hauke-jj-tooling` onto the tag, regenerates `hauke-jj`, and moves `jj-glue`, `main` and everything above onto it.
   - It ends by listing commits with conflicts.
   - Resolve them in the commit that has them, never in `hauke-jj`. Fix jj breakage in `jj-glue`; fix your own patches where they are.
   - If a conflict cannot be resolved with confidence, stop, push nothing, and report the conflicted files.
   - Then run `node fork/hauke-jj/sync.ts prune`.

7. **Verify.**
   - Run `pnpm install --frozen-lockfile`.
   - Run `node_modules/.bin/vp run typecheck` inside each package below. Do not run the repo-wide `vp run -r typecheck`.
     - `apps/server`, `apps/web`, `apps/mobile`
     - `packages/contracts`, `packages/shared`, `packages/client-runtime`
     - `packages/provider-core`, `packages/provider-acp`, `packages/provider-cursor`, `packages/provider-opencode`, `packages/provider-pi`
   - Run the tests:
     ```sh
     GIT_CONFIG_GLOBAL=/dev/null node_modules/.bin/vp test run apps/server/src/jj apps/server/src/vcs apps/server/src/git/GitWorkflowService.test.ts apps/server/src/checkpointing apps/server/src/orchestration-v2/CheckpointCaptureService.test.ts apps/server/src/orchestration-v2/CheckpointService.test.ts apps/server/src/provider/AgentContextBudget.test.ts apps/server/src/cli/update.test.ts packages/shared/src/cliRelease.test.ts packages/provider-opencode/src/server/toolItems.test.ts packages/client-runtime/src/state/jjStack.test.ts apps/web/src/components/JjStackControl.logic.test.ts apps/web/src/workspaceLayout
     ```
     `GIT_CONFIG_GLOBAL=/dev/null` keeps a personal `url.*.insteadOf` rule from failing `GitVcsDriver.test.ts`.
   - If `AgentContextBudget.test.ts` fails only on `mcpToolListJsonBytes`, set `apps/server/src/provider/agentContextBudget.json` to the measured value in `jj-glue`. The jj MCP tools add about 2 KB.
   - Fix any other failure in `jj-glue` or in the patch that caused it. If a fix is unclear, stop, push nothing, and report the failure output.

8. **Publish.** Push the four bookmarks and run the release workflow with `version=$VERSION-mtymek.1`, as in [Publishing a build](#publishing-a-build). Then check the x64 archive as described there.
   - If the push brought new upstream workflow files, disable them in `mtymek/t3code`.
   - Never update a machine's T3 install from the scheduled task. The user does that.

9. **Report**, in the thread:
   - the upstream tag
   - whether Hauke had merged it
   - the hunk decisions
   - the conflicts and how they were resolved
   - the check results with their final output lines
   - the release URL
   - the install command for the user's machines

## Adding a patch of your own

1. Run `jj new main -m "<type>(<scope>): <what changes for a user>"`.
2. Make the change and verify it.
3. Run `jj bookmark set main -r @`.
4. Publish a build with the next `-mtymek.N`.

Keep each patch small and in its own commit. The weekly upgrade rebases them all onto every new release, so each upstream file you touch is a possible conflict.

Record any patch that changes behaviour in the [Fork-only changes outside the jj patch](#fork-only-changes-outside-the-jj-patch) list above.
