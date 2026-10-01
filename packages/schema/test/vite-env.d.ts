// Vite features the tests use to read fixture files as text, so canonical bytes can be compared.

declare module '*?raw' {
  const text: string;
  export default text;
}

interface ImportMeta {
  glob(pattern: string, options: { query: '?raw'; import: 'default'; eager: true }): Record<string, string>;
}
