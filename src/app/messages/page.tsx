import { ComingSoonPage } from "@/components/parent/ComingSoonPage";
import { ChatBubbleIcon } from "@/components/ui/icons";

export default function MessagesPage() {
  return (
    <ComingSoonPage
      Icon={ChatBubbleIcon}
      body="We are building a secure messaging hub for you and your team."
    />
  );
}
