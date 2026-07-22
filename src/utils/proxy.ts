import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

export function configureProxyFromEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  const httpProxy = env.HTTP_PROXY ?? env.http_proxy;
  const httpsProxy = env.HTTPS_PROXY ?? env.https_proxy;
  if (httpProxy === undefined && httpsProxy === undefined) return false;

  setGlobalDispatcher(
    new EnvHttpProxyAgent({
      httpProxy,
      httpsProxy,
      noProxy: env.NO_PROXY ?? env.no_proxy,
    }),
  );
  return true;
}
