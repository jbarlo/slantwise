// Support importing SQL files as raw strings via Vite's ?raw suffix
declare module '*.sql?raw' {
  const content: string;
  export default content;
}
