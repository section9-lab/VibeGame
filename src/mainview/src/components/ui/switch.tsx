"use client";

import * as React from "react";
import { cn } from "cn";
import { Switch as SwitchPrimitive } from "radix-ui";

// 胶囊开关：圆角轨道 + 左右滑动的滑块，和设置页的整体视觉一致。
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
	return (
		<SwitchPrimitive.Root
			data-slot="switch"
			className={cn(
				"peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-input transition-colors outline-none",
				"focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
				"data-[state=checked]:bg-brand data-[state=unchecked]:bg-input dark:data-[state=unchecked]:bg-input/80",
				"disabled:cursor-not-allowed disabled:opacity-50",
				className,
			)}
			{...props}
		>
			<SwitchPrimitive.Thumb
				data-slot="switch-thumb"
				className={cn(
					"pointer-events-none block size-4 rounded-full bg-background shadow-sm transition-transform",
					"data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0.5",
				)}
			/>
		</SwitchPrimitive.Root>
	);
}

export { Switch };
