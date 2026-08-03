type IconProps = {
  className?: string;
};

function Base({
  className,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function DocumentIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9.5A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5Z" />
      <path d="M14 3.5V8h4" />
      <path d="M8.5 12.5h7M8.5 15.5h7M8.5 9.5h3" />
    </Base>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 12.3l2.4 2.4 4.6-5.2" />
    </Base>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M6 10.5a6 6 0 0 1 12 0v3.5l1.5 3H4.5l1.5-3v-3.5Z" />
      <path d="M10 19.5a2 2 0 0 0 4 0" />
    </Base>
  );
}

export function ClipboardIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="5.5" y="4.5" width="13" height="16" rx="1.5" />
      <path d="M9 4.5V3.75A1.25 1.25 0 0 1 10.25 2.5h3.5A1.25 1.25 0 0 1 15 3.75V4.5" />
      <path d="M8.5 11.5h7M8.5 14.5h7M8.5 17.5h4" />
    </Base>
  );
}

export function KeyIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="8" cy="15" r="3.5" />
      <path d="M10.5 12.5 17 6M15 8l2 2M17.5 5.5l2 2" />
    </Base>
  );
}

export function PeopleIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="8.5" cy="8.5" r="2.75" />
      <circle cx="16" cy="9.5" r="2.25" />
      <path d="M3.75 19v-.75A4.75 4.75 0 0 1 8.5 13.5h0a4.75 4.75 0 0 1 4.75 4.75V19" />
      <path d="M14 14.25a3.75 3.75 0 0 1 6.25 2.79V19" />
    </Base>
  );
}

export function OpenBookIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 6.5c-1.5-1.3-3.7-2-6.5-2v13c2.8 0 5 .7 6.5 2 1.5-1.3 3.7-2 6.5-2v-13c-2.8 0-5 .7-6.5 2Z" />
      <path d="M12 6.5V19.5" />
    </Base>
  );
}

export function LightbulbIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M9 18h6M9.75 21h4.5" />
      <path d="M12 3a6 6 0 0 0-3.5 10.9c.6.45 1 1.2 1 2.1h5c0-.9.4-1.65 1-2.1A6 6 0 0 0 12 3Z" />
    </Base>
  );
}

export function ChatBubbleIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4.5 6.5A2.5 2.5 0 0 1 7 4h10a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 17 16H9l-4.5 4v-4a2.5 2.5 0 0 1 0-.24V6.5Z" />
    </Base>
  );
}

export function ClinicalFileIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9.5A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5Z" />
      <path d="M14 3.5V8h4" />
      <path d="M12 11v5M9.5 13.5h5" />
    </Base>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="5.5" y="10.5" width="13" height="9" rx="1.5" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </Base>
  );
}
