import { ShieldCheck } from "lucide-react";
import { Brand } from "@/components/brand";

export function AppHeader() {
  return (
    <header className="app-header">
      <Brand />
      <div className="app-header__privacy">
        <ShieldCheck aria-hidden="true" />
        <span>Your name stays separate from the medical analysis.</span>
      </div>
    </header>
  );
}

