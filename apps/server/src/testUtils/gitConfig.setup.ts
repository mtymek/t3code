// @effect-diagnostics nodeBuiltinImport:off -- setup runs before any Effect runtime exists.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

// Override inherited autocrlf, signing and init-branch settings through env so every git child gets stable fixtures.
const entries: ReadonlyArray<readonly [key: string, value: string]> = [
  ["core.autocrlf", "false"],
  ["core.filemode", "false"],
  ["core.longpaths", "true"],
  ["commit.gpgsign", "false"],
  ["tag.gpgsign", "false"],
  ["init.defaultBranch", "main"],
];

const existing = Number(process.env.GIT_CONFIG_COUNT ?? "0");
process.env.GIT_CONFIG_COUNT = String(existing + entries.length);
entries.forEach(([key, value], index) => {
  process.env[`GIT_CONFIG_KEY_${existing + index}`] = key;
  process.env[`GIT_CONFIG_VALUE_${existing + index}`] = value;
});

// jj gets the same treatment: a fixed identity and no signing, instead of the
// developer's config, so jj fixtures never wait on an SSH agent.
if (process.env.T3_TEST_JJ_CONFIG === undefined) {
  const jjConfig = NodePath.join(NodeOS.tmpdir(), `t3-test-jj-${process.pid}.toml`);
  NodeFS.writeFileSync(
    jjConfig,
    '[user]\nname = "Test"\nemail = "test@test.com"\n[signing]\nbehavior = "drop"\n[ui]\npaginate = "never"\n',
  );
  process.env.T3_TEST_JJ_CONFIG = jjConfig;
  process.env.JJ_CONFIG = jjConfig;
}
