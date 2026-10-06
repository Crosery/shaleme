# SOP: 发布 shaleme 到 npmjs

这份 SOP 约束的是当前仓库已经存在的发布链路，并沉淀了 0.1.0/0.1.1/0.1.2 三轮翻车的教训。
发 npm 前从头读一遍。

## 教训（为什么会有下面的规则）

1. **恢复码不是 OTP**（2026-09-29）。账号 2FA 配的是安全密钥（WebAuthn），`npm publish`
   返回 `EOTP` 时把 2FA 恢复码填进了 `--otp`，重复两次直接触发风控，账号被临时封禁。
   恢复码只用于登录救急，**永远不要**塞给 `--otp`。正确姿势是 `--auth-type=web`，
   让 npm 打开浏览器，用 Touch ID 批准。
2. **unpublish 会烧号**（2026-10-04）。整包 unpublish 后：同名 24h 内禁止任何新版本发布；
   `0.1.0` 这个版本号永久不可复用。npm 对被封禁/无权限的发布返回的是误导性 **404**，
   不是 401/403（npm/cli#9088），所以看到 404 先怀疑账号状态和信任配置，别怀疑包名。
3. **Trusted Publisher（OIDC）有先有鸡问题**：trust 配置挂在「已存在的包」上，
   包不在 registry 就没有配置入口。所以**首次发布必须本地交互式 2FA**，
   CI 只能在首发之后接手。0.1.1/0.1.2 在 CI 里反复 404 就是这个原因，不是 workflow 写错。
4. **npm CLI 版本不够也会 404**：OIDC 发布要求 npm ≥ 11.5.1 + Node ≥ 22.14。
   `publish.yml` 用 `setup-node` 的 node 24，满足；本地发布也别用旧 npm。
5. **2026-09-03 之后新建的 trusted publisher 默认只允许 `npm stage publish`**，
   必须手动勾 **Allow npm publish**，否则 CI 里的 `npm publish` 照样被拒。
6. **trust 配置创建后 2 天内必须完成首次 CI 发布**，否则过期作废，只能删了重建。
   所以「配 trust → 推 tag」要连着做。

## 当前状态（2026-10-07 更新）

- 包 `shaleme` 已在 registry：0.1.3 为「本地首发」产物（npm 11.19 把新包的首发
  自动走了 staged publishing：先落一个 `0.0.0-stage` 占位版本，真正的 0.1.3 在
  registry 处理完占位后入库；期间盲目重试会得到 `409 Failed to save packument`，
  正确做法是等一两分钟再查 `npm view shaleme version`，别连点）。
- Trusted publisher 已建立并完成首次 CI 验证发布（0.1.4，workflow 37500943694，
  provenance 进 sigstore 透明日志，`npm view shaleme@0.1.4` 可查 attestation），
  trust 已绑定仓库不可变身份、不会过期。重建命令（备用）：
  `npm trust github shaleme --repo Crosery/shaleme --file publish.yml --allow-publish --auth-type=web`
  验证：`npm trust list shaleme` → permissions: publish, stage publish。
- 之后发版的唯一入口：`.github/workflows/publish.yml`，唯一触发条件：`v*` tag push。
  只 push `main` 不会发包。

## 发布前检查

```bash
git fetch origin
git checkout main && git pull --ff-only origin main
git status -sb                    # 必须干净
node -p "require('./package.json').version"   # 要发的新版本
npm view shaleme versions         # 确认这个版本没发过
git tag --list 'v*' --sort=version:refname  # 确认 tag 不存在
```

同时确认：`package.json` 的 version、`src/cli.ts --version` 输出、
`src/adapters/index.ts` 的 `version:`、`README.md` 示例四处一致；
`dist/` 已用 `bun run build` 重建并提交（仓库跟踪 dist 供 GitHub 直装）。

```bash
# 1. 四处版本号一致 + 重建 bundle + 过测试
bun run build && bun test tests/

# 2. 提交并推 main
git add package.json src dist README.md
git commit -m "chore(release): 0.1.4"
git push origin main

# 3. 打 tag 推 tag —— tag 必须和 package.json 完全一致
git tag v0.1.4
git push origin refs/tags/v0.1.4

# 4. 盯 CI
gh run list --workflow publish.yml --limit 3
gh run view <run-id> --log-failed
```

## 发布流程（应急本地首发/修包，仅 OIDC 不可用时）

```bash
npm login --auth-type=web              # 浏览器 + Touch ID，不要用 --otp
npm publish --access public --provenance --auth-type=web
```

- 工作区必须干净、当前 commit 必须已推到 GitHub，否则 provenance 构建失败。
- 失败返回 404 时：先查 `npm whoami`、账号是否又被风控、包是否在 24h unpublish 冷却里。

## 发布后检查

```bash
npm view shaleme version                      # 新版本
npx shaleme@latest --version                  # 0.1.4 输出对
# provenance 签名在包页面 Security 区块可见
```

榜单端验证：报告页「上传到榜单」默认烧入 `https://shaleme.crosery.cc.cd/submit`，
见 `web/README.md` 的部署与排查。

## 常见错误速查

| 报错 | 根因 | 处理 |
| --- | --- | --- |
| CI `404 PUT ...shaleme` | 包不存在时走 OIDC / trust 配置错 / npm CLI 太旧 | 首发走本地 web auth；核对 user/repo/workflow 文件名逐字一致 |
| `403 cannot publish over previously published versions` | 版本号重复 | bump 新版本，npm 版本不可覆盖 |
| `EOTP` / `ENEEDAUTH` | 本地发布缺 2FA | `--auth-type=web`，Touch ID；**绝不填恢复码** |
| 账号 `temporarily suspended` | 异常 2FA 行为（如恢复码当 OTP） | 用 `docs/npm-appeal.md` 申诉 |
| tag push 后没有 run | tag 不是 `v*` 或没推到远端 | `git push origin refs/tags/v0.1.4` |
