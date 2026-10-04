export function bodyPose(kind = "neutral") {
  const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.2, z: 0, visibility: 0.99 }));
  const set = (i, x, y, z = 0) => Object.assign(points[i], { x, y, z });
  set(0, 0.5, 0.08, -0.06);
  set(7, 0.54, 0.1); set(8, 0.46, 0.1);
  set(11, 0.63, 0.24); set(12, 0.37, 0.24);
  set(13, 0.69, 0.4); set(14, 0.31, 0.4);
  set(15, 0.72, 0.55); set(16, 0.28, 0.55);
  set(23, 0.58, 0.52); set(24, 0.42, 0.52);
  set(25, 0.58, 0.72); set(26, 0.42, 0.72);
  set(27, 0.58, 0.91); set(28, 0.42, 0.91);
  set(29, 0.58, 0.94, 0.02); set(30, 0.42, 0.94, 0.02);
  set(31, 0.58, 0.96, -0.1); set(32, 0.42, 0.96, -0.1);
  if (kind === "left-up" || kind === "upper-only") {
    set(13, 0.77, 0.19, -0.02); set(15, 0.83, 0.04, -0.04);
  }
  if (kind === "right-up") {
    set(14, 0.23, 0.19, -0.02); set(16, 0.17, 0.04, -0.04);
  }
  if (kind === "knee-bend") {
    set(26, 0.42, 0.69, -0.2); set(28, 0.42, 0.82, 0.12);
  }
  for (const [wrist, fingers] of [[15, [17, 19, 21]], [16, [18, 20, 22]]]) {
    for (const [n, i] of fingers.entries()) {
      set(i, points[wrist].x + (wrist === 15 ? 0.01 : -0.01) * n,
        points[wrist].y + (points[wrist].y < 0.2 ? -0.025 : 0.025), -0.04);
    }
  }
  if (kind === "upper-only") for (let i = 23; i < 33; i++) points[i].visibility = 0.05;
  return points;
}
