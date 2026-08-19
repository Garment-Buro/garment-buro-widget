import { appPath } from "@/lib/base-path";

export default function MobilePreviewPage() {
  return (
    <main className="mobile-preview-page">
      <iframe
        className="mobile-preview-frame"
        src={appPath("/")}
        title="Garment Buro mobile dashboard"
      />
    </main>
  );
}
