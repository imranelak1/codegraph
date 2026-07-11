export function makePool(url: string) {
  return {
    url,
    async run<T>(_sql: string): Promise<T[]> {
      return [];
    },
  };
}
