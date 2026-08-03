import { TeacherComingSoonPage } from "@/components/teacher/TeacherComingSoonPage";
import { ChatBubbleIcon } from "@/components/ui/icons";

export default function TeacherMessagesPage() {
  return (
    <TeacherComingSoonPage
      Icon={ChatBubbleIcon}
      body="Parent-Teacher messaging coming soon."
    />
  );
}
