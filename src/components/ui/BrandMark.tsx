import Image from "next/image";

interface BrandMarkProps {
  size?: number;
}

export function BrandMark({ size = 56 }: BrandMarkProps) {
  return (
    <Image
      src="/icons/icon-192.png"
      alt="The Behaviour Hive"
      width={size}
      height={size}
      priority
      className="rounded-full"
    />
  );
}
