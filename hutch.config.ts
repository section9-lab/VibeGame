// @hutch cli=0.30.0 cottontail=0.7.3
export default {
	scripts: {
		install: ["hutch", "install", "--frozen-lockfile"],
		// vite.config.ts 引用 .hutch/devkit；新 clone 上必须先 prepare。
		start: "hutch electrobun prepare && hutch scripts/build-ui.ts && hutch electrobun dev",
		dev: "hutch electrobun prepare && hutch scripts/build-ui.ts && hutch electrobun dev --watch",
		build: "hutch electrobun prepare && hutch scripts/build-ui.ts && hutch electrobun build --env=stable",
		"build:canary": "hutch electrobun prepare && hutch scripts/build-ui.ts && hutch electrobun build --env=canary",
		"bench:gpu": "swift benchmarks/webgpu-vs-webgl2/run-wkwebview.swift",
	},
	electrobun: {
		version: "2.0.7",
	},
};
