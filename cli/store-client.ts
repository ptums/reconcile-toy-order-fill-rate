export interface GqlResult<T> {
  data?: T;
  errors?: { message: string; extensions?: { code?: string } }[];
  extensions?: {
    cost: {
      requestedQueryCost: number;
      actualQueryCost: number | null; // null when THROTTLED
      throttleStatus: {
        maximumAvailable: number;
        currentlyAvailable: number;
        restoreRate: number; // points per second
      };
    };
  };
}

type Fetch = (url: string, init: RequestInit) => Response | Promise<Response>;

export function storeClient(
  url: string,
  token: string,
  fetchFn: Fetch = fetch,
) {
  return async function gql<T>(query: string): Promise<GqlResult<T>> {
    const res = await fetchFn(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-toy-shop-access-token": token,
      },
      body: JSON.stringify({ query }),
    });
    return (await res.json()) as GqlResult<T>;
  };
}
