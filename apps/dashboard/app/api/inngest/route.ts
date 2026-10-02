import { serve } from "inngest/next";
import { inngest } from "@/app/lib/inngest/client";
import {
  processDocumentFunction,
  generateInsightsScheduled,
  generateInsightsOnDemand,
  generateCustomerAiReply,
  deliverInternalMessageNotificationFunction,
} from "@/app/lib/inngest/functions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    processDocumentFunction,
    generateInsightsScheduled,
    generateInsightsOnDemand,
    generateCustomerAiReply,
    deliverInternalMessageNotificationFunction,
  ],
});
