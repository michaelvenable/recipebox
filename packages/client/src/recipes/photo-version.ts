// A replaced photo has the same address as the old one, and a browser reuses an image it has already loaded in the page for the
// same address, so the recipe would go on showing the old photo (REC-7). After this app uploads or removes a photo, the image
// addresses get a new version; the server ignores the query string. Kept in the query cache, so it lasts as long as the cached
// recipes do.
import { type QueryClient, useQuery } from "@tanstack/react-query";
import { photoKeys } from "../api/query-keys.js";

/** The recipe's photo version: 0 until its photo is changed here, then one more for each change. */
export function usePhotoVersion(id: string): number {
  const { data } = useQuery({ queryKey: photoKeys.version(id), queryFn: () => 0, staleTime: Infinity, gcTime: Infinity });
  return data ?? 0;
}

/** After an upload or removal: the recipe's images get new addresses. */
export function photoChanged(queryClient: QueryClient, id: string): void {
  queryClient.setQueryData<number>(photoKeys.version(id), (version) => (version ?? 0) + 1);
}
