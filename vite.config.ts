import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { electrobunViteAliases } from "./.hutch/devkit/api/config/electrobun-vite.ts";

export default defineConfig({
	root: resolve(import.meta.dirname, "src/mainview"),
	base: "./",
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: [
			{ find: /^@\//, replacement: resolve(import.meta.dirname, "src/mainview/src") + "/" },
			...electrobunViteAliases(resolve(import.meta.dirname, ".hutch/devkit")),
		],
	},
	build: {
		outDir: resolve(import.meta.dirname, "src/mainview/dist"),
		emptyOutDir: true,
	},
});
