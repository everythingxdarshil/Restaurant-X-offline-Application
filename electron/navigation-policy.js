export function isLocalRuntimeUrl(url, runtimeOrigin) {
  try {
    return Boolean(runtimeOrigin && new URL(url).origin === runtimeOrigin);
  } catch {
    return false;
  }
}
