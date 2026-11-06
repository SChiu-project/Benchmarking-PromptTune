import { isVercel } from "@/lib/runtime";
import { UploadScreen } from "@/components/upload";
export default function Page() {
  return <UploadScreen hosted={isVercel()} />;
}
