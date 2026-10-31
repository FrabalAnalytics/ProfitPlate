import { Brand } from "./brand";
export function LoadingScreen() {
  return (
    <main id="main" className="status-page" aria-busy="true">
      <Brand />
      <p role="status" style={{ marginTop: 24 }}>
        Opening your workspace…
      </p>
    </main>
  );
}
