import { notFound } from "next/navigation";
import { isDemoChannelEnabled } from "@/app/lib/demo-config";
import { DemoCustomerClient } from "./demo-customer-client";

export const metadata = {
  title: "Virtual Customer Terminal (Demo Channel) | RF Intelligence",
  description: "Phone-style interactive customer simulator for end-to-end RF Intelligence demonstrations without external messaging tunnels.",
};

export default function DemoCustomerPage() {
  if (!isDemoChannelEnabled()) {
    notFound();
  }

  return <DemoCustomerClient />;
}
