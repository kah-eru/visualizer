/* Entry point. Import order matters: styles first, then errors (installs global
   handlers on import), then the app (wires the dashboard + exports diagnostics),
   then the feedback widget (wired to the app's diagnostics snapshot). */
import "./styles.css";
import "./errors.js";
import { getDiagnostics } from "./app.js";
import { initFeedback } from "./feedback.js";

initFeedback({ getDiagnostics });
