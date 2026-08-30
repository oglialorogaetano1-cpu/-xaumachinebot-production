import { Suspense } from "react";
import CrmApp from "@/components/crm-app";

export default function Home() {
  return <Suspense fallback={<div className="loading">Caricamento CRM…</div>}><CrmApp /></Suspense>;
}
