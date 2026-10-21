export function httpError(message, status = 500) {
  return Object.assign(new Error(message), { status });
}
