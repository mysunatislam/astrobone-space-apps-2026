export function isAnatomySurface(name, triangles) {
  return triangles > 2 && !/\.(?:[ijg]|[oe]\d*[lr]?)$/i.test(name);
}

export function anatomyDisplayName(name) {
  return name.replaceAll("_", " ").replace(/\.l$/i, " (left)").replace(/\.r$/i, " (right)");
}
