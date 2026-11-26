// 只有这个文件会被 AI 改写。不要 import 任何东西，引擎会通过 ctx 传入 THREE。
let box: any = null;

export function setup(ctx: any) {
	const T = ctx.THREE;

	box = new T.Mesh(
		new T.BoxGeometry(1, 1, 1),
		new T.MeshStandardMaterial({ color: 0x4cc9f0, roughness: 0.35, metalness: 0.1 }),
	);
	box.position.set(0, 1, 0);
	ctx.scene.add(box);

	const ground = new T.Mesh(
		new T.PlaneGeometry(40, 40),
		new T.MeshStandardMaterial({ color: 0x171722, roughness: 1 }),
	);
	ground.rotation.x = -Math.PI / 2;
	ctx.scene.add(ground);

	ctx.scene.add(new T.HemisphereLight(0xffffff, 0x222233, 1.4));
	const sun = new T.DirectionalLight(0xffffff, 2);
	sun.position.set(4, 8, 6);
	ctx.scene.add(sun);

	const grid = new T.GridHelper(40, 40, 0x2a2a3a, 0x1e1e2a);
	grid.position.y = 0.01;
	ctx.scene.add(grid);
}

export function update(dt: number, input: any) {
	if (!box) return;
	const speed = 5 * dt;
	if (input.keys["a"] || input.keys["arrowleft"]) box.position.x -= speed;
	if (input.keys["d"] || input.keys["arrowright"]) box.position.x += speed;
	if (input.keys["w"] || input.keys["arrowup"]) box.position.z -= speed;
	if (input.keys["s"] || input.keys["arrowdown"]) box.position.z += speed;
	box.rotation.y += dt * 1.2;
	box.rotation.x += dt * 0.6;
}
