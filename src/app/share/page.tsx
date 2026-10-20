import type { Metadata } from "next";
import { ShareInvitation } from "@/features/sharing/share-invitation";

export const metadata: Metadata = {
  title: "Share your location with consent | OpenAirTag",
  description: "A temporary link to share your location with a named account, only after you agree.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function SharePage() {
  return <ShareInvitation />;
}
