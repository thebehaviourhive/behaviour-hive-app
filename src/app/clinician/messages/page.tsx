import { ClinicianComingSoonPage } from "@/components/clinician/ClinicianComingSoonPage";
import { ChatBubbleIcon } from "@/components/ui/icons";

export default function ClinicianMessagesPage() {
  return (
    <ClinicianComingSoonPage
      Icon={ChatBubbleIcon}
      body="Secure clinical messaging coming soon."
    />
  );
}
