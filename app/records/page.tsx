import { Suspense } from "react";
import { RecordsScreen } from "@/components/records";
export default function Page() {
  return (
    <Suspense fallback={<p>Loading records…</p>}>
      <RecordsScreen />
    </Suspense>
  );
}
