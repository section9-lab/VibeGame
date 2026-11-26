// 用 Vite 的 JS API 构建视图。这样 hutch（Bun）可以直接跑，不依赖 node 的 shebang。
import { build } from "vite";

await build({ logLevel: "warn" });
