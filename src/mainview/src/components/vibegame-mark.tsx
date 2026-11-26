// 直接画一个带两个白色眼睛的实心路径：不用 SVG mask，避免 WebKit 在合成时
// 把蒙版按低分辨率栅格化；曲线和圆都用矢量路径，任何倍率下都保持锐利。
export function VibeGameMark({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			viewBox="160 160 704 704"
			role="presentation"
			focusable="false"
			shapeRendering="geometricPrecision"
		>
			<path
				d="M160 160H696A168 168 0 0 1 864 328V696A168 168 0 0 1 696 864H328A168 168 0 0 1 160 696V160Z"
				style={{ fill: "var(--brand, #155DFC)" }}
			/>
			<circle cx="350" cy="372" r="74" fill="#FFFFFF" />
			<circle cx="632" cy="372" r="74" fill="#FFFFFF" />
		</svg>
	);
}
