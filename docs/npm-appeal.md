# npm 账号封禁申诉文案

提交到 https://www.npmjs.com/support ，选 **Account → Suspended account**。

---

## 英文版（推荐，npm 支持优先处理英文）

**Subject:** Account temporarily suspended after mistakenly submitting a recovery code as an OTP

**Body:**

Hello,

My account `crosery` (luoxi2024@foxmail.com) has been temporarily suspended with the
message "Your account has been temporarily suspended due to a recent security-sensitive
action."

This was my mistake, and I want to explain exactly what happened.

My account has a **security key (WebAuthn)** configured for two-factor authentication,
not a TOTP authenticator app. While trying to publish an update to my own package
`shaleme`, `npm publish` returned `EOTP` ("This operation requires a one-time password").
Since I had no 6-digit code available from a security key, I mistakenly supplied a
**2FA recovery code** to the `--otp` flag. I now understand that recovery codes are not
one-time passwords and that using them for publishing is exactly the kind of anomalous
pattern your security controls are designed to catch.

I repeated this attempt twice before realizing the error, which is presumably why the
suspension triggered.

There was no malicious intent — I was only trying to publish an update to my own package.
No other account or package was involved.

Could you please lift the temporary suspension on `crosery`? I understand the correct
path forward is to configure a **Trusted Publisher (OIDC)** connection so that publishing
happens via GitHub Actions and no OTP is needed at all.

Thank you for your time.

---

## 中文版（备选）

**主题：** 因误将恢复码当作 OTP 提交导致账号被临时封禁，申请解封

**正文：**

你好，

我的账号 `crosery`（luoxi2024@foxmail.com）被临时封禁，提示
"Your account has been temporarily suspended due to a recent security-sensitive action."

这是我的操作失误，说明如下：

我的账号配置的是**安全密钥（WebAuthn）**两步验证，而不是 TOTP 验证器 App。
在尝试给我自己的包 `shaleme` 发布更新时，`npm publish` 返回 `EOTP`
（要求一次性口令）。由于安全密钥本身没有 6 位动态码，我错误地把一枚
**2FA 恢复码**填给了 `--otp` 参数。我现在明白恢复码不是一次性口令，
将其用于发布正是你们安全风控所要拦截的异常行为。

我在意识到错误前重复尝试了两次，这应该是触发封禁的原因。

我没有任何恶意意图，只是在发布自己包的一个更新，不涉及任何其他账号或包。

能否请协助解除对 `crosery` 的临时封禁？我理解正确的做法是配置
**Trusted Publisher (OIDC)** 连接，让发布通过 GitHub Actions 完成，
从而完全不需要 OTP。

感谢。

---

## 解封后的操作（一次 Touch ID，之后永久自动）

1. 打开 https://www.npmjs.com/package/shaleme/access
2. **Trusted Publisher** 区域 → 若已有 GitHub Actions 卡片，**先删掉**
   （npm 的 trust 创建后不可修改，只能删了重建）
3. 点 **GitHub Actions**，逐字填：
   - Organization or user: `Crosery`
   - Repository: `shaleme`
   - Workflow filename: `publish.yml`
4. 勾选 **Allow npm publish**
5. 点 **Set up connection** → 按 Touch ID

完成后页面会从 `Select your publisher` 变成显示连接详情的卡片。
之后发版只需：

```bash
cd /Users/crosery/work_file/shaleme
git tag v0.1.2 && git push origin v0.1.2
```

CI 会自动构建 + 发布 + 附 provenance 签名，**不再需要任何 OTP 或 token**。
