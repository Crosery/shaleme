# shaleme 榜单 (web)

在 Cloudflare Workers 上托管的 shaleme 排行榜：收集各模型「你说得对」类附和行为的
命中次数与 MDI，按人排名，并提供模型维度视图。

技术栈：Astro（`output: "server"`）+ `@astrojs/cloudflare` + Cloudflare Workers +
D1 + GitHub OAuth。没有前端框架，没有客户端状态，页面全部服务端渲染。


## 官方实例状态（2026-10-07）

| 项 | 值 |
| --- | --- |
| 地址 | <https://shaleme.crosery.cc.cd>（CLI 默认烧入 `/submit`） |
| Worker / D1 | `shaleme-leaderboard`，`database_id = 3e213812-1cfd-494f-ab41-28a8910befc8`，迁移已应用 |
| 域名 | zone `crosery.cc.cd`，`routes` 里 `custom_domain: true`，`workers_dev: false`，`APP_URL = https://shaleme.crosery.cc.cd` |
| 部署方式 | 本地 `wrangler login` + `npm run deploy`（账号 `2022003007@yangtzeu.edu.cn's Account`） |
| 密钥 | `SESSION_SECRET`、`GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET` 三个 secret 均已 `wrangler secret put` 写入（OAuth App id `3909756`，回调 `https://shaleme.crosery.cc.cd/api/auth/github/callback`）。端到端已实测：报告页表单 POST `/submit` → GitHub 授权 → 回调消费 pending token → 落榜显示名次。 |


## 目录结构

```
web/
├── migrations/
│   └── 0001_init.sql               # 全部表与索引
├── src/
│   ├── env.d.ts                    # Worker 变量与最小 D1 类型声明
│   ├── layouts/BaseLayout.astro     # 全局样式与浅色主题
│   ├── lib/
│   │   ├── auth.ts                 # GitHub OAuth + HMAC 签名的无状态会话
│   │   ├── db.ts                   # 全部 SQL 集中在这里
│   │   ├── report.ts               # 提交载荷校验与 MDI 分档
│   │   └── types.ts                # 与 CLI 对齐的载荷类型
│   ├── components/                 # StatusBanner
│   └── pages/
│       ├── index.astro             # 榜单：人榜 + 模型榜双榜切换
│       ├── models.astro            # 单模型下钻
│       ├── upload.astro            # 上传说明 + 提交结果落点
│       ├── submit.ts               # 报告页「上传到榜单」的落点
│       ├── u/[login].astro         # 个人成绩页
│       └── api/auth/github/        # login / callback / logout
├── astro.config.mjs
├── wrangler.jsonc
├── tsconfig.json
├── package.json
└── .dev.vars.example
```

---

## 提交契约

报告页的「上传到榜单」按钮发的是一个**普通 HTML 表单 POST**
（`application/x-www-form-urlencoded`），只有一个字段：

| 字段 | 值 |
| --- | --- |
| `payload` | `LeaderboardReportPayload` 的 JSON 字符串 |

形状（同时定义在 CLI 的 `src/types.ts` 与本目录 `src/lib/types.ts`）：

```jsonc
{
  "version": "0.1.2",
  "droolCount": 142,
  "assistantMessages": 5321,
  "mdi": 26.69,
  "sessionsScanned": 37,
  "modelCount": 4,
  "modelEntries": [
    { "model": "gpt-5", "droolCount": 88, "totalMessages": 2100, "mdi": 41.9 }
  ],
  "generatedAt": 1759100000000
}
```

所以榜单地址必须配成 `<你的域名>/submit`：

```bash
npx shaleme --leaderboard https://shaleme.example.com/submit
# 或
export SHALEME_LEADERBOARD_URL=https://shaleme.example.com/submit
```

服务端对这个请求的处理：

- 字段名不是 `payload`、JSON 坏了、数值非有限或为负 → 拒绝，跳回首页并带一个
  `state` 提示，不写库。
- 未登录 → 把载荷存在 D1 的 `leaderboard_pending_submissions`，
  换一个 10 分钟有效的一次性 token，然后跳 GitHub 登录；登录成功后由 OAuth
  回调消费这个 token 并落榜。**跨站表单 POST 不保证带上 SameSite=Lax 的 cookie，
  所以登录后再提交这条路不能只靠 cookie。**
- 已登录 → 直接 upsert。

服务端会做的事：`assistantMessages` 为 0 时把 `mdi` 归零；否则用
`droolCount / assistantMessages * 1000` 重算，只接受与计算结果相差 1% 以内的上报值。
`modelEntries` 超过 500 条会被截断，`modelCount` 一律以实际行数为准。

### 隐私边界

载荷只有模型名与计数：没有对话正文、没有引用片段、没有会话 ID、没有文件路径、
没有机器标识。身份只来自提交者登录的 GitHub 账号。

---

## 排名口径

原始 MDI 对样本量没有记忆：3.5k 条消息碰巧连发附和能刷出 27，23k 条消息的稳定 8 会被压住。
榜单统一按**贝叶斯收缩分数**排名（人榜与模型榜同一口径，`src/lib/db.ts` 的 `scoreExpr` 是唯一真源）：

```
score = (drool + PRIOR_MASS × 全局命中率) / (assistant_messages + PRIOR_MASS) × 1000
PRIOR_MASS = 5000（伪计数）
```

小样本被拉向全局均值、大样本几乎不动——信息越多置信度越高。同分再按
`drool_count DESC, assistant_messages DESC, updated_at ASC` 断序。原始 MDI 仍然展示
（tooltip），只是不再直接决定名次。

`migrations/0001_init.sql` 里的 `leaderboard_entries_rank_idx` 是旧口径（drool_count 优先）
遗留的，score 是运行时表达式走不了索引；数据量大了再把 score 物化成列。

MDI 分档阈值与 CLI 的 `getDroolLevel` 一致，报告和榜单不会对同一模型给出两套标签：

| MDI | 档位 |
| --- | --- |
| `<= 2` | 恪守客观 |
| `<= 10` | 得体礼貌 |
| `<= 25` | 顺从附和 |
| `<= 50` | 过度附和 |
| `> 50` | 极度谄媚 |

---

## 部署手册

下面的命令都在 `web/` 目录里执行。

### 前置条件

- Node.js 20 及以上（Astro 6 的要求）
- 一个 Cloudflare 账号，且本机已 `npx wrangler login`
- 一个 GitHub 账号，用来创建 OAuth App

### 需要账号所有者本人做的步骤

以下四步需要登录态或创建权限，代理无法代劳：

1. **第 1 步**：`wrangler login`（打开浏览器授权 Cloudflare）
2. **第 2 步**：`wrangler d1 create`（在账号下创建数据库）
3. **第 5 步**：在 GitHub 上创建 OAuth App，并生成 client secret
4. **第 6 步**：`wrangler secret put`（把密钥写进 Cloudflare，值不应经过任何日志）

其余步骤（装依赖、改配置、跑迁移、构建、部署）可以脚本化。

---

### 第 1 步：登录 Cloudflare

```bash
npx wrangler login
```

浏览器会打开授权页。完成后 `npx wrangler whoami` 应能看到账号。

### 第 2 步：创建 D1 数据库

```bash
npx wrangler d1 create shaleme-leaderboard
```

输出里会有一行 `database_id = "xxxxxxxx-xxxx-..."`。

### 第 3 步：把 database_id 写进配置

编辑 `wrangler.jsonc`，把占位值替换成上一步的 id：

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "shaleme-leaderboard",
    "database_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
  }
]
```

绑定名必须是 `DB`：`src/lib/db.ts` 通过 `env.DB` 取它。

### 第 4 步：创建 GitHub OAuth App

打开 <https://github.com/settings/developers> → **New OAuth App**，填：

| 字段 | 值 |
| --- | --- |
| Application name | 任意，例如 `shaleme leaderboard` |
| Homepage URL | `https://shaleme.crosery.cc.cd` |
| Authorization callback URL | **`https://shaleme.crosery.cc.cd/api/auth/github/callback`** |

回调地址必须是 `<APP_URL>/api/auth/github/callback`，一字不差，否则 GitHub 会拒绝
授权并报 redirect_uri 不匹配。本地开发另建一个 OAuth App，回调填
`http://127.0.0.1:4321/api/auth/github/callback`。

创建后记下 **Client ID**，再点 **Generate a new client secret** 记下 **Client secret**
（secret 只显示一次）。

### 第 5 步：确定 APP_URL

`APP_URL` 用来拼 OAuth 的 `redirect_uri`。留空时回退成「当前请求的 origin」，
`workers.dev` 域名和自定义域名都能work，所以第一次部署可以先留空。

绑定了正式域名之后建议写死，避免以后有人通过别的域名访问时拿到一个错误的
`redirect_uri`。写死在 `wrangler.jsonc` 的 `vars` 里（它不是密钥）：

```jsonc
"vars": {
  "APP_URL": "https://shaleme.example.com"
}
```

> **注意**：官方实例已按此配置：`workers_dev: false` + `routes` 里的
> `shaleme.crosery.cc.cd` 自定义域名，`APP_URL` 已写死在 `wrangler.jsonc`。

### 第 6 步：写入密钥

三个都是密钥，走 `wrangler secret put`（会提示粘贴，不会回显、不进 shell 历史）：

```bash
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET
```

`SESSION_SECRET` 是会话 cookie 的 HMAC-SHA256 签名密钥，用任意长随机串：

```bash
openssl rand -base64 48
```

换掉它会让所有已登录会话立即失效（榜单数据不受影响）。

### 第 7 步：应用迁移

```bash
# 生产库
npx wrangler d1 migrations apply shaleme-leaderboard --remote

# 本地开发库（astro dev / wrangler dev 用的那份）
npx wrangler d1 migrations apply shaleme-leaderboard --local
```

用 `npx wrangler d1 migrations list shaleme-leaderboard --remote` 确认已应用。
迁移是幂等的（`CREATE TABLE IF NOT EXISTS`），重复执行不会出错。

### 第 8 步：安装依赖并部署

```bash
npm install
npm run deploy        # = astro build && wrangler deploy
```

部署完 `npx wrangler deploy` 会打印实际地址。

### 第 9 步：让 CLI 指向它

官方实例无需任何参数：CLI 从 0.1.3 起默认烧入
`https://shaleme.crosery.cc.cd/submit`。自建实例时：

```bash
npx shaleme --leaderboard https://shaleme.example.com/submit
```

点报告页的「上传到榜单」应跳到 GitHub 授权，授权后回到站点并显示名次。

---

## 本地开发

```bash
cp .dev.vars.example .dev.vars     # 填入本地 OAuth App 的 id/secret 与随机 SESSION_SECRET
npm install
npm run db:migrate:local
npm run dev                        # http://127.0.0.1:4321
```

`.dev.vars` 已被 `.gitignore` 忽略，不要提交。

用 `npx wrangler d1 execute shaleme-leaderboard --local --command "SELECT login, drool_count, mdi FROM leaderboard_entries ORDER BY drool_count DESC"` 看本地数据。

---

## 排查

| 现象 | 原因 |
| --- | --- |
| 首页顶部提示「榜单还没接上数据库」 | Worker 没有 `DB` 绑定。检查 `wrangler.jsonc` 的 `d1_databases` 与 `database_id`；本地还要确认迁移已应用到 `--local`。 |
| 点上传后跳回首页并提示「提交内容无法解析」 | 客户端发的字段名不是 `payload`，或者 payload 不是合法 JSON。 |
| 授权后报 `redirect_uri` 不匹配 | OAuth App 里的回调地址与 `<APP_URL>/api/auth/github/callback` 不一致。注意 `APP_URL` 末尾不要带斜杠。 |
| 提示「登录未配置」 | `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` / `SESSION_SECRET` 有缺失。密钥是 `wrangler secret put` 写的，改完要重新部署才生效。 |
| 授权后被判为未登录 | `SESSION_SECRET` 换过；旧 cookie 的签名验不过，重新登录即可。 |
| 提交后名次没变 | 同一个人只保留最新一次提交。确认报告页那次点击确实返回了 `state=submitted`。 |
| 模型榜是空的 | 那份提交的 `modelEntries` 为空，用较新版本的 shaleme 重新生成报告。 |

---

## 已知边界

- **已部署到真实 Cloudflare 账号并验证**（见顶部「官方实例状态」）：
  `astro build`、`wrangler d1 migrations apply --remote`、`wrangler deploy`、
  首页/模型榜/`/submit` 的 payload 校验与 pending 重定向路径都用 curl 实测过。
  唯一没跑过的是**真实 GitHub OAuth 往返**（OAuth App 还没建，secret 未写入）。
- 依赖版本按 2026-09-29 的 npm registry 现状声明：`astro ^6.4.8`、
  `@astrojs/cloudflare ^13.7.0`（peer 要求 `astro ^6.3.0` + `wrangler ^4.83.0`）、
  `wrangler ^4.143.0`。**注意 npm 上的 `latest` 已经是 Astro 7 + 适配器 14.x**，
  而参考实现与本目录都按 Astro 6 编写；如果将来要升 7，得先确认
  `@astrojs/cloudflare/entrypoints/server` 这个 `main` 入口和
  `session.driver: sessionDrivers.null()` 的写法在 7 里仍然成立。
- `remoteBindings: false` 是参考实现的取值，本次未验证它在新版适配器里的含义是否变化。
- D1 类型是本目录 `src/env.d.ts` 里手写的最小面（只覆盖用到的
  `prepare/bind/first/run/all/batch`），没有引入 `@cloudflare/workers-types`。
  要用到别的 API 时需要补声明。
- 单模型榜会把同一模型的所有历史提交按人汇总统计「最烫的模型」，但随着提交次数增长，
  这个查询扫的行数是提交次数而不是人数，数据量大之后需要改成读 entries 快照。
