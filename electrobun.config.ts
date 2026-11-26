import type { ElectrobunConfig } from "electrobun";

// CI 用 tag 注入版本号；本地构建不设置时回退到默认版本。
const appVersion = process.env.VIBEGAME_VERSION ?? "0.0.1";
// 只在 CI 准备好 Developer ID 证书和签名身份时才签名/公证。
const signingEnabled = Boolean(process.env.ELECTROBUN_DEVELOPER_ID);

export default {
	app: {
		name: "VibeGame",
		identifier: "dev.vibegame.app",
		version: appVersion,
	},
	build: {
		mainProcess: "bun",
		bun: {
			entrypoint: "src/main/index.ts",
		},
		copy: {
			"src/mainview/dist/index.html": "views/mainview/index.html",
			"src/mainview/dist/assets": "views/mainview/assets",
			// 整个 engine 目录一起复制，新增 Agent 文件不会漏。
			"resources/engine": "engine",
			"resources/template": "template",
		},
		mac: {
			bundleCEF: false,
			bundleWGPU: false,
			icons: "resources/branding/vibegame.iconset",
			codesign: signingEnabled,
			notarize: signingEnabled,
			createDmg: true,
		},
		linux: {
			bundleCEF: false,
			bundleWGPU: false,
		},
		win: {
			bundleCEF: false,
			bundleWGPU: false,
		},
	},
} satisfies ElectrobunConfig;
