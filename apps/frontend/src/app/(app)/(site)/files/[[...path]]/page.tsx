import { FileManager } from '@postmill-ai/frontend/components/files/file-manager';
import { Metadata } from 'next';
export const metadata: Metadata = {
  title: `Postmill Files`,
  description: '',
};

// An optional catch-all: `/files` and `/files/<folder>/<subfolder>` both land
// here. The path segments are read client-side off `usePathname()`, since only
// the folder tree can map folder names to ids.
export default async function Page() {
  return (
    <div className="bg-newBgColorInner p-[20px] flex flex-1 flex-col gap-[15px] transition-all min-h-0">
      <FileManager standalone urlSync />
    </div>
  );
}
