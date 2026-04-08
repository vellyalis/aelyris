import { TitleBar } from "./features/titlebar/TitleBar";
import { StatusBar } from "./features/statusbar/StatusBar";
import { TerminalArea } from "./features/terminal/TerminalArea";

export function App() {
  return (
    <div className="app-container">
      <TitleBar />
      <main className="app-main">
        <TerminalArea />
      </main>
      <StatusBar />
    </div>
  );
}
