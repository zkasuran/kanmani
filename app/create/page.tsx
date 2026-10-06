import { permanentRedirect } from "next/navigation";

/** There is one kind of account now, created on the create tab of /login. Old links land there. */
export default function CreatePage() {
  permanentRedirect("/login?tab=create");
}
