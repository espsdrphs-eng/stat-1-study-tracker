import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

test("sidebar version badge uses package version and build-injected commit",async()=>{
  const [pkg,config,app]=await Promise.all([
    readFile("package.json","utf8").then(JSON.parse),
    readFile("vite.config.ts","utf8"),
    readFile("src/App.tsx","utf8"),
  ]);
  assert.match(config,/readFileSync\("package\.json"/);
  assert.match(config,/__APP_VERSION__:\s*JSON\.stringify\(appVersion\)/);
  assert.match(config,/process\.env\.GITHUB_SHA\|\|process\.env\.VITE_APP_COMMIT/);
  assert.match(app,/v\{__APP_VERSION__\} · \{__APP_COMMIT__\.slice\(0,7\)\}/);
  assert.equal(pkg.version,"0.1.0");
});
