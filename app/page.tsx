import { ConversationPage } from "@/components/ConversationPage";
import { PERSONAS } from "@/lib/personas";

export default function Home() {
  return <ConversationPage personas={PERSONAS} />;
}
