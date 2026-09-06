// The clipboard text for a mail or a chat — the one place both handles that
// hand a handout over (the result page today, the dashboard's row menu next)
// compose it, so a recipient never gets two different shapes of the same
// handover: no title line, the address first, and no "Password:" line when
// there is no password — a label without a value reads as an error.
// docs/adr/0013 records the decision.
import { strings } from "./views/strings.js";

export function messageText(address, password) {
  if (!password) return null;
  return (
    `${strings["message.addressLabel"]} ${address}` +
    `\n${strings["message.passwordLabel"]} ${password}`
  );
}
