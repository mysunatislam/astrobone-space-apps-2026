// Reserve real screen space for the viewer heading and layer controls.
export function meshCameraFrame(size, width, height, fov, padding = {}) {
  const top = Math.min(padding.top ?? 100, height * .3);
  const bottom = Math.min(padding.bottom ?? 88, height * .28);
  const sides = Math.min(padding.sides ?? 24, width * .1);
  const tangent = Math.tan(fov * Math.PI / 360);
  const vertical = (height - top - bottom) / height;
  const horizontal = (width - sides * 2) / width;
  const nearDistance = Math.max(size.y / (2 * tangent * vertical), size.x / (2 * tangent * width / height * horizontal)) * 1.06;
  return {
    distance: nearDistance + size.z / 2,
    targetY: (top - bottom) / height * nearDistance * tangent,
  };
}
