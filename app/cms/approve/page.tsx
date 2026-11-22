import type { Metadata } from "next";
import { CmsApproval } from "@/components/cms-approval";
export const metadata: Metadata = {
  title: "Approve CMS access",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};
export default function Page() {
  return <CmsApproval />;
}
