import { permanentRedirect } from "next/navigation";

/** /create/agent and /create/user were two kinds of the same account. Both now create the one account. */
export default function CreateKindPage() {
  permanentRedirect("/login?tab=create");
}
