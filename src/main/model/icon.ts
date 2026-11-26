// 校验模型产出的标题。去掉引号、序号和句末标点，只留一行短标题。
export function sanitizeProjectTitle(raw: string): string | null {
	const first = raw
		.split("\n")
		.map((line) => line.trim())
		.find(Boolean);
	if (!first) return null;
	let title = first
		.replace(/^(标题|名称|title|name)\s*[:：]\s*/i, "")
		.replace(/^[#>*_\-\s"“”'‘’「」《》]+/, "")
		.replace(/[#*_"“”'‘’「」《》。.!！,，:：\s]+$/, "")
		.trim();
	if (!title || /[<>{}]/.test(title)) return null;
	if (title.length > 24) title = title.slice(0, 24).trim();
	return title || null;
}

// 校验模型产出的 SVG。只接受内联、无脚本、无外部引用的小图标。
export function sanitizeIconSvg(raw: string): string | null {
	const match = raw.match(/<svg[\s\S]*?<\/svg>/i);
	if (!match) return null;
	const svg = match[0];
	if (svg.length > 12_000) return null;
	if (/<script|<foreignObject|on\w+\s*=|href\s*=|<image|@import|url\(/i.test(svg)) return null;
	if (!/xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2000\/svg["']/i.test(svg)) return null;
	return svg;
}
