import "react-native-reanimated";
import { registerRootComponent } from "expo";
import { ErrorBoundary } from "./components/ErrorBoundary";
import App from "./App";

registerRootComponent(() => (
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
));
