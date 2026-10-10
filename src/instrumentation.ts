export async function register() {
  // Fail fast on server start if the environment is misconfigured.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./env");
  }
}
