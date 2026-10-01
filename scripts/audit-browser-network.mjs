/** Keep audit browser traffic on the disposable local app, including subframes. */
export async function restrictToLocalApp(context, base) {
  const allowed = new URL(base);
  const local = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  if (!local.has(allowed.hostname)) throw new Error("Audit requires an isolated loopback application");
  // Production browser audits need no sockets; close them before any connect.
  await context.routeWebSocket("**/*", socket => socket.close());
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    const sameApp = local.has(url.hostname) && url.protocol === allowed.protocol && url.port === allowed.port;
    if (sameApp || url.protocol === "data:" || url.protocol === "blob:") await route.continue();
    else await route.abort("blockedbyclient");
  });
}
