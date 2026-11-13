import BriefPage from "@/components/brief/BriefPage";
import { APP_TITLE } from "@/lib/app-config";

const SEO_TITLE = `${APP_TITLE} — pre-meeting briefings you can trust`;
const SEO_DESCRIPTION =
  "Research any company or person in the 30 days before your meeting and get a one-page, fully cited briefing with verified vs. uncertain findings.";

export function meta() {
  return [
    { title: SEO_TITLE },
    { name: "description", content: SEO_DESCRIPTION },
    { property: "og:title", content: SEO_TITLE },
    { property: "og:description", content: SEO_DESCRIPTION },
    { name: "twitter:card", content: "summary" },
  ];
}

export default function HomeRoute() {
  return <BriefPage />;
}
