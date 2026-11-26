# VibeGame branding

- `vibegame-appicon.svg`：打包用图标源文件。1024 画布，图形四周 5% 安全边距，透明背景，眼睛是实心白；颜色为品牌蓝 #155DFC。
- `vibegame-mark.svg`：应用内用的紧凑标志（无内边距）。应用内实际渲染的是 `src/mainview/src/components/vibegame-mark.tsx` 里的内联 SVG；改几何或颜色时两处要一起改。
- `vibegame.iconset/`、`vibegame.icns`、`vibegame-appicon.png`：生成产物。

重新生成：

```bash
bash scripts/build-icons.sh
```

不要用 `qlmanage` 生成图标 PNG，它会把透明区域压成不透明白底，导致 Dock 图标外面出现白框。
