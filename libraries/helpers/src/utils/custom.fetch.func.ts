function getCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
  return match ? match[1] : null;
}

function hasAuthHeader(options: RequestInit): boolean {
  if (!options.headers) return false;
  if (options.headers instanceof Headers) {
    return options.headers.has('auth');
  }
  if (Array.isArray(options.headers)) {
    return options.headers.some(([key]) => key.toLowerCase() === 'auth');
  }
  return 'auth' in (options.headers as Record<string, string>);
}

export interface Params {
  baseUrl: string;
  beforeRequest?: (url: string, options: RequestInit) => Promise<RequestInit>;
  afterRequest?: (
    url: string,
    options: RequestInit,
    response: Response
  ) => Promise<boolean>;
}
export const customFetch = (
  params: Params,
  auth?: string,
  showorg?: string,
  secured: boolean = true
) => {
  return async function newFetch(url: string, options: RequestInit = {}) {
    const loggedAuth =
      typeof window === 'undefined'
        ? undefined
        : new URL(window.location.href).searchParams.get('loggedAuth');
    const newRequestObject = await params?.beforeRequest?.(url, options);

    const method = (options.method || 'GET').toUpperCase();
    const isMutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    const hasExplicitAuth = !!(auth || loggedAuth || hasAuthHeader(options));
    const csrfToken = isMutating && !hasExplicitAuth ? getCsrfToken() : null;

    const fetchRequest = await fetch(params.baseUrl + url, {
      ...(secured ? { credentials: 'include' } : {}),
      ...(newRequestObject || options),
      headers: {
        ...(showorg ? { showorg } : {}),
        ...(options.body instanceof FormData
          ? {}
          : { 'Content-Type': 'application/json' }),
        Accept: 'application/json',
        ...(loggedAuth ? { auth: loggedAuth } : {}),
        ...options?.headers,
        ...(auth ? { auth } : {}),
        ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
      },
      // @ts-ignore
      ...(!options.next && options.cache !== 'force-cache'
        ? { cache: options.cache || 'no-store' }
        : {}),
    });

    if (
      !params?.afterRequest ||
      (await params?.afterRequest?.(url, options, fetchRequest))
    ) {
      return fetchRequest;
    }

    // @ts-ignore
    return new Promise((res) => {}) as Response;
  };
};

export const fetchBackend = customFetch({
  get baseUrl() {
    return process.env.BACKEND_URL!;
  },
});
