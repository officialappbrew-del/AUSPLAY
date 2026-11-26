## Goal

Improve ESLint plugin loading in `/workspace/repo`.

- Plugins declared directly by an active config file must resolve relative to that config file's directory.
- Plugins declared by a config loaded through `extends` must resolve relative to the extending config file's directory.
- When configs active for the same target file load one plugin from different physical locations, ESLint must throw a descriptive conflict error.
- The conflict error must name the plugin.
- The conflict error must name both config sources.
- When the same plugin resolves to the same physical file across all active configs for a target file, ESLint must not throw a conflict error.
- Config files that apply to separate, non-overlapping target files must not conflict merely because they load different physical copies of the same plugin.
- Each matching file of separate config files must still produce a lint result.
- Users must be able to set one shared plugin-resolution directory.
- When this override is provided, all plugins load from that directory.
- When this override is provided, conflicts caused only by separate local installations are suppressed.
- Changing the plugin installation used for a target must not change which configuration results apply to that target.
- When a plugin cannot be found and no override is set, the error must report the directory of the config file whose plugin lookup failed.
- Users should receive the plugin intended by each configuration, including inherited configurations, with an explicit exception for the `--config` option which resolves from `cwd`.

## Constraints & Preferences

- In `lib/cli-engine/config-array-factory.js`, `createContext` must accept `{ cwd }` as its first argument.
- The remaining `createContext` parameters must be `providedType`, `providedName`, `providedFilePath`, and `providedMatchBasePath`.
- The first `createContext` argument must be an object holding `cwd`.
- The first `createContext` argument must not be a plain directory string.
- When `providedType`, `providedName`, `providedFilePath`, and `providedMatchBasePath` are unchanged, `createContext` must preserve its current `filePath` result.
- With those arguments unchanged, `createContext` must preserve its current `matchBasePath` result.
- With those arguments unchanged, `createContext` must preserve its current `name` result.
- With those arguments unchanged, `createContext` must preserve its current `type` result.
- In `lib/cli-engine/cli-engine.js`, `CLIEngine` must accept `resolvePluginsRelativeTo` as the shared directory override.
- `executeOnFiles()` must throw when one target gets conflicting physical copies of a plugin.
- The conflict message must read `Plugin "<pluginId>" was conflicted between "<importerName1>" and "<importerName2>".`.
- The conflict error's `messageTemplate` must be `"plugin-conflict"`.
- The conflict error's `messageData.pluginId` must hold the plugin identifier string.
- `messageData.plugins` must be an array of `{ filePath: string, importerName: string }` records.
- `messageData.plugins` must list records in message order.
- Conflict sources must be listed from higher to lower configuration precedence.
- A regular config file's `importerName` must be its path relative to `cwd`.
- For example, a regular config file can have the relative path `a/.eslintrc.json`, using the platform `path.sep`.
- A file given through `configFile` must have `"--config"` as its `importerName`.
- Plugins given through the `plugins` option must have `"CLIOptions"` as their `importerName`.
- In `lib/cli-engine/cascading-config-array-factory.js`, `CascadingConfigArrayFactory` must accept `resolvePluginsRelativeTo`.
- When `resolvePluginsRelativeTo` is omitted, plugin resolution must follow the applicable config file's resolution base.
- Plugin resolution must not default to `cwd` when `resolvePluginsRelativeTo` is omitted.

## Progress

### Done

- [x] Confirmed the repository is ESLint `7.0.0-alpha.2`.
- [x] Edited `lib/cli-engine/config-array-factory.js` so `createContext` takes `{ cwd }` as its first argument.
- [x] Every internal `createContext` call in `lib/cli-engine/config-array-factory.js` passes `{ cwd }`.
- [x] When `resolvePluginsRelativeTo` is given, the `ConfigArrayFactory` constructor stores `path.resolve(cwd, resolvePluginsRelativeTo)`.
- [x] When `resolvePluginsRelativeTo` is omitted, the `ConfigArrayFactory` constructor leaves it as `void 0`.
- [x] `_loadPlugin` sets `const relativeToDirectory = resolvePluginsRelativeTo || ctx.matchBasePath`.
- [x] The plugin-missing `messageData` reports `resolvePluginsRelativeTo: relativeToDirectory`.
- [x] The `additionalPluginPool` branch passes `filePath: void 0`.
- [x] Removed the `resolvePluginsRelativeTo = cwd` default from the `CascadingConfigArrayFactory` constructor.
- [x] Added `checkPluginConflicts(configArray, filePath)` to `lib/cli-engine/cascading-config-array-factory.js`.
- [x] `getConfigArrayForFile` calls `checkPluginConflicts(finalConfigArray, absoluteFilePath)` before returning.
- [x] `getConfigArrayForFile` skips the conflict check when no `filePath` is given.
- [x] Wrote `messages/plugin-conflict.txt`.
- [x] Updated only the `resolvePluginsRelativeTo` JSDoc in `lib/cli-engine/cli-engine.js`.
- [x] Changed the `createContext` test calls in `tests/lib/cli-engine/config-array-factory.js` to pass `{ cwd: tempDir }`.
- [x] Renamed the test `should load the plugin from the project root.` to `should load the plugin from the directory of the config file.`.
- [x] The renamed test expects `subdir/node_modules/eslint-plugin-subdir/index.js`.
- [x] Added the empty fixture `tests/fixtures/config-hierarchy/broken/plugins/node_modules/eslint-plugin-example.js`.
- [x] Updated the first plugin-missing test in tests/lib/cli-engine/cli-engine.js to expect the config file's directory.
- [x] Updated the second plugin-missing test in tests/lib/cli-engine/cli-engine.js to expect the config file's directory.
- [x] The `extends` plugin-missing test expects `getFixturePath("module-not-found", "extends-plugin")`.
- [x] `tests/lib/cli-engine/config-array-factory.js` ran with 212 passing.
- [x] `tests/lib/cli-engine/cascading-config-array-factory.js` ran with 80 passing.
- [x] `tests/lib/cli-engine/cli-engine.js` ran with 325 passing.
- [x] The `tests/lib/linter` directory ran with 539 passing.
- [x] A combined recursive run from `tests/lib/cli-engine` plus two CLI test files gave 1073 passing.
- [x] That combined run gave 8 failing.
- [x] With the agent's plugin-resolution implementation changes stashed, the formatter tests had failures.
- [x] With those implementation changes stashed, `tests/lib/cli.js` failed `should return an error when rule isn't found`.
- [x] The agent concluded that the observed failures pre-existed its plugin-resolution changes.
- [x] Verified that CLI option plugins use `create(cliConfigData, { name: "CLIOptions" })`.
- [x] CLI option plugins have no `filePath`.
- [x] CLI option plugins have no `basePath`.
- [x] With no `filePath` or `basePath`, `matchBasePath` is `cwd`.
- [x] Verified that `loadFile(specificConfigPath, { name: "--config", basePath: cwd })` loads the `--config` file.
- [x] Verified that `createContext` derives `name` from `providedName`, then the path relative to `cwd`, then an empty string.
- [x] Verified that `createContext` derives `matchBasePath` from `providedMatchBasePath`, then the config file directory, then `cwd`.
- [x] Verified the `criteria.test` API against `getMatchedIndices`.
- [x] `getMatchedIndices` includes an element when `!element.criteria || element.criteria.test(filePath)`.
- [x] Verified that `DefaultIgnorePattern` appears in `baseConfigArray`.
- [x] Verified that the `--rulesdir` pseudo plugin appears in `baseConfigArray`.
- [x] Ancestor configs follow the base config array.
- [x] The personal config follows ancestor configs.
- [x] `.eslintignore` follows the personal config.
- [x] `--config` precedes `.eslintignore`.
- [x] `CLIOptions` is last in the final config array.
- [x] `CLIOptions` has the highest precedence.
- [x] Read `tests/lib/cli-engine/_utils.js`.
- [x] The utility file defines `defineCascadingConfigArrayFactoryWithInMemoryFileSystem`.
- [x] The utility file defines `defineCLIEngineWithInMemoryFileSystem`.
- [x] Wrote a 12-scenario scratch verification script at `/tmp/check-plugin-conflicts.js`.
- [x] The scratch script's root is `path.join(os.tmpdir(), "eslint/check-plugin-conflicts")`.
- [x] Re-ran `node /tmp/check-plugin-conflicts.js` after fixing bugs in the script.
- [x] The scratch script printed `12 scenarios passed.`.
- [x] The scratch scenarios verified per-config-file plugin resolution.
- [x] The scratch scenarios verified `extends` plugin resolution relative to the extending config file.
- [x] The scratch scenarios verified that a decoy plugin copy inside the shareable config package is not used.
- [x] The scratch scenarios verified that a plugin conflict throws.
- [x] The scratch scenarios verified the exact conflict message.
- [x] The scratch scenarios verified `messageTemplate: "plugin-conflict"`.
- [x] The scratch scenarios verified the precedence order in `messageData`.
- [x] The scratch scenarios verified that the same physical plugin file does not cause a conflict.
- [x] The scratch scenarios verified that separate target files do not conflict.
- [x] The scratch scenarios verified that separate target files produce lint results.
- [x] The scratch scenarios verified that the first separate target file produces a lint result.
- [x] The scratch scenarios verified that the second separate target file produces a lint result.
- [x] The scratch scenarios verified that `resolvePluginsRelativeTo` suppresses conflicts.
- [x] The scratch scenarios verified that plugin-missing errors report the config directory.
- [x] The scratch scenarios verified a CLIOptions conflict with the message `Plugin "foo" was conflicted between "CLIOptions" and "a/.eslintrc.json".`.
- [x] The scratch scenarios verified that the CLIOptions same-file case does not throw.
- [x] The scratch scenarios verified that `--config` plugins resolve from `cwd`.
- [x] The scratch scenarios verified that a file loaded through `--config` has the `"--config"` importer name.
- [x] The scratch scenarios verified that `getConfigArrayForFile()` without a path skips the conflict check.
- [x] The scratch scenarios verified that plugin declarations in non-matching overrides do not conflict.

### In Progress

- [ ] Deciding how to convert the verified scratch scenarios into permanent test files.

## Key Decisions

- The agent chose `ctx.matchBasePath` as the plugin-resolution base when no override is set.
- `ctx.matchBasePath` survives the `{ ...ctx, filePath, name }` spread.
- Using `ctx.matchBasePath` keeps `extends` plugins on the extending config file's directory.
- The agent rejected `ctx.filePath` as the plugin-resolution base.
- A decoy plugin copy inside a shareable config package would win if `ctx.filePath` were used.
- The agent rejected adding a new field to the object returned by `createContext`.
- The required `createContext` parameters do not include such a return-object field.
- Under `matchBasePath`, the `--config` file's plugins resolve from `cwd`.
- `createCLIConfigArray` passes `basePath: cwd` for the `--config` file.
- CLIOptions plugins resolve from `cwd`.
- CLIOptions has no `filePath`.
- The agent reconsidered the `--config` behavior after seeing `loadFile(specificConfigPath, { name: "--config", basePath: cwd })`.
- The agent kept the `cwd` behavior for `--config`.
- `checkPluginConflicts` walks config elements from last to first.
- The last config element has the highest precedence.
- `checkPluginConflicts` skips an element when `element.criteria && !element.criteria.test(filePath)`.
- `checkPluginConflicts` skips plugin records with no `filePath`.
- Pool plugins have no `filePath`.
- Failed plugin loads have no `filePath`.
- `checkPluginConflicts` keeps the first record per plugin id.
- A later record for the same plugin id with a different `filePath` triggers a conflict.
- The conflict is thrown through `Object.assign` with `messageTemplate: "plugin-conflict"`.
- The agent reasoned that `_finalizeConfigArray` returns a frozen config array ordered: base-array elements (`DefaultIgnorePattern` and the `--rulesdir` pseudo plugin), ancestor configs, personal config, then CLI config-array elements (`--config`, `.eslintignore`, `CLIOptions`).
- The agent fixed the scratch script's `collect()` to mirror `checkPluginConflicts` reverse iteration.
- The agent fixed the scratch script's `collect()` to apply the `criteria.test` filter.
- While debugging the test, the agent noted that config-array iteration proceeds from lowest precedence to highest.
- The final scratch scenario 10 removed the `a/node_modules` copy so both records resolve to the root copy to avoid a conflict.
- `executeOnFiles` returns a LintReport object with a `results` array, not a plain array.

## Next Steps

1. Decide how to convert the verified scratch scenarios into permanent test files.

## Critical Context

- `messages/plugin-conflict.txt` names the plugin.
- `messages/plugin-conflict.txt` names the `filePath` of each conflicting record.
- `messages/plugin-conflict.txt` names the `importerName` of each conflicting record.
- `messages/plugin-conflict.txt` suggests the `--resolve-plugins-relative-to` option.
- The agent found earlier that bin/eslint.js renders ../messages/${err.messageTemplate}.txt through lodash.template.
- The agent believed that `tests/lib/cli-engine/_utils.js` stubs `ModuleResolver` via proxyquire over an in-memory file system.
- The read of `tests/lib/cli-engine/_utils.js` was completed.
- `defineCascadingConfigArrayFactoryWithInMemoryFileSystem` accepts `{ cwd: () => root, files }`.
- `defineCascadingConfigArrayFactoryWithInMemoryFileSystem` subclasses `CascadingConfigArrayFactory` to override `cwd`.
- In-memory fixture plugin files use `module.exports = { rules: { "test": context => ({}) } };`.