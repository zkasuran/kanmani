import { permanentRedirect } from "next/navigation";

/** The studio is the agents section of the account dashboard now. */
export default function Studio() {
  permanentRedirect("/account#agents");
}
