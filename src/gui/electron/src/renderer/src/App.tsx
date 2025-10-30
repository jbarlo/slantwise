import { client } from './trpc';
import SharedApp from '@shared/client/App';
import { ElectronThemeDetector } from './lib/electron-detector';

const themeDetector = new ElectronThemeDetector();

function App(): React.JSX.Element {
  return <SharedApp trpcClient={client} themeDetector={themeDetector} />;
}

export default App;
