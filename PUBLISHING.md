# 发布指南（GitHub / npm / DSH 插件市场）

> 当前状态：本地插件名 `dsh-precise-billing`，`private: true`，只能 link 安装，不能直接发布。

## 0. npm 2FA 与通行密钥（实测记录）

- 2026-11：在本机 Windows + Chrome 上，npm 的「Security key」注册反复失败（弹出 Windows 安全中心后提示 `Device registration failed`），无论选本机 Windows Hello 还是手机都不行。
- 最终成功方式：**小米 17 Ultra（Android）+ Google Chrome** 打开 npmjs.com → Account → Enable 2FA → Security key，用手机原生通行密钥（指纹/人脸）完成注册。
- 通行密钥默认保存在手机（Google 密码管理器/设备）。**换手机前**要确认它已同步到 Google 账号，或在 npm 里再注册一把硬件安全密钥作为备份；同时保存 npm 的恢复码。

### 硬件安全密钥建议

- **YubiKey 5 NFC / 5C NFC**：FIDO2 + U2F，USB-A 或 USB-C + NFC，兼容性最好；可存约 25 个 resident passkey。
- **Yubico Security Key NFC / C NFC**：更便宜，纯 FIDO2，日常够用。
- **Feitian（飞天诚信）ePass FIDO2 / BioPass**：国内容易买，价格低。
- **Token2 / Nitrokey 3 / Solo 2C NFC**：开源或欧洲品牌，支持 NFC。
- 建议买 **两只**（一只日常、一只备份）或「一只硬件钥匙 + 手机通行密钥」，并在 npm 里都注册；只留一把钥匙，丢了会非常麻烦。

## 1. 改成可发布的包名（必须）

`@local/*` 是本地保留 scope，npm 不接受发布。建议使用已被验证可用的名字：

- **`dsh-precise-billing`**（2026-11 查询时 npm 上不存在，可直接注册）

如果要使用自己的 scope，也可以改成 `@<你的npm用户名>/dsh-precise-billing`。

需要同步修改：

1. `package.json`：
   - `"name": "dsh-precise-billing"`
   - 删除 `"private": true`（或改为 `false`）
   - `"license": "MIT"`（已加）
   - `"keywords"` 中含 **`dsh-plugin`**（市场索引的关键）
   - `"repository"` 指向 GitHub 仓库（发布 npm 时必须与仓库对应）
2. `cordis.patch.yml` 里的行名：
   ```yaml
   - insert:
       - id: precise-billing
         name: 'dsh-precise-billing'
   ```
3. 重新安装本地 link（包名变了，profile 依赖键也要变）：
   ```bash
   dsh plugin --profile desktop remove dsh-precise-billing
   dsh plugin --profile desktop add link:C:\Users\XXJ\Documents\deepseek-harness\default-workspace\_plugins\precise-billing
   ```
   然后重启 DSH。
4. 本地版本改名后，`dsh-precise-billing` 的旧链接不会再被加载，确认设置/数据（`$DSH_HOME/storages/precise-billing.json`）不受影响即可。

## 2. 发布到 GitHub

```bash
cd C:\Users\XXJ\Documents\deepseek-harness\default-workspace\_plugins\precise-billing
git add -A
git commit -m "release: v0.2.1"
git remote add origin https://github.com/SheldonJinn/dsh-precise-billing.git
git branch -M main
git push -u origin main
```

GitHub 仓库设置里添加 topics：

- `dsh-plugin`
- `deepseek-harness`

并确保仓库**创建满 1 天**（awesome-dsh-plugin 目录的硬性要求）。

## 3. 发布到 npm

```bash
npm login
npm pack --dry-run     # 检查打包内容：index.js、client.js、README、docs、LICENSE 等
npm publish --access public
```

发布后：

- npm 页面确认 keywords 含 `dsh-plugin`、repository 指向 GitHub；
- 以后发新版只需改 `package.json` 的 `version`，再 `npm publish`。

## 4. 进入 DSH 插件市场

有两条渠道，互不冲突：

### A. dshmp.com（自动索引，无需投稿）

- 只要 npm 包的 `keywords` 含 **`dsh-plugin`**，catalog 会**每天自动同步**；
- 可用官方自检页确认是否被正确识别：<https://dshmp.com/en/guides/publish/check>
- 更新版本无需额外操作，发新版后自动跟上。

### B. awesome-dsh-plugin（精选目录，需要 PR）

这是 DSH 内置「发现」和 dsh-market 等市场的重要目录，需要提交一个 YAML 文件：

1. Fork <https://github.com/awesome-dsh-plugin/awesome-dsh-plugin>
2. 新建 `data/plugins/SheldonJinn__<repo>.yml`，例如：

   ```yaml
   url: https://github.com/SheldonJinn/dsh-precise-billing
   name: SheldonJinn/dsh-precise-billing
   category: usage          # 计费/用量类；可选值见 contributing.md
   description:
     en: Per-request DeepSeek billing with peak/off-peak pricing, usage dashboard, calendar and hot restart.
     zh: 按 DeepSeek 官方人民币价目逐请求精确计费，含费用条、侧栏卡片、用量看板（趋势/日历/年视图）与三段式热重启。
   ```

3. 提 PR。要求：
   - `package.json` 声明 `dsh.bundle`（本插件已有）；
   - 仓库满 1 天、有真实代码；
   - 仓库加了 `dsh-plugin` topic；
   - 描述必须与实际功能一致（不要夸大）。
4. 可选：仓库根放 `screenshots.json`，市场详情页展示 App Store 风格截图：

   ```json
   ["docs/overview.png", "docs/calendar.png", "docs/year.png", "docs/settings.png", "docs/restart.png"]
   ```

5. 合并后目录自动重建，DSH 内置「发现」与 dsh-market 会同步展示。

### C. 其他市场

- `dshmarket` / `dshmarketplace` 等第三方市场通常从 npm 与 awesome-dsh-plugin 目录聚合，做好上面两步即可被收录；
- 若发现未收录，可在对应市场仓库按它的说明提 issue/PR。

## 5. 发布前检查清单

- [ ] 包名已改为公开名，`private` 已移除；
- [ ] `cordis.patch.yml` 行名与新包名一致；
- [ ] 本地重新 link 安装后功能正常（费用条、侧栏、看板、热重启）；
- [ ] `keywords` 含 `dsh-plugin`；
- [ ] `repository` 指向 GitHub 仓库；
- [ ] 仓库有 `LICENSE`（MIT，作者 Sheldon Jinn）；
- [ ] `docs/` 截图与 README 引用路径一致；
- [ ] 仓库内**没有**任何 token、cookie、`.env`、本地路径外的私密文件；
- [ ] 参考项目与许可证声明（README、CREDITS.md）保留，不要删除他人署名；
- [ ] GitHub topics 已加 `dsh-plugin`、`deepseek-harness`；
- [ ] npm 发布后安装一次 `dsh plugin add dsh-precise-billing` 验证。

## 6. 版本与更新

```bash
npm version patch   # 或 minor / major
git push --follow-tags
npm publish --access public
```

市场会自动读取 npm 的 latest 版本，无需手动改目录站点。
