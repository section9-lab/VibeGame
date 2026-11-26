# 发布 macOS 桌面版

发布流程在 `.github/workflows/release.yml`，只在推送 tag 时运行。

## 触发一次发布

```bash
git tag v0.2.3
git push origin v0.2.3
```

tag 必须符合 `vMAJOR.MINOR.PATCH`，可以带 `-beta.1` 这类 prerelease 后缀。工作流会：

1. 校验 tag 格式。
2. 从 tag 去掉 `v` 得到版本号。
3. 通过 `VIBEGAME_VERSION` 把版本号传给 `electrobun.config.ts`，不需要手动改文件。
4. 在 `macos-15`（arm64）runner 上构建 stable 包。
5. 校验 DMG、`Info.plist` 版本和 arm64 架构。
6. 上传产物并创建 GitHub Release。

`macos-14` 是 Intel runner；本项目固定用 `macos-15`，并在构建前检查 `uname -m` 必须是 `arm64`。

## Release 里的文件

- `macos-arm64-VibeGame.dmg`：用户下载安装的 DMG。
- `stable-macos-arm64-VibeGame.app.tar.zst`：更新用的完整压缩包。
- `stable-macos-arm64-update.json`：Electrobun 更新元数据。
- `stable-macos-arm64-checksum.json`：压缩包校验信息。
- `SHA256SUMS.txt`：DMG 和 tar.zst 的 SHA-256。

## 签名与公证

不配置签名 secret 也能跑，但产物是 unsigned DMG，macOS Gatekeeper 会拦截普通用户下载。只配置一部分会直接失败，避免误发未签名包。

需要以下 6 个仓库 secret：

1. `MACOS_CERTIFICATE`：Developer ID Application 证书 `.p12` 的 base64。
2. `MACOS_CERTIFICATE_PWD`：导出 `.p12` 时设置的密码。
3. `ELECTROBUN_DEVELOPER_ID`：`security find-identity -v -p codesigning` 输出的身份，例如 `Developer ID Application: Example Corp (AB12C3D4E5)`。
4. `ELECTROBUN_APPLEID`：Apple ID 邮箱。
5. `ELECTROBUN_APPLEIDPASS`：Apple ID 的 app-specific password。
6. `ELECTROBUN_TEAMID`：10 位 Apple Developer Team ID。

生成并写入 secret：

```bash
base64 -i DeveloperID.p12 -o DeveloperID.p12.b64

gh secret set MACOS_CERTIFICATE < DeveloperID.p12.b64
gh secret set MACOS_CERTIFICATE_PWD
gh secret set ELECTROBUN_DEVELOPER_ID --body "Developer ID Application: Example Corp (AB12C3D4E5)"
gh secret set ELECTROBUN_APPLEID --body "you@example.com"
gh secret set ELECTROBUN_APPLEIDPASS --body "xxxx-xxxx-xxxx-xxxx"
gh secret set ELECTROBUN_TEAMID --body "AB12C3D4E5"
```

工作流会把证书导入临时 keychain，构建结束后删除。公证使用 Apple ID + app-specific password；如果改用 App Store Connect API Key，需要额外把 `.p8` 文件放到 runner 上，当前工作流没有接这条路径。

## 本地复现

```bash
hutch install
hutch electrobun prepare
hutch scripts/build-ui.ts
VIBEGAME_VERSION=0.2.3 hutch electrobun build --env=stable --arch=arm64
```

产物目录：

```text
artifacts/macos-arm64-VibeGame.dmg
artifacts/stable-macos-arm64-VibeGame.app.tar.zst
artifacts/stable-macos-arm64-update.json
artifacts/stable-macos-arm64-checksum.json
```

`hutch.lock` 必须提交到仓库。工作流会在 `hutch install` 后检查它是否被改写，被改写就失败，防止 CI 实际安装的依赖和仓库锁文件不一致。

## 自动更新（可选，目前未启用）

`electrobun.config.ts` 目前没有配置 `release.baseUrl`，所以 `update.json` 和 `tar.zst` 只是作为 Release 附件上传，客户端不会自动更新；而且当前 app 代码也没有调用 updater。

将来要启用静态托管更新，可以在 `electrobun.config.ts` 增加：

```ts
release: {
  baseUrl: "https://github.com/section9-lab/VibeGame/releases/latest/download",
  // 首次发布没有上一版可比对，先关掉 delta patch 生成。
  generatePatch: false,
},
```

同时需要在 app 里实际调用 Electrobun 的 updater。GitHub Releases 适合早期版本；下载量大或需要灰度时再换 S3 / R2 等静态托管。
